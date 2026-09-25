/*
 * Characterization tests for the people submissions store (src/store/submissions/people.js):
 * submit, the owner auto-approval it triggers, updateSubmission, reject, approvePerson and approve.
 * Dependency seams guarded:
 *
 * - uuid (through util/chronouid): every new submission id and person id is a chronouid, a
 *   reverse-time hex prefix plus the first 7 hex characters of a v4 uuid.
 * - lodash/pick against the personSubmission schema: which submission fields become the public
 *   person record, and which (id, status, reviewComment, type, personId) stay behind. A schema key
 *   the submission lacks is left out rather than set to undefined, so the person keeps its own.
 * - axios: the GET that util/sendEmail makes to the email service, its query string and its
 *   Authorization header. axios runs for real; only its network adapter is replaced.
 * - vuex 4: a namespaced module dispatching root actions ({ root: true }) and reading rootGetters
 *   (users/loadOne, people/get, submissions/people/get, content/get, user/saveProfile), and a
 *   dispatch that resolves to whatever a non-async action returns.
 * - jsdom: window.location.origin in the review links of the pending email, and the window globals
 *   the real '@/store' singleton touches when it is imported.
 *
 * Firebase (pinned at v8) is the one boundary faked: firebase/app becomes an in-memory Realtime
 * Database that honours the v8 set vs update contract the store relies on, so the real
 * src/firebase.js and each module's lazy import of it still run.
 */
import axios from 'axios'
import store from '@/store'

const fb = vi.hoisted(() => {
  /** Deep-copies a value through JSON, which also unwraps Vuex's reactive proxies. */
  const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

  /** Drops null children and empty objects, as the Realtime Database does when it stores a value. */
  const prune = value => {
    if (value === null || typeof value !== 'object') return value
    const entries = Object.entries(value)
      .map(([key, child]) => [key, prune(child)])
      .filter(([, child]) => child !== null)
    return entries.length ? Object.fromEntries(entries) : null
  }

  /** Returns the key path of the first undefined inside value, or null when there is none. */
  const undefinedAt = (value, at = '') =>
    value === undefined
      ? at || '/'
      : value !== null && typeof value === 'object'
        ? Object.entries(value).reduce(
            (found, [key, child]) => found ?? undefinedAt(child, `${at}/${key}`),
            null,
          )
        : null

  /** Throws, as Firebase v8 does, when asked to store undefined anywhere in a value. */
  const validate = (method, path, value) => {
    const at = undefinedAt(value)
    if (at) throw new Error(`Reference.${method} failed: ${path} contains undefined at ${at}`)
  }

  /** Splits a database path into its keys. */
  const keysOf = path => path.split('/').filter(Boolean)

  /** Returns node with value stored at the key path, without mutating node. */
  const assign = (node, keys, value) => {
    if (keys.length === 0) return value
    const [key, ...rest] = keys
    const base = node !== null && typeof node === 'object' ? node : {}
    return prune({ ...base, [key]: assign(base[key] ?? null, rest, value) })
  }

  const db = { root: null, listeners: [] }

  /** Returns a copy of the value stored at path, or null. */
  const valueAt = path =>
    clone(keysOf(path).reduce((node, key) => node?.[key] ?? null, db.root)) ?? null

  /** Wraps the value stored at path as a v8 DataSnapshot. */
  const snapshot = path => {
    const value = valueAt(path)
    return { val: () => value }
  }

  /** True when a write at one path changes the value seen at the other. */
  const related = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)

  /** Re-delivers every on('value') listener whose path a write at path touched, synchronously. */
  const notify = path =>
    db.listeners
      .filter(listener => related(listener.path, path))
      .forEach(listener => listener.callback(snapshot(listener.path)))

  /** Records each set and update as (method, path, value), with the value JSON-copied. */
  const write = vi.fn()
  /** Records each once and on as (method, path). */
  const read = vi.fn()

  /** A v8 database Reference backed by the in-memory tree. */
  const ref = path => ({
    set: value => {
      validate('set', path, value)
      write('set', path, clone(value))
      db.root = assign(db.root, keysOf(path), prune(clone(value)))
      notify(path)
      return Promise.resolve()
    },
    update: value => {
      validate('update', path, value)
      write('update', path, clone(value))
      db.root = Object.entries(value).reduce(
        (root, [key, child]) =>
          assign(root, [...keysOf(path), ...keysOf(key)], prune(clone(child))),
        db.root,
      )
      notify(path)
      return Promise.resolve()
    },
    once: (event, callback) => {
      read('once', path)
      return new Promise(resolve =>
        setTimeout(() => {
          const snap = snapshot(path)
          if (callback) callback(snap)
          resolve(snap)
        }, 0),
      )
    },
    on: (event, callback) => {
      read('on', path)
      const listener = { path, callback }
      db.listeners = [...db.listeners, listener]
      queueMicrotask(() => {
        if (db.listeners.includes(listener)) callback(snapshot(path))
      })
      return callback
    },
  })

  return {
    write,
    read,
    valueAt,
    /** Replaces the database with root, forgets every listener and clears the recorders. */
    reset: (root = null) => {
      db.root = prune(clone(root))
      db.listeners = []
      write.mockClear()
      read.mockClear()
    },
    /** The v8 namespace that src/firebase.js initializes and hands to every lazy import of it. */
    firebase: {
      initializeApp: () => {},
      auth: () => ({ currentUser: null }),
      database: () => ({ ref, useEmulator: () => {} }),
    },
  }
})

