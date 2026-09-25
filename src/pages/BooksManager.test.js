/**
 * BooksManager page characterization tests. Seams guarded:
 * - vue-router 4: data() reads sort, dir and search from $route.query, and the debounced watchers
 * call router.replace({ ...this.$route, query }) on the real router singleton from src/router.js,
 * spreading the whole route object; query encoding (':' kept, ' ' as '+', non-ASCII
 * percent-encoded), an undefined value dropping its key, the history URL, and the edit links'
 * named-route pushes.
 * - @sindresorhus/slugify: the title and person slugs in those edit-link pushes.
 * - lodash 4.17: sortBy with the titleLower tie-break, reverse for descending, and the trailing
 * 200ms debounce on the URL sync, restarted by each change.
 * - dayjs: createdAt parsed into the sort keys of the default Submitted sort, and formatted as
 * 'M/D/YYYY hh:mm' for the Submitted cell and the submitted: search.
 * - diacritics: accent-insensitive search on both the term and the book's fields.
 * - json2csv (plainjs) 7: the exact CSV text (header, quoting, numbers, empty cells, doubled
 * quotes, nested objects, zero rows).
 * - vue 3.5: v-model plus an explicit update:model-value listener on SimpleInput (listener order
 * decides whether an edit is dispatched), the global $uiBusy mixin, the deferred edit mode.
 */
import { render, fireEvent, within } from '@testing-library/vue'
import router from '@/router'
import store from '@/store'
import mixins from '@/mixins/global'
import directives from '@/directives'
import download from '@/util/download'
import BooksManager from '@/pages/BooksManager.vue'

// jsdom has no URL.createObjectURL, so the browser download is the boundary
vi.mock('@/util/download', () => ({ default: vi.fn() }))

// nothing on this page should reach Firebase; fail loudly if something tries
vi.mock('@/firebase', () => ({
  default: {
    database: () => {
      throw new Error('BooksManager tests must not reach Firebase')
    },
  },
}))

const NOW = '2024-05-01T12:00:00.000Z'

const CSV_HEADER =
  '"isbn","title","authors","illustrators","tags","year","goodreads","publisher","summary","createdAt","createdBy","id","submissionId","cover","thumbnail","reviewedAt","reviewedBy","updatedAt","updatedBy","status"'

const people = {
  p1: { id: 'p1', name: 'Raúl the Third' },
  p2: { id: 'p2', name: 'Kadir Nelson' },
  p3: { id: 'p3', name: 'Matthew A. Cherry' },
  p4: { id: 'p4', name: 'Vashti Harrison' },
}

const tags = {
  t1: { id: 't1', tag: 'Picture book', sortOrder: 1 },
  t2: { id: 't2', tag: 'LGBTQIA+', sortOrder: 2 },
}

const users = {
  u1: { profile: { name: 'Ana Contributor' } },
}

/**
 * Returns fresh copies of the seeded books, in insertion order b1, b2, b3. The ISBNs sort b1, b3,
 * b2, unlike the titles (b2, b1, b3), so an ISBN sort cannot pass on the titleLower tie-break.
 */
const makeBooks = () => ({
  b1: {
    id: 'b1',
    isbn: '9781328780966',
    title: 'The Undefeated',
    creators: { p2: 'illustrator' },
    tags: { t1: true },
    createdAt: '2020-11-27T12:00:00Z',
    year: 2019,
    createdBy: 'u1',
    summary: 'Say "hi", ok',
  },
  b2: {
    id: 'b2',
    isbn: '9781646140046',
    title: 'Hair Love',
    creators: { p3: 'author', p4: 'illustrator' },
    tags: { t1: true, t2: true },
    createdAt: '2021-03-01T12:00:00Z',
    year: 2019,
    cover: { url: 'https://example.com/hair-love.jpg' },
  },
  b3: {
    id: 'b3',
    isbn: '9781452171913',
    title: 'àlma',
    creators: { p1: 'author-illustrator' },
    tags: {},
    createdAt: '2019-01-01T12:00:00Z',
    year: '',
  },
})

/** Navigates the real router singleton to a url, then renders BooksManager directly. */
const renderAt = async url => {
  await router.push(url)
  return render(BooksManager, {
    global: {
      plugins: [store, router],
      mixins: [mixins],
      directives: { ...directives, tippy: () => {} },
    },
  })
}

/** Runs past the 200ms debounce on the URL sync and lets the router's replace settle. */
const flushDebounce = () => vi.advanceTimersByTimeAsync(250)

