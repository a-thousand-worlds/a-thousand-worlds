/*
 * Characterization tests for the root store (src/store/index.js), the weighted shuffle it drives
 * (src/store/modules/shuffleable.js) and the people store (src/store/people.js). Dependency seams
 * guarded:
 *
 * - vuex: createStore with root state (auth, theme) plus fourteen modules, sixteen root keys in
 *   declared order, root actions that dispatch into namespaced modules and run synchronously when
 *   dispatched, replaceState, and store.subscribe reporting each mutation's type and payload in
 *   commit order.
 * - vue: people/filtered is a computed getter over reactive state, so read repeatedly from one live
 *   store it must recompute when the shuffle and the filters change underneath it.
 * - jsdom: window.location.search (set through history.replaceState) is what setFiltersFromUrl
 *   reads during loadCache, and the store publishes itself on the window global.
 * - @sindresorhus/slugify: a ?filters= value is matched against slugify(tag.tag) during loadCache.
 *
 * deck (the weighted shuffle) is not being upgraded; Math.random is mocked so each shuffle is a
 * seeded run rather than a guard on deck. Firebase (pinned at v8) is the one boundary faked, at
 * firebase/app, so the real src/firebase.js and every module's lazy import of it still run: the
 * subscribe action starts a dozen concurrent imports of '@/firebase'.
 */

const fb = vi.hoisted(() => {
  /** The on('value') callback registered at each ref path, fired by the tests as a snapshot. */
  const listeners = {}
  /** Records every Reference.on call as (path, event, callback). */
  const on = vi.fn((path, event, callback) => {
    listeners[path] = callback
  })
  const onAuthStateChanged = vi.fn()
  /** A fake v8 Reference that only supports subscribing. */
  const ref = path => ({
    on: (event, callback) => on(path, event, callback),
    once: () => {},
  })
  return {
    listeners,
    on,
    onAuthStateChanged,
    firebase: {
      initializeApp: () => {},
      auth: () => ({ currentUser: null, onAuthStateChanged }),
      database: () => ({ ref, useEmulator: () => {} }),
    },
  }
})

vi.mock('firebase/app', () => ({ default: fb.firebase }))
vi.mock('firebase/auth', () => ({}))
vi.mock('firebase/database', () => ({}))
vi.mock('firebase/storage', () => ({}))

const NOW = '2026-01-02T03:04:05.000Z'

const CACHE_MISSING =
  'The cache has not been generated. Run `npm run update:dbcache .env.local` to build the cache from Firebase. Once deployed, the cache will be regenerated directly on Firebase hosting via rebuildCache.js if needed.'

const NO_TAGS =
  'Trying to shuffle but no tags found to determine shuffle weights. Make sure tags are loaded before shuffling.'

/** People tags: `a` is heavy, `b` is light. */
const peopleTags = {
  a: { id: 'a', tag: 'Indigenous', weight: 10 },
  b: { id: 'b', tag: 'Black', weight: 1 },
}

/** x2 carries the heavy identity, x1 the light one, and x3 has no identities at all. */
const people = {
  x1: { id: 'x1', name: 'One', identities: { b: true } },
  x2: { id: 'x2', name: 'Two', identities: { a: true } },
  x3: { id: 'x3', name: 'Three' },
}

/** A full dbcache, shaped as public/dbcache.js publishes it on window. */
const dbcache = {
  content: { about: { title: 'About A Thousand Worlds' } },
  tags: {
    books: {
      pb: { id: 'pb', tag: 'Picture book', sortOrder: 1, weight: 2 },
      ya: { id: 'ya', tag: 'Young adult', sortOrder: 2 },
    },
    people: peopleTags,
    bundles: { hol: { id: 'hol', tag: 'Holidays', sortOrder: 1 } },
  },
  books: {
    b1: { id: 'b1', isbn: '9780000000001', title: 'First', tags: { pb: true } },
    b2: { id: 'b2', isbn: '9780000000002', title: 'Second', tags: { pb: true, ya: true } },
    b3: { id: 'b3', isbn: '9780000000003', title: 'Third', tags: { ya: true } },
  },
  people,
}

