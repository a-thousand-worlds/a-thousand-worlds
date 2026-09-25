/*
 * Characterization tests for the links and books store modules: share codes (links/create,
 * links/get, books/setFiltersFromShareCode) and book removal (books/remove). Dependency seams
 * guarded:
 *
 * - vuex: namespaced modules reaching each other through rootState, rootGetters and root dispatch,
 *   action return values and rejections, getters that return functions, and replaceState.
 * - vue: Vuex getters are Vue computeds, so books/isShared must recompute while a share code loads
 *   and again once it settles.
 * - uuid (through util/chronouid): the id of the error popup a malformed share raises.
 *
 * Firebase (pinned at v8) is the one boundary faked, at firebase/app, so the real src/firebase.js
 * and every store module's dynamic import of it still run.
 */
import store from '@/store'

const fb = vi.hoisted(() => {
  const state = { values: {}, log: [], held: [], holdOnce: false }

  /** Returns a fake v8 database reference over the in-memory values that logs each call in order. */
  const ref = path => ({
    once: (event, callback) => {
      state.log = [...state.log, ['once', path, event]]
      const deliver = () => callback({ val: () => state.values[path] ?? null })
      if (state.holdOnce) {
        state.held = [...state.held, deliver]
      } else {
        deliver()
      }
    },
    set: async value => {
      state.log = [...state.log, ['set', path, value]]
    },
    update: async value => {
      state.log = [...state.log, ['update', path, value]]
    },
    remove: async () => {
      state.log = [...state.log, ['remove', path]]
    },
    transaction: async (update, onComplete) => {
      const current = state.values[path] ?? null
      const next = update(current)
      state.log = [...state.log, ['transaction', path, current, next]]
      state.values[path] = next
      const snapshot = { toJSON: () => next }
      onComplete(null, true, snapshot)
      return { committed: true, snapshot }
    },
  })

  const firebase = {
    initializeApp: () => {},
    database: () => ({ ref }),
  }

  return { state, firebase }
})

vi.mock('firebase/app', () => ({ default: fb.firebase }))
vi.mock('firebase/auth', () => ({}))
vi.mock('firebase/database', () => ({}))
vi.mock('firebase/storage', () => ({}))

const NOW = '2026-01-02T03:04:05.000Z'

/** The code the first share ever made would get: 'atwxyz' read as a base-36 number. */
const MAX_COUNT = parseInt('atwxyz', 36)

const books = {
  b3: { id: 'b3', isbn: '9780000000003', title: 'Third' },
  b2: { id: 'b2', isbn: '9780000000002', title: 'Second' },
  b1: { id: 'b1', isbn: '9781250140913', title: 'My Mommy Medicine' },
}

const initialState = JSON.parse(JSON.stringify(store.state))

/** Lets pending promise chains and fire-and-forget dispatches run to completion. */
const flush = () => new Promise(resolve => setTimeout(resolve, 20))

/** Normalizes logged calls into a sorted list of distinct entries, so writes compare as a set. */
const asSet = entries =>
  [...new Set(entries.map(entry => JSON.stringify(entry)))].toSorted().map(json => JSON.parse(json))

/** Returns the distinct firebase calls made so far, as a set. */
const callSet = () => asSet(fb.state.log)