/** Gets the ids of the rendered book rows in document order. */
const rowIds = utils =>
  utils
    .queryAllByRole('row')
    .map(tr => tr.dataset.bookId)
    .filter(id => id)

/** Scopes queries to one book's row. */
const withinRow = (utils, id) =>
  within(utils.getAllByRole('row').find(tr => tr.dataset.bookId === id))

/** Gets the "N books" count, whose own text leaves out the nested "(filtered)" marker. */
const bookCount = utils => utils.getByText(/^\d+ books?$/)

/** Gets the router singleton's current full path. */
const currentUrl = () => router.currentRoute.value.fullPath

/** Clicks the download icon and returns the [csv, filename] passed to the download util. */
const exportCsv = async () => {
  // eslint-disable-next-line testing-library/no-node-access -- a bare icon, with no text, role or label to query by
  await fireEvent.click(document.querySelector('.fa-download'))
  expect(download).toHaveBeenCalledTimes(1)
  return download.mock.calls[0]
}

let dispatch = null

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  // jsdom does not implement scrolling, which the router's scrollBehavior asks for on navigation
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  store.commit('people/set', people)
  store.commit('tags/books/set', tags)
  store.commit('users/set', users)
  store.commit('books/set', makeBooks())
  // resolve store writes without calling through to Firebase
  dispatch = vi.spyOn(store, 'dispatch').mockResolvedValue(undefined)
})

afterEach(async () => {
  // the debounced watchers are shared by every instance, so a pending call must not leak
  await vi.advanceTimersByTimeAsync(1000)
  vi.useRealTimers()
  vi.restoreAllMocks()
  download.mockReset()
  store.commit('books/reset')
  store.commit('people/reset')
  store.commit('tags/books/reset')
  store.commit('users/reset')
  store.commit('ui/setBusy', false)
})

describe('sorting', () => {
  test('defaults to the newest submission first without touching the URL', async () => {
    const utils = await renderAt('/admin/books')
    expect(rowIds(utils)).toEqual(['b2', 'b1', 'b3'])
    expect(bookCount(utils)).toHaveTextContent(/^3 books$/)
    await flushDebounce()
    expect(currentUrl()).toBe('/admin/books')
  })

  test.each([
    ['ISBN', ['b1', 'b3', 'b2'], '/admin/books?sort=isbn&dir=asc'],
    // 'àlma' sorts after every ASCII title; title asc matches the default order, so only the URL
    // is new here, and the double-click test below tells the two apart
    ['Title', ['b2', 'b1', 'b3'], '/admin/books?sort=titleLower&dir=asc'],
    // a tag list sorts before a longer one it prefixes; a book with no tags sorts last
    ['Tags', ['b1', 'b2', 'b3'], '/admin/books?sort=tags&dir=asc'],
    // author-illustrator counts as an author; a book with no author sorts last
    ['Author(s)', ['b2', 'b3', 'b1'], '/admin/books?sort=authors&dir=asc'],
    // defaults to desc; the empty year still sorts last, and the tied 2019s fall back to title
    ['Published', ['b1', 'b2', 'b3'], '/admin/books?sort=year&dir=desc'],
    // already the active sort (desc), so the click flips it to asc
    ['Submitted', ['b3', 'b1', 'b2'], '/admin/books?sort=submitted&dir=asc'],
  ])('clicking %s reorders the rows and syncs the URL', async (heading, ids, url) => {
    const utils = await renderAt('/admin/books')
    await fireEvent.click(utils.getByText(heading))
    expect(rowIds(utils)).toEqual(ids)
    await flushDebounce()
    expect(currentUrl()).toBe(url)
    expect(router.currentRoute.value.name).toBe('BooksManager')
  })

  test('clicking the same heading again reverses the direction', async () => {
    const utils = await renderAt('/admin/books')
    await fireEvent.click(utils.getByText('Title'))
    await flushDebounce()
    expect(rowIds(utils)).toEqual(['b2', 'b1', 'b3'])
    expect(currentUrl()).toBe('/admin/books?sort=titleLower&dir=asc')

    await fireEvent.click(utils.getByText('Title'))
    await flushDebounce()
    expect(rowIds(utils)).toEqual(['b3', 'b1', 'b2'])
    expect(currentUrl()).toBe('/admin/books?sort=titleLower&dir=desc')
  })

  test('the URL sync waits 200ms after the last change, then replaces once with the final sort', async () => {
    const replace = vi.spyOn(router, 'replace')
    const utils = await renderAt('/admin/books')
    await fireEvent.click(utils.getByText('Title'))
    await vi.advanceTimersByTimeAsync(150)
    await fireEvent.click(utils.getByText('Title'))
    // the rows follow each click at once
    expect(rowIds(utils)).toEqual(['b3', 'b1', 'b2'])

    // 200ms after the first click, where a throttle would fire: the second click restarted the wait
    await vi.advanceTimersByTimeAsync(50)
    expect(replace).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(149)
    expect(replace).not.toHaveBeenCalled()
    expect(currentUrl()).toBe('/admin/books')

    // 200ms after the second click
    await vi.advanceTimersByTimeAsync(1)
    expect(replace).toHaveBeenCalledTimes(1)
    // the whole current route is spread into the location, with the query overridden
    expect(replace.mock.calls[0][0]).toMatchObject({
      name: 'BooksManager',
      path: '/admin/books',
      fullPath: '/admin/books',
      query: { sort: 'titleLower', dir: 'desc' },
    })
    await flushDebounce()
    expect(currentUrl()).toBe('/admin/books?sort=titleLower&dir=desc')
  })

  test('illustrator sort orders by illustrator name, not title, in both directions', async () => {
    const utils = await renderAt('/admin/books')
    // limit to the two books with a plain illustrator
    await fireEvent.update(utils.getByPlaceholderText('Search'), 'tag:picture')
    await fireEvent.click(utils.getByText('Illustrator(s)'))
    expect(rowIds(utils)).toEqual(['b1', 'b2'])
    await fireEvent.click(utils.getByText('Illustrator(s)'))
    expect(rowIds(utils)).toEqual(['b2', 'b1'])
    await flushDebounce()
    expect(currentUrl()).toBe('/admin/books?search=tag:picture&sort=illustrators&dir=desc')
  })
})