/** Deep-copies a fixture so a commit never shares objects with it. */
const copy = value => JSON.parse(JSON.stringify(value))

/** Returns the ids of a shuffled collection, in shuffled order. */
const shuffledIds = type => store.state[type].shuffled.map(item => item.id)

/** Returns the types of the mutations a commit watcher saw, in commit order. */
const types = commits => commits.mock.calls.map(([mutation]) => mutation.type)

/** Subscribes a mock to every commit until the end of the test, and returns the mock. */
const watchCommits = () => {
  const commits = vi.fn()
  stopWatching = store.subscribe(commits)
  return commits
}

/** Makes every Math.random call return value until the end of the test. */
const seedRandom = value => vi.spyOn(Math, 'random').mockReturnValue(value)

let store
let initialState
let warn
let stopWatching = () => {}

beforeAll(async () => {
  // the theme and structuredData's datePublished are computed when the store is first imported
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
  window.dbcache = undefined
  history.replaceState(null, '', '/')
  store = (await import('@/store')).default
  vi.useRealTimers()
  initialState = copy(store.state)
})

beforeEach(() => {
  store.replaceState(copy(initialState))
  window.dbcache = undefined
  history.replaceState(null, '', '/')
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  stopWatching()
  stopWatching = () => {}
  warn.mockRestore()
  if (vi.isMockFunction(Math.random)) Math.random.mockRestore()
})

describe('store construction', () => {
  test('root state starts signed out with the theme picked by the hour since the epoch', () => {
    // 490923 hours since the epoch at NOW: (490923 % 4) + 1
    expect(initialState.theme).toBe(4)
    expect(initialState.auth).toBe(false)
  })

  test('root state holds the root keys, then one key per module in declaration order', () => {
    expect(Object.keys(store.state)).toEqual([
      'auth',
      'theme',
      'books',
      'bundles',
      'content',
      'debug',
      'invites',
      'links',
      'logs',
      'people',
      'structuredData',
      'submissions',
      'tags',
      'ui',
      'user',
      'users',
    ])
    expect(Object.keys(store.state.tags)).toEqual(['books', 'people', 'bundles'])
    expect(Object.keys(store.state.submissions)).toEqual(['books', 'bundles', 'people'])
  })

  test('the store is published on window.store', () => {
    expect(window.store).toBe(store)
  })

  test('structured data is stamped with the time of the first import', () => {
    expect(initialState.structuredData.data.datePublished).toBe(NOW)
    expect(initialState.structuredData.data.mainEntityOfPage).toEqual({
      '@type': 'WebPage',
      '@id': window.location.origin,
    })
  })

  test('people start empty, unshuffled and unfiltered', () => {
    expect(initialState.people).toEqual({
      data: {},
      loaded: false,
      loadedAll: false,
      name: 'people',
      filters: [],
      idFilters: [],
      isShuffled: false,
      shuffled: [],
    })
  })
})

