/**
 * Characterization tests for the Home page, rendered through the real router singleton and a
 * <RouterView>. Firebase is the boundary and is replaced by a fake of the v8 namespaced database API.
 *
 * Guards vue-router's in-component beforeRouteEnter, beforeRouteUpdate and beforeRouteLeave,
 * including a switch between the two route records (ShareList, Home) that share the component;
 * the title and og/twitter meta tags that @vueuse/head renders from reactive computed refs; and the
 * tag filters that @sindresorhus/slugify matches from ?filters= when the book tags first load.
 */
import { h, nextTick } from 'vue'
import { RouterView } from 'vue-router'
import { render, screen, within } from '@testing-library/vue'
import { createHead } from '@vueuse/head'
import VueMasonry from 'vue-next-masonry'
import router from '@/router'
import store from '@/store'
import mixins from '@/mixins/global'
import directives from '@/directives'

const fake = vi.hoisted(() => ({ db: {}, refPaths: [] }))

vi.mock('@/firebase', () => ({
  default: {
    database: () => ({
      ref: path => {
        fake.refPaths = [...fake.refPaths, path]
        return {
          once: (event, cb) => cb({ val: () => fake.db[path] ?? null }),
          on() {},
          off() {},
        }
      },
    }),
  },
}))

vi.mock('@/assets/icons/bookmark.svg', async () => {
  const { h } = await import('vue')
  return { default: { render: () => h('svg') } }
})

const FROZEN_NOW = new Date('2026-03-14T15:09:26.000Z')

const books = {
  b1: { id: 'b1', isbn: '9781328780966', title: 'The Undefeated', tags: { t1: true } },
  b2: { id: 'b2', isbn: '9780000000001', title: 'Hair Love', tags: { t2: true } },
}

const bookTags = {
  t1: { id: 't1', tag: 'LGBTQIA+', showOnFront: true, sortOrder: 2 },
  t2: { id: 't2', tag: 'Picture book', showOnFront: true, sortOrder: 3 },
  t3: { id: 't3', tag: 'Fantasy/Fable', showOnFront: true, sortOrder: 1 },
}

/** Renders a host whose only child is <RouterView>, so Home is mounted as a route component and its in-component guards run. */
const renderApp = () =>
  render(
    { render: () => h(RouterView) },
    {
      global: {
        plugins: [store, router, createHead(), VueMasonry],
        mixins: [mixins],
        directives: { ...directives, tippy: () => {} },
      },
    },
  )

/** Returns the payload of every books/setFiltersFromShareCode dispatch the spy has recorded, in order. */
const shareCodeDispatches = spy =>
  spy.mock.calls
    .filter(([type]) => type === 'books/setFiltersFromShareCode')
    .map(([, payload]) => payload)

/** Returns the elements in the document head that match the selector. Testing Library queries only reach the body. */
const headElements = selector =>
  // eslint-disable-next-line testing-library/no-node-access
  [...document.head.querySelectorAll(selector)]

/** Returns the content attribute of every <meta name="..."> tag in the document head. */
const metaContents = name =>
  headElements(`meta[name="${name}"]`).map(meta => meta.getAttribute('content'))

/** Parses the application/ld+json script that the structuredData store writes to the head. */
const structuredData = () =>
  JSON.parse(headElements('script[type="application/ld+json"]')[0]?.textContent)

/** Returns how many times the spy saw the given action type dispatched. */
const dispatchCount = (spy, type) => spy.mock.calls.filter(([t]) => t === type).length

/** Loads the books and tags into the store the way the Firebase subscription does, shuffling books so BooksView can list them. */
const seed = () => {
  store.commit('tags/books/set', bookTags)
  store.commit('books/set', books)
  store.dispatch('shuffle', 'books')
}

/**
 * Freezes Date at FROZEN_NOW, faking nothing else so router promises and the head flush stay real.
 * Call it right before the navigation under test: vi.waitFor advances fake clocks while it polls.
 */
