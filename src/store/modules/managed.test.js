/*
 * Characterization tests for the collection and managed store modules, and the content store built
 * on collection. Dependency seams guarded:
 *
 * - vuex: namespaced modules, the local dispatch from managed update to save, rootState reaching
 *   the signed-in user, getters that return functions, and action errors surfacing as rejected
 *   dispatches.
 * - lodash: get and set back the "/" and "." path expressions of get, findBy and setOne.
 * - vue: collection state is reactive, so a computed over list() recomputes when setOne adds a key
 *   through lodash set.
 * - vitest: vi.mock intercepts the lazy import('@/firebase') inside the modules, and the fake
 *   clock stamps createdAt and updatedAt.
 */
import { computed } from 'vue'
import { createStore } from 'vuex'
import collection, { firebaseGet } from '@/store/modules/collection'
import managed from '@/store/modules/managed'
import content from '@/store/content'

const firebase = vi.hoisted(() => {
  /** Records every database call, in call order, as (method, path, ...args). */
  const db = vi.fn()
  /** Values served to once('value'), keyed by ref path. A missing path serves null. */
  const snapshots = new Map()
  /** The on('value') listener registered at each ref path. */
  const listeners = new Map()
  /** Wraps a value as a v8 DataSnapshot. */
  const snapshot = value => ({ val: () => value })
  /** A v8 database Reference that records its calls instead of reaching Firebase. */
  const ref = path => ({
    set: async value => db('set', path, value),
    update: async value => db('update', path, value),
    remove: async () => db('remove', path),
    once: (event, callback) => {
      db('once', path, event)
      callback(snapshot(snapshots.has(path) ? snapshots.get(path) : null))
    },
    on: (event, callback) => {
      db('on', path, event)
      listeners.set(path, callback)
    },
  })
  return {
    db,
    snapshots,
    listeners,
    /** Fires the on('value') listener registered at path with a snapshot of value. */
    fire: (path, value) => listeners.get(path)(snapshot(value)),
    module: { default: { database: () => ({ ref }) } },
  }
})

vi.mock('@/firebase', () => firebase.module)

const now = '2026-01-02T03:04:05.000Z'

const records = {
  r1: { id: 'r1', isbn: '9781250140913', tags: { t1: true }, meta: { lang: 'en' } },
  r2: { id: 'r2', isbn: '2', meta: { lang: 'es' } },
}

/** Deep-copies a fixture so no test shares an object that a mutation could reach. */
const clone = value => JSON.parse(JSON.stringify(value))

/** Builds a fresh store: a managed "things", a plain collection "plain", a user and content. */
const makeStore = ({ user = { uid: 'u1' } } = {}) =>
  createStore({
    modules: {
      things: managed('things'),
      plain: collection('plain'),
      user: { namespaced: true, state: () => ({ user }) },
      content,
    },
  })

/** Returns the recorded database calls, in call order. */
const calls = () => firebase.db.mock.calls

/** Waits until the database has recorded n calls, for writes that land after a dispatch resolves. */
const flushCalls = n => vi.waitFor(() => expect(calls()).toHaveLength(n))

/** Waits until an on('value') listener is registered at path; subscribe registers it lazily. */
const subscribed = path => vi.waitFor(() => expect(firebase.listeners.has(path)).toBe(true))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(now))
  firebase.db.mockReset()
  firebase.snapshots.clear()
  firebase.listeners.clear()
  window.dbcache = undefined
})

afterEach(() => {
  vi.useRealTimers()
  window.dbcache = undefined
})

