/*
 * Characterization tests for the filterable store module and the books, people and bundles modules
 * built on it. Dependency seams guarded:
 *
 * - @sindresorhus/slugify: tag names become the slugs written to, and matched from, `?filters=`.
 * - vue-router: `router.resolve()` serializes the pushed location; ',' and '/' in a query value
 *   stay unencoded today. updateUrl reads `router.currentRoute.name` to choose replace over push;
 *   currentRoute is a shallowRef, so that read is undefined and every update pushes.
 * - jsdom: `window.history.replaceState`, `window.location.search` and `URLSearchParams` decoding
 *   feed setFiltersFromUrl.
 * - vue: Vuex getters are Vue computeds, so they must recompute after a mutation, and a getter that
 *   returns state unchanged must hand back the same reactive proxy.
 */
import store from '@/store'
import router from '@/router'
import specialFilters from '@/store/constants/special-filters'
import creatorTitles from '@/store/constants/creatorTitles'

// Firebase is a boundary: nothing here should reach it, but a fake keeps any stray call offline.
vi.mock('@/firebase', () => {
  const ref = () => ({
    on: () => {},
    once: () => {},
    set: async () => {},
    update: async () => {},
    remove: async () => {},
  })
  return { default: { database: () => ({ ref }) } }
})

const bookTags = {
  t1: { id: 't1', tag: 'Picture book', sortOrder: 2 },
  t2: { id: 't2', tag: 'LGBTQIA+', sortOrder: 13 },
  t3: { id: 't3', tag: 'Fantasy/Fable', sortOrder: 10 },
  t4: { id: 't4', tag: 'Non-fiction', sortOrder: 20 },
}

const peopleTags = {
  p1: { id: 'p1', tag: 'Indigenous', weight: 10, sortOrder: 1 },
  p2: { id: 'p2', tag: 'Arab/Middle Eastern/North African', sortOrder: 2 },
  g: { id: 'g', tag: 'Gender', sortOrder: 3 },
  g1: { id: 'g1', tag: 'Trans ', parent: 'g', sortOrder: 4 },
  g2: { id: 'g2', tag: 'Agender', parent: 'g', sortOrder: 5 },
}

const books = {
  b1: { id: 'b1', isbn: '9781250140913', title: 'My Mommy Medicine', tags: { t1: true } },
  b2: { id: 'b2', isbn: '9780000000002', title: 'Second', tags: { t1: true, t2: true } },
  b3: { id: 'b3', isbn: '9780000000003', title: 'Third', tags: { t2: true } },
}

const initialState = JSON.parse(JSON.stringify(store.state))

/**
 * Records every location handed to router.push or router.replace, in call order. It is
 * method-agnostic on purpose: the router.push and router.replace spies themselves pin which method
 * runs, so a switch between them fails only the tests that check the method.
 */
const navigate = vi.fn()

/** The route the router holds before each test, restored after tests that overwrite it. */
let startRoute

/** Returns the location passed to the most recent router.push/replace. */
const lastLocation = () => navigate.mock.lastCall[0]

/** Asserts that the latest navigation pushed `location` and that nothing called router.replace. */
const expectPushed = location => {
  expect(router.push).toHaveBeenLastCalledWith(location)
  expect(router.replace).not.toHaveBeenCalled()
}

/** Serializes the most recent location through the real router, as the address bar would show it. */
const lastFullPath = () => router.resolve(lastLocation()).fullPath

/** Returns the ids of a module's active tag filters, in order. */
const filterIds = type => store.state[type].filters.map(filter => filter.id)

/** Sets the jsdom URL that setFiltersFromUrl reads. */
const setUrl = url => window.history.replaceState(null, '', url)

beforeEach(() => {
  store.replaceState(JSON.parse(JSON.stringify(initialState)))
  store.commit('tags/books/set', JSON.parse(JSON.stringify(bookTags)))
  store.commit('tags/people/set', JSON.parse(JSON.stringify(peopleTags)))
  setUrl('/')
  navigate.mockReset()
  startRoute = router.currentRoute.value
  vi.spyOn(router, 'push').mockImplementation(async location => navigate(location))
  vi.spyOn(router, 'replace').mockImplementation(async location => navigate(location))
})

