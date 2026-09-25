/*
 * Characterizes the book-submission workflow (src/store/submissions/books.js): submit, approve,
 * approveBook, reject, submissionsGroup and checkSubmissionGroup. Dependency seams guarded:
 *
 * - @sindresorhus/slugify: book-detail URLs in approval emails, through util/renderEmailBook.
 * - uuid: chronouid ids for submissions, groups, books and newly created people.
 * - diacritics: almostEqual matching of submitted creator names against existing people.
 * - lodash: groupBy for the per-submitter profile save, get/set behind collection state.
 * - axios: the email request util/sendEmail makes, decoded from the config axios hands its
 *   adapter (method, URL query, AxiosHeaders Authorization), and an adapter failure passing
 *   through axios unwrapped. axios runs for real; only its network adapter is replaced.
 *   src/util/sendEmail.test.js covers the xhr adapter underneath.
 * - vuex 4: namespaced modules reaching each other through root dispatch, rootGetters and
 *   rootState (submissions/books, people, books, users, user, content).
 * - jsdom: window.location.origin, vitest's default http://localhost:3000, in email links, and
 *   localStorage behind user/impersonate.
 * - vitest: vi.mock reaching the SDK behind the dynamic import('@/firebase') every store module
 *   makes. The mock sits at firebase/app rather than at '@/firebase' itself: vitest 2 shares one
 *   import callstack per importing module, so concurrent import('@/firebase') calls from one
 *   module (two submissions saved at once) can bypass a factory mock of '@/firebase' and load the
 *   real SDK. Mocking one level down leaves src/firebase.js real and loaded once.
 *
 * Firebase (pinned at v8, excluded from upgrades) is faked as a small in-memory Realtime
 * Database. Like firebase 8.10.1, its set throws synchronously on an undefined anywhere in the
 * value, so a write the real SDK would refuse cannot pass here. No console.error is allowed
 * unless a test says it expects one (see expectErrors).
 */
import axios from 'axios'
import store from '@/store'

const fb = await vi.hoisted(async () => {
  const { default: lodashGet } = await import('lodash/get')
  const { default: lodashSet } = await import('lodash/set')

  /** Copies a value as a network round trip would. structuredClone rejects Vuex proxies. */
  const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

  /** Splits a database path into lodash path segments. */
  const segments = path => path.split('/').filter(Boolean)

  /** Returns the dotted key path of the first undefined inside value, or null when there is none. */
  const undefinedAt = (value, keys) =>
    value === undefined
      ? keys.join('.')
      : value !== null && typeof value === 'object'
        ? Object.entries(value).reduce(
            (found, [key, child]) => found ?? undefinedAt(child, [...keys, key]),
            null,
          )
        : null

  /** Throws the error firebase 8.10.1's Reference.set throws, synchronously, for an undefined. */
  const validate = (path, value) => {
    const at = undefinedAt(value, segments(path))
    if (at !== null) {
      throw new Error(`set failed: value argument contains undefined in property '${at}'`)
    }
  }

  const state = { db: {}, listeners: [] }

  /** Records every write as (op, path, value), in call order. */
  const write = vi.fn()

  /** Records the path of every once('value') read. */
  const read = vi.fn()

  /** Returns a copy of the value stored at a path, or null when nothing is there. */
  const valueAt = path => clone(lodashGet(state.db, segments(path))) ?? null

  /** Re-delivers to listeners at, above or below a written path, as v8 fires local events. */
  const notify = path =>
    state.listeners
      .filter(
        listener =>
          listener.path === path ||
          path.startsWith(`${listener.path}/`) ||
          listener.path.startsWith(`${path}/`),
      )
      .forEach(listener => listener.callback({ val: () => valueAt(listener.path) }))

  /** A fake v8 Reference supporting the calls the store makes. */
  const ref = path => ({
    set: value => {
      validate(path, value)
      write('set', path, clone(value))
      lodashSet(state.db, segments(path), clone(value))
      notify(path)
      return Promise.resolve()
    },
    once: (event, callback) => {
      read(path)
      setTimeout(() => callback({ val: () => valueAt(path) }), 0)
    },
    on: (event, callback) => {
      state.listeners = [...state.listeners, { path, callback }]
      queueMicrotask(() => callback({ val: () => valueAt(path) }))
    },
  })

  const auth = { currentUser: null }

  return {
    state,
    write,
    read,
    auth,
    firebase: { initializeApp: () => {}, auth: () => auth, database: () => ({ ref }) },
  }
})

vi.mock('firebase/app', () => ({ default: fb.firebase }))
vi.mock('firebase/auth', () => ({}))
vi.mock('firebase/database', () => ({}))
vi.mock('firebase/storage', () => ({}))

const NOW = '2024-01-01T00:00:00.000Z'
/** Every chronouid minted at NOW: (253402304400000 - Date.now()) in hex, then 7 uuid chars. */
const CHRONOUID = /^e4eb1004d680-[0-9a-f]{7}$/
const EMAIL_URL = 'https://email.example.test/send'
const ADMIN = 'admin@example.test'
/** vitest's default jsdom URL, hardcoded so a changed window.location.origin fails every link. */
const ORIGIN = 'http://localhost:3000'