const freezeClock = () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(FROZEN_NOW)
}

let dispatch
let filterMenu

beforeEach(async () => {
  window.scrollTo = vi.fn()
  document.title = ''
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  filterMenu = document.createElement('div')
  filterMenu.id = 'books-filter-menu'
  document.body.appendChild(filterMenu)

  fake.db = {
    'links/index/abc': { type: 'books', data: ['9781328780966'] },
    'links/index/def': { type: 'books', data: ['9780000000001'] },
  }
  fake.refPaths = []

  store.commit('books/reset')
  store.commit('tags/books/reset')
  store.commit('books/resetFilters')
  store.commit('books/setIdFilters', [])
  store.commit('ui/setLastVisited', undefined)

  // park the router on a page that is not Home, so mounting does not run Home's enter guard
  await router.push('/not-a-page')
  dispatch = vi.spyOn(store, 'dispatch')
})

afterEach(() => {
  dispatch.mockRestore()
  vi.useRealTimers()
})

describe('share links', () => {
  test('/s/:code runs beforeRouteEnter, which filters the list to the shared books', async () => {
    seed()
    renderApp()
    await router.push('/s/abc')

    expect(shareCodeDispatches(dispatch)).toEqual(['abc'])
    await vi.waitFor(() => expect(store.state.books.idFilters).toEqual(['b1']))
    expect(fake.refPaths).toEqual(['links/index/abc'])
    expect(await screen.findByText('Someone shared a list of books with you!')).toBeInTheDocument()
    expect(await screen.findByText('The Undefeated')).toBeInTheDocument()
    expect(screen.queryByText('Hair Love')).not.toBeInTheDocument()
  })

  test('changing the share code runs beforeRouteUpdate with the new code', async () => {
    seed()
    renderApp()
    await router.push('/s/abc')
    await vi.waitFor(() => expect(store.state.books.idFilters).toEqual(['b1']))

    await router.push('/s/def')

    expect(shareCodeDispatches(dispatch)).toEqual(['abc', 'def'])
    await vi.waitFor(() => expect(store.state.books.idFilters).toEqual(['b2']))
    expect(fake.refPaths).toEqual(['links/index/abc', 'links/index/def'])
    expect(await screen.findByText('Hair Love')).toBeInTheDocument()
    expect(screen.queryByText('The Undefeated')).not.toBeInTheDocument()
  })

  test('an unknown share code leaves the list unfiltered', async () => {
    seed()
    renderApp()
    await router.push('/s/nope')

    expect(shareCodeDispatches(dispatch)).toEqual(['nope'])
    await vi.waitFor(() => expect(store.state.books.loadingShareCode).toBe(false))
    expect(fake.refPaths).toEqual(['links/index/nope'])
    expect(store.state.books.idFilters).toEqual([])
    expect(store.getters['books/filtered'].map(book => book.id).toSorted()).toEqual(['b1', 'b2'])
    // the unshared list uses the cover view, which prints each title twice (overlay and mobile caption)
    expect(await screen.findAllByText('The Undefeated')).toHaveLength(2)
    expect(screen.getAllByText('Hair Love')).toHaveLength(2)
    expect(screen.queryByText('Someone shared a list of books with you!')).not.toBeInTheDocument()
  })

  test('going from a share link to / leaves ShareList and enters Home, clearing the id filters', async () => {
    seed()
    renderApp()
    await router.push('/s/abc')
    await router.push('/s/def')
    await vi.waitFor(() => expect(store.state.books.idFilters).toEqual(['b2']))

    freezeClock()
    await router.push('/')

    expect(router.currentRoute.value.name).toBe('Home')
    expect(shareCodeDispatches(dispatch)).toEqual(['abc', 'def', undefined])
    expect(store.state.books.idFilters).toEqual([])
    expect(store.state.ui.lastVisited).toEqual(FROZEN_NOW)
    await vi.waitFor(() =>
      expect(
        screen.queryByText('Someone shared a list of books with you!'),
      ).not.toBeInTheDocument(),
    )
  })
})