afterEach(() => {
  vi.restoreAllMocks()
  router.currentRoute.value = startRoute
  setUrl('/')
})

describe('special filters', () => {
  test('people special filters are the creator titles, with the title text as the tag', () => {
    expect(creatorTitles).toEqual([
      { id: 'author', text: 'Author' },
      { id: 'illustrator', text: 'Illustrator' },
      { id: 'author-illustrator', text: 'Author/Illustrator' },
    ])
    expect(specialFilters).toEqual({
      books: [],
      bundles: [],
      people: [
        { id: 'author', tag: 'Author' },
        { id: 'illustrator', tag: 'Illustrator' },
        { id: 'author-illustrator', tag: 'Author/Illustrator' },
      ],
    })
  })
})

describe('books toggleFilter and updateUrl', () => {
  test('toggling a tag pushes a Home location with the slugified tag as the filters query', async () => {
    await store.dispatch('books/toggleFilter', bookTags.t1)
    expect(navigate).toHaveBeenCalledTimes(1)
    expectPushed({ name: 'Home', query: { filters: 'picture-book' } })
    expect(lastFullPath()).toBe('/?filters=picture-book')
  })

  test('toggling while the current route is already Home still pushes rather than replaces', async () => {
    // updateUrl replaces only when `router.currentRoute.name === 'Home'`, but currentRoute is a
    // shallowRef, so `.name` is undefined even on Home and the replace branch never runs. This pins
    // both halves: the Ref shape vue-router hands back, and the push it leads to.
    router.currentRoute.value = router.resolve({ name: 'Home' })
    expect(router.currentRoute.value.name).toBe('Home')
    expect(router.currentRoute.name).toBeUndefined()

    await store.dispatch('books/toggleFilter', bookTags.t1)
    expect(router.push).toHaveBeenCalledTimes(1)
    expectPushed({ name: 'Home', query: { filters: 'picture-book' } })
  })

  test('each toggle appends a slug, and commas and slashes stay unencoded in the url', async () => {
    await store.dispatch('books/toggleFilter', bookTags.t1)
    await store.dispatch('books/toggleFilter', bookTags.t2)
    expect(lastFullPath()).toBe('/?filters=picture-book,lgbtqia')

    await store.dispatch('books/toggleFilter', bookTags.t3)
    expect(lastLocation()).toEqual({
      name: 'Home',
      query: { filters: 'picture-book,lgbtqia,fantasy-fable' },
    })
    expect(lastFullPath()).toBe('/?filters=picture-book,lgbtqia,fantasy-fable')
    expect(filterIds('books')).toEqual(['t1', 't2', 't3'])
    expect(navigate).toHaveBeenCalledTimes(3)
  })

  test('toggling an active tag again removes it and keeps the others in order', async () => {
    await store.dispatch('books/toggleFilter', bookTags.t1)
    await store.dispatch('books/toggleFilter', bookTags.t2)
    await store.dispatch('books/toggleFilter', bookTags.t3)
    await store.dispatch('books/toggleFilter', { ...bookTags.t2 })
    expect(filterIds('books')).toEqual(['t1', 't3'])
    expect(lastFullPath()).toBe('/?filters=picture-book,fantasy-fable')
  })

  test('a filter with a submenu appends the slugified submenu text after a slash', async () => {
    await store.dispatch('books/toggleFilter', {
      ...bookTags.t3,
      submenu: { id: 's1', text: 'Fairy Tales' },
    })
    expect(lastLocation()).toEqual({
      name: 'Home',
      query: { filters: 'fantasy-fable/fairy-tales' },
    })
    expect(lastFullPath()).toBe('/?filters=fantasy-fable/fairy-tales')
  })

  test('setFilters replaces the filters and writes them to the url in the given order', async () => {
    await store.dispatch('books/setFilters', [bookTags.t4, bookTags.t2])
    expect(filterIds('books')).toEqual(['t4', 't2'])
    expect(lastFullPath()).toBe('/?filters=non-fiction,lgbtqia')
  })

  test('resetFilters clears tag and id filters and pushes Home with an empty query', async () => {
    await store.dispatch('books/toggleFilter', bookTags.t1)
    store.commit('books/setIdFilters', ['b1'])
    await store.dispatch('books/resetFilters')
    expect(store.state.books.filters).toEqual([])
    expect(store.state.books.idFilters).toEqual([])
    expect(router.push).toHaveBeenCalledTimes(2)
    expectPushed({ name: 'Home', query: {} })
    expect(router.resolve(lastLocation()).query).toEqual({})
    expect(lastFullPath()).toBe('/')
  })
})

