/*
 * Characterization tests for the submissions store (src/store/submissions.js and its books,
 * bundles and people children), the bundle submissions write contract
 * (src/store/submissions/bundles.js, a bare managed('submits/bundles')), and the root resetAuth
 * action that clears them on logout. Dependency seams guarded:
 *
 * - vuex: three collections registered under the nested namespace submissions/books|bundles|people,
 *   parent actions that dispatch into children by relative name, a root action that dispatches
 *   into namespaced modules, rootState reaching the signed-in user, getters that return functions,
 *   and action errors surfacing as rejected dispatches.
 * - vue: collection state is reactive, so a computed over list() recomputes when a value event
 *   replaces the collection.
 * - lodash: get backs the "/" path expressions of the get and findBy getters, and set backs setOne
 *   when a single submission is loaded.
 * - vitest: vi.mock intercepts firebase/app beneath the lazy import('@/firebase') inside the
 *   modules, and vi.setSystemTime pins the managed timestamps.
 *
 * Firebase (pinned at v8) is the one boundary faked: a small in-memory database whose value
 * listeners deliver their first snapshot on a microtask and re-deliver synchronously when a write
 * touches their path, as the v8 client does for local writes. It is faked at firebase/app rather
 * than '@/firebase' because submissions/subscribe imports '@/firebase' three times at once, and a
 * vi.mock of '@/firebase' hands only the first of those concurrent imports the fake.
 */
import { computed } from 'vue'
import store from '@/store'

const fb = vi.hoisted(() => {
  /** Deep-copies a JSON value, so the store and the fake never share an object. */
  const clone = value => (value === undefined ? null : JSON.parse(JSON.stringify(value)))
  /** The database tree, and the value listeners registered on it as { path, callback }. */
  const state = { tree: null, listeners: [] }
  /** Records every write, in call order, as (method, path, value). */
  const write = vi.fn()
  /** Records every read and subscription, in call order, as (method, path, event). */
  const read = vi.fn()

  /** Splits a ref path into its keys. */
  const keysOf = path => path.split('/').filter(Boolean)

  /** Returns the value at path, or null where Firebase would report nothing. */
  const valueAt = path =>
    keysOf(path).reduce(
      (node, key) => (node !== null && typeof node === 'object' && key in node ? node[key] : null),
      state.tree,
    )

  /** Returns node with value placed at keys, pruning nulls and emptied objects as Firebase does. */
  const setIn = (node, [key, ...rest], value) => {
    if (key === undefined) return value
    const parent = node !== null && typeof node === 'object' ? node : {}
    const { [key]: previous, ...siblings } = parent
    const child = setIn(previous, rest, value)
    const next = child === null ? siblings : { ...parent, [key]: child }
    return Object.keys(next).length ? next : null
  }

  /** Whether a write at one path changes the value seen at the other: one contains the other. */
  const related = (a, b) => {
    const [x, y] = [keysOf(a).join('/'), keysOf(b).join('/')]
    return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)
  }

  /** Wraps a value as a v8 DataSnapshot. */
  const snapshot = value => ({ val: () => clone(value) })

  /** Applies (path, value) writes to the tree, then re-delivers each related listener once. */
  const apply = writes => {
    state.tree = writes.reduce(
      (tree, [path, value]) => setIn(tree, keysOf(path), clone(value)),
      state.tree,
    )
    state.listeners
      .filter(listener => writes.some(([path]) => related(listener.path, path)))
      .forEach(listener => listener.callback(snapshot(valueAt(listener.path))))
  }

  /** A v8 database Reference over the in-memory tree. */
  const ref = path => ({
    set: async value => {
      write('set', path, clone(value))
      apply([[path, value]])
    },
    update: async value => {
      write('update', path, clone(value))
      apply(Object.entries(value).map(([key, child]) => [`${path}/${key}`, child]))
    },
    remove: async () => {
      write('remove', path)
      apply([[path, null]])
    },
    once: (event, callback) => {
      read('once', path, event)
      callback(snapshot(valueAt(path)))
    },
    on: (event, callback) => {
      read('on', path, event)
      state.listeners = [...state.listeners, { path, callback }]
      queueMicrotask(() => callback(snapshot(valueAt(path))))
    },
  })

  return {
    write,
    read,
    firebase: {
      initializeApp: () => {},
      database: () => ({ ref, useEmulator: () => {} }),
    },
    /** Replaces the whole database, as data already on the server, without notifying anyone. */
    seed: tree => {
      state.tree = clone(tree)
    },
    /** Writes as another client would: nothing is recorded, but related listeners re-deliver. */
    remoteSet: (path, value) => apply([[path, value]]),
    /** The paths that have a value listener, in registration order. */
    paths: () => state.listeners.map(listener => listener.path),
    /** Empties the database, drops every listener and clears the recorders. */
    reset: () => {
      state.tree = null
      state.listeners = []
      write.mockReset()
      read.mockReset()
    },
  }
})