/** Returns the logged firebase calls that did not touch the given path. */
const callsExcept = path => fb.state.log.filter(entry => entry[1] !== path)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
  store.replaceState(JSON.parse(JSON.stringify(initialState)))
  fb.state.values = {}
  fb.state.log = []
  fb.state.held = []
  fb.state.holdOnce = false
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('links/create', () => {
  test('the first share code counts 500 down from atwxyz and is written to links/index', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    store.state.user.user = { uid: 'u1' }

    const code = await store.dispatch('links/create', { type: 'books', data: ['9781250140913'] })

    expect(code).toBe('atwxl3')
    expect(MAX_COUNT - parseInt(code, 36)).toBe(500)
    expect(fb.state.values['links/count']).toBe('atwxl3')
    expect(fb.state.log).toEqual([
      ['transaction', 'links/count', null, 'atwxl3'],
      [
        'update',
        'links/index',
        {
          atwxl3: {
            createdAt: NOW,
            createdBy: 'u1',
            type: 'books',
            data: ['9781250140913'],
          },
        },
      ],
    ])
  })

  test('the next share code counts down again from the stored count', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    fb.state.values['links/count'] = 'atwxl3'

    const code = await store.dispatch('links/create', { type: 'books', data: ['9780000000003'] })

    expect(code).toBe('atwx77')
    expect(MAX_COUNT - parseInt(code, 36)).toBe(1000)
    expect(fb.state.log[0]).toEqual(['transaction', 'links/count', 'atwxl3', 'atwx77'])
  })

  test('the random step is Math.random() * 1000, floored', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9999)

    const code = await store.dispatch('links/create', { type: 'books', data: [] })

    expect(code).toBe('atwx78')
    expect(MAX_COUNT - parseInt(code, 36)).toBe(999)
  })

  test('with no signed-in user, the share is recorded with createdBy null', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(store.state.user.user).toBe(null)

    await store.dispatch('links/create', { type: 'books', data: ['9781250140913'] })

    expect(fb.state.log[1]).toEqual([
      'update',
      'links/index',
      { atwxl3: { createdAt: NOW, createdBy: null, type: 'books', data: ['9781250140913'] } },
    ])
  })
})

describe('links/get', () => {
  test('reads the share record once from links/index/<code>', async () => {
    fb.state.values['links/index/abc'] = { type: 'books', data: ['9781250140913'] }

    const share = await store.getters['links/get']('abc')

    expect(share).toEqual({ type: 'books', data: ['9781250140913'] })
    expect(fb.state.log).toEqual([['once', 'links/index/abc', 'value']])
  })

  test('resolves null for a code that does not exist', async () => {
    await expect(store.getters['links/get']('nope')).resolves.toBe(null)
  })

  test('reads Firebase rather than the links collection held in state', async () => {
    store.commit('links/set', { index: { abc: { type: 'books', data: ['stale'] } } })
    fb.state.values['links/index/abc'] = { type: 'books', data: ['fresh'] }

    await expect(store.getters['links/get']('abc')).resolves.toEqual({
      type: 'books',
      data: ['fresh'],
    })
  })
})