describe('loadCache', () => {
  test('warns that the cache is missing and loads nothing when window.dbcache is undefined', async () => {
    const commits = watchCommits()

    await store.dispatch('loadCache')

    expect(warn.mock.calls).toEqual([[CACHE_MISSING]])
    expect(types(commits)).toEqual([])
    expect(store.state.books.loaded).toBe(false)
    expect(store.state.people.loaded).toBe(false)
  })

  test('loads content and tags before books and people, then filters and shuffles from the URL', async () => {
    window.dbcache = copy(dbcache)
    history.replaceState(null, '', '/?filters=picture-book&books=9780000000002')
    const commits = watchCommits()

    await store.dispatch('loadCache')

    expect(types(commits)).toEqual([
      'content/set',
      'tags/books/set',
      'tags/people/set',
      'tags/bundles/set',
      'books/set',
      'books/setFilters',
      'books/setIdFilters',
      'books/shuffle',
      'people/set',
      'people/setFilters',
      'people/shuffle',
    ])
    // every book and person tag is in its weight spec, so nothing warns
    expect(warn).not.toHaveBeenCalled()

    expect(store.getters['content/get']('about/title')).toBe('About A Thousand Worlds')
    expect(store.state.tags.books).toMatchObject({ loaded: true, data: dbcache.tags.books })
    expect(store.state.tags.people).toMatchObject({ loaded: true, data: dbcache.tags.people })
    expect(store.state.tags.bundles).toMatchObject({ loaded: true, data: dbcache.tags.bundles })

    expect(store.state.books).toMatchObject({ loaded: true, loadedAll: true, isShuffled: true })
    expect(shuffledIds('books').toSorted()).toEqual(['b1', 'b2', 'b3'])
    expect(store.state.books.filters).toEqual([dbcache.tags.books.pb])
    expect(store.state.books.idFilters).toEqual(['b2'])
    expect(store.getters['books/filtered'].map(book => book.id)).toEqual(['b2'])

    expect(store.state.people).toMatchObject({ loaded: true, loadedAll: true, isShuffled: true })
    expect(shuffledIds('people').toSorted()).toEqual(['x1', 'x2', 'x3'])
    // 'picture-book' matches no people tag, and ?books= only applies to books
    expect(store.state.people.filters).toEqual([])
    expect(store.state.people.idFilters).toEqual([])
  })

  test('commits each shuffle with its tag prop (tags / identities) and the loaded tag weights', async () => {
    seedRandom(0)
    window.dbcache = copy(dbcache)
    const commits = watchCommits()

    await store.dispatch('loadCache')

    const shuffles = commits.mock.calls
      .map(([mutation]) => mutation)
      .filter(mutation => mutation.type.endsWith('/shuffle'))
    expect(shuffles).toEqual([
      { type: 'books/shuffle', payload: { idProp: 'tags', weights: dbcache.tags.books } },
      { type: 'people/shuffle', payload: { idProp: 'identities', weights: peopleTags } },
    ])
    expect(shuffledIds('books')).toEqual(['b1', 'b2', 'b3'])
    expect(shuffledIds('people')).toEqual(['x1', 'x2', 'x3'])
  })

  test('warns that there are no tags to weight the shuffle when the cache has books but no tags', async () => {
    window.dbcache = {
      books: { b1: { id: 'b1', isbn: '9780000000001', title: 'First', tags: { pb: true } } },
    }

    await store.dispatch('loadCache')

    expect(warn.mock.calls).toEqual([[NO_TAGS]])
    expect(store.state.books.isShuffled).toBe(true)
    expect(shuffledIds('books')).toEqual(['b1'])
    expect(store.state.people.loaded).toBe(false)
  })
})