describe('beforeRouteLeave', () => {
  test('leaving Home marks the visit with the current date', async () => {
    seed()
    renderApp()
    await router.push('/')
    expect(store.state.ui.lastVisited).toBeUndefined()

    freezeClock()
    await router.push('/about')

    expect(router.currentRoute.value.name).toBe('About')
    expect(store.state.ui.lastVisited).toBeInstanceOf(Date)
    expect(store.state.ui.lastVisited.toISOString()).toBe('2026-03-14T15:09:26.000Z')
  })

  test('leaving Home does not overwrite an earlier visit', async () => {
    const earlier = new Date('2025-01-01T00:00:00.000Z')
    store.commit('ui/setLastVisited', earlier)
    seed()
    renderApp()
    await router.push('/')

    freezeClock()
    await router.push('/about')

    expect(router.currentRoute.value.name).toBe('About')
    expect(store.state.ui.lastVisited).toBe(earlier)
  })
})

describe('head', () => {
  test('without filters the title and descriptions are the site defaults', async () => {
    seed()
    await router.push('/')
    renderApp()

    await vi.waitFor(() => expect(document.title).toBe('A Thousand Worlds'))
    expect(metaContents('og:title')).toEqual(['A Thousand Worlds'])
    expect(metaContents('twitter:title')).toEqual(['A Thousand Worlds'])
    expect(metaContents('og:description')).toEqual(['Colorful Reads X Colorful People'])
    expect(metaContents('twitter:description')).toEqual(['Colorful Reads X Colorful People'])
    await vi.waitFor(() =>
      expect(structuredData()).toMatchObject({
        headline: 'A Thousand Worlds',
        description: 'Colorful Reads X Colorful People',
      }),
    )
  })

  test('tag filters become a written list with Picture book as the adjective for books', async () => {
    seed()
    await router.push('/')
    renderApp()
    await vi.waitFor(() => expect(document.title).toBe('A Thousand Worlds'))

    store.commit('books/setFilters', [
      { id: 't1', tag: 'LGBTQIA+' },
      { id: 'tb', tag: 'Black' },
      { id: 't2', tag: 'Picture book' },
    ])

    const title = 'LGBTQIA+ and Black Picture books @ A Thousand Worlds'
    const description = 'Read LGBTQIA+ and Black Picture books at A Thousand Worlds'
    await vi.waitFor(() => expect(document.title).toBe(title))
    expect(metaContents('og:title')).toEqual([title])
    expect(metaContents('twitter:title')).toEqual([title])
    expect(metaContents('og:description')).toEqual([description])
    expect(metaContents('twitter:description')).toEqual([description])
    await vi.waitFor(() => expect(structuredData()).toMatchObject({ headline: title, description }))
  })

  test('Picture book wins over Board book, and Board book alone is the adjective', async () => {
    seed()
    await router.push('/')
    renderApp()

    store.commit('books/setFilters', [
      { id: 'tb', tag: 'Black' },
      { id: 't4', tag: 'Board book' },
      { id: 't2', tag: 'Picture book' },
    ])
    await vi.waitFor(() => expect(document.title).toBe('Black Picture books @ A Thousand Worlds'))

    store.commit('books/setFilters', [
      { id: 'tb', tag: 'Black' },
      { id: 't4', tag: 'Board book' },
    ])
    await vi.waitFor(() => expect(document.title).toBe('Black Board books @ A Thousand Worlds'))
    expect(metaContents('og:description')).toEqual(['Read Black Board books at A Thousand Worlds'])
  })

  test('three filters are joined with a comma and a final "and"', async () => {
    seed()
    await router.push('/')
    renderApp()

    store.commit('books/setFilters', [
      { id: 't1', tag: 'LGBTQIA+' },
      { id: 'tb', tag: 'Black' },
      { id: 't3', tag: 'Fantasy/Fable' },
    ])

    await vi.waitFor(() =>
      expect(document.title).toBe('LGBTQIA+, Black and Fantasy/Fable books @ A Thousand Worlds'),
    )
    expect(metaContents('twitter:description')).toEqual([
      'Read LGBTQIA+, Black and Fantasy/Fable books at A Thousand Worlds',
    ])
  })

  test('clearing the filters restores the defaults', async () => {
    seed()
    await router.push('/')
    renderApp()
    store.commit('books/setFilters', [{ id: 'tb', tag: 'Black' }])
    await vi.waitFor(() => expect(document.title).toBe('Black books @ A Thousand Worlds'))

    store.commit('books/resetFilters')

    await vi.waitFor(() => expect(document.title).toBe('A Thousand Worlds'))
    expect(metaContents('og:title')).toEqual(['A Thousand Worlds'])
    expect(metaContents('og:description')).toEqual(['Colorful Reads X Colorful People'])
    await vi.waitFor(() =>
      expect(structuredData()).toMatchObject({ headline: 'A Thousand Worlds' }),
    )
  })
})