describe('managed save', () => {
  test('stamps a new record with created and updated fields, flagging the cache before writing it', async () => {
    const store = makeStore()
    const value = { title: 'X' }
    await store.dispatch('things/save', { path: 'r1', value })
    expect(calls()).toEqual([
      ['set', 'cache/clean', false],
      [
        'set',
        'things/r1',
        { title: 'X', updatedAt: now, updatedBy: 'u1', createdAt: now, createdBy: 'u1' },
      ],
    ])
    // the caller's object is copied, not stamped in place
    expect(value).toEqual({ title: 'X' })
  })

  test('keeps an existing createdAt and createdBy, refreshing only updatedAt and updatedBy', async () => {
    const store = makeStore()
    const then = '2020-01-01T00:00:00.000Z'
    await store.dispatch('things/save', {
      path: 'r1',
      value: { title: 'X', createdAt: then, createdBy: 'orig', updatedAt: then, updatedBy: 'orig' },
    })
    expect(calls()).toEqual([
      ['set', 'cache/clean', false],
      [
        'set',
        'things/r1',
        { title: 'X', createdAt: then, createdBy: 'orig', updatedAt: now, updatedBy: 'u1' },
      ],
    ])
  })

  test('stamps null for updatedBy and createdBy when no user is signed in', async () => {
    const store = makeStore({ user: null })
    await store.dispatch('things/save', { path: 'r1', value: { title: 'X' } })
    expect(calls()[1]).toEqual([
      'set',
      'things/r1',
      { title: 'X', updatedAt: now, updatedBy: null, createdAt: now, createdBy: null },
    ])
  })

  test('update stamps only updatedAt and updatedBy', async () => {
    const store = makeStore()
    await store.dispatch('things/update', { path: 'r1', value: { title: 'Y' } })
    await flushCalls(2)
    expect(calls()).toEqual([
      ['set', 'cache/clean', false],
      ['update', 'things/r1', { title: 'Y', updatedAt: now, updatedBy: 'u1' }],
    ])
  })
})

describe('managed save on a nested path', () => {
  test('a "/" path writes the value untimestamped, then flags the cache', async () => {
    const store = makeStore()
    await store.dispatch('things/save', { path: 'r1/tags', value: { t1: true } })
    expect(calls()).toEqual([
      ['set', 'things/r1/tags', { t1: true }],
      ['set', 'cache/clean', false],
    ])
  })

  test('a "." path counts as nested too, so a non-object value passes through', async () => {
    const store = makeStore()
    await store.dispatch('things/save', { path: 'r1.title', value: 'X' })
    expect(calls()).toEqual([
      ['set', 'things/r1.title', 'X'],
      ['set', 'cache/clean', false],
    ])
  })

  test('update on a nested path writes untimestamped', async () => {
    const store = makeStore()
    await store.dispatch('things/update', { path: 'r1/tags', value: { t1: null } })
    await flushCalls(2)
    expect(calls()).toEqual([
      ['update', 'things/r1/tags', { t1: null }],
      ['set', 'cache/clean', false],
    ])
  })

  test('a multi-path update at "/" passes through untimestamped', async () => {
    const store = makeStore()
    await store.dispatch('things/update', { path: '/', value: { 'r1/title': 'Z' } })
    await flushCalls(2)
    expect(calls()).toEqual([
      ['update', 'things//', { 'r1/title': 'Z' }],
      ['set', 'cache/clean', false],
    ])
  })
})