describe('shuffle', () => {
  test('orders people by the sum of their identity weights, and a person with no identities weighs 1', async () => {
    seedRandom(0.5)
    store.commit('tags/people/set', copy(peopleTags))
    store.commit('people/set', copy(people))

    await store.dispatch('shuffle', 'people')

    expect(shuffledIds('people')).toEqual(['x2', 'x3', 'x1'])
    expect(store.state.people.isShuffled).toBe(true)
    expect(store.state.people.shuffled[0]).toEqual(people.x2)
  })

  test('adds up every identity weight rather than taking the heaviest', async () => {
    seedRandom(0.5)
    store.commit('tags/people/set', {
      a: { id: 'a', weight: 10 },
      b: { id: 'b', weight: 6 },
      c: { id: 'c', weight: 6 },
    })
    store.commit('people/set', {
      y1: { id: 'y1', identities: { a: true } },
      y2: { id: 'y2', identities: { b: true, c: true } },
    })

    await store.dispatch('shuffle', 'people')

    // y2 weighs 12 against y1's 10; weighed by its heaviest identity alone, y1 would come first
    expect(shuffledIds('people')).toEqual(['y2', 'y1'])
  })

  test('counts a tag without a weight as 1', async () => {
    seedRandom(0.5)
    store.commit('tags/people/set', { a: { id: 'a', weight: 3 }, b: { id: 'b', tag: 'B' } })
    store.commit('people/set', {
      p1: { id: 'p1', identities: { b: true } },
      p2: { id: 'p2', identities: { a: true } },
    })

    await store.dispatch('shuffle', 'people')

    expect(shuffledIds('people')).toEqual(['p2', 'p1'])
    expect(warn).not.toHaveBeenCalled()
  })

  test('shuffles books by their tags weighted by tags/books', async () => {
    seedRandom(0.5)
    store.commit('tags/books/set', {
      heavy: { id: 'heavy', weight: 3 },
      light: { id: 'light', weight: 1 },
    })
    store.commit('books/set', {
      A: { id: 'A', tags: { heavy: true } },
      B: { id: 'B', tags: { light: true } },
    })

    await store.dispatch('shuffle', 'books')

    expect(shuffledIds('books')).toEqual(['A', 'B'])
  })

  test('swapping the book tag weights swaps the shuffled order', async () => {
    seedRandom(0.5)
    store.commit('tags/books/set', {
      heavy: { id: 'heavy', weight: 1 },
      light: { id: 'light', weight: 3 },
    })
    store.commit('books/set', {
      A: { id: 'A', tags: { heavy: true } },
      B: { id: 'B', tags: { light: true } },
    })

    await store.dispatch('shuffle', 'books')

    expect(shuffledIds('books')).toEqual(['B', 'A'])
  })

  test('keeps insertion order when Math.random returns 0', async () => {
    seedRandom(0)
    store.commit('tags/people/set', copy(peopleTags))
    store.commit('people/set', copy(people))

    await store.dispatch('shuffle', 'people')

    expect(shuffledIds('people')).toEqual(['x1', 'x2', 'x3'])
  })

  test('a second shuffle merges: new items first, removed items dropped, updated items replaced in place', async () => {
    seedRandom(0.5)
    store.commit('tags/people/set', copy(peopleTags))
    store.commit('people/set', copy(people))
    await store.dispatch('shuffle', 'people')
    expect(shuffledIds('people')).toEqual(['x2', 'x3', 'x1'])

    store.commit('people/set', {
      x2: { id: 'x2', name: 'Two v2', identities: { a: true } },
      x3: copy(people.x3),
      x4: { id: 'x4', name: 'Four', identities: { b: true } },
    })
    await store.dispatch('shuffle', 'people')

    expect(shuffledIds('people')).toEqual(['x4', 'x2', 'x3'])
    expect(store.state.people.shuffled[1]).toEqual({
      id: 'x2',
      name: 'Two v2',
      identities: { a: true },
    })
  })

  test('a merge keeps the previous order even after the weights change', async () => {
    seedRandom(0.5)
    store.commit('tags/people/set', copy(peopleTags))
    store.commit('people/set', copy(people))
    await store.dispatch('shuffle', 'people')

    store.commit('tags/people/set', {
      a: { id: 'a', weight: 1 },
      b: { id: 'b', weight: 100 },
    })
    await store.dispatch('shuffle', 'people')

    expect(shuffledIds('people')).toEqual(['x2', 'x3', 'x1'])
  })

  test('warns about an identity missing from the tags, and weighs it as 1', async () => {
    seedRandom(0.5)
    store.commit('tags/people/set', { a: { id: 'a', weight: 3 } })
    store.commit('people/set', {
      z1: { id: 'z1', name: 'Zed', identities: { zz: true } },
      z2: { id: 'z2', name: 'Ay', identities: { a: true } },
    })

    await store.dispatch('shuffle', 'people')

    expect(warn.mock.calls).toEqual([
      [
        'Tag id missing from weightSpec when shuffling by identities: zz. This could mean that a tag was deleted from the tags collection but not deleted from a book/person.',
        'Zed',
        { id: 'z1', name: 'Zed', identities: { zz: true } },
      ],
    ])
    expect(shuffledIds('people')).toEqual(['z2', 'z1'])
  })

  test('names a missing book tag by the tags prop and the book title', async () => {
    seedRandom(0)
    store.commit('tags/books/set', { pb: { id: 'pb', weight: 2 } })
    store.commit('books/set', { b1: { id: 'b1', title: 'First', tags: { gone: true } } })

    await store.dispatch('shuffle', 'books')

    expect(warn.mock.calls.map(([message, title]) => [message, title])).toEqual([
      [
        'Tag id missing from weightSpec when shuffling by tags: gone. This could mean that a tag was deleted from the tags collection but not deleted from a book/person.',
        'First',
      ],
    ])
  })
})