/** Stands in for the network under axios, answering every request with a 200. */
const adapter = vi.fn()
const originalAdapter = axios.defaults.adapter

/** Set by a test that expects console.error, which exempts it from the afterEach check. */
let errorsExpected = false

/** Marks the running test as one that logs through console.error on purpose. */
const expectErrors = () => {
  errorsExpected = true
}

/** Returns a fresh signed-in contributor, Ada. */
const contributor = () => ({
  uid: 'c1',
  roles: { authorized: true, contributor: true },
  profile: {
    name: 'Ada King Lovelace',
    email: 'ada@example.test',
    submissions: { old1: 'approved' },
    draftBooks: [{ title: 'Draft' }],
    bookmarks: {},
  },
})

/** Returns the owner's stored profile. */
const ownerProfile = () => ({
  name: 'Olivia Owner',
  email: 'olivia@example.test',
  submissions: {},
})

/** Returns a fresh signed-in owner, Olivia. */
const owner = () => ({
  uid: 'owner1',
  roles: { authorized: true, owner: true },
  profile: ownerProfile(),
})

/** Returns the email templates the content collection holds. */
const templates = () => ({
  email: {
    submissions: {
      pending: {
        book: {
          subject: 'New books from FULL_NAME',
          body: '<p>FIRST_NAME|LAST_NAME|FULL_NAME</p>NEW_BOOKS',
        },
      },
      approved: {
        book: {
          subject: 'Your books are in, FIRST_NAME',
          body: '<p>FIRST_NAME|LAST_NAME|FULL_NAME</p>NEW_BOOKS',
        },
      },
      rejected: {
        book: {
          subject: 'About your suggestion, FIRST_NAME',
          body: '<p>Sorry FULL_NAME</p>[NEW_BOOKS]',
        },
      },
    },
  },
})

/** Returns every recorded database write as { op, path, value }. */
const writes = () => fb.write.mock.calls.map(([op, path, value]) => ({ op, path, value }))

/** Returns the recorded writes other than the cache/clean flag. */
const dataWrites = () => writes().filter(({ path }) => path !== 'cache/clean')

/** Returns the recorded writes under a top-level database path such as 'people'. */
const writesUnder = root => dataWrites().filter(({ path }) => path.startsWith(`${root}/`))

/** Returns the value of the last write to an exact path. */
const lastSet = path => dataWrites().findLast(write => write.path === path)?.value

/** Returns the key a write landed on, the last segment of its path. */
const keyOf = write => write.path.split('/').at(-1)

/** Decodes the request config axios handed its adapter into the email it carries. */
const parseEmail = ([config]) => {
  const { origin: host, pathname, searchParams } = new URL(config.url)
  return {
    method: config.method,
    endpoint: `${host}${pathname}`,
    to: searchParams.get('to'),
    subject: searchParams.get('subject'),
    body: searchParams.get('body'),
    authorization: config.headers.Authorization,
  }
}

/** Returns every email that reached the network adapter so far, decoded, in send order. */
const emails = () => adapter.mock.calls.map(parseEmail)

/** Lets un-awaited saves and the fake's setTimeout reads run to completion. */
const settle = () =>
  Array.from({ length: 5 }).reduce(
    promise => promise.then(() => new Promise(resolve => setTimeout(resolve, 0))),
    Promise.resolve(),
  )

/** Returns the book submissions held in state, in insertion order. */
const submissionsInState = () => Object.values(store.state.submissions.books.data)

beforeEach(() => {
  vi.setSystemTime(new Date(NOW))
  vi.stubEnv('VUE_APP_EMAIL_URL', EMAIL_URL)
  vi.stubEnv('VUE_APP_ADMIN_EMAIL', ADMIN)
  adapter.mockReset()
  adapter.mockImplementation(async config => ({
    data: 'sent',
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  }))
  axios.defaults.adapter = adapter
  vi.spyOn(console, 'error').mockImplementation(() => {})
  errorsExpected = false

  fb.state.db = {}
  fb.state.listeners = []
  fb.write.mockClear()
  fb.read.mockClear()
  fb.auth.currentUser = { getIdToken: async () => 'id-token-c1' }
  localStorage.clear()

  store.commit('submissions/books/reset')
  store.commit('people/reset')
  store.commit('books/reset')
  store.commit('users/reset')
  store.commit('content/reset')
  store.commit('user/impersonate', null)
  store.commit('user/setUser', contributor())
  store.commit('content/set', templates())
})

afterEach(async () => {
  try {
    await settle()
    if (!errorsExpected) expect(console.error).not.toHaveBeenCalled()
  } finally {
    axios.defaults.adapter = originalAdapter
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  }
})

test("runs on vitest's default jsdom origin, the host every email link names", () => {
  expect(window.location.origin).toBe(ORIGIN)
})