describe('filters from the URL', () => {
  /** Mounts Home at the url while tags and books are still empty, then loads them the way the Firebase subscription does. */
  const loadTagsAt = async url => {
    await router.push(url)
    renderApp()
    seed()
  }

  test('slugified ?filters= select tags in URL order once the book tags first load', async () => {
    await loadTagsAt('/?filters=lgbtqia,picture-book')

    await vi.waitFor(() =>
      expect(store.state.books.filters.map(filter => filter.tag)).toEqual([
        'LGBTQIA+',
        'Picture book',
      ]),
    )
    expect(dispatchCount(dispatch, 'books/setFiltersFromUrl')).toBe(1)
    await vi.waitFor(() =>
      expect(document.title).toBe('LGBTQIA+ Picture books @ A Thousand Worlds'),
    )
  })

  test('the filter order follows the URL, not the tag sort order', async () => {
    await loadTagsAt('/?filters=picture-book,lgbtqia')

    await vi.waitFor(() =>
      expect(store.state.books.filters.map(filter => filter.id)).toEqual(['t2', 't1']),
    )
  })

  test('a tag with a slash matches its slug, and unknown slugs are dropped', async () => {
    await loadTagsAt('/?filters=fantasy-fable,not-a-tag')

    await vi.waitFor(() => expect(store.state.books.filters).toEqual([bookTags.t3]))
  })

  test('?books= selects books by ISBN as id filters', async () => {
    await loadTagsAt('/?books=9781328780966')

    await vi.waitFor(() => expect(store.state.books.idFilters).toEqual(['b1']))
    expect(store.state.books.filters).toEqual([])
  })

  test('a later tag update does not re-read the URL', async () => {
    await loadTagsAt('/?filters=lgbtqia')
    await vi.waitFor(() =>
      expect(store.state.books.filters.map(filter => filter.tag)).toEqual(['LGBTQIA+']),
    )

    store.commit('tags/books/set', { ...bookTags, t5: { id: 't5', tag: 'Black' } })
    await nextTick()

    expect(dispatchCount(dispatch, 'books/setFiltersFromUrl')).toBe(1)
  })

  test('the Filter menu is teleported into #books-filter-menu, sorted, with URL filters active', async () => {
    await loadTagsAt('/?filters=lgbtqia')

    const menu = await within(filterMenu).findByRole('complementary')
    const [fantasy, lgbtqia, picture, reset] = within(menu).getAllByRole('button')
    await vi.waitFor(() => expect(lgbtqia).toHaveClass('active'))
    expect(lgbtqia).toHaveTextContent('LGBTQIA+—')
    expect(fantasy).toHaveTextContent('Fantasy/Fable')
    expect(fantasy).not.toHaveClass('active')
    expect(picture).toHaveTextContent('Picture book')
    expect(picture).not.toHaveClass('active')
    expect(reset).toHaveTextContent('Reset Filter')
  })
})