describe('write errors', () => {
  test('managed save rejects a missing path, naming the collection', async () => {
    const store = makeStore()
    await expect(store.dispatch('things/save', { value: {} })).rejects.toThrow(
      new Error('Managed collection "things": path required'),
    )
    expect(calls()).toEqual([])
  })

  test('managed save rejects a record value that is not an object', async () => {
    const store = makeStore()
    await expect(store.dispatch('things/save', { path: 'r1', value: 'str' })).rejects.toThrow(
      new Error('Managed collection "things": value should be object, not string'),
    )
    await expect(store.dispatch('things/save', { path: 'r1' })).rejects.toThrow(
      new Error('Managed collection "things": value should be object, not undefined'),
    )
    expect(calls()).toEqual([])
  })

  test('the plain collection rejects an undefined value on save and update', async () => {
    const store = makeStore()
    await expect(store.dispatch('plain/save', { path: 'p1' })).rejects.toThrow(
      new Error('value may not be undefined'),
    )
    await expect(store.dispatch('plain/update', { path: 'p1' })).rejects.toThrow(
      new Error('value may not be undefined'),
    )
    expect(calls()).toEqual([])
  })

  test('the plain collection rejects a missing path on save, update and remove', async () => {
    const store = makeStore()
    await expect(store.dispatch('plain/save', { value: {} })).rejects.toThrow(
      new Error('path required'),
    )
    await expect(store.dispatch('plain/update', { value: {} })).rejects.toThrow(
      new Error('path required'),
    )
    await expect(store.dispatch('plain/remove')).rejects.toThrow(new Error('path required'))
    await expect(store.dispatch('things/remove', '')).rejects.toThrow(new Error('path required'))
    expect(calls()).toEqual([])
  })
})

describe('plain collection writes', () => {
  test('save writes the value as given, then flags the cache', async () => {
    const store = makeStore()
    await store.dispatch('plain/save', { path: 'p1', value: { a: 1 } })
    expect(calls()).toEqual([
      ['set', 'plain/p1', { a: 1 }],
      ['set', 'cache/clean', false],
    ])
  })

  test('save accepts null, which deletes the node in Firebase', async () => {
    const store = makeStore()
    await store.dispatch('plain/save', { path: 'p1/flag', value: null })
    expect(calls()).toEqual([
      ['set', 'plain/p1/flag', null],
      ['set', 'cache/clean', false],
    ])
  })

  test('update writes the value as given, then flags the cache', async () => {
    const store = makeStore()
    await store.dispatch('plain/update', { path: 'p1', value: { a: 2 } })
    expect(calls()).toEqual([
      ['update', 'plain/p1', { a: 2 }],
      ['set', 'cache/clean', false],
    ])
  })

  test('remove, inherited by managed collections, removes the record, then flags the cache', async () => {
    const store = makeStore()
    await store.dispatch('things/remove', 'r1')
    expect(calls()).toEqual([
      ['remove', 'things/r1'],
      ['set', 'cache/clean', false],
    ])
  })
})

describe('getters', () => {
  /** Builds a store whose "things" collection holds the r1 and r2 fixtures. */
  const loadedStore = () => {
    const store = makeStore()
    store.commit('things/set', clone(records))
    return store
  }

  test('get normalizes "/" to lodash get paths, and "." paths work as-is', () => {
    const store = loadedStore()
    const get = store.getters['things/get']
    expect(get('r1/tags/t1')).toBe(true)
    expect(get('r1.meta.lang')).toBe('en')
    expect(get('r2/meta')).toEqual({ lang: 'es' })
    expect(get('r1/missing/deep')).toBeUndefined()
  })

  test('get at "/", "" or no path returns the whole collection', () => {
    const store = loadedStore()
    const get = store.getters['things/get']
    expect(get('/')).toEqual(records)
    expect(get('')).toEqual(records)
    expect(get()).toEqual(records)
    expect(get('/')).toBe(store.getters['things/getAll']())
  })

  test('getAll returns the collection data', () => {
    const store = loadedStore()
    expect(store.getters['things/getAll']()).toEqual(records)
  })

  test('findBy matches a deep value by "/" or "." path', () => {
    const store = loadedStore()
    const findBy = store.getters['things/findBy']
    expect(findBy('isbn', '9781250140913')).toEqual(records.r1)
    expect(findBy('meta/lang', 'es')).toEqual(records.r2)
    expect(findBy('meta.lang', 'en')).toEqual(records.r1)
  })

  test('findBy takes a predicate over the deep value, or over the whole record with one argument', () => {
    const store = loadedStore()
    const findBy = store.getters['things/findBy']
    expect(findBy('isbn', isbn => isbn.length === 1)).toEqual(records.r2)
    expect(findBy(record => record.id === 'r2')).toEqual(records.r2)
    expect(findBy(() => true)).toEqual(records.r1)
  })

  test('findBy returns null when nothing matches', () => {
    const store = loadedStore()
    expect(store.getters['things/findBy']('isbn', 'nope')).toBeNull()
    expect(store.getters['things/findBy'](() => false)).toBeNull()
  })

  test('list is empty until the collection is loaded, even when seeded from the dbcache', () => {
    window.dbcache = { things: clone(records) }
    const store = makeStore()
    expect(store.state.things.data).toEqual(records)
    expect(store.state.things.loaded).toBe(false)
    expect(store.getters['things/list']()).toEqual([])
    expect(store.getters['things/get']('r2/isbn')).toBe('2')

    store.commit('things/set', clone(records))
    expect(store.getters['things/list']()).toEqual([records.r1, records.r2])
  })
})