describe('books/setFiltersFromShareCode', () => {
  beforeEach(() => {
    store.commit('books/set', JSON.parse(JSON.stringify(books)))
  })

  test('filters to the shared books in share order and drops isbns with no book', async () => {
    fb.state.values['links/index/abc'] = {
      type: 'books',
      data: ['9781250140913', '9780000000003', '0000000000000'],
    }
    expect(store.getters['books/isShared']).toBe(false)

    await store.dispatch('books/setFiltersFromShareCode', 'abc')

    expect(store.state.books.idFilters).toEqual(['b1', 'b3'])
    expect(store.state.books.loadingShareCode).toBe(false)
    expect(store.getters['books/isShared']).toBe(true)
    expect(fb.state.log).toEqual([['once', 'links/index/abc', 'value']])
  })

  test('books/isShared is true while the share loads and false once it matches nothing', async () => {
    fb.state.values['links/index/abc'] = { type: 'books', data: ['0000000000000'] }
    fb.state.holdOnce = true

    const pending = store.dispatch('books/setFiltersFromShareCode', 'abc')
    await vi.waitFor(() => expect(fb.state.held).toHaveLength(1))

    expect(store.state.books.loadingShareCode).toBe(true)
    expect(store.getters['books/isShared']).toBe(true)

    fb.state.held[0]()
    await pending

    expect(store.state.books.loadingShareCode).toBe(false)
    expect(store.getters['books/isShared']).toBe(false)
    expect(store.state.books.idFilters).toEqual([])
  })

  test('an unknown share code sets no filters', async () => {
    await store.dispatch('books/setFiltersFromShareCode', 'nope')

    expect(store.state.books.idFilters).toEqual([])
    expect(store.state.books.loadingShareCode).toBe(false)
    expect(store.getters['books/isShared']).toBe(false)
    expect(fb.state.log).toEqual([['once', 'links/index/nope', 'value']])
  })

  test('an empty code clears the id filters without reading Firebase', async () => {
    store.commit('books/setIdFilters', ['b1'])
    expect(store.getters['books/isShared']).toBe(true)

    await store.dispatch('books/setFiltersFromShareCode', '')

    expect(store.state.books.idFilters).toEqual([])
    expect(store.getters['books/isShared']).toBe(false)
    await flush()
    expect(fb.state.log).toEqual([])
  })

  test('a malformed share raises one error popup that stays open', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] })
    vi.setSystemTime(new Date(NOW))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    fb.state.values['links/index/abc'] = { type: 'books', data: 'not-an-array' }

    await store.dispatch('books/setFiltersFromShareCode', 'abc')

    expect(consoleError).toHaveBeenCalledTimes(1)
    const [error] = consoleError.mock.calls[0]
    expect(error).toBeInstanceOf(TypeError)

    const idPrefix = (253402304400000 - Date.parse(NOW)).toString(16)
    expect(store.state.ui.popups).toEqual([
      {
        id: expect.stringMatching(new RegExp(`^${idPrefix}-[0-9a-f]{7}$`)),
        text: error.message,
        type: 'danger',
      },
    ])

    vi.advanceTimersByTime(10000)
    expect(store.state.ui.popups).toHaveLength(1)
    expect(store.state.books.loadingShareCode).toBe(false)
    expect(store.state.books.idFilters).toEqual([])
  })
})

describe('books/remove', () => {
  const submission = { id: 's1', bookId: 'b1', createdBy: 'u9' }

  beforeEach(() => {
    store.state.user.user = { uid: 'admin1' }
  })

  test('marks the submission and the submitter profile deleted, then removes the book', async () => {
    store.commit('submissions/books/set', { s1: { ...submission } })
    store.commit('users/set', { u9: { profile: { submissions: { s1: 'approved' } } } })

    await store.dispatch('books/remove', 'b1')

    const expected = asSet([
      ['update', 'submits/books/s1', { status: 'deleted', updatedAt: NOW, updatedBy: 'admin1' }],
      ['update', 'users/u9/profile/submissions', { s1: 'deleted' }],
      ['remove', 'books/b1'],
      ['set', 'cache/clean', false],
    ])
    await vi.waitFor(() => expect(callSet()).toEqual(expected))
    await flush()
    expect(callSet()).toEqual(expected)
  })

  test('with no submission for the book, only the book is removed', async () => {
    store.commit('submissions/books/set', { s1: { ...submission, bookId: 'other' } })
    store.commit('users/set', { u9: { profile: { submissions: { s1: 'approved' } } } })

    await store.dispatch('books/remove', 'b1')
    await flush()

    expect(callsExcept('cache/clean')).toEqual([['remove', 'books/b1']])
  })

  test('a submitter with no profile submissions gets no users update', async () => {
    store.commit('submissions/books/set', { s1: { ...submission } })
    store.commit('users/set', { u9: { profile: { name: 'Nine' } } })

    await store.dispatch('books/remove', 'b1')

    const expected = asSet([
      ['update', 'submits/books/s1', { status: 'deleted', updatedAt: NOW, updatedBy: 'admin1' }],
      ['remove', 'books/b1'],
      ['set', 'cache/clean', false],
    ])
    await vi.waitFor(() => expect(callSet()).toEqual(expected))
    await flush()
    expect(callSet()).toEqual(expected)
  })

  test('rejects without a book id and writes nothing', async () => {
    await expect(store.dispatch('books/remove')).rejects.toThrow('bookId required')
    await flush()
    expect(fb.state.log).toEqual([])
  })
})
