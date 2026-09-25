/*
 * Characterization tests for the tags store (with the sortable module it mixes in) and the logs
 * store. Dependency seams guarded:
 *
 * - vuex: namespaced nested modules (`tags/books/...`), cross-module `rootGetters` and root
 *   dispatches (`books/update`, `logs/save` with `{ root: true }`), and `replaceState`.
 * - uuid: tag removal logs under a chronouid key, whose 7-character suffix is the head of a real
 *   `uuid` v4 string and must stay lowercase hex.
 *
 * Firebase is the boundary. It is faked at 'firebase/app' rather than '@/firebase', because tag
 * removal imports '@/firebase' from several places at once, and a vi.mock of '@/firebase' let a
 * concurrent import through to the real module.
 */
import store from '@/store'

const fb = vi.hoisted(() => ({
  set: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  on: vi.fn(),
}))

vi.mock('firebase/app', () => {
  /** A fake v8 Reference that records every write by its path. */
  const ref = path => ({
    set: async value => fb.set(path, value),
    update: async value => fb.update(path, value),
    remove: async () => fb.remove(path),
    on: (event, callback) => fb.on(path, event, callback),
    once: () => {},
  })
  return {
    default: {
      initializeApp: () => {},
      database: () => ({ ref, useEmulator: () => {} }),
    },
  }
})
vi.mock('firebase/auth', () => ({}))
vi.mock('firebase/database', () => ({}))
vi.mock('firebase/storage', () => ({}))

const initialState = JSON.parse(JSON.stringify(store.state))

/** Production-like people tags, deliberately out of sortOrder. Gender is the only parent. */
const peopleTags = {
  g3: { id: 'g3', tag: 'Agender', parent: 'g', sortOrder: 19.05 },
  lg: { id: 'lg', tag: 'LGBTQIA+', sortOrder: 17.02 },
  g: { id: 'g', tag: 'Gender', sortOrder: 19.02 },
  in: { id: 'in', tag: 'Indigenous', sortOrder: 1 },
  g4: { id: 'g4', tag: 'Trans ', parent: 'g', sortOrder: 19.06 },
  ar: { id: 'ar', tag: 'Arab/Middle Eastern/North African', sortOrder: 3 },
  g1: { id: 'g1', tag: 'Gender Non-Conforming', parent: 'g', sortOrder: 19.03 },
  di: { id: 'di', tag: 'Disabled', sortOrder: 18.02 },
  bl: { id: 'bl', tag: 'Black', sortOrder: 2 },
  g2: { id: 'g2', tag: 'Genderfluid', parent: 'g', sortOrder: 19.04 },
}

/** Deep-copies a fixture so a commit never shares objects with it. */
const copy = value => JSON.parse(JSON.stringify(value))

/** Returns the paths and values of every recorded write of one kind, ignoring the cache flag. */
const writes = method => fb[method].mock.calls.filter(([path]) => path !== 'cache/clean')

/** Returns how many times the `cache/clean` flag has been set to false. */
const cacheFlags = () =>
  fb.set.mock.calls.filter(([path, value]) => path === 'cache/clean' && value === false).length