describe('people toggleFilter and updateUrl', () => {
  test('tags, subtags and special filters build the People filters query', async () => {
    await store.dispatch('people/toggleFilter', peopleTags.p2)
    expectPushed({
      name: 'People',
      query: { filters: 'arab-middle-eastern-north-african' },
    })
    expect(lastFullPath()).toBe('/people?filters=arab-middle-eastern-north-african')

    // the trailing space in 'Trans ' is dropped by slugify
    await store.dispatch('people/toggleFilter', peopleTags.g1)
    expect(lastFullPath()).toBe('/people?filters=arab-middle-eastern-north-african,trans')

    // a sibling subtag replaces the active subtag with the same parent
    await store.dispatch('people/toggleFilter', peopleTags.g2)
    expect(lastFullPath()).toBe('/people?filters=arab-middle-eastern-north-african,agender')

    await store.dispatch('people/toggleFilter', { id: 'author', tag: 'Author' })
    expect(lastFullPath()).toBe('/people?filters=arab-middle-eastern-north-african,agender,author')
    expect(filterIds('people')).toEqual(['p2', 'g2', 'author'])
  })

  test('a top-level toggle keeps active subtags, since only same-parent filters are removed', async () => {
    await store.dispatch('people/toggleFilter', peopleTags.g1)
    await store.dispatch('people/toggleFilter', peopleTags.p1)
    expect(filterIds('people')).toEqual(['g1', 'p1'])

    await store.dispatch('people/toggleFilter', peopleTags.g2)
    expect(filterIds('people')).toEqual(['p1', 'g2'])
    expect(lastFullPath()).toBe('/people?filters=indigenous,agender')
  })

  test('resetFilters pushes People with an empty query', async () => {
    await store.dispatch('people/toggleFilter', peopleTags.p1)
    await store.dispatch('people/resetFilters')
    expect(store.state.people.filters).toEqual([])
    expect(store.state.people.idFilters).toEqual([])
    expect(router.push).toHaveBeenCalledTimes(2)
    expectPushed({ name: 'People', query: {} })
    expect(lastFullPath()).toBe('/people')
  })
})

describe('bundles toggleFilter and updateUrl', () => {
  test('toggling a bundle tag pushes its slug, with & spelled out and accents dropped', async () => {
    // The route name is left unasserted on purpose: updateUrl maps every module other than books to
    // 'People', which sends a filter click on the Bundles page to /people (a suspected bug).
    await store.dispatch('bundles/toggleFilter', { id: 'bt1', tag: 'Español & Bilingual' })
    expect(filterIds('bundles')).toEqual(['bt1'])
    expect(router.push).toHaveBeenCalledTimes(1)
    expect(router.replace).not.toHaveBeenCalled()
    expect(lastLocation().query).toEqual({ filters: 'espanol-and-bilingual' })
  })
})