// Mocked below src/firebase.js rather than at '@/firebase': vitest 2 serves the real module to
// the second of two concurrent dynamic imports of a factory-mocked path from the same importer,
// and approve starts two users/loadOne reads at once.
vi.mock('firebase/app', () => ({ default: fb.firebase }))
vi.mock('firebase/auth', () => ({}))
vi.mock('firebase/database', () => ({}))
vi.mock('firebase/storage', () => ({}))

const NOW = '2024-01-01T00:00:00.000Z'
/** A chronouid minted at NOW: decamillenium minus NOW in hex, then 7 hex characters of a v4 uuid. */
const ID = /^e4eb1004d680-[0-9a-f]{7}$/
const EMAIL_URL = 'https://email.example.test/send'
const ADMIN_EMAIL = 'admin@example.test'

const templates = {
  pending: {
    people: { subject: 'New creator FULL_NAME', body: '<p>FIRST_NAME/LAST_NAME</p>NEW_PERSON' },
  },
  rejected: {
    people: { subject: 'Update for FIRST_NAME', body: '<p>Dear FULL_NAME</p>[NEW_PERSON]' },
  },
  approved: {
    people: { subject: 'Welcome FIRST_NAME', body: '<p>FULL_NAME</p>NEW_PERSON' },
  },
}

/** Deep-copies a fixture so the store never shares an object with a test. */
const copy = value => JSON.parse(JSON.stringify(value))

/** Loads submission email templates into the content collection, keyed by status. */
const setTemplates = (byStatus = templates) =>
  store.commit('content/set', { email: { submissions: copy(byStatus) } })

/** Signs a user in to the store, as the user/subscribe listener would. */
const signIn = (uid, roles, profile) => store.commit('user/setUser', copy({ uid, roles, profile }))

/** The profile of c1, the creator who submits in most tests. */
const creatorProfile = () => ({
  name: 'Yuyi Morales',
  email: 'yuyi@example.test',
  submissions: { old: 'approved' },
  draftPerson: { name: 'draft' },
})

/** The profile of owner1, the owner who reviews. */
const ownerProfile = () => ({
  name: 'Olivia Owner',
  email: 'olivia@example.test',
  submissions: {},
})

/** The person form a creator fills in. */
const personForm = () => ({
  name: 'Yuyi Morales',
  title: 'author-illustrator',
  bio: 'Born in Xalapa',
  pronouns: 'she/her',
  identities: { latinx: true },
  photo: { url: 'https://photos.example.test/yuyi.jpg' },
  website: 'https://yuyimorales.com',
  awards: '',
  bonus: '',
  curateInterest: '',
})