describe('people/filtered', () => {
  /** Loads the people fixture and shuffles it into ['x2', 'x3', 'x1']. */
  const shufflePeople = async () => {
    seedRandom(0.5)
    store.commit('tags/people/set', copy(peopleTags))
    store.commit('people/set', {
      ...copy(people),
      x3: { ...people.x3, title: 'illustrator' },
    })
    await store.dispatch('shuffle', 'people')
  }

  test('is empty until the people are shuffled, even once they are loaded', () => {
    store.commit('people/set', copy(people))

    expect(store.state.people.loaded).toBe(true)
    expect(store.getters['people/filtered']).toEqual([])
  })

  test('returns the shuffled order when no filter is set', async () => {
    await shufflePeople()

    expect(store.getters['people/filtered'].map(person => person.id)).toEqual(['x2', 'x3', 'x1'])
  })

  test('filters by identity tag ids', async () => {
    await shufflePeople()

    store.commit('people/setFilters', [peopleTags.b])

    expect(store.getters['people/filtered'].map(person => person.id)).toEqual(['x1'])
  })

  test('matches a creator title special filter against the person title', async () => {
    await shufflePeople()

    store.commit('people/setFilters', [{ id: 'illustrator', tag: 'Illustrator' }])

    expect(store.getters['people/filtered'].map(person => person.id)).toEqual(['x3'])
  })

  test('keeps the shuffled order under id filters, whatever order the ids are in', async () => {
    await shufflePeople()

    store.commit('people/setIdFilters', ['x1', 'x2'])

    expect(store.getters['people/filtered'].map(person => person.id)).toEqual(['x2', 'x1'])
  })

  test('recomputes on one live store as the shuffle, the filters and the id filters change', async () => {
    /** Reads people/filtered from the live store, as the ids it yields right now. */
    const filteredIds = () => store.getters['people/filtered'].map(person => person.id)
    seedRandom(0.5)
    store.commit('tags/people/set', copy(peopleTags))
    store.commit('people/set', copy(people))
    expect(filteredIds()).toEqual([])

    await store.dispatch('shuffle', 'people')
    expect(filteredIds()).toEqual(['x2', 'x3', 'x1'])

    store.commit('people/setFilters', [peopleTags.b])
    expect(filteredIds()).toEqual(['x1'])
    // cached between writes: the same filtered array comes back until state changes again
    expect(store.getters['people/filtered']).toBe(store.getters['people/filtered'])

    store.commit('people/setFilters', [])
    expect(filteredIds()).toEqual(['x2', 'x3', 'x1'])

    store.commit('people/setIdFilters', ['x1', 'x2'])
    expect(filteredIds()).toEqual(['x2', 'x1'])
  })
})