describe('setFiltersFromUrl', () => {
  test('books filters become the matching tag objects in url order, dropping unknown slugs', async () => {
    setUrl('/?filters=picture-book,lgbtqia,not-a-tag')
    await store.dispatch('books/setFiltersFromUrl')
    expect(store.state.books.filters).toEqual([bookTags.t1, bookTags.t2])
    expect(store.state.books.idFilters).toEqual([])
    expect(navigate).not.toHaveBeenCalled()
  })

  test('a percent-encoded comma is decoded before splitting', async () => {
    setUrl('/?filters=lgbtqia%2Cpicture-book')
    await store.dispatch('books/setFiltersFromUrl')
    expect(filterIds('books')).toEqual(['t2', 't1'])
  })

  test('only the segment before a slash is matched against tag slugs', async () => {
    setUrl('/?filters=picture-book/extra')
    await store.dispatch('books/setFiltersFromUrl')
    expect(filterIds('books')).toEqual(['t1'])
  })

  test('ids sets the id filters verbatim', async () => {
    setUrl('/?ids=b1,b3')
    await store.dispatch('books/setFiltersFromUrl')
    expect(store.state.books.idFilters).toEqual(['b1', 'b3'])
    expect(store.state.books.filters).toEqual([])
  })

  test('a url with no filters or ids leaves the active filters in place', async () => {
    // The reset branch is guarded by `!urlFilters.length === 0 && ...`, which is always false, so
    // commit('resetFilters') cannot run and nothing is cleared.
    store.commit('books/setFilters', [bookTags.t1])
    store.commit('books/setIdFilters', ['b1'])
    store.commit('people/setFilters', [peopleTags.p1])
    setUrl('/')

    await store.dispatch('books/setFiltersFromUrl')
    await store.dispatch('people/setFiltersFromUrl')
    expect(filterIds('books')).toEqual(['t1'])
    expect(store.state.books.idFilters).toEqual(['b1'])
    expect(filterIds('people')).toEqual(['p1'])
    expect(navigate).not.toHaveBeenCalled()
  })

  test('people filters match slugs of tags with slashes and trailing spaces', async () => {
    setUrl('/people?filters=arab-middle-eastern-north-african,trans')
    await store.dispatch('people/setFiltersFromUrl')
    expect(filterIds('people')).toEqual(['p2', 'g1'])
  })

  test('books isbns set id filters to the matching book ids and drop unknown isbns', async () => {
    store.commit('books/set', JSON.parse(JSON.stringify(books)))
    expect(store.getters['books/isShared']).toBe(false)

    setUrl('/?books=9781250140913,9999999999999')
    await store.dispatch('books/setFiltersFromUrl')
    expect(store.state.books.idFilters).toEqual(['b1'])
    expect(store.getters['books/isFilteredByIds']).toBe(true)
    expect(store.getters['books/isShared']).toBe(true)
  })

  test('a url written by updateUrl restores the same books filters', async () => {
    await store.dispatch('books/toggleFilter', bookTags.t3)
    await store.dispatch('books/toggleFilter', bookTags.t2)
    const fullPath = lastFullPath()
    expect(fullPath).toBe('/?filters=fantasy-fable,lgbtqia')

    setUrl(fullPath)
    store.commit('books/resetFilters')
    expect(store.state.books.filters).toEqual([])

    await store.dispatch('books/setFiltersFromUrl')
    expect(filterIds('books')).toEqual(['t3', 't2'])
  })
})