/** A pending people submission s1 from c1 that names the existing person p1. */
const approvalSub = overrides => ({
  id: 's1',
  createdBy: 'c1',
  personId: 'p1',
  name: 'Yuyi Morales',
  bio: 'new bio',
  title: 'author-illustrator',
  pronouns: 'she/her',
  identities: { latinx: true },
  photo: { url: 'https://photos.example.test/yuyi.jpg' },
  website: 'https://yuyimorales.com',
  awards: 'Caldecott Honor',
  bonus: '',
  curateInterest: '',
  status: 'pending',
  reviewComment: '',
  type: 'people',
  ...overrides,
})

/** The person p1 already in the directory. */
const existingPerson = () => ({
  id: 'p1',
  name: 'Yuyi Morales',
  bio: 'old bio',
  createdAt: '2023-01-01T00:00:00.000Z',
  createdBy: 'owner1',
  photo: { url: 'https://old.example.test/p.jpg' },
})

/** Stands in for the network under axios, answering every request with a 200. */
const adapter = vi.fn()
const originalAdapter = axios.defaults.adapter

/** Decodes the email that one request to the network adapter carried in its query string. */
const parseEmail = ([config]) => {
  const url = new URL(config.url)
  return {
    endpoint: `${url.origin}${url.pathname}`,
    to: url.searchParams.get('to'),
    subject: url.searchParams.get('subject'),
    body: url.searchParams.get('body'),
    authorization: config.headers.Authorization,
  }
}

/** Returns every email that reached the network, in send order. */
const sentEmails = () => adapter.mock.calls.map(parseEmail)

/** Returns the recorded writes except the cache/clean flag, as (method, path, value), in order. */
const dataWrites = () => fb.write.mock.calls.filter(([, path]) => path !== 'cache/clean')

/** Returns the data writes ordered by path, for writes that race each other. */
const byPath = writes => writes.toSorted(([, a], [, b]) => a.localeCompare(b))

/** Returns the one write made to path, failing unless there is exactly one. */
const writeTo = path => {
  const writes = dataWrites().filter(([, writePath]) => writePath === path)
  expect(writes).toHaveLength(1)
  return writes[0]
}

/** Returns the id a write path ends in, failing unless the path is prefix plus a chronouid minted at NOW. */
const chronouidIn = (prefix, path) => {
  expect(path.slice(0, prefix.length)).toBe(prefix)
  const id = path.slice(prefix.length)
  expect(id).toMatch(ID)
  return id
}

/** Returns the paths of the data writes whose path starts with prefix, in write order. */
const pathsUnder = prefix =>
  dataWrites()
    .map(([, path]) => path)
    .filter(path => path.startsWith(prefix))

/** Waits for managed.update's un-awaited update of submits/people/id, and returns the write. */
const settledUpdate = id =>
  vi.waitFor(() => {
    const updates = dataWrites().filter(
      ([method, path]) => method === 'update' && path === `submits/people/${id}`,
    )
    expect(updates).toHaveLength(1)
    return updates[0]
  })

/** Returns every href in an HTML string, in document order. */
const hrefs = html => [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1])

/** Wraps an email template body in the html document every people email is sent as. */
const wrapped = body =>
  new RegExp(
    `^<html>\\s*<head>\\s*<style>\\s*p \\{ margin: 0; \\}\\s*</style>\\s*</head>\\s*<body>\\s*${body}`,
  )

let consoleError
let axiosGet