describe('mutations', () => {
  test('setOne adds a record and marks the collection loaded, but not loadedAll', () => {
    const store = makeStore()
    store.commit('things/setOne', { path: 'r9', value: { id: 'r9' } })
    expect(store.state.things.data).toEqual({ r9: { id: 'r9' } })
    expect(store.state.things.loaded).toBe(true)
    expect(store.state.things.loadedAll).toBe(false)
    expect(store.getters['things/list']()).toEqual([{ id: 'r9' }])
  })

  test('setOne sets a deep value through a "." path, creating objects along the way', () => {
    const store = makeStore()
    store.commit('things/set', clone(records))
    store.commit('things/setOne', { path: 'r1.meta.lang', value: 'fr' })
    store.commit('things/setOne', { path: 'r3.meta.lang', value: 'de' })
    expect(store.state.things.data.r1.meta).toEqual({ lang: 'fr' })
    expect(store.state.things.data.r3).toEqual({ meta: { lang: 'de' } })
  })

  test('set replaces the data and marks the collection loaded and loadedAll', () => {
    const store = makeStore()
    store.commit('things/setOne', { path: 'r9', value: { id: 'r9' } })
    store.commit('things/set', clone(records))
    expect(store.state.things.data).toEqual(records)
    expect(store.state.things.loaded).toBe(true)
    expect(store.state.things.loadedAll).toBe(true)
  })

  test('reset restores the dbcache entry for the collection, unloaded', () => {
    const store = makeStore()
    store.commit('things/set', clone(records))
    window.dbcache = { things: { c1: { id: 'c1' } } }
    store.dispatch('things/reset')
    expect(store.state.things).toEqual({
      data: { c1: { id: 'c1' } },
      loaded: false,
      loadedAll: false,
      name: 'things',
    })
  })

  test('reset with no dbcache empties the collection', () => {
    const store = makeStore()
    store.commit('things/set', clone(records))
    store.commit('things/reset')
    expect(store.state.things).toEqual({
      data: {},
      loaded: false,
      loadedAll: false,
      name: 'things',
    })
  })

  test('a computed over list() recomputes when setOne adds a record', () => {
    const store = makeStore()
    store.commit('things/set', { r1: { id: 'r1' } })
    const count = computed(() => store.getters['things/list']().length)
    expect(count.value).toBe(1)
    store.commit('things/setOne', { path: 'r2', value: { id: 'r2' } })
    expect(count.value).toBe(2)
  })
})