describe('subscribe', () => {
  beforeAll(async () => {
    await store.dispatch('subscribe')
    await vi.waitFor(() => expect(Object.keys(fb.listeners)).toHaveLength(12))
  })

  test('listens for values at every collection path, and for auth state changes', () => {
    expect(fb.on.mock.calls.map(([path]) => path).toSorted()).toEqual([
      'books',
      'bundles',
      'content',
      'invites',
      'people',
      'submits/books',
      'submits/bundles',
      'submits/people',
      'tags/books',
      'tags/bundles',
      'tags/people',
      'users',
    ])
    expect(fb.on.mock.calls.map(([, event]) => event)).toEqual(Array(12).fill('value'))
    expect(fb.onAuthStateChanged).toHaveBeenCalledTimes(1)
    expect(fb.onAuthStateChanged).toHaveBeenCalledWith(expect.any(Function))
  })

  test('a books snapshot sets the books, then shuffles them', () => {
    store.commit('tags/books/set', { pb: { id: 'pb', weight: 2 } })
    const commits = watchCommits()

    fb.listeners.books({ val: () => ({ n1: { id: 'n1', title: 'New', tags: { pb: true } } }) })

    expect(types(commits)).toEqual(['books/set', 'books/shuffle'])
    expect(commits.mock.calls[1][0].payload).toEqual({
      idProp: 'tags',
      weights: { pb: { id: 'pb', weight: 2 } },
    })
    expect(store.state.books.shuffled).toEqual([{ id: 'n1', title: 'New', tags: { pb: true } }])
    expect(warn).not.toHaveBeenCalled()
  })

  test('a people snapshot sets the people, then shuffles them', () => {
    store.commit('tags/people/set', copy(peopleTags))
    const commits = watchCommits()

    fb.listeners.people({ val: () => copy(people) })

    expect(types(commits)).toEqual(['people/set', 'people/shuffle'])
    expect(shuffledIds('people').toSorted()).toEqual(['x1', 'x2', 'x3'])
  })

  test('a tags/people snapshot sets the tags, then shuffles both books and people', () => {
    const commits = watchCommits()

    fb.listeners['tags/people']({ val: () => copy(peopleTags) })

    expect(types(commits)).toEqual(['tags/people/set', 'books/shuffle', 'people/shuffle'])
    expect(store.state.tags.people.data).toEqual(peopleTags)
  })

  test('a tags/books snapshot sets the tags without shuffling anything', () => {
    const commits = watchCommits()

    fb.listeners['tags/books']({ val: () => ({ pb: { id: 'pb', weight: 2 } }) })

    expect(types(commits)).toEqual(['tags/books/set'])
  })

  test('a signed-out auth state clears the user', () => {
    store.commit('user/setUser', { uid: 'u1' })
    expect(store.state.user.user).toEqual({ uid: 'u1' })
    const commits = watchCommits()

    fb.onAuthStateChanged.mock.calls[0][0](null)

    expect(commits.mock.calls.map(([mutation]) => mutation)).toEqual([
      { type: 'user/setUser', payload: null },
    ])
    expect(store.state.user.user).toBe(null)
  })
})

describe('resetAuth', () => {
  test('resets the admin-only collections and leaves the public ones loaded', async () => {
    store.commit('users/set', { u1: { profile: { name: 'Admin' }, roles: { owner: true } } })
    store.commit('submissions/books/set', { s1: { id: 's1', status: 'pending' } })
    store.commit('submissions/people/set', { s2: { id: 's2', status: 'pending' } })
    store.commit('books/set', copy(dbcache.books))
    const commits = watchCommits()

    await store.dispatch('resetAuth')

    expect(types(commits)).toEqual([
      'submissions/books/reset',
      'submissions/bundles/reset',
      'submissions/people/reset',
      'users/reset',
    ])
    expect(store.state.users).toEqual({ data: {}, loaded: false, loadedAll: false, name: 'users' })
    expect(store.state.submissions.books).toMatchObject({
      data: {},
      loaded: false,
      loadedAll: false,
      name: 'submits/books',
    })
    expect(store.state.submissions.people).toMatchObject({
      data: {},
      loaded: false,
      loadedAll: false,
      name: 'submits/people',
    })
    expect(store.state.books).toMatchObject({ loaded: true, data: dbcache.books })
  })
})