describe('filtered getters', () => {
  const shuffledBooks = [
    { id: 'obj', tags: { t1: true } },
    { id: 'arr', tags: ['t1'] },
    { id: 'str', tags: 't1' },
    { id: 'none' },
    { id: 'b2', tags: { t1: true, t2: true } },
    { id: 'other', tags: { t2: true } },
  ]

  /** Returns the ids of the items a filtered getter returned. */
  const ids = items => items.map(item => item.id)

  test('books/filtered filters state.shuffled rather than state.data', () => {
    store.commit('books/set', JSON.parse(JSON.stringify(books)))
    store.state.books.shuffled = [{ id: 'only', tags: { t1: true } }]
    store.commit('books/setFilters', [bookTags.t1])
    expect(ids(store.getters['books/filtered'])).toEqual(['only'])
  })

  test('a tag filter matches tags stored as an object, an array or a string', () => {
    store.state.books.shuffled = shuffledBooks
    store.commit('books/setFilters', [bookTags.t1])
    expect(ids(store.getters['books/filtered'])).toEqual(['obj', 'arr', 'str', 'b2'])
  })

  test('multiple tag filters must all match', () => {
    store.state.books.shuffled = shuffledBooks
    store.commit('books/setFilters', [bookTags.t1, bookTags.t2])
    expect(ids(store.getters['books/filtered'])).toEqual(['b2'])
  })

  test('id filters combine with tag filters', () => {
    store.state.books.shuffled = shuffledBooks
    store.commit('books/setFilters', [bookTags.t1, bookTags.t2])
    store.commit('books/setIdFilters', ['b2', 'other'])
    expect(ids(store.getters['books/filtered'])).toEqual(['b2'])

    store.commit('books/setFilters', [])
    expect(ids(store.getters['books/filtered'])).toEqual(['b2', 'other'])
  })

  test('with no filters or ids, books/filtered returns state.shuffled itself', () => {
    store.state.books.shuffled = shuffledBooks
    expect(store.getters['books/filtered']).toBe(store.state.books.shuffled)
    expect(ids(store.getters['books/filtered'])).toEqual(ids(shuffledBooks))
  })

  test('people/filtered matches identities, and special filters match the exact title', () => {
    store.state.people.shuffled = [
      { id: 'a', title: 'author', identities: { p1: true } },
      { id: 'ai', title: 'author-illustrator', identities: { p1: true } },
      { id: 'i', title: 'illustrator', identities: { p2: true } },
    ]
    store.commit('people/setFilters', [peopleTags.p1])
    expect(ids(store.getters['people/filtered'])).toEqual(['a', 'ai'])

    store.commit('people/setFilters', [{ id: 'author', tag: 'Author' }])
    expect(ids(store.getters['people/filtered'])).toEqual(['a'])

    store.commit('people/setFilters', [{ id: 'author-illustrator', tag: 'Author/Illustrator' }])
    expect(ids(store.getters['people/filtered'])).toEqual(['ai'])

    store.commit('people/setFilters', [peopleTags.p2, { id: 'illustrator', tag: 'Illustrator' }])
    expect(ids(store.getters['people/filtered'])).toEqual(['i'])
  })

  test('bundles/filtered filters the array it is passed by its tags key', () => {
    const bundles = [
      { id: 'x', tags: { t1: true } },
      { id: 'y', tags: { t2: true } },
      { id: 'z', identities: { t1: true } },
    ]
    expect(store.getters['bundles/filtered'](bundles)).toBe(bundles)

    store.commit('bundles/setFilters', [{ id: 't1', tag: 'Picture book' }])
    expect(ids(store.getters['bundles/filtered'](bundles))).toEqual(['x'])
    expect(ids(store.getters['bundles/filtered'](bundles, 'identities'))).toEqual(['z'])
  })
})

describe('isFiltered and isFilteredByIds', () => {
  test('are false initially', () => {
    expect(store.getters['books/isFiltered']).toBe(false)
    expect(store.getters['books/isFilteredByIds']).toBe(false)
    expect(store.getters['people/isFiltered']).toBe(false)
    expect(store.getters['bundles/isFiltered']).toBe(false)
  })

  test('a tag filter sets isFiltered but not isFilteredByIds', async () => {
    await store.dispatch('people/toggleFilter', peopleTags.p1)
    expect(store.getters['people/isFiltered']).toBe(true)
    expect(store.getters['people/isFilteredByIds']).toBe(false)

    await store.dispatch('people/toggleFilter', peopleTags.p1)
    expect(store.getters['people/isFiltered']).toBe(false)
  })

  test('id filters set both isFiltered and isFilteredByIds', () => {
    store.commit('books/setIdFilters', ['x'])
    expect(store.getters['books/isFiltered']).toBe(true)
    expect(store.getters['books/isFilteredByIds']).toBe(true)
    expect(store.getters['books/isShared']).toBe(true)
  })
})