vi.mock('firebase/app', () => ({ default: fb.firebase }))
vi.mock('firebase/auth', () => ({}))
vi.mock('firebase/database', () => ({}))
vi.mock('firebase/storage', () => ({}))

const NOW = '2026-01-02T03:04:05.000Z'

/** The submits tree on the server: one pending submission of each kind. */
const db = {
  submits: {
    books: { s1: { id: 's1', group: 'g1', status: 'pending' } },
    bundles: { b1: { id: 'b1', status: 'pending' } },
    people: { p1: { id: 'p1', name: 'Kadir Nelson', status: 'pending' } },
  },
}

/** The state of a collection that has never loaded. */
const empty = name => ({ data: {}, loaded: false, loadedAll: false, name })

/** Subscribes to all three submission collections and waits for their first value events. */
const subscribe = async () => {
  await store.dispatch('submissions/subscribe')
  await vi.waitFor(() => expect(fb.paths()).toHaveLength(3))
  await vi.waitFor(() =>
    expect(
      ['books', 'bundles', 'people'].map(type => store.state.submissions[type].loaded),
    ).toEqual([true, true, true]),
  )
}

/** Waits until the database has recorded n writes, for writes that land after a dispatch resolves. */
const flushWrites = n => vi.waitFor(() => expect(fb.write).toHaveBeenCalledTimes(n))

beforeEach(async () => {
  fb.reset()
  window.dbcache = undefined
  store.commit('user/setUser', null)
  await store.dispatch('submissions/reset')
  await store.dispatch('users/reset')
})

afterEach(() => {
  store.commit('user/setUser', null)
})

describe('nested namespaced registration', () => {
  test('each submission collection is registered under submissions/ with its own getters', () => {
    expect(
      Object.keys(store.getters)
        .filter(key => key.startsWith('submissions/'))
        .toSorted(),
    ).toEqual([
      'submissions/books/filtered',
      'submissions/books/findBy',
      'submissions/books/get',
      'submissions/books/getAll',
      'submissions/books/list',
      'submissions/bundles/findBy',
      'submissions/bundles/get',
      'submissions/bundles/getAll',
      'submissions/bundles/list',
      'submissions/people/findBy',
      'submissions/people/get',
      'submissions/people/getAll',
      'submissions/people/list',
    ])
  })

  test('each collection starts empty and unloaded, named by its Firebase path', () => {
    expect(store.state.submissions).toEqual({
      books: empty('submits/books'),
      bundles: empty('submits/bundles'),
      people: empty('submits/people'),
    })
    expect(store.getters['submissions/books/list']()).toEqual([])
  })
})