beforeEach(() => {
  vi.setSystemTime(new Date(NOW))
  vi.stubEnv('VUE_APP_EMAIL_URL', EMAIL_URL)
  vi.stubEnv('VUE_APP_ADMIN_EMAIL', ADMIN_EMAIL)
  fb.reset()
  ;['submissions/people', 'people', 'users', 'content'].forEach(name =>
    store.commit(`${name}/reset`),
  )
  store.commit('user/setUser', null)
  adapter.mockReset()
  adapter.mockImplementation(async config => ({
    data: 'ok',
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  }))
  axios.defaults.adapter = adapter
  axiosGet = vi.spyOn(axios, 'get')
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  axios.defaults.adapter = originalAdapter
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('submit by a creator', () => {
  beforeEach(() => {
    signIn('c1', { authorized: true, creator: true }, creatorProfile())
    setTemplates()
  })

  test('puts the pending submission in state and submits/people under a new chronouid, stamped with creator and time', async () => {
    await store.dispatch('submissions/people/submit', personForm())

    const [, path, value] = dataWrites()[0]
    const id = chronouidIn('submits/people/', path)
    const record = { ...personForm(), id, reviewComment: '', status: 'pending', type: 'people' }
    expect(store.state.submissions.people.data).toEqual({ [id]: record })
    expect(value).toEqual({
      ...record,
      createdAt: NOW,
      createdBy: 'c1',
      updatedAt: NOW,
      updatedBy: 'c1',
    })
    expect(fb.valueAt(`submits/people/${id}`)).toEqual(value)
    expect(consoleError).not.toHaveBeenCalled()
  })

  test('then sets the whole creator profile with the submission pending and the person draft cleared', async () => {
    await store.dispatch('submissions/people/submit', personForm())

    const id = chronouidIn('submits/people/', dataWrites()[0][1])
    const profile = {
      name: 'Yuyi Morales',
      email: 'yuyi@example.test',
      draftPerson: null,
      submissions: { old: 'approved', [id]: 'pending' },
    }
    expect(dataWrites().map(([method, path]) => [method, path])).toEqual([
      ['set', `submits/people/${id}`],
      ['set', 'users/c1/profile'],
    ])
    expect(writeTo('users/c1/profile')[2]).toEqual(profile)
    expect(store.state.user.user.profile).toEqual(profile)
  })

  test('emails the admin a pending notice filled in from the creator profile', async () => {
    await store.dispatch('submissions/people/submit', personForm())

    expect(axiosGet).toHaveBeenCalledTimes(1)
    const emails = sentEmails()
    expect(emails).toHaveLength(1)
    const [email] = emails
    expect(email).toMatchObject({
      endpoint: EMAIL_URL,
      to: 'admin@example.test',
      subject: 'New creator Yuyi Morales',
      authorization: 'Bearer ',
    })
    expect(email.body).toMatch(wrapped('<p>Yuyi/Morales</p>'))
    // the name and the photo both link the admin to the people review queue
    const reviewUrl = `${window.location.origin}/admin/review/people`
    expect(hrefs(email.body)).toEqual([reviewUrl, reviewUrl])
    expect(consoleError).not.toHaveBeenCalled()
  })

  test('still resolves when the pending template is missing, logging instead of emailing', async () => {
    setTemplates({ rejected: templates.rejected, approved: templates.approved })

    await expect(store.dispatch('submissions/people/submit', personForm())).resolves.toBe(undefined)

    const message = 'No email template at content/email/submissions/pending/people'
    expect(consoleError.mock.calls).toEqual([
      [message, creatorProfile()],
      ['Email failed to send'],
      [new Error(message)],
    ])
    expect(axiosGet).not.toHaveBeenCalled()
    expect(adapter).not.toHaveBeenCalled()
    const writes = dataWrites()
    expect(writes.map(([method]) => method)).toEqual(['set', 'set'])
    chronouidIn('submits/people/', writes[0][1])
    expect(writes[1][1]).toBe('users/c1/profile')
  })
})

describe('submit by an owner', () => {
  test('auto-approves the submission as the submits/people subscription redelivered it, createdBy stamped and null and empty fields dropped', async () => {
    signIn('owner1', { owner: true }, ownerProfile())
    fb.reset({ users: { owner1: { profile: ownerProfile() } } })
    store.commit('people/set', {})
    setTemplates()
    store.dispatch('submissions/people/subscribe')
    await vi.waitFor(() => expect(store.state.submissions.people.loaded).toBe(true))

    // the personSubmission defaults, which Firebase does not store
    await store.dispatch('submissions/people/submit', {
      ...personForm(),
      website: null,
      identities: {},
    })

    const id = chronouidIn('submits/people/', dataWrites()[0][1])
    expect(dataWrites()[0][2]).toMatchObject({ website: null, identities: {} })
    const [, peoplePath, person] = dataWrites().find(([, path]) => path.startsWith('people/'))
    const personId = chronouidIn('people/', peoplePath)
    expect(personId).not.toBe(id)
    // pick leaves out the schema keys the redelivered submission lacks, rather than writing them
    // as undefined, which Firebase would refuse
    const { photo, website, identities, ...form } = personForm()
    expect(person).toEqual({
      ...form,
      photo: { downloadUrl: photo.url },
      id: personId,
      createdAt: NOW,
      createdBy: 'owner1',
      updatedAt: NOW,
      updatedBy: 'owner1',
    })
    expect(fb.valueAt('users/owner1/profile')).toEqual({
      name: 'Olivia Owner',
      email: 'olivia@example.test',
      submissions: { [id]: 'approved' },
      personId,
    })
    expect((await settledUpdate(id))[2]).toEqual({
      reviewedBy: 'owner1',
      reviewedAt: NOW,
      status: 'approved',
      personId,
      updatedAt: NOW,
      updatedBy: 'owner1',
    })
    expect(sentEmails().map(({ to, subject }) => [to, subject])).toEqual([
      ['olivia@example.test', 'Welcome Olivia'],
    ])
    expect(consoleError).not.toHaveBeenCalled()
  })
})

describe('updateSubmission', () => {
  beforeEach(() => {
    signIn('owner1', { owner: true }, ownerProfile())
  })

  test('commits the reviewed submission to state at once, then updates submits/people and the creator profile', async () => {
    const sub = { id: 's1', createdBy: 'c1', name: 'Kadir Nelson', status: 'pending' }

    const pending = store.dispatch('submissions/people/updateSubmission', {
      personId: 'p9',
      sub,
      status: 'approved',
    })

    // synchronously, before any write has reached Firebase
    expect(store.state.submissions.people.data.s1).toEqual({
      id: 's1',
      createdBy: 'c1',
      name: 'Kadir Nelson',
      reviewedBy: 'owner1',
      reviewedAt: NOW,
      status: 'approved',
      personId: 'p9',
    })
    expect(dataWrites()).toEqual([])
    await pending
    await settledUpdate('s1')
    expect(byPath(dataWrites())).toEqual([
      [
        'update',
        'submits/people/s1',
        {
          reviewedBy: 'owner1',
          reviewedAt: NOW,
          status: 'approved',
          personId: 'p9',
          updatedAt: NOW,
          updatedBy: 'owner1',
        },
      ],
      ['set', 'users/c1/profile/personId', 'p9'],
      ['set', 'users/c1/profile/submissions/s1', 'approved'],
    ])
    expect(pathsUnder('users/')).toEqual([
      'users/c1/profile/submissions/s1',
      'users/c1/profile/personId',
    ])
  })

  test('leaves personId out, and the profile personId alone, when not given', async () => {
    const sub = { id: 's1', createdBy: 'c1', name: 'Kadir Nelson', status: 'pending' }

    await store.dispatch('submissions/people/updateSubmission', { sub, status: 'approved' })

    expect(store.state.submissions.people.data.s1).toEqual({
      ...sub,
      reviewedBy: 'owner1',
      reviewedAt: NOW,
      status: 'approved',
    })
    await settledUpdate('s1')
    expect(byPath(dataWrites())).toEqual([
      [
        'update',
        'submits/people/s1',
        {
          reviewedBy: 'owner1',
          reviewedAt: NOW,
          status: 'approved',
          updatedAt: NOW,
          updatedBy: 'owner1',
        },
      ],
      ['set', 'users/c1/profile/submissions/s1', 'approved'],
    ])
  })
})

describe('reject', () => {
  const sub = () => ({ id: 's1', createdBy: 'c1', name: 'Kadir Nelson', status: 'pending' })
  const rejectedUpdate = {
    reviewedBy: 'owner1',
    reviewedAt: NOW,
    status: 'rejected',
    updatedAt: NOW,
    updatedBy: 'owner1',
  }

  beforeEach(() => {
    signIn('owner1', { owner: true }, ownerProfile())
    fb.reset({ users: { c1: { profile: { name: 'Kadir Nelson', email: 'kadir@example.test' } } } })
    setTemplates()
  })

  /**
   * Asserts the rejection reached state and the creator profile by the time reject settled, then
   * that the un-awaited submits/people update lands too, and nothing else is written.
   */
  const expectRejectedWrites = async () => {
    expect(store.state.submissions.people.data.s1.status).toBe('rejected')
    expect(writeTo('users/c1/profile/submissions/s1')[2]).toBe('rejected')
    await settledUpdate('s1')
    expect(byPath(dataWrites())).toEqual([
      ['update', 'submits/people/s1', rejectedUpdate],
      ['set', 'users/c1/profile/submissions/s1', 'rejected'],
    ])
  }

  test('marks the submission rejected and emails the creator from the rejected template', async () => {
    await store.dispatch('submissions/people/reject', sub())

    await expectRejectedWrites()
    expect(fb.read.mock.calls).toEqual([['once', 'users/c1']])
    const emails = sentEmails()
    expect(emails).toHaveLength(1)
    expect(emails[0]).toMatchObject({
      endpoint: EMAIL_URL,
      to: 'kadir@example.test',
      subject: 'Update for Kadir',
      authorization: 'Bearer ',
    })
    expect(emails[0].body).toMatch(wrapped('<p>Dear Kadir Nelson</p>\\[\\]'))
    expect(consoleError).not.toHaveBeenCalled()
  })

  test('rejects after the status writes when the creator has no email', async () => {
    fb.reset({ users: { c1: { profile: { name: 'Kadir Nelson' } } } })

    await expect(store.dispatch('submissions/people/reject', sub())).rejects.toThrow(
      new Error('No email for user c1 of submission s1'),
    )

    expect(consoleError).toHaveBeenCalledWith('No email for user c1 of submission s1', sub())
    expect(adapter).not.toHaveBeenCalled()
    await expectRejectedWrites()
  })

  test('rejects after the status writes when the rejected template is missing', async () => {
    setTemplates({ pending: templates.pending, approved: templates.approved })

    await expect(store.dispatch('submissions/people/reject', sub())).rejects.toThrow(
      new Error('No email template at email/submissions/rejected/people'),
    )

    expect(consoleError).toHaveBeenCalledWith(
      'No email template at email/submissions/rejected/people',
      sub(),
    )
    expect(adapter).not.toHaveBeenCalled()
    await expectRejectedWrites()
  })

  test('passes an email service failure through to the caller rather than swallowing it', async () => {
    adapter.mockRejectedValueOnce(new Error('boom'))

    await expect(store.dispatch('submissions/people/reject', sub())).rejects.toThrow(
      new Error('Error sending email: boom'),
    )

    expect(adapter).toHaveBeenCalledTimes(1)
    await expectRejectedWrites()
  })
})

describe('approvePerson', () => {
  beforeEach(() => {
    signIn('owner1', { owner: true }, ownerProfile())
    fb.reset({
      users: {
        c1: {
          profile: {
            name: 'Yuyi Morales',
            email: 'yuyi@example.test',
            submissions: { s0: 'approved', s1: 'pending' },
          },
        },
      },
    })
    store.commit('people/set', { p1: existingPerson() })
    store.commit('submissions/people/set', {
      s0: { id: 's0', createdBy: 'c1', status: 'approved' },
    })
    setTemplates()
  })

  test('overwrites the named person with the schema fields of the submission and a photo to resave', async () => {
    await store.dispatch('submissions/people/approvePerson', approvalSub())

    expect(writeTo('people/p1')[2]).toEqual({
      id: 'p1',
      name: 'Yuyi Morales',
      bio: 'new bio',
      title: 'author-illustrator',
      pronouns: 'she/her',
      identities: { latinx: true },
      photo: { downloadUrl: 'https://photos.example.test/yuyi.jpg' },
      website: 'https://yuyimorales.com',
      awards: 'Caldecott Honor',
      bonus: '',
      curateInterest: '',
      createdAt: '2023-01-01T00:00:00.000Z',
      createdBy: 'owner1',
      updatedAt: NOW,
      updatedBy: 'owner1',
    })
    expect(consoleError).not.toHaveBeenCalled()
  })

  test('keeps the fields of the named person that the submission lacks, as Firebase returns one saved with a null website and no identities', async () => {
    store.commit('people/set', {
      p1: {
        ...existingPerson(),
        website: 'https://old.example.test',
        identities: { indigenous: true },
      },
    })
    const { website, identities, ...sub } = approvalSub()

    await store.dispatch('submissions/people/approvePerson', sub)

    expect(writeTo('people/p1')[2]).toEqual({
      id: 'p1',
      name: 'Yuyi Morales',
      bio: 'new bio',
      title: 'author-illustrator',
      pronouns: 'she/her',
      identities: { indigenous: true },
      photo: { downloadUrl: 'https://photos.example.test/yuyi.jpg' },
      website: 'https://old.example.test',
      awards: 'Caldecott Honor',
      bonus: '',
      curateInterest: '',
      createdAt: '2023-01-01T00:00:00.000Z',
      createdBy: 'owner1',
      updatedAt: NOW,
      updatedBy: 'owner1',
    })
    expect(fb.valueAt('people/p1')).toEqual(writeTo('people/p1')[2])
    expect(consoleError).not.toHaveBeenCalled()
  })

  test("records the approval and the person id on the creator's profile before saving the person", async () => {
    await store.dispatch('submissions/people/approvePerson', approvalSub())

    expect((await settledUpdate('s1'))[2]).toEqual({
      reviewedBy: 'owner1',
      reviewedAt: NOW,
      status: 'approved',
      personId: 'p1',
      updatedAt: NOW,
      updatedBy: 'owner1',
    })
    expect(
      dataWrites()
        .filter(([, path]) => !path.startsWith('submits/'))
        .map(([method, path]) => [method, path]),
    ).toEqual([
      ['set', 'users/c1/profile/submissions/s1'],
      ['set', 'users/c1/profile/personId'],
      ['set', 'people/p1'],
    ])
    expect(writeTo('users/c1/profile/submissions/s1')[2]).toBe('approved')
    expect(writeTo('users/c1/profile/personId')[2]).toBe('p1')
    // the creator's submissions are not read: the person comes from sub.personId alone
    expect(fb.read.mock.calls).toEqual([['once', 'users/c1']])
  })

  test('creates a new person under a fresh chronouid when the submission names none', async () => {
    store.commit('people/set', {})

    await store.dispatch('submissions/people/approvePerson', approvalSub({ personId: undefined }))

    const [, peoplePath, person] = dataWrites().find(([, path]) => path.startsWith('people/'))
    const personId = chronouidIn('people/', peoplePath)
    expect(person).toEqual({
      name: 'Yuyi Morales',
      bio: 'new bio',
      title: 'author-illustrator',
      pronouns: 'she/her',
      identities: { latinx: true },
      photo: { downloadUrl: 'https://photos.example.test/yuyi.jpg' },
      website: 'https://yuyimorales.com',
      awards: 'Caldecott Honor',
      bonus: '',
      curateInterest: '',
      id: personId,
      createdAt: NOW,
      createdBy: 'owner1',
      updatedAt: NOW,
      updatedBy: 'owner1',
    })
    expect(writeTo('users/c1/profile/personId')[2]).toBe(personId)
    const [, , update] = await settledUpdate('s1')
    expect(update.personId).toBe(personId)
  })

  test('never matches a person by name: a submission naming no person creates a new one even when the name is taken', async () => {
    const namesake = {
      id: 'p2',
      name: 'Yuyi Morales',
      bio: 'namesake bio',
      website: 'https://namesake.example.test',
      createdAt: '2023-01-01T00:00:00.000Z',
      createdBy: 'owner1',
    }
    store.commit('people/set', { p2: namesake })

    await store.dispatch('submissions/people/approvePerson', approvalSub({ personId: undefined }))

    // one write, to a new chronouid rather than to p2, with nothing of p2 merged in
    const paths = pathsUnder('people/')
    expect(paths).toHaveLength(1)
    const personId = chronouidIn('people/', paths[0])
    expect(writeTo(paths[0])[2]).toEqual({
      name: 'Yuyi Morales',
      bio: 'new bio',
      title: 'author-illustrator',
      pronouns: 'she/her',
      identities: { latinx: true },
      photo: { downloadUrl: 'https://photos.example.test/yuyi.jpg' },
      website: 'https://yuyimorales.com',
      awards: 'Caldecott Honor',
      bonus: '',
      curateInterest: '',
      id: personId,
      createdAt: NOW,
      createdBy: 'owner1',
      updatedAt: NOW,
      updatedBy: 'owner1',
    })
    expect(writeTo('users/c1/profile/personId')[2]).toBe(personId)
    expect(consoleError).not.toHaveBeenCalled()
  })

  test.each([
    ['a data url photo', { url: 'data:image/png;base64,AAA' }],
    ['an empty photo', ''],
  ])('saves %s on the person as submitted, with nothing to resave', async (label, photo) => {
    store.commit('people/set', {})

    await store.dispatch(
      'submissions/people/approvePerson',
      approvalSub({ personId: undefined, photo }),
    )

    const [, , person] = dataWrites().find(([, path]) => path.startsWith('people/'))
    expect(person.photo).toEqual(photo)
  })

  test('emails the creator an approval filled in from their profile and the new person', async () => {
    await store.dispatch('submissions/people/approvePerson', approvalSub())

    const emails = sentEmails()
    expect(emails).toHaveLength(1)
    expect(emails[0]).toMatchObject({
      endpoint: EMAIL_URL,
      to: 'yuyi@example.test',
      subject: 'Welcome Yuyi',
      authorization: 'Bearer ',
    })
    expect(emails[0].body).toMatch(wrapped('<p>Yuyi Morales</p>'))
    expect(emails[0].body).toContain(
      '<img src="https://photos.example.test/yuyi.jpg" width="150" />',
    )
    expect(emails[0].body).toContain('author-illustrator<br>')
  })

  test('rejects after the person and status writes when the creator has no email', async () => {
    fb.reset({
      users: { c1: { profile: { name: 'Yuyi Morales', submissions: { s1: 'pending' } } } },
    })

    await expect(store.dispatch('submissions/people/approvePerson', approvalSub())).rejects.toThrow(
      new Error('No email for user c1 of submission s1'),
    )

    expect(consoleError).toHaveBeenCalledWith(
      'No email for user c1 of submission s1',
      approvalSub(),
    )
    // already written when the promise rejected, with nothing awaited since
    expect(writeTo('people/p1')[2].bio).toBe('new bio')
    expect(writeTo('users/c1/profile/submissions/s1')[2]).toBe('approved')
    expect(writeTo('users/c1/profile/personId')[2]).toBe('p1')
    expect(adapter).not.toHaveBeenCalled()
    // the submits/people update is not awaited by updateSubmission, so it may land afterwards
    expect((await settledUpdate('s1'))[2].status).toBe('approved')
  })

  test('rejects after the person and status writes when the approved template is missing', async () => {
    setTemplates({ pending: templates.pending, rejected: templates.rejected })

    await expect(store.dispatch('submissions/people/approvePerson', approvalSub())).rejects.toThrow(
      new Error('No email template at content/email/submissions/approved/people'),
    )

    // already written when the promise rejected, with nothing awaited since
    expect(writeTo('people/p1')[2].bio).toBe('new bio')
    expect(writeTo('users/c1/profile/submissions/s1')[2]).toBe('approved')
    expect(writeTo('users/c1/profile/personId')[2]).toBe('p1')
    expect(adapter).not.toHaveBeenCalled()
  })
})

describe('approve', () => {
  beforeEach(() => {
    signIn('owner1', { owner: true }, ownerProfile())
    fb.reset({
      users: {
        c1: { profile: { name: 'Yuyi Morales', email: 'yuyi@example.test' } },
        c2: { profile: { name: 'Kadir Nelson', email: 'kadir@example.test' } },
      },
    })
    store.commit('people/set', {})
    setTemplates()
  })

  test('resolves to one un-awaited approvePerson promise per submission', async () => {
    const subs = [
      approvalSub({ personId: undefined }),
      approvalSub({ id: 's2', createdBy: 'c2', personId: undefined, name: 'Kadir Nelson' }),
    ]

    const result = await store.dispatch('submissions/people/approve', subs)

    expect(result).toEqual([expect.any(Promise), expect.any(Promise)])
    await Promise.all(result)
    const people = dataWrites().filter(([, path]) => path.startsWith('people/'))
    expect(people.map(([, , person]) => person.name).toSorted()).toEqual([
      'Kadir Nelson',
      'Yuyi Morales',
    ])
    await settledUpdate('s1')
    await settledUpdate('s2')
    expect(
      sentEmails()
        .map(({ to }) => to)
        .toSorted(),
    ).toEqual(['kadir@example.test', 'yuyi@example.test'])
    expect(consoleError).not.toHaveBeenCalled()
  })
})