describe('initial state from the URL', () => {
  test('sort, dir and search are read from the query before the first render', async () => {
    // every book matches 'e' (b3 through its author), and title desc is neither the default order
    // nor title asc, so ignoring either param would change the rows
    const utils = await renderAt('/admin/books?sort=titleLower&dir=desc&search=e')
    expect(rowIds(utils)).toEqual(['b3', 'b1', 'b2'])
    expect(utils.getByPlaceholderText('Search')).toHaveValue('e')
    expect(bookCount(utils)).toHaveTextContent(/^3 books \(filtered\)$/)

    // mounting does not rewrite the URL
    await flushDebounce()
    expect(currentUrl()).toBe('/admin/books?sort=titleLower&dir=desc&search=e')
  })

  test.each([
    // a sort without a dir defaults to asc for every field but submitted
    ['/admin/books?sort=authors', ['b2', 'b3', 'b1']],
    ['/admin/books?sort=year&dir=desc', ['b1', 'b2', 'b3']],
    ['/admin/books?dir=asc', ['b3', 'b1', 'b2']],
    // a sanity check only: naming the default sort renders the same rows as no params at all
    ['/admin/books?sort=submitted', ['b2', 'b1', 'b3']],
  ])('%s renders rows %j', async (url, ids) => {
    const utils = await renderAt(url)
    expect(rowIds(utils)).toEqual(ids)
  })
})