describe('loading', () => {
  test('loadCache sets the given data, or {} for null, and marks the collection loaded', async () => {
    const store = makeStore()
    await store.dispatch('things/loadCache', clone(records))
    expect(store.state.things.data).toEqual(records)
    await store.dispatch('things/loadCache', null)
    expect(store.state.things.data).toEqual({})
    expect(store.state.things.loaded).toBe(true)
    expect(store.state.things.loadedAll).toBe(true)
    expect(calls()).toEqual([])
  })

  test('load reads the collection once and resolves its data', async () => {
    const store = makeStore()
    firebase.snapshots.set('things', clone(records))
    await expect(store.dispatch('things/load')).resolves.toEqual(records)
    expect(calls()).toEqual([['once', 'things', 'value']])
    expect(store.state.things.data).toEqual(records)
    expect(store.state.things.loadedAll).toBe(true)
  })

  test('load resolves {} for an empty collection', async () => {
    const store = makeStore()
    await expect(store.dispatch('things/load')).resolves.toEqual({})
    expect(store.state.things.data).toEqual({})
    expect(store.state.things.loaded).toBe(true)
  })

  test('loadOne reads one record, adds it to the collection and resolves it', async () => {
    const store = makeStore()
    firebase.snapshots.set('things/r2', clone(records.r2))
    await expect(store.dispatch('things/loadOne', 'r2')).resolves.toEqual(records.r2)
    expect(calls()).toEqual([['once', 'things/r2', 'value']])
    expect(store.state.things.data).toEqual({ r2: records.r2 })
    expect(store.state.things.loaded).toBe(true)
    expect(store.state.things.loadedAll).toBe(false)
  })

  test('loadOne resolves {} for a missing record, and stores {} under its id', async () => {
    const store = makeStore()
    await expect(store.dispatch('things/loadOne', 'r404')).resolves.toEqual({})
    expect(store.state.things.data).toEqual({ r404: {} })
  })

  test('firebaseGet resolves the value at a ref, or null when it is empty', async () => {
    firebase.snapshots.set('links/index/abc', 'r1')
    await expect(firebaseGet('links/index/abc')).resolves.toBe('r1')
    await expect(firebaseGet('links/index/nope')).resolves.toBeNull()
    expect(calls()).toEqual([
      ['once', 'links/index/abc', 'value'],
      ['once', 'links/index/nope', 'value'],
    ])
  })
})

describe('subscribe', () => {
  test('stores the transformed value, then calls onValue with the raw value', async () => {
    const store = makeStore()
    const extra = { id: 'extra' }
    const transform = vi.fn(value => ({ ...value, extra }))
    let dataWhenCalled
    const onValue = vi.fn(() => {
      dataWhenCalled = clone(store.state.things.data)
    })
    await store.dispatch('things/subscribe', { transform, onValue })
    await subscribed('things')
    expect(calls()).toEqual([['on', 'things', 'value']])

    firebase.fire('things', clone(records))
    expect(transform.mock.calls).toEqual([[records]])
    expect(store.state.things.data).toEqual({ ...records, extra })
    expect(store.state.things.loadedAll).toBe(true)
    expect(onValue.mock.calls).toEqual([[records]])
    expect(dataWhenCalled).toEqual({ ...records, extra })
  })

  test('each snapshot replaces the data rather than merging it', async () => {
    const store = makeStore()
    await store.dispatch('things/subscribe')
    await subscribed('things')
    firebase.fire('things', clone(records))
    firebase.fire('things', { r3: { id: 'r3' } })
    expect(store.state.things.data).toEqual({ r3: { id: 'r3' } })
  })

  test('a null snapshot stores {}', async () => {
    const store = makeStore()
    const onValue = vi.fn()
    await store.dispatch('things/subscribe', { onValue })
    await subscribed('things')
    firebase.fire('things', null)
    expect(store.state.things.data).toEqual({})
    expect(store.state.things.loaded).toBe(true)
    expect(onValue.mock.calls).toEqual([[null]])
  })
})

describe('content', () => {
  test('get reads a nested template by "/" path', () => {
    const store = makeStore()
    store.commit('content/reset')
    store.commit('content/set', {
      email: { invite: { contributor: { subject: 'You are invited to contribute' } } },
    })
    expect(store.getters['content/get']('email/invite/contributor/subject')).toBe(
      'You are invited to contribute',
    )
    expect(store.state.content.name).toBe('content')
  })
})