beforeEach(() => {
  store.replaceState(copy(initialState))
  Object.values(fb).forEach(mock => mock.mockReset())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('tags/<type>/listSorted', () => {
  test('sorts by the numeric value of sortOrder, not lexicographically', () => {
    store.commit('tags/books/set', {
      a: { id: 'a', tag: 'A', sortOrder: 13 },
      b: { id: 'b', tag: 'B', sortOrder: 2 },
      c: { id: 'c', tag: 'C', sortOrder: '10' },
      d: { id: 'd', tag: 'D', sortOrder: 9 },
      e: { id: 'e', tag: 'E', sortOrder: 15.03 },
      f: { id: 'f', tag: 'F', sortOrder: 15.01 },
    })

    const sorted = store.getters['tags/books/listSorted']()

    expect(sorted.map(tag => tag.sortOrder)).toEqual([2, 9, '10', 13, 15.01, 15.03])
    expect(sorted.map(tag => tag.id)).toEqual(['b', 'd', 'c', 'a', 'f', 'e'])
  })

  test('returns an empty array before the tags collection is loaded', () => {
    expect(store.state.tags.books.loaded).toBe(false)
    expect(store.getters['tags/books/listSorted']()).toEqual([])
  })

  test('each tag collection sorts independently', () => {
    store.commit('tags/bundles/set', {
      x: { id: 'x', tag: 'X', sortOrder: 2 },
      y: { id: 'y', tag: 'Y', sortOrder: 1 },
    })

    expect(store.getters['tags/bundles/listSorted']().map(tag => tag.id)).toEqual(['y', 'x'])
    expect(store.getters['tags/books/listSorted']()).toEqual([])
  })
})

describe('tags/topLevel', () => {
  test('returns the sorted top-level tags, leaving out any tag that has subtags', () => {
    store.commit('tags/people/set', copy(peopleTags))

    expect(store.getters['tags/topLevel']('people').map(tag => tag.tag)).toEqual([
      'Indigenous',
      'Black',
      'Arab/Middle Eastern/North African',
      'LGBTQIA+',
      'Disabled',
    ])
  })

  test('returns an empty array before the tags collection is loaded', () => {
    expect(store.getters['tags/topLevel']('people')).toEqual([])
  })
})

describe('tags/subtags', () => {
  test('returns the subtags of the named parent in sortOrder', () => {
    store.commit('tags/people/set', copy(peopleTags))

    expect(store.getters['tags/subtags']('people', 'Gender').map(tag => tag.tag)).toEqual([
      'Gender Non-Conforming',
      'Genderfluid',
      'Agender',
      'Trans ',
    ])
  })

  test('returns an empty array for a parent with no subtags', () => {
    store.commit('tags/people/set', copy(peopleTags))

    expect(store.getters['tags/subtags']('people', 'Black')).toEqual([])
  })
})

describe('tags/<type>/remove', () => {
  test('removes a book tag from the one book using it, deletes the tag, and logs both', async () => {
    const tag = { id: 't1', tag: 'Joy' }
    store.commit('tags/books/set', { t1: tag, t2: { id: 't2', tag: 'Grief' } })
    store.commit('books/set', {
      b1: { id: 'b1', title: 'One', tags: { t1: true, t2: true } },
      b2: { id: 'b2', title: 'Two', tags: { t2: true } },
    })

    await store.dispatch('tags/books/remove', 't1')
    // the book update is dispatched without being awaited, so wait for its cache flag too
    await vi.waitFor(() => expect(cacheFlags()).toBe(3))

    expect(writes('update')).toEqual([['books/b1/tags', { t1: null }]])
    expect(writes('remove')).toEqual([['tags/books/t1']])
    expect(writes('set')).toHaveLength(1)

    const [logPath, logValue] = writes('set')[0]
    expect(logPath).toMatch(/^logs\/e4dc55ad3df8-[0-9a-f]{7}$/)
    expect(logValue).toEqual({
      createdAt: '2026-01-02T03:04:05.000Z',
      type: 'tags',
      action: 'delete',
      message:
        'Deleted tag "Joy":\n{\n  "id": "t1",\n  "tag": "Joy"\n}\n\n' +
        'Removed from 1 books:\n{\n  "b1": "One"\n}',
    })
  })

  test('removes a people tag from the identities of the person using it', async () => {
    store.commit('tags/people/set', { p1: { id: 'p1', tag: 'Black' } })
    store.commit('people/set', {
      x1: { id: 'x1', name: 'Ada', identities: { p1: true } },
      x2: { id: 'x2', name: 'Grace', identities: { p2: true } },
    })

    await store.dispatch('tags/people/remove', 'p1')
    await vi.waitFor(() => expect(cacheFlags()).toBe(3))

    expect(writes('update')).toEqual([['people/x1/identities', { p1: null }]])
    expect(writes('remove')).toEqual([['tags/people/p1']])
    const [logPath, logValue] = writes('set')[0]
    expect(logPath).toMatch(/^logs\/e4dc55ad3df8-[0-9a-f]{7}$/)
    expect(logValue.message).toBe(
      'Deleted tag "Black":\n{\n  "id": "p1",\n  "tag": "Black"\n}\n\n' +
        'Removed from 1 people:\n{\n  "x1": "Ada"\n}',
    )
  })

  test('removes a bundle tag from the tags of the bundle using it', async () => {
    store.commit('tags/bundles/set', { u1: { id: 'u1', tag: 'Holidays' } })
    store.commit('bundles/set', { n1: { id: 'n1', title: 'Winter', tags: { u1: true } } })

    await store.dispatch('tags/bundles/remove', 'u1')
    await vi.waitFor(() => expect(cacheFlags()).toBe(3))

    expect(writes('update')).toEqual([['bundles/n1/tags', { u1: null }]])
    expect(writes('remove')).toEqual([['tags/bundles/u1']])
    expect(writes('set')[0][1].message).toBe(
      'Deleted tag "Holidays":\n{\n  "id": "u1",\n  "tag": "Holidays"\n}\n\n' +
        'Removed from 1 bundles:\n{\n  "n1": "Winter"\n}',
    )
  })

  test('deletes an unused tag without writing a log entry', async () => {
    store.commit('tags/books/set', { t9: { id: 't9', tag: 'Unused' } })
    store.commit('books/set', { b1: { id: 'b1', title: 'One', tags: { t1: true } } })

    await store.dispatch('tags/books/remove', 't9')

    expect(fb.update).not.toHaveBeenCalled()
    expect(fb.remove.mock.calls).toEqual([['tags/books/t9']])
    expect(fb.set.mock.calls).toEqual([['cache/clean', false]])
  })

  test('removes the tag from every book that uses it', async () => {
    store.commit('tags/books/set', { t1: { id: 't1', tag: 'Joy' } })
    store.commit('books/set', {
      b1: { id: 'b1', title: 'One', tags: { t1: true } },
      b2: { id: 'b2', title: 'Two', tags: { t1: true, t2: true } },
      b3: { id: 'b3', title: 'Three', tags: { t1: true } },
      b4: { id: 'b4', title: 'Four', tags: { t2: true } },
    })

    await store.dispatch('tags/books/remove', 't1')
    await vi.waitFor(() => expect(cacheFlags()).toBe(5))

    const updates = writes('update').toSorted(([a], [b]) => a.localeCompare(b))
    expect(updates).toEqual([
      ['books/b1/tags', { t1: null }],
      ['books/b2/tags', { t1: null }],
      ['books/b3/tags', { t1: null }],
    ])
    expect(writes('remove')).toEqual([['tags/books/t1']])
    expect(writes('set').map(([path]) => path)).toEqual([
      expect.stringMatching(/^logs\/e4dc55ad3df8-[0-9a-f]{7}$/),
    ])
    expect(writes('set')[0][1].message).toMatch(/\n\nRemoved from 3 books:\n/)
  })

  test('logs an error and writes nothing when there is no tag at the path', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    store.commit('tags/books/set', { t1: { id: 't1', tag: 'Joy' } })

    await store.dispatch('tags/books/remove', 'zzz')

    expect(error.mock.calls).toEqual([['No tag at "zzz"']])
    expect(fb.set).not.toHaveBeenCalled()
    expect(fb.update).not.toHaveBeenCalled()
    expect(fb.remove).not.toHaveBeenCalled()
  })
})

describe('tags/subscribe', () => {
  /** Returns the value callback registered on a path, once the lazy firebase import has run. */
  const listener = async path => {
    await vi.waitFor(() => expect(fb.on.mock.calls.map(([p]) => p)).toContain(path))
    const [, event, callback] = fb.on.mock.calls.find(([p]) => p === path)
    expect(event).toBe('value')
    return callback
  }

  /** Builds a fake v8 DataSnapshot. */
  const snapshot = value => ({ val: () => value })

  test('subscribes to all three tag collections', async () => {
    store.dispatch('tags/subscribe', {})

    await vi.waitFor(() => expect(fb.on).toHaveBeenCalledTimes(3))
    expect(fb.on.mock.calls.map(([path, event]) => [path, event]).toSorted()).toEqual([
      ['tags/books', 'value'],
      ['tags/bundles', 'value'],
      ['tags/people', 'value'],
    ])
  })

  test('a people tags value sets the collection and is passed raw to onValue', async () => {
    const onValue = vi.fn()
    const value = { p1: { id: 'p1', tag: 'Black', sortOrder: 2 } }
    store.dispatch('tags/subscribe', { people: { onValue } })

    const callback = await listener('tags/people')
    callback(snapshot(value))

    expect(store.state.tags.people.loaded).toBe(true)
    expect(store.state.tags.people.data).toEqual(value)
    expect(store.getters['tags/people/listSorted']().map(tag => tag.id)).toEqual(['p1'])
    expect(onValue.mock.calls).toEqual([[value]])
  })

  test('an empty tags value is stored as an empty object while onValue still gets null', async () => {
    const onValue = vi.fn()
    store.dispatch('tags/subscribe', { books: { onValue } })

    const callback = await listener('tags/books')
    callback(snapshot(null))

    expect(store.state.tags.books.loaded).toBe(true)
    expect(store.state.tags.books.data).toEqual({})
    expect(onValue.mock.calls).toEqual([[null]])
  })
})

describe('logs/listSorted', () => {
  test('lists log entries newest first by createdAt', () => {
    store.commit('logs/set', {
      a: { createdAt: '2026-01-02T00:00:00.000Z', message: 'middle' },
      b: { createdAt: '2025-12-31T23:59:59.000Z', message: 'oldest' },
      c: { createdAt: '2026-01-03T00:00:00.000Z', message: 'newest' },
    })

    expect(store.getters['logs/listSorted']().map(log => log.message)).toEqual([
      'newest',
      'middle',
      'oldest',
    ])
  })

  test('returns null, not an empty array, before the logs collection is loaded', () => {
    expect(store.getters['logs/listSorted']()).toBeNull()
  })
})