describe('search', () => {
  test.each([
    ['raul', ['b3'], '/admin/books?search=raul'],
    // diacritics are removed from the book's fields and from the search term
    ['ALMA', ['b3'], '/admin/books?search=ALMA'],
    ['raúl the', ['b3'], '/admin/books?search=ra%C3%BAl+the'],
    ['tag:lgbt', ['b2'], '/admin/books?search=tag:lgbt'],
    ['illustrator:Harr', ['b2'], '/admin/books?search=illustrator:Harr'],
    ['contributor:ana', ['b1'], '/admin/books?search=contributor:ana'],
    ['isbn:97816', ['b2'], '/admin/books?search=isbn:97816'],
    // every createdAt is noon UTC, which keeps its year from UTC-12 to UTC+14
    ['submitted:2020', ['b1'], '/admin/books?search=submitted:2020'],
    // the field name is trimmed and lowercased, the value trimmed
    ['Title: undefeated', ['b1'], '/admin/books?search=Title:+undefeated'],
  ])('searching %j shows %j and syncs the URL', async (term, ids, url) => {
    const utils = await renderAt('/admin/books')
    await fireEvent.update(utils.getByPlaceholderText('Search'), term)
    expect(rowIds(utils)).toEqual(ids)
    expect(bookCount(utils)).toHaveTextContent(/^1 book \(filtered\)$/)
    await flushDebounce()
    expect(currentUrl()).toBe(url)
    expect(router.currentRoute.value.query).toEqual({ search: term })
  })

  test('an unknown field matches nothing', async () => {
    const utils = await renderAt('/admin/books')
    await fireEvent.update(utils.getByPlaceholderText('Search'), 'publisher:love')
    expect(rowIds(utils)).toEqual([])
    expect(utils.getByRole('heading', { level: 2 })).toHaveTextContent(/^No matching books$/)
    expect(bookCount(utils)).toHaveTextContent(/^0 books \(filtered\)$/)
  })

  test('the matched part of a name is highlighted, accents and all', async () => {
    const utils = await renderAt('/admin/books')
    await fireEvent.update(utils.getByPlaceholderText('Search'), 'raul')
    expect(withinRow(utils, 'b3').getByText('Raúl')).toHaveClass('bg-primary')
  })

  test('no match shows the empty state, and Reset Search restores every row', async () => {
    const utils = await renderAt('/admin/books')
    await fireEvent.update(utils.getByPlaceholderText('Search'), 'zzz')
    await flushDebounce()
    expect(utils.queryByRole('table')).not.toBeInTheDocument()
    expect(utils.getByRole('heading', { level: 2 })).toHaveTextContent(/^No matching books$/)
    expect(bookCount(utils)).toHaveTextContent(/^0 books \(filtered\)$/)
    expect(currentUrl()).toBe('/admin/books?search=zzz')

    await fireEvent.click(utils.getByText('Reset Search'))
    expect(rowIds(utils)).toEqual(['b2', 'b1', 'b3'])
    expect(utils.getByPlaceholderText('Search')).toHaveValue('')
    await flushDebounce()
    expect(currentUrl()).toBe('/admin/books')
  })

  test('search keeps the sort params, and clearing it drops only the search param', async () => {
    const utils = await renderAt('/admin/books')
    await fireEvent.click(utils.getByText('Title'))
    await flushDebounce()
    await fireEvent.update(utils.getByPlaceholderText('Search'), 'raul')
    await flushDebounce()
    expect(currentUrl()).toBe('/admin/books?sort=titleLower&dir=asc&search=raul')

    await fireEvent.update(utils.getByPlaceholderText('Search'), '')
    await flushDebounce()
    expect(currentUrl()).toBe('/admin/books?sort=titleLower&dir=asc')
    // the replace goes through to the browser history
    expect(window.location.pathname + window.location.search).toBe(
      '/admin/books?sort=titleLower&dir=asc',
    )
  })
})

describe('Submitted column', () => {
  test('shows createdAt in local time as unpadded M/D/YYYY and a 12-hour hh:mm', async () => {
    const utils = await renderAt('/admin/books')
    // noon UTC falls on the same day or the next from UTC-12 to UTC+14, so only the shape is fixed
    const time = '(0[1-9]|1[0-2]):[0-5]\\d'
    expect(withinRow(utils, 'b3').getByText(new RegExp(`^1/[12]/2019 ${time}$`))).toHaveStyle({
      opacity: '0.5',
    })
    expect(withinRow(utils, 'b1').getByText(new RegExp(`^11/2[78]/2020 ${time}$`))).toHaveStyle({
      opacity: '0.5',
    })
  })
})

describe('CSV export', () => {
  test('exports the sorted books with readable authors, illustrators and tags', async () => {
    const utils = await renderAt('/admin/books')
    await fireEvent.click(utils.getByText('Published'))
    const [csv, filename] = await exportCsv()
    const lines = csv.split('\n')

    expect(filename).toBe(`ATW books (3) - ${NOW}.csv`)
    expect(lines).toHaveLength(4)
    expect(lines[0]).toBe(CSV_HEADER)
    // rows follow the current sort (year desc); numbers unquoted, missing fields empty, quotes doubled
    expect(lines[1]).toBe(
      '"9781328780966","The Undefeated","","Kadir Nelson","Picture book",2019,,,"Say ""hi"", ok","2020-11-27T12:00:00Z","u1","b1",,,,,,,,',
    )
    // tags joined with ', ', and a nested object is written as quoted JSON
    expect(lines[2]).toBe(
      '"9781646140046","Hair Love","Matthew A. Cherry","Vashti Harrison","Picture book, LGBTQIA+",2019,,,,"2021-03-01T12:00:00Z",,"b2",,"{""url"":""https://example.com/hair-love.jpg""}",,,,,,',
    )
    expect(lines[3]).toMatch(/^"9781452171913","àlma","Raúl the Third",/)
  })

  test('exports only the filtered books, down to a header-only file', async () => {
    const utils = await renderAt('/admin/books')
    await fireEvent.update(utils.getByPlaceholderText('Search'), 'zzz')
    const [csv, filename] = await exportCsv()
    expect(csv).toBe(CSV_HEADER)
    expect(filename).toBe(`ATW books (0) - ${NOW}.csv`)
  })

  test('a failed download is reported through ui/handleError', async () => {
    const error = new Error('download blocked')
    download.mockImplementation(() => {
      throw error
    })
    await renderAt('/admin/books')
    await exportCsv()
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith('ui/handleError', error)
  })
})