describe('submit', () => {
  /** A submission shaped loosely, as callers may pass it. */
  const julian = () => ({
    title: 'Julián Is a Mermaid',
    authors: ['Jessica Love'],
    illustrators: 'Jessica Love',
    isbn: 9780763690458,
    publisher: 'Candlewick',
    summary: 'A boy dreams',
    tags: { t1: true },
    thumbnail: 'https://covers.example.test/julian.jpg',
    year: 2018,
  })

  /** A sparse submission, as the form sends it before metadata arrives. */
  const hair = () => ({
    title: "Don't Touch My Hair!",
    authors: 'Sharee Miller',
    isbn: '9780316562584',
    thumbnail: '',
    createdAt: '2023-12-31T00:00:00.000Z',
  })

  /** Submits both fixture books as the signed-in user and returns the records in state. */
  const submitTwo = async () => {
    await expect(store.dispatch('submissions/books/submit', [julian(), hair()])).resolves.toBe(
      undefined,
    )
    return submissionsInState()
  }

  test('stores each submission keyed by its own chronouid, normalized, with one shared group', async () => {
    const [first, second] = await submitTwo()

    expect(Object.keys(store.state.submissions.books.data)).toEqual([first.id, second.id])
    expect(first).toStrictEqual({
      authors: 'Jessica Love',
      group: first.group,
      id: first.id,
      illustrators: 'Jessica Love',
      isbn: '9780763690458',
      publisher: 'Candlewick',
      reviewComment: '',
      status: 'pending',
      summary: 'A boy dreams',
      tags: { t1: true },
      thumbnail: 'https://covers.example.test/julian.jpg',
      title: 'Julián Is a Mermaid',
      type: 'book',
      year: 2018,
    })
    expect(second).toStrictEqual({
      authors: 'Sharee Miller',
      group: first.group,
      id: second.id,
      illustrators: '',
      isbn: '9780316562584',
      publisher: '',
      reviewComment: '',
      status: 'pending',
      summary: '',
      tags: {},
      thumbnail: '',
      title: "Don't Touch My Hair!",
      type: 'book',
      year: '',
    })
    expect([first.group, first.id, second.id]).toEqual([
      expect.stringMatching(CHRONOUID),
      expect.stringMatching(CHRONOUID),
      expect.stringMatching(CHRONOUID),
    ])
    expect(new Set([first.group, first.id, second.id]).size).toBe(3)
  })

  test('writes each submission to submits/books with created and updated stamps', async () => {
    const [first, second] = await submitTwo()
    const stamps = { createdAt: NOW, createdBy: 'c1', updatedAt: NOW, updatedBy: 'c1' }

    await vi.waitFor(() => {
      expect(lastSet(`submits/books/${first.id}`)).toEqual({ ...first, ...stamps })
      expect(lastSet(`submits/books/${second.id}`)).toEqual({ ...second, ...stamps })
    })
    expect(writes()).toContainEqual({ op: 'set', path: 'cache/clean', value: false })
  })

  test('saves the submitter profile once, clearing drafts and marking each submission pending', async () => {
    const [first, second] = await submitTwo()
    const profile = {
      name: 'Ada King Lovelace',
      email: 'ada@example.test',
      bookmarks: {},
      draftBooks: [],
      submissions: { old1: 'approved', [first.id]: 'pending', [second.id]: 'pending' },
    }

    await vi.waitFor(() => expect(store.state.user.user.profile).toEqual(profile))
    await settle()
    expect(writesUnder('users')).toEqual([{ op: 'set', path: 'users/c1/profile', value: profile }])
  })

  test('emails the admin a pending notice listing every submission, sent with the ID token', async () => {
    await submitTwo()
    await settle()

    expect(emails()).toEqual([
      {
        method: 'get',
        endpoint: EMAIL_URL,
        to: ADMIN,
        subject: 'New books from Ada King Lovelace',
        body: expect.any(String),
        authorization: 'Bearer id-token-c1',
      },
    ])
    const { body } = emails()[0]
    expect(body).toContain('<p>Ada|King Lovelace|Ada King Lovelace</p>')
    expect(body).toContain(
      `<a href="${ORIGIN}/admin/review/books" target="_blank">Julián Is a Mermaid</a>`,
    )
    expect(body).toContain(
      `<a href="${ORIGIN}/admin/review/books" target="_blank">Don't Touch My Hair!</a>`,
    )
    expect(body).toContain('<b>words by</b> Jessica Love')
    expect(body).toContain('<b>words by</b> Sharee Miller')
    expect(body).toContain('<img src="https://covers.example.test/julian.jpg" width="150" />')
  })

  test('addresses a submitter with no name as "friend"', async () => {
    store.commit('user/setUser', { ...contributor(), profile: { email: 'ada@example.test' } })

    await store.dispatch('submissions/books/submit', [hair()])

    expect(emails().map(({ subject }) => subject)).toEqual(['New books from friend'])
    expect(emails()[0].body).toContain('<p>friend||friend</p>')
  })

  test('logs and skips the email when the pending template is missing, still saving everything', async () => {
    expectErrors()
    store.commit('content/set', {})

    const [first, second] = await submitTwo()

    expect(adapter).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith(
      'No email template at content/email/submissions/pending/book',
      [first, second],
    )
    await vi.waitFor(() =>
      expect(
        dataWrites()
          .map(({ path }) => path)
          .toSorted(),
      ).toEqual(
        [`submits/books/${first.id}`, `submits/books/${second.id}`, 'users/c1/profile'].toSorted(),
      ),
    )
  })

  test('still resolves when the email request fails, logging the failure', async () => {
    expectErrors()
    const boom = new Error('boom')
    adapter.mockRejectedValueOnce(boom)

    await submitTwo()

    expect(adapter).toHaveBeenCalledTimes(1)
    // sendEmail logs the adapter's own error, which axios passes through unwrapped, then rethrows
    // it rewrapped; submit logs that and resolves anyway
    expect(console.error.mock.calls).toEqual([
      [boom],
      ['Email failed to send'],
      [expect.objectContaining({ message: 'Error sending email: boom' })],
    ])
  })

  describe('as an owner', () => {
    /** An owner-entered submission credited to the owner, with an illustrator marked "same". */
    const ownersBook = () => ({
      title: 'Julián Is a Mermaid',
      authors: 'Jessica Love',
      illustrators: 'same',
      isbn: '9780763690458',
      publisher: 'Candlewick',
      summary: 's',
      tags: { t1: true },
      thumbnail: 'https://covers.example.test/julian.jpg',
      year: '2018',
      createdBy: 'owner1',
    })

    /** The owner's profile as the users collection holds it, which differs from the session's. */
    const storedOwnerProfile = () => ({ ...ownerProfile(), submissions: { prev: 'approved' } })

    beforeEach(() => {
      store.commit('user/setUser', owner())
      store.commit('users/set', {
        owner1: { profile: storedOwnerProfile() },
        c1: { profile: contributor().profile },
      })
      store.commit('people/set', {})
    })

    test('approves the submission at once: new person, approved book, approved profile entry', async () => {
      await store.dispatch('submissions/books/submit', [ownersBook()])
      const [sub] = submissionsInState()

      const [personWrite, ...otherPeople] = writesUnder('people')
      expect(otherPeople).toEqual([])
      const personId = keyOf(personWrite)
      expect(personId).toMatch(CHRONOUID)
      expect(personWrite.value).toMatchObject({
        id: personId,
        name: 'Jessica Love',
        reviewedBy: 'owner1',
        createdAt: NOW,
        createdBy: 'owner1',
        updatedAt: NOW,
        updatedBy: 'owner1',
      })

      const [bookWrite, ...otherBooks] = writesUnder('books')
      expect(otherBooks).toEqual([])
      const bookId = keyOf(bookWrite)
      expect(bookId).toMatch(CHRONOUID)
      expect(bookWrite.value).toEqual({
        createdBy: 'owner1',
        creators: { [personId]: 'author-illustrator' },
        goodreads: '',
        id: bookId,
        isbn: '9780763690458',
        cover: { downloadUrl: 'https://covers.example.test/julian.jpg' },
        publisher: 'Candlewick',
        reviewedAt: NOW,
        reviewedBy: 'owner1',
        status: 'approved',
        submissionId: sub.id,
        summary: 's',
        tags: { t1: true },
        thumbnail: 'https://covers.example.test/julian.jpg',
        title: 'Julián Is a Mermaid',
        year: '2018',
        createdAt: NOW,
        updatedAt: NOW,
        updatedBy: 'owner1',
      })

      expect(writes()).toContainEqual({
        op: 'set',
        path: `users/owner1/profile/submissions/${sub.id}`,
        value: 'approved',
      })
      expect(lastSet(`submits/books/${sub.id}`)).toEqual({
        ...sub,
        bookId,
        reviewedAt: NOW,
        reviewedBy: 'owner1',
        status: 'approved',
        createdAt: NOW,
        updatedAt: NOW,
        updatedBy: 'owner1',
      })
    })

    test("saves the credited user's stored profile, not the session's, with the submission marked pending", async () => {
      await store.dispatch('submissions/books/submit', [ownersBook()])
      const [sub] = submissionsInState()
      const profile = {
        ...ownerProfile(),
        draftBooks: [],
        submissions: { prev: 'approved', [sub.id]: 'pending' },
      }

      await vi.waitFor(() => expect(store.state.user.user.profile).toEqual(profile))
      await settle()
      expect(dataWrites().filter(({ path }) => path === 'users/owner1/profile')).toEqual([
        { op: 'set', path: 'users/owner1/profile', value: profile },
      ])
    })

    test('credits the book, the submission and the approved profile entry to the user the owner names', async () => {
      await store.dispatch('submissions/books/submit', [{ ...ownersBook(), createdBy: 'c1' }])
      const [sub] = submissionsInState()
      await settle()

      // Left unpinned: user/saveProfile writes to the signed-in owner's own users/owner1/profile,
      // so c1's stored profile currently overwrites the owner's (a suspected bug).

      const [bookWrite, ...otherBooks] = writesUnder('books')
      expect(otherBooks).toEqual([])
      expect(bookWrite.value).toMatchObject({
        createdBy: 'c1',
        reviewedBy: 'owner1',
        status: 'approved',
        submissionId: sub.id,
        updatedBy: 'owner1',
      })
      expect(writes()).toContainEqual({
        op: 'set',
        path: `users/c1/profile/submissions/${sub.id}`,
        value: 'approved',
      })
      expect(lastSet(`submits/books/${sub.id}`)).toMatchObject({
        createdBy: 'c1',
        bookId: keyOf(bookWrite),
        status: 'approved',
        updatedBy: 'owner1',
      })
    })

    test('sends no email at all, neither the pending notice nor an approval', async () => {
      await store.dispatch('submissions/books/submit', [ownersBook()])
      await settle()
      const [sub] = submissionsInState()

      // approveBook writes the approved record to the database but never commits it to state, so
      // checkSubmissionGroup still finds the group's record pending and stops before emailing
      expect(sub.status).toBe('pending')
      expect(adapter).not.toHaveBeenCalled()
    })

    test('takes the pending path while impersonating a contributor', async () => {
      store.commit('user/impersonate', 'contributor')
      const { createdBy, ...uncredited } = ownersBook()

      await store.dispatch('submissions/books/submit', [uncredited])
      await settle()

      expect(localStorage.getItem('impersonate')).toBe('contributor')
      expect(dataWrites().filter(({ path }) => /^(people|books)\//.test(path))).toEqual([])
      expect(emails().map(({ to, subject }) => ({ to, subject }))).toEqual([
        { to: ADMIN, subject: 'New books from Olivia Owner' },
      ])
    })
  })
})

describe('approveBook', () => {
  /** A pending submission crediting one existing author, one new author and one illustrator. */
  const nino = () => ({
    id: 's1',
    group: 'g1',
    createdBy: 'c1',
    createdAt: '2023-12-01T00:00:00.000Z',
    title: 'Niño Wrestles the World',
    authors: 'Jose Perez, Ada Author',
    illustrators: 'grace lin',
    isbn: '9781596436046',
    publisher: 'Roaring Brook',
    summary: 'Lucha libre',
    tags: { t1: true },
    thumbnail: 'https://covers.example.test/nino.jpg',
    year: '2013',
    status: 'pending',
  })

  /** Returns the value of the only book written. */
  const onlyBook = () => {
    const books = writesUnder('books')
    expect(books).toHaveLength(1)
    return books[0].value
  }

  /** Approves one submission as the signed-in owner. */
  const approveBook = sub => store.dispatch('submissions/books/approveBook', sub)

  beforeEach(() => {
    store.commit('user/setUser', owner())
    store.commit('people/set', {
      p1: { id: 'p1', name: 'José Pérez' },
      p2: { id: 'p2', name: 'Grace Lin' },
    })
  })

  test('matches creators to people ignoring case and accents, and creates the rest', async () => {
    await approveBook(nino())

    const [personWrite, ...otherPeople] = writesUnder('people')
    expect(otherPeople).toEqual([])
    const personId = keyOf(personWrite)
    expect(personId).toMatch(CHRONOUID)
    expect(personWrite.value).toMatchObject({
      id: personId,
      name: 'Ada Author',
      reviewedBy: 'owner1',
      createdAt: NOW,
      createdBy: 'owner1',
      updatedAt: NOW,
      updatedBy: 'owner1',
    })

    const book = onlyBook()
    expect(book.id).toMatch(CHRONOUID)
    expect(book).toEqual({
      createdBy: 'c1',
      creators: { p1: 'author', [personId]: 'author', p2: 'illustrator' },
      goodreads: '',
      id: book.id,
      isbn: '9781596436046',
      cover: { downloadUrl: 'https://covers.example.test/nino.jpg' },
      publisher: 'Roaring Brook',
      reviewedAt: NOW,
      reviewedBy: 'owner1',
      status: 'approved',
      submissionId: 's1',
      summary: 'Lucha libre',
      tags: { t1: true },
      thumbnail: 'https://covers.example.test/nino.jpg',
      title: 'Niño Wrestles the World',
      year: '2013',
      createdAt: NOW,
      updatedAt: NOW,
      updatedBy: 'owner1',
    })
  })

  test('writes the person, book, profile entry and approved submission in that order', async () => {
    await approveBook(nino())

    const [personWrite] = writesUnder('people')
    const book = onlyBook()
    expect(dataWrites()).toEqual([
      { op: 'set', path: `people/${keyOf(personWrite)}`, value: personWrite.value },
      { op: 'set', path: `books/${book.id}`, value: book },
      { op: 'set', path: 'users/c1/profile/submissions/s1', value: 'approved' },
      {
        op: 'set',
        path: 'submits/books/s1',
        value: {
          ...nino(),
          bookId: book.id,
          reviewedAt: NOW,
          reviewedBy: 'owner1',
          status: 'approved',
          updatedAt: NOW,
          updatedBy: 'owner1',
        },
      },
    ])
    expect(writes()).toContainEqual({ op: 'set', path: 'cache/clean', value: false })
  })

  test.each(['same', 'the same', 'is same', ' Same '])(
    'credits the authors as author-illustrators when illustrators is %j',
    async illustrators => {
      await approveBook({ ...nino(), authors: 'Grace Lin', illustrators })

      expect(onlyBook().creators).toEqual({ p2: 'author-illustrator' })
      expect(writesUnder('people')).toEqual([])
    },
  )

  test('credits one person as author-illustrator when both fields spell them differently', async () => {
    await approveBook({ ...nino(), authors: 'José Pérez', illustrators: 'Jose Perez' })

    expect(onlyBook().creators).toEqual({ p1: 'author-illustrator' })
    expect(writesUnder('people')).toEqual([])
  })

  test('splits names on commas, semicolons, ampersands and "and", creating each person', async () => {
    store.commit('people/set', {})

    await approveBook({
      ...nino(),
      authors: 'Ann Bee & Cy Dee; Eve Fox and Gus Hay, Ida Jay',
      illustrators: '',
    })

    const people = writesUnder('people')
    expect(people.map(({ value }) => value.name).toSorted()).toEqual([
      'Ann Bee',
      'Cy Dee',
      'Eve Fox',
      'Gus Hay',
      'Ida Jay',
    ])
    const ids = people.map(keyOf)
    expect(ids).toEqual(Array(5).fill(expect.stringMatching(CHRONOUID)))
    expect(new Set(ids).size).toBe(5)
    expect(onlyBook().creators).toEqual(Object.fromEntries(ids.map(id => [id, 'author'])))
  })

  test('reuses a person just created for an author when the illustrator names them again, while people are subscribed', async () => {
    store.dispatch('people/subscribe')
    await settle()

    await approveBook({ ...nino(), authors: 'Ada Author', illustrators: 'ada author' })

    const [personWrite, ...otherPeople] = writesUnder('people')
    expect(otherPeople).toEqual([])
    expect(onlyBook().creators).toEqual({ [keyOf(personWrite)]: 'author-illustrator' })
  })

  test.each([
    [
      'a cover url',
      { cover: { url: 'https://c.example.test/a.jpg' } },
      { downloadUrl: 'https://c.example.test/a.jpg' },
    ],
    [
      'a base64 cover',
      { cover: { base64: 'data:image/png;base64,AAA' } },
      { base64: 'data:image/png;base64,AAA' },
    ],
    [
      'both a cover url and base64',
      { cover: { url: 'https://c.example.test/a.jpg', base64: 'data:image/png;base64,AAA' } },
      { downloadUrl: 'https://c.example.test/a.jpg', base64: 'data:image/png;base64,AAA' },
    ],
    ['no cover and no thumbnail', { thumbnail: '' }, {}],
    ['an empty cover, which hides the thumbnail', { cover: {} }, {}],
  ])('maps %s onto the book cover', async (_, fields, cover) => {
    await approveBook({ ...nino(), ...fields })

    expect(onlyBook().cover).toEqual(cover)
  })

  test('rejects a submission missing a field the book copies as-is, as the v8 SDK refuses undefined', async () => {
    const { publisher, ...sparse } = nino()

    await expect(approveBook(sparse)).rejects.toThrow(
      /^set failed: value argument contains undefined in property 'books\.e4eb1004d680-[0-9a-f]{7}\.publisher'$/,
    )

    expect(writesUnder('people')).toHaveLength(1)
    expect(writesUnder('books')).toEqual([])
    expect(writesUnder('submits')).toEqual([])
  })

  test('passes a goodreads link through to the book', async () => {
    await approveBook({ ...nino(), goodreads: 'https://goodreads.example.test/1' })

    expect(onlyBook().goodreads).toBe('https://goodreads.example.test/1')
  })

  test('emails the submitter once the subscribed group has no pending record left', async () => {
    fb.state.db = {
      submits: { books: { s1: nino() } },
      users: { c1: { profile: { name: 'Ada King Lovelace', email: 'ada@example.test' } } },
    }
    store.dispatch('submissions/books/subscribe')
    await settle()

    await approveBook(nino())

    const book = onlyBook()
    expect(store.state.submissions.books.data.s1).toMatchObject({
      status: 'approved',
      bookId: book.id,
    })
    expect(emails().map(({ to, subject }) => ({ to, subject }))).toEqual([
      { to: 'ada@example.test', subject: 'Your books are in, Ada' },
    ])
    expect(emails()[0].body).toContain(
      `<a href="${ORIGIN}/book/nino-wrestles-the-world-9781596436046" target="_blank">Niño Wrestles the World</a>`,
    )
  })
})

describe('approve', () => {
  test('approves submissions one after another, in the order given', async () => {
    store.commit('user/setUser', owner())
    store.commit('people/set', {})
    /** A pending submission, shaped as submit stores it, whose single new author is named after it. */
    const sub = id => ({
      id,
      group: 'g1',
      createdBy: 'c1',
      createdAt: '2023-12-01T00:00:00.000Z',
      title: `Title ${id}`,
      authors: `Author ${id}`,
      illustrators: '',
      isbn: '9780000000017',
      publisher: '',
      summary: '',
      tags: {},
      year: '',
      status: 'pending',
      thumbnail: '',
    })
    /** Names the submission a write belongs to: by path, by submissionId or by person name. */
    const submissionOf = ({ path, value }) =>
      ['s1', 's2'].find(
        id =>
          path.endsWith(`/${id}`) || value?.submissionId === id || value?.name === `Author ${id}`,
      )

    await store.dispatch('submissions/books/approve', [sub('s1'), sub('s2')])

    expect(writesUnder('books').map(({ value }) => value.submissionId)).toEqual(['s1', 's2'])
    expect(dataWrites().map(submissionOf)).toEqual(['s1', 's1', 's1', 's1', 's2', 's2', 's2', 's2'])
  })
})

describe('reject', () => {
  /** The only submission in group g1, still pending. */
  const s1 = () => ({
    id: 's1',
    group: 'g1',
    createdBy: 'c1',
    createdAt: '2023-12-01T00:00:00.000Z',
    title: 'Julián Is a Mermaid',
    authors: 'Jessica Love',
    illustrators: '',
    isbn: '9780763690458',
    status: 'pending',
    thumbnail: '',
  })

  beforeEach(() => {
    store.commit('user/setUser', owner())
    store.commit('submissions/books/set', { s1: s1() })
    fb.state.db = {
      users: { c1: { profile: { name: 'Ada King Lovelace', email: 'ada@example.test' } } },
    }
  })

  test('stamps the passed submission as rejected by the reviewer and stores it', async () => {
    const sub = s1()

    await store.dispatch('submissions/books/reject', sub)

    const rejected = { ...s1(), reviewedBy: 'owner1', reviewedAt: NOW, status: 'rejected' }
    expect(sub).toEqual(rejected)
    expect(store.state.submissions.books.data.s1).toEqual(rejected)
  })

  test('writes the rejected submission and the submitter profile entry', async () => {
    await store.dispatch('submissions/books/reject', s1())

    expect(dataWrites()).toEqual([
      {
        op: 'set',
        path: 'submits/books/s1',
        value: {
          ...s1(),
          reviewedBy: 'owner1',
          reviewedAt: NOW,
          status: 'rejected',
          updatedAt: NOW,
          updatedBy: 'owner1',
        },
      },
      { op: 'set', path: 'users/c1/profile/submissions/s1', value: 'rejected' },
    ])
  })

  test('emails the submitter the rejection once the group is fully reviewed', async () => {
    await store.dispatch('submissions/books/reject', s1())

    expect(fb.read).toHaveBeenCalledWith('users/c1')
    expect(emails()).toEqual([
      {
        method: 'get',
        endpoint: EMAIL_URL,
        to: 'ada@example.test',
        subject: 'About your suggestion, Ada',
        body: expect.stringContaining('<p>Sorry Ada King Lovelace</p>[]'),
        authorization: 'Bearer id-token-c1',
      },
    ])
  })
})

describe('submissionsGroup and checkSubmissionGroup', () => {
  /** Returns a reviewed record in group g1, submitted by c1. */
  const reviewed = (id, status, fields) => ({
    id,
    group: 'g1',
    createdBy: 'c1',
    status,
    authors: 'Someone',
    illustrators: '',
    thumbnail: '',
    ...fields,
  })

  /** Four approved books and one rejected in g1, plus a pending record in g2. */
  const records = () => ({
    a: reviewed('a', 'approved', {
      title: "Don't Touch My Hair!",
      isbn: '9780316562584',
      authors: 'Sharee Miller',
      thumbnail: 'https://covers.example.test/hair.jpg',
    }),
    b: reviewed('b', 'approved', { title: 'Julián Is a Mermaid', isbn: '9780763690458' }),
    c: reviewed('c', 'approved', { title: 'Old MacDonald & Friends', isbn: '9780000000017' }),
    d: reviewed('d', 'approved', {
      title: 'Don’t Let the Pigeon Drive the Bus!',
      isbn: '9780786819881',
    }),
    e: reviewed('e', 'rejected', { title: 'Rejected Title', isbn: '9780000000024' }),
    f: { ...reviewed('f', 'pending', { title: 'Elsewhere', isbn: '9780000000031' }), group: 'g2' },
  })

  /** Returns the fixture records in group g1. */
  const g1 = () => Object.values(records()).filter(({ group }) => group === 'g1')

  /** Stores the submitter's profile in the fake database. */
  const seedSubmitter = profile => {
    fb.state.db = { users: { c1: { profile } } }
  }

  /** Runs the group check for g1. */
  const checkG1 = () => store.dispatch('submissions/books/checkSubmissionGroup', 'g1')

  beforeEach(() => {
    store.commit('user/setUser', owner())
    store.commit('submissions/books/set', records())
    seedSubmitter({ name: 'Ada King Lovelace', email: 'ada@example.test' })
  })

  test('submissionsGroup resolves only the records in the requested group', async () => {
    await expect(store.dispatch('submissions/books/submissionsGroup', 'g1')).resolves.toEqual(g1())
  })

  test('submissionsGroup resolves nothing for an unknown group or before the collection loads', async () => {
    await expect(store.dispatch('submissions/books/submissionsGroup', 'nope')).resolves.toEqual([])

    store.commit('submissions/books/reset')

    await expect(store.dispatch('submissions/books/submissionsGroup', 'g1')).resolves.toEqual([])
  })

  test.each([
    ['an unknown group', () => {}, 'nope'],
    ['a collection not yet loaded', () => store.commit('submissions/books/reset'), 'g1'],
  ])('reads and sends nothing for %s', async (_, arrange, gid) => {
    arrange()

    await store.dispatch('submissions/books/checkSubmissionGroup', gid)
    await settle()

    expect(fb.read).not.toHaveBeenCalled()
    expect(adapter).not.toHaveBeenCalled()
  })

  test('emails the submitter once, linking each approved book by its slug', async () => {
    await checkG1()

    expect(emails().map(({ to, subject }) => ({ to, subject }))).toEqual([
      { to: 'ada@example.test', subject: 'Your books are in, Ada' },
    ])
    const { body } = emails()[0]
    expect(body).toContain(`${ORIGIN}/book/dont-touch-my-hair-9780316562584`)
    expect(body).toContain(`${ORIGIN}/book/julian-is-a-mermaid-9780763690458`)
    expect(body).toContain(`${ORIGIN}/book/old-mac-donald-and-friends-9780000000017`)
    expect(body).toContain(`${ORIGIN}/book/don-t-let-the-pigeon-drive-the-bus-9780786819881`)
    expect(body).toContain(
      `<a href="${ORIGIN}/book/dont-touch-my-hair-9780316562584" target="_blank">Don't Touch My Hair!</a>`,
    )
    expect(body).toContain('<img src="https://covers.example.test/hair.jpg" width="150" />')
    expect(body).not.toContain('Rejected Title')
  })

  test.each([
    ['Ada King Lovelace', '<p>Ada|King Lovelace|Ada King Lovelace</p>'],
    ['Ada', '<p>Ada||Ada</p>'],
    ['', '<p>friend||friend</p>'],
  ])('splits the submitter name %j into first and last name', async (name, greeting) => {
    seedSubmitter({ name, email: 'ada@example.test' })

    await checkG1()

    expect(emails()[0].body).toContain(greeting)
  })

  test('uses the rejected template with no books listed when the whole group was rejected', async () => {
    store.commit('submissions/books/set', {
      a: reviewed('a', 'rejected', { title: 'One', isbn: '9780000000017' }),
      b: reviewed('b', 'rejected', { title: 'Two', isbn: '9780000000024' }),
    })

    await checkG1()

    expect(emails().map(({ subject }) => subject)).toEqual(['About your suggestion, Ada'])
    expect(emails()[0].body).toContain('<p>Sorry Ada King Lovelace</p>[]')
  })

  test('reads no submitter and sends nothing while any record in the group is pending', async () => {
    store.commit('submissions/books/set', {
      ...records(),
      g: reviewed('g', 'pending', { title: 'Still Waiting', isbn: '9780000000048' }),
    })

    await checkG1()
    await settle()

    expect(fb.read).not.toHaveBeenCalledWith('users/c1')
    expect(adapter).not.toHaveBeenCalled()
  })

  test('logs and sends nothing when the submitter has no email', async () => {
    expectErrors()
    seedSubmitter({ name: 'Ada King Lovelace' })

    await checkG1()

    expect(console.error).toHaveBeenCalledWith('No email for user c1', g1())
    expect(adapter).not.toHaveBeenCalled()
  })

  test('logs and sends nothing when the approved template is missing', async () => {
    expectErrors()
    store.commit('content/set', {})

    await checkG1()

    expect(console.error).toHaveBeenCalledWith(
      'No email template at email/submissions/approved/book',
      g1(),
    )
    expect(adapter).not.toHaveBeenCalled()
  })

  test('still resolves when the email request fails, logging the failure', async () => {
    expectErrors()
    const boom = new Error('boom')
    adapter.mockRejectedValueOnce(boom)

    await expect(checkG1()).resolves.toBe(undefined)

    expect(adapter).toHaveBeenCalledTimes(1)
    expect(console.error.mock.calls).toEqual([
      [boom],
      ['Email failed to send'],
      [expect.objectContaining({ message: 'Error sending email: boom' })],
    ])
  })
})