describe('submissions/subscribe', () => {
  test('registers exactly one value listener on each submits path', async () => {
    await store.dispatch('submissions/subscribe')
    await vi.waitFor(() => expect(fb.paths()).toHaveLength(3))
    expect(fb.paths().toSorted()).toEqual(['submits/books', 'submits/bundles', 'submits/people'])
    expect(fb.read.mock.calls.map(([method, , event]) => [method, event])).toEqual([
      ['on', 'value'],
      ['on', 'value'],
      ['on', 'value'],
    ])
  })

  test('stores each delivered tree whole, marking the collection fully loaded', async () => {
    fb.seed(db)
    await subscribe()
    expect(store.state.submissions.books).toEqual({
      data: { s1: { id: 's1', group: 'g1', status: 'pending' } },
      loaded: true,
      loadedAll: true,
      name: 'submits/books',
    })
    expect(store.state.submissions.bundles.data).toEqual(db.submits.bundles)
    expect(store.state.submissions.people.data).toEqual(db.submits.people)
  })

  test('list, get and findBy read the delivered submissions through lodash paths', async () => {
    fb.seed(db)
    await subscribe()
    expect(store.getters['submissions/books/list']()).toEqual([
      { id: 's1', group: 'g1', status: 'pending' },
    ])
    expect(store.getters['submissions/people/get']('p1').name).toBe('Kadir Nelson')
    expect(store.getters['submissions/people/get']('p1/name')).toBe('Kadir Nelson')
    expect(store.getters['submissions/people/get']('p9')).toBeUndefined()
    expect(store.getters['submissions/bundles/findBy']('status', 'pending').id).toBe('b1')
    expect(store.getters['submissions/books/findBy'](sub => sub.group === 'g1')).toEqual({
      id: 's1',
      group: 'g1',
      status: 'pending',
    })
    expect(store.getters['submissions/bundles/findBy']('status', 'approved')).toBeNull()
  })

  test('a later write by another client replaces the collection with both records', async () => {
    fb.seed(db)
    await subscribe()
    fb.remoteSet('submits/people/p2', { id: 'p2', name: 'Faith Ringgold', status: 'pending' })
    expect(store.state.submissions.people.data).toEqual({
      p1: { id: 'p1', name: 'Kadir Nelson', status: 'pending' },
      p2: { id: 'p2', name: 'Faith Ringgold', status: 'pending' },
    })
    // the other collections were not re-delivered and keep what they had
    expect(store.state.submissions.books.data).toEqual(db.submits.books)
  })

  test('an empty database delivers null, which is stored as an empty loaded collection', async () => {
    fb.seed(null)
    await subscribe()
    expect(store.state.submissions.books).toEqual({
      data: {},
      loaded: true,
      loadedAll: true,
      name: 'submits/books',
    })
    expect(store.getters['submissions/books/list']()).toEqual([])
  })

  test('a computed over list() recomputes as value events arrive', async () => {
    fb.seed(db)
    await subscribe()
    const pendingIds = computed(() =>
      store.getters['submissions/books/list']()
        .filter(sub => sub.status === 'pending')
        .map(sub => sub.id),
    )
    expect(pendingIds.value).toEqual(['s1'])

    fb.remoteSet('submits/books/s2', { id: 's2', group: 'g1', status: 'pending' })
    expect(pendingIds.value).toEqual(['s1', 's2'])

    fb.remoteSet('submits/books/s1/status', 'approved')
    expect(pendingIds.value).toEqual(['s2'])
  })
})

describe('submissions/books/loadOne', () => {
  test('reads one submission and sets it alone, loaded but not fully loaded', async () => {
    fb.seed(db)
    await expect(store.dispatch('submissions/books/loadOne', 's1')).resolves.toEqual({
      id: 's1',
      group: 'g1',
      status: 'pending',
    })
    expect(fb.read.mock.calls).toEqual([['once', 'submits/books/s1', 'value']])
    expect(store.state.submissions.books).toEqual({
      data: { s1: { id: 's1', group: 'g1', status: 'pending' } },
      loaded: true,
      loadedAll: false,
      name: 'submits/books',
    })
  })
})

describe('reset', () => {
  test('submissions/reset returns every child collection to its initial state', async () => {
    fb.seed(db)
    await subscribe()
    await store.dispatch('submissions/reset')
    expect(store.state.submissions.books).toEqual(empty('submits/books'))
    expect(store.state.submissions.bundles).toEqual(empty('submits/bundles'))
    expect(store.state.submissions.people).toEqual(empty('submits/people'))
    expect(store.getters['submissions/books/list']()).toEqual([])
  })

  test('root resetAuth clears the submission collections and the users collection', async () => {
    fb.seed(db)
    await subscribe()
    await store.dispatch('users/loadCache', {
      owner1: { roles: { owner: true }, profile: { name: 'Ashley Bryan' } },
    })
    expect(store.state.users.loaded).toBe(true)

    await store.dispatch('resetAuth')
    expect(store.state.submissions).toEqual({
      books: empty('submits/books'),
      bundles: empty('submits/bundles'),
      people: empty('submits/people'),
    })
    expect(store.state.users).toEqual(empty('users'))
  })
})