describe('edit mode', () => {
  /** Enters edit mode and waits out the deferred toggle. */
  const enterEditMode = async utils => {
    await fireEvent.click(utils.getByText('EDIT'))
    await vi.advanceTimersByTimeAsync(0)
  }

  /** Opens the title input in one book's row and returns it. */
  const openTitleInput = async (utils, id) => {
    const bookRow = withinRow(utils, id)
    await fireEvent.click(bookRow.getByTitle('Enter Title'))
    // SimpleInput focuses its input on the next tick
    await vi.advanceTimersByTimeAsync(0)
    return bookRow.getByRole('textbox')
  }

  test('EDIT switches to DONE and renders the inline inputs one tick later', async () => {
    const utils = await renderAt('/admin/books')
    await fireEvent.click(utils.getByText('EDIT'))
    expect(utils.queryByText('DONE')).not.toBeInTheDocument()
    expect(utils.queryAllByTitle('Enter Title')).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(0)
    expect(utils.getByText('DONE')).toBeInTheDocument()
    expect(utils.queryAllByTitle('Enter Title')).toHaveLength(3)

    await fireEvent.click(utils.getByText('DONE'))
    await vi.advanceTimersByTimeAsync(0)
    expect(utils.getByText('EDIT')).toBeInTheDocument()
    expect(utils.queryAllByTitle('Enter Title')).toHaveLength(0)
  })

  test('changing a title and blurring dispatches books/update with the new title', async () => {
    const utils = await renderAt('/admin/books')
    await enterEditMode(utils)
    const input = await openTitleInput(utils, 'b2')
    expect(input).toHaveValue('Hair Love')
    expect(input).toHaveFocus()

    await fireEvent.update(input, 'Hair Love!')
    await fireEvent.blur(input)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith('books/update', {
      path: 'b2/',
      value: { title: 'Hair Love!' },
    })
  })

  test('blurring an unchanged title dispatches nothing', async () => {
    const utils = await renderAt('/admin/books')
    await enterEditMode(utils)
    await fireEvent.blur(await openTitleInput(utils, 'b2'))
    expect(dispatch).not.toHaveBeenCalled()
  })
})

describe('delete', () => {
  test('marks the UI busy while books/remove is pending, then clears it', async () => {
    let resolveRemove = null
    dispatch.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveRemove = resolve
        }),
    )
    const utils = await renderAt('/admin/books')
    await fireEvent.click(withinRow(utils, 'b1').getByRole('button'))

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith('books/remove', 'b1')
    expect(store.state.ui.busy).toBe(true)
    const buttons = utils.getAllByRole('button')
    expect(buttons).toHaveLength(3)
    buttons.forEach(button => expect(button).toBeDisabled())

    resolveRemove()
    await vi.advanceTimersByTimeAsync(0)
    expect(store.state.ui.busy).toBe(false)
    buttons.forEach(button => expect(button).toBeEnabled())
  })
})

describe('links', () => {
  test('title and author links push to the slugged edit routes', async () => {
    const utils = await renderAt('/admin/books')
    // registered after the render's own push, so it sees only the links' navigations, and cancels
    // each one before the lazy edit page is loaded
    const guard = vi.fn(to => to.name === 'BooksManager')
    const removeGuard = router.beforeEach(guard)
    try {
      const alma = withinRow(utils, 'b3')
      await fireEvent.click(alma.getByText('àlma'))
      await fireEvent.click(alma.getByText('Raúl the Third'))
      await vi.advanceTimersByTimeAsync(0)
      expect(guard.mock.calls.map(([to]) => to.fullPath)).toEqual([
        '/book/alma-9781452171913/edit',
        '/person/raul-the-third/edit',
      ])
      expect(currentUrl()).toBe('/admin/books')
    } finally {
      removeGuard()
    }
  })
})