describe('submissions/bundles writes (managed submits/bundles)', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date(NOW))
    store.commit('user/setUser', { uid: 'owner1' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('save flags the cache, then sets the bundle stamped with created and updated fields', async () => {
    await store.dispatch('submissions/bundles/save', {
      path: 'b1',
      value: { title: 'Brave Girls', books: ['bk1', 'bk2'] },
    })
    expect(fb.write.mock.calls).toEqual([
      ['set', 'cache/clean', false],
      [
        'set',
        'submits/bundles/b1',
        {
          title: 'Brave Girls',
          books: ['bk1', 'bk2'],
          createdAt: NOW,
          createdBy: 'owner1',
          updatedAt: NOW,
          updatedBy: 'owner1',
        },
      ],
    ])
  })

  test('save keeps an existing createdAt and createdBy', async () => {
    await store.dispatch('submissions/bundles/save', {
      path: 'b1',
      value: { title: 'Brave Girls', createdAt: '2020-01-01T00:00:00.000Z', createdBy: 'contrib1' },
    })
    expect(fb.write.mock.calls[1]).toEqual([
      'set',
      'submits/bundles/b1',
      {
        title: 'Brave Girls',
        createdAt: '2020-01-01T00:00:00.000Z',
        createdBy: 'contrib1',
        updatedAt: NOW,
        updatedBy: 'owner1',
      },
    ])
  })

  test('save with nobody signed in stamps null for createdBy and updatedBy', async () => {
    store.commit('user/setUser', null)
    await store.dispatch('submissions/bundles/save', {
      path: 'b1',
      value: { title: 'Brave Girls' },
    })
    expect(fb.write.mock.calls[1]).toEqual([
      'set',
      'submits/bundles/b1',
      { title: 'Brave Girls', createdAt: NOW, createdBy: null, updatedAt: NOW, updatedBy: null },
    ])
  })

  test('save to a nested path sets the raw value unstamped, then flags the cache', async () => {
    await store.dispatch('submissions/bundles/save', { path: 'b1/status', value: 'approved' })
    expect(fb.write.mock.calls).toEqual([
      ['set', 'submits/bundles/b1/status', 'approved'],
      ['set', 'cache/clean', false],
    ])
  })

  test('save rejects a missing path and a non-object record without writing', async () => {
    await expect(
      store.dispatch('submissions/bundles/save', { path: '', value: { title: 'Brave Girls' } }),
    ).rejects.toThrow('Managed collection "submits/bundles": path required')
    await expect(
      store.dispatch('submissions/bundles/save', { path: 'b1', value: 'x' }),
    ).rejects.toThrow('Managed collection "submits/bundles": value should be object, not string')
    expect(fb.write).not.toHaveBeenCalled()
  })

  test('update flags the cache, then updates the bundle with updated fields only', async () => {
    await store.dispatch('submissions/bundles/update', {
      path: 'b1',
      value: { status: 'rejected' },
    })
    await flushWrites(2)
    expect(fb.write.mock.calls).toEqual([
      ['set', 'cache/clean', false],
      ['update', 'submits/bundles/b1', { status: 'rejected', updatedAt: NOW, updatedBy: 'owner1' }],
    ])
  })

  test('remove deletes the bundle, then flags the cache', async () => {
    await store.dispatch('submissions/bundles/remove', 'b1')
    expect(fb.write.mock.calls).toEqual([
      ['remove', 'submits/bundles/b1'],
      ['set', 'cache/clean', false],
    ])
  })

  test('a saved bundle reaches state only through the value listener, not a local commit', async () => {
    await store.dispatch('submissions/bundles/save', {
      path: 'b1',
      value: { title: 'Brave Girls' },
    })
    expect(store.state.submissions.bundles).toEqual(empty('submits/bundles'))

    await subscribe()
    await store.dispatch('submissions/bundles/save', { path: 'b2', value: { title: 'Joyful' } })
    expect(store.state.submissions.bundles.data).toEqual({
      b1: {
        title: 'Brave Girls',
        createdAt: NOW,
        createdBy: 'owner1',
        updatedAt: NOW,
        updatedBy: 'owner1',
      },
      b2: {
        title: 'Joyful',
        createdAt: NOW,
        createdBy: 'owner1',
        updatedAt: NOW,
        updatedBy: 'owner1',
      },
    })
  })
})
