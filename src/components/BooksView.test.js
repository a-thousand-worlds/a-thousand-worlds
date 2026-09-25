/**
 * BooksView, BookCoverView, BookListView, BookmarkButton, BookmarksView, BookmarkWidget and
 * RightBar: the home page book grid and list, and the bookmarks sidebar with its share link.
 *
 * Dependency seams guarded:
 * vite and @vitejs/plugin-vue: a '*.svg' import resolves to a URL string, not the component the
 * webpack build's vue-svg-loader makes, so the icon components are mocked here.
 *
 * jsdom: Image load and error events, which a canary pins as never fired, so a fake Image stands in
 * everywhere else; url() in computed and inline styles, window.location.origin in the share link,
 * and the absence of navigator.share that selects the desktop share path.
 *
 * vue 3.5: style-object bindings that drop null values, a string style falling through onto an
 * icon, a watcher that resets share state when bookmarks change, and the batched watcher that forces
 * RightBar to defer its switch back to covers with a setTimeout.
 *
 * vuex 4: the books/filtered, books/isFiltered and books/isShared getters, and replaceState.
 *
 * vue-router 4: pushes to Signup, Login, BookDetail/BookEdit and Home, the ShareList route a share
 * code resolves to, and the $route watcher that hides the view options off Home and Bundles.
 *
 * jest-dom (from @testing-library/jest-dom): toHaveStyle in both its object and CSS string forms,
 * toHaveClass, toBeVisible and toHaveValue.
 *
 * Firebase (pinned at v8) is the boundary, faked at firebase/app so the real src/firebase.js and
 * every store module's dynamic import of it still run; the fake logs the write shapes pinned here.
 * vue-next-masonry is a global plugin registered only in main.js, so a stub stands in for it.
 */
import { h, nextTick } from 'vue'
import { render, fireEvent, within } from '@testing-library/vue'
import router from '@/router'
import store from '@/store'
import mixins from '@/mixins/global'
import directives from '@/directives'
import BooksView from '@/components/BooksView.vue'
import BookCoverView from '@/components/BookCoverView.vue'
import BookListView from '@/components/BookListView.vue'
import BookmarkButton from '@/components/BookmarkButton.vue'
import BookmarksView from '@/components/BookmarksView.vue'
import RightBar from '@/components/RightBar.vue'

// vitest hoists this above the imports. createWebHistory reads window.location when src/router.js
// is imported, so the initial navigation resolves to the eagerly imported NotFound page.
vi.hoisted(() => {
  window.history.replaceState(null, '', '/__test__')
  // router scrollBehavior calls it after a navigation, and jsdom does not implement it
  window.scrollTo = () => {}
})

const fb = vi.hoisted(() => {
  const state = { values: {}, log: [] }

  /** Deep-copies a written value, since the store keeps mutating the profile it wrote. */
  const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

  /** Returns a fake v8 database reference that logs every write and transaction in order. */
  const ref = path => ({
    set: async value => {
      state.log = [...state.log, ['set', path, clone(value)]]
    },
    update: async value => {
      state.log = [...state.log, ['update', path, clone(value)]]
    },
    once: (event, callback) => callback({ val: () => state.values[path] ?? null }),
    transaction: (update, onComplete) => {
      const current = state.values[path] ?? null
      const next = update(current)
      state.log = [...state.log, ['transaction', path, current, next]]
      state.values[path] = next
      const snapshot = { toJSON: () => next }
      onComplete?.(null, true, snapshot)
      return Promise.resolve({ committed: true, snapshot })
    },
  })

  return { state, firebase: { initializeApp: () => {}, database: () => ({ ref }) } }
})

vi.mock('firebase/app', () => ({ default: fb.firebase }))
vi.mock('firebase/auth', () => ({}))
vi.mock('firebase/database', () => ({}))
vi.mock('firebase/storage', () => ({}))

// these also match the components' relative '../assets/icons/...' imports
vi.mock('@/assets/icons/bookmark.svg', async () => {
  const { h } = await import('vue')
  return { default: { render: () => h('svg', { 'data-testid': 'bookmark-icon' }) } }
})
vi.mock('@/assets/icons/cover-view.svg', async () => {
  const { h } = await import('vue')
  return { default: { render: () => h('svg', { 'data-testid': 'cover-view-icon' }) } }
})
vi.mock('@/assets/icons/list-view.svg', async () => {
  const { h } = await import('vue')
  return { default: { render: () => h('svg', { 'data-testid': 'list-view-icon' }) } }
})

// RightBar is navigated past these pages, never renders them
vi.mock('@/pages/About.vue', () => ({ default: { render: () => null } }))
vi.mock('@/pages/Home.vue', () => ({ default: { render: () => null } }))
vi.mock('@/pages/Bundles.vue', () => ({ default: { render: () => null } }))

const NOW = '2026-01-02T03:04:05.000Z'
const AUTHORIZED = { uid: 'u1', roles: { authorized: true } }

/** Ten books b1..b10 titled 'Book 1'..'Book 10', with the even-numbered ones tagged 'even'. */
const BOOKS = Object.fromEntries(
  Array.from({ length: 10 }, (_, i) => {
    const n = i + 1
    const book = {
      id: `b${n}`,
      isbn: `97800000000${String(n).padStart(2, '0')}`,
      title: `Book ${n}`,
      cover: `/img/b${n}.jpg`,
      ...(n % 2 === 0 ? { tags: { even: true } } : null),
    }
    return [book.id, book]
  }),
)

const pristine = JSON.parse(JSON.stringify(store.state))

/** Stands in for vue-next-masonry, rendering its items and echoing its cols and gutter props. */
const MasonryStub = {
  props: ['cols', 'gutter'],
  render() {
    return h(
      'div',
      {
        'data-testid': 'masonry',
        'data-cols': JSON.stringify(this.cols),
        'data-gutter': this.gutter,
      },
      this.$slots.default?.(),
    )
  },
}

/** Stands in for v-tippy, exposing each binding's content as data-tippy on the element. */
const tippy = {
  mounted: (el, { value }) => el.setAttribute('data-tippy', value.content),
  updated: (el, { value }) => el.setAttribute('data-tippy', value.content),
}

/** jsdom's own Image constructor, taken before beforeEach stubs it with FakeImage. */
const RealImage = window.Image

/** Every Image the components created in the current test, in creation order. */
let images = []

/**
 * Stands in for window.Image, whose load and error events jsdom never fires. Records each instance
 * so a test can call its onload or onerror by hand.
 */
function FakeImage() {
  images = [...images, this]
}

let push

/** Renders a component with the real store and router, the app's global mixins and directives. */
const renderWithApp = (component, options = {}) =>
  render(component, {
    ...options,
    global: {
      plugins: [store, router],
      mixins: [mixins],
      directives: { ...directives, tippy },
      stubs: { masonry: MasonryStub },
    },
  })

/** Returns the elements under a container that match a CSS selector, for nodes with no role or text. */
const $$ = (container, selector) =>
  // eslint-disable-next-line testing-library/no-node-access
  [...container.querySelectorAll(selector)]

/**
 * Retries an assertion every 10ms of real time until it passes, for up to a second. Unlike
 * vi.waitFor, it never advances a faked clock, so a frozen Date stays frozen while it polls.
 */
const eventually = async (assertion, tries = 100) => {
  try {
    return assertion()
  } catch (e) {
    if (tries <= 1) throw e
    await new Promise(resolve => setTimeout(resolve, 10))
    return eventually(assertion, tries - 1)
  }
}

/**
 * Returns an inline style declaration as Vue wrote it. toHaveStyle reads the computed style, where
 * jsdom resolves a transparent and an unset background color alike to rgba(0, 0, 0, 0).
 */
const inline = (element, property) => element.style.getPropertyValue(property)

/** Returns the text of each heading of the given level, in document order. */
const headings = (view, level) =>
  view.queryAllByRole('heading', { level }).map(heading => heading.textContent.trim())

/** Returns the set and update calls the fake database received, in order. */
const writes = () => fb.state.log.filter(([method]) => method === 'set' || method === 'update')

/** Returns the transactions the fake database ran as [path, before, after], in order. */
const transactions = () =>
  fb.state.log.filter(([method]) => method === 'transaction').map(([, ...rest]) => rest)

/** Loads the book tags, the one tag 'even'. */
const loadTags = () => store.commit('tags/books/set', { even: { id: 'even', tag: 'Even' } })

/** Loads the ten books, and sets shuffled to insertion order in place of the random shuffle. */
const loadBooks = () => {
  store.commit('books/set', JSON.parse(JSON.stringify(BOOKS)))
  store.state.books.shuffled = Object.values(store.state.books.data)
}

/** Loads the book tags and the ten books. */
const seedBooks = () => {
  loadTags()
  loadBooks()
}

/** Logs in an authorized user u1 with the given bookmarks. */
const login = (bookmarks = {}) =>
  store.commit('user/setUser', { ...AUTHORIZED, profile: { bookmarks } })

beforeEach(async () => {
  store.replaceState(JSON.parse(JSON.stringify(pristine)))
  fb.state.values = {}
  fb.state.log = []
  images = []
  vi.stubGlobal('Image', FakeImage)
  // a test that navigated leaves the router elsewhere; the first call also starts the router
  await router.replace('/__test__')
  push = vi.spyOn(router, 'push').mockResolvedValue()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  Reflect.deleteProperty(window.navigator, 'share')
})

describe('stand-in canaries', () => {
  test('vite resolves an svg import to its URL string, not a component', async () => {
    const actual = await vi.importActual('@/assets/icons/bookmark.svg')
    expect(actual.default).toBe('/src/assets/icons/bookmark.svg')
  })

  test('jsdom fires neither load nor error on an Image, for any src the covers use', async () => {
    const srcs = ['/img/c.jpg', 'https://x/c.jpg', '']
    const realImages = srcs.map(src => {
      const image = new RealImage()
      image.onload = vi.fn()
      image.onerror = vi.fn()
      image.src = src
      return image
    })
    // the real element, not FakeImage
    expect(realImages.map(image => image.tagName)).toEqual(['IMG', 'IMG', 'IMG'])

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(
      realImages.map(image => [image.onload.mock.calls.length, image.onerror.mock.calls.length]),
    ).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
    ])
  })
})

describe('BookCoverView', () => {
  const COVER = { url: 'https://x/c.jpg', cache: '/img/c.jpg', width: 200, height: 300 }

  /** Renders a BookCoverView for the given book and returns the view and its cover wrapper. */
  const renderCover = book => {
    const view = renderWithApp(BookCoverView, { props: { book } })
    const [wrapper] = $$(view.container, '.book-cover-wrapper')
    return { view, wrapper }
  }

  test('a cover object sizes the wrapper by its aspect ratio and shows the cached image', () => {
    const { wrapper } = renderCover({ id: 'b1', title: 'Book 1', cover: COVER })
    expect(wrapper).toHaveStyle({
      width: '100%',
      paddingTop: '150%',
      backgroundImage: 'url(/img/c.jpg)',
      backgroundSize: 'contain',
      backgroundRepeat: 'no-repeat',
    })
    expect(wrapper).toHaveStyle('background-image: url("/img/c.jpg")')
    expect(inline(wrapper, 'background-image')).toBe('url("/img/c.jpg")')
    expect(inline(wrapper, 'background-color')).toBe('transparent')
    expect(inline(wrapper, 'min-height')).toBe('')
  })

  test('the cached image is the one loaded to detect the cover loading', () => {
    renderCover({ id: 'b1', title: 'Book 1', cover: COVER })
    expect(images.map(image => image.src)).toEqual(['/img/c.jpg'])
  })

  test('a cover object with no cache loads and shows the url', () => {
    const { wrapper } = renderCover({ id: 'b1', title: 'Book 1', cover: { ...COVER, cache: '' } })
    expect(images.map(image => image.src)).toEqual(['https://x/c.jpg'])
    expect(wrapper).toHaveStyle({ backgroundImage: 'url("https://x/c.jpg")' })
  })

  test('when the cached image errors, the background falls back to the cover url', async () => {
    const { wrapper } = renderCover({ id: 'b1', title: 'Book 1', cover: COVER })
    images[0].onerror()
    await nextTick()
    expect(wrapper).toHaveStyle({ backgroundImage: 'url("https://x/c.jpg")' })
  })

  test('when the image loads, it emits loaded with the book', () => {
    const book = { id: 'b1', title: 'Book 1', cover: COVER }
    const { view } = renderCover(book)
    expect(view.emitted().loaded).toBeUndefined()
    images[0].onload()
    expect(view.emitted().loaded).toEqual([[book]])
  })

  test('a string cover is sized by coverWidth and coverHeight', () => {
    const { wrapper } = renderCover({
      id: 'b2',
      title: 'Old',
      cover: '/img/old.jpg',
      coverWidth: 100,
      coverHeight: 125,
    })
    expect(wrapper).toHaveStyle({ paddingTop: '125%', backgroundImage: 'url(/img/old.jpg)' })
    expect(inline(wrapper, 'background-color')).toBe('transparent')
    expect(images.map(image => image.src)).toEqual(['/img/old.jpg'])
  })

  test('a string cover with no dimensions gets a 1% ratio', () => {
    const { wrapper } = renderCover({ id: 'b2', title: 'Old', cover: '/img/old.jpg' })
    expect(wrapper).toHaveStyle({ paddingTop: '1%' })
  })

  test('no cover gives a 200px placeholder with an empty url() and no background color', () => {
    const { wrapper } = renderCover({ id: 'b3', title: 'None' })
    expect(wrapper).toHaveStyle(
      'width: 100%; padding-top: 1%; background-image: url(""); min-height: 200px; background-size: contain; background-repeat: no-repeat',
    )
    // a null in the style object leaves the declaration out
    expect(inline(wrapper, 'background-color')).toBe('')
    expect(inline(wrapper, 'background-image')).toBe('url("")')
    expect(images.map(image => image.src)).toEqual([''])
  })

  test('the title renders twice, in the hover overlay and in the mobile block', () => {
    const { view } = renderCover({ id: 'b1', title: 'Book 1', cover: COVER })
    expect(view.getAllByText('Book 1')).toHaveLength(2)
    expect(headings(view, 1)).toEqual(['Book 1'])
    expect(view.getAllByTestId('bookmark-icon')).toHaveLength(2)
  })

  test('clicking the cover pushes BookDetail with the slugified title', async () => {
    const { wrapper } = renderCover({
      id: 'b1',
      isbn: '9780000000001',
      title: "Mommy's Book",
      cover: COVER,
    })
    await fireEvent.click(wrapper)
    expect(push.mock.calls).toEqual([
      [{ name: 'BookDetail', params: { isbn: '9780000000001', slug: 'mommys-book' } }],
    ])
  })
})

describe('BookListView', () => {
  test('a book with no title renders the missing-book placeholder with its id', () => {
    const view = renderWithApp(BookListView, { props: { book: { id: 'zz' } } })
    expect(view.getByText('Oops! Missing book')).toBeInTheDocument()
    expect(view.getByText('zz')).toBeInTheDocument()
    const [cover] = $$(view.container, '.img-cover')
    expect(cover).toHaveStyle({ minWidth: '100px', minHeight: '180px', paddingTop: '1%' })
    expect(inline(cover, 'background-image')).toBe('url("")')
    expect(inline(cover, 'background-color')).toBe('')
  })

  test('a book with a cover object is sized by its ratio and has no minimum size', () => {
    const view = renderWithApp(BookListView, {
      props: {
        book: {
          id: 'b1',
          title: 'Book 1',
          cover: { url: 'https://x/c.jpg', cache: '/img/c.jpg', width: 200, height: 300 },
        },
      },
    })
    const [cover] = $$(view.container, '.img-cover')
    expect(cover).toHaveStyle(
      'width: 100%; padding-top: 150%; background-image: url("/img/c.jpg"); background-size: contain; background-repeat: no-repeat',
    )
    expect(inline(cover, 'background-color')).toBe('transparent')
    expect(inline(cover, 'min-width')).toBe('')
    expect(inline(cover, 'min-height')).toBe('')
    expect(images.map(image => image.src)).toEqual(['/img/c.jpg'])
  })

  test('when the cover errors it falls back to the url, and when it loads it emits loaded', async () => {
    const book = {
      id: 'b1',
      title: 'Book 1',
      cover: { url: 'https://x/c.jpg', cache: '/img/c.jpg', width: 200, height: 300 },
    }
    const view = renderWithApp(BookListView, { props: { book } })
    images[0].onerror()
    await nextTick()
    expect($$(view.container, '.img-cover')[0]).toHaveStyle({
      backgroundImage: 'url("https://x/c.jpg")',
    })
    images[0].onload()
    expect(view.emitted().loaded).toEqual([[book]])
  })

  test('the bookmark icon takes the inline iconStyle string', () => {
    const view = renderWithApp(BookListView, { props: { book: { id: 'b1', title: 'Book 1' } } })
    expect(view.getByTestId('bookmark-icon')).toHaveStyle({ marginTop: '6.5px', height: '27px' })
  })

  test('creators render only when the book has them', () => {
    store.commit('people/set', { p1: { id: 'p1', name: 'Yuyi Morales' } })
    const view = renderWithApp(BookListView, {
      props: { book: { id: 'b1', title: 'Book 1', creators: { p1: 'author-illustrator' } } },
    })
    expect(view.getByText('Yuyi Morales')).toBeInTheDocument()
    view.unmount()

    const bare = renderWithApp(BookListView, { props: { book: { id: 'b1', title: 'Book 1' } } })
    expect(bare.queryByText('Yuyi Morales')).not.toBeInTheDocument()
    expect($$(bare.container, '.authors')).toHaveLength(0)
  })

  test.each([
    [false, 'BookDetail'],
    [true, 'BookEdit'],
  ])('with edit %s, clicking the title pushes %s', async (edit, name) => {
    const view = renderWithApp(BookListView, {
      props: { book: { id: 'b1', isbn: '9780000000001', title: 'Book 1' }, edit },
    })
    await fireEvent.click(view.getByRole('heading', { level: 3, name: 'Book 1' }))
    expect(push.mock.calls).toEqual([[{ name, params: { isbn: '9780000000001', slug: 'book-1' } }]])
  })
})

describe('BooksView', () => {
  test.each([
    ['the book tags', 'the books', loadTags, loadBooks],
    ['the books', 'the book tags', loadBooks, loadTags],
  ])('shows only the loader once %s load, until %s load too', async (_, __, first, second) => {
    const view = renderWithApp(BooksView)
    expect($$(view.container, '.loading-spinner')).toHaveLength(1)
    expect(view.queryByTestId('masonry')).not.toBeInTheDocument()

    first()
    await nextTick()
    expect($$(view.container, '.loading-spinner')).toHaveLength(1)
    expect(view.queryByTestId('masonry')).not.toBeInTheDocument()

    second()
    await nextTick()
    expect($$(view.container, '.loading-spinner')).toHaveLength(0)
    expect(view.getByTestId('masonry')).toBeInTheDocument()
  })

  test('an empty book list with no filter shows no books and no No matching books', () => {
    loadTags()
    store.commit('books/set', {})
    const view = renderWithApp(BooksView)
    expect($$(view.container, '.loading-spinner')).toHaveLength(0)
    expect(view.queryByText('No matching books')).not.toBeInTheDocument()
    expect(view.queryByText('Reset Filter')).not.toBeInTheDocument()
    expect(view.getByTestId('masonry')).toBeInTheDocument()
    expect($$(view.container, '.book-cover-wrapper')).toHaveLength(0)
    expect(images).toEqual([])
  })

  test('covers mode renders the first 8 books in the masonry with its columns and gutter', () => {
    seedBooks()
    const view = renderWithApp(BooksView)
    const masonry = view.getByTestId('masonry')
    expect(JSON.parse(masonry.dataset.cols)).toEqual({ default: 4, 1024: 3, 440: 2, 0: 1 })
    expect(masonry.dataset.gutter).toBe('20')
    expect(
      within(masonry)
        .getAllByRole('heading', { level: 1 })
        .map(heading => heading.textContent),
    ).toEqual(['Book 1', 'Book 2', 'Book 3', 'Book 4', 'Book 5', 'Book 6', 'Book 7', 'Book 8'])
    expect($$(view.container, '.book-cover-wrapper')).toHaveLength(8)
    expect(images.map(image => image.src)).toEqual([
      '/img/b1.jpg',
      '/img/b2.jpg',
      '/img/b3.jpg',
      '/img/b4.jpg',
      '/img/b5.jpg',
      '/img/b6.jpg',
      '/img/b7.jpg',
      '/img/b8.jpg',
    ])
  })

  test('each loaded cover reveals one more book', async () => {
    seedBooks()
    const view = renderWithApp(BooksView)
    expect(view.queryByText('Book 9')).not.toBeInTheDocument()

    images[0].onload()
    await nextTick()
    expect(view.getAllByText('Book 9')).toHaveLength(2)
    expect(view.queryByText('Book 10')).not.toBeInTheDocument()
    expect(images.map(image => image.src).slice(8)).toEqual(['/img/b9.jpg'])

    images[1].onload()
    await nextTick()
    expect(headings(view, 1)).toHaveLength(10)
  })

  test('list mode renders the first 8 books as list items', () => {
    seedBooks()
    store.commit('ui/setViewMode', 'list')
    const view = renderWithApp(BooksView)
    expect(view.queryByTestId('masonry')).not.toBeInTheDocument()
    expect(headings(view, 3)).toEqual([
      'Book 1',
      'Book 2',
      'Book 3',
      'Book 4',
      'Book 5',
      'Book 6',
      'Book 7',
      'Book 8',
    ])
    expect($$(view.container, '.img-cover')).toHaveLength(8)
  })

  test('a filter that matches nothing offers Reset Filter, which clears it and goes Home', async () => {
    seedBooks()
    const view = renderWithApp(BooksView)
    await store.dispatch('books/setFilters', [{ id: 'none', tag: 'None' }])
    await nextTick()

    expect(view.getByText('No matching books')).toBeInTheDocument()
    expect(headings(view, 1)).toEqual([])
    expect(push.mock.calls).toEqual([[{ name: 'Home', query: { filters: 'none' } }]])

    await fireEvent.click(view.getByText('Reset Filter'))
    expect(store.state.books.filters).toEqual([])
    expect(push.mock.calls.slice(1)).toEqual([[{ name: 'Home', query: {} }]])
    expect(view.queryByText('No matching books')).not.toBeInTheDocument()
    expect(headings(view, 1)).toHaveLength(8)
  })

  test('a tag filter shows only the tagged books', async () => {
    seedBooks()
    const view = renderWithApp(BooksView)
    await store.dispatch('books/setFilters', [{ id: 'even', tag: 'Even' }])
    await nextTick()
    expect(headings(view, 1)).toEqual(['Book 2', 'Book 4', 'Book 6', 'Book 8', 'Book 10'])
    expect(view.queryByText('No matching books')).not.toBeInTheDocument()
    expect(push.mock.calls).toEqual([[{ name: 'Home', query: { filters: 'even' } }]])
  })

  test('a shared list shows its banner and is forced into list view', () => {
    seedBooks()
    store.commit('books/setIdFilters', ['b3', 'b7'])
    expect(store.state.ui.viewMode).toBe('covers')
    const view = renderWithApp(BooksView)
    expect(view.getByText('Someone shared a list of books with you!')).toBeInTheDocument()
    expect(view.queryByTestId('masonry')).not.toBeInTheDocument()
    expect($$(view.container, '.img-cover')).toHaveLength(2)
    expect(headings(view, 3)).toEqual(['Book 3', 'Book 7'])
  })

  test('while a share code loads, it shows the banner and a loader instead of books', () => {
    seedBooks()
    store.commit('books/setLoadingShareCode', true)
    const view = renderWithApp(BooksView)
    expect(view.getByText('Someone shared a list of books with you!')).toBeInTheDocument()
    expect($$(view.container, '.loading-spinner')).toHaveLength(1)
    expect(view.queryByText('Book 1')).not.toBeInTheDocument()
  })

  test('open bookmarks mark the books container with-bookmarks', async () => {
    seedBooks()
    const view = renderWithApp(BooksView)
    expect($$(view.container, '.with-bookmarks')).toHaveLength(0)

    store.commit('ui/setBookmarksOpen', true)
    await nextTick()
    const [container] = $$(view.container, '.with-bookmarks')
    expect(within(container).getByTestId('masonry')).toBeInTheDocument()
  })
})

describe('RightBar', () => {
  test('signed out, the bookmark toggler has no badge and pushes Login', async () => {
    const view = renderWithApp(RightBar)
    const [toggler] = $$(view.container, '.bookmark-toggler')
    expect($$(view.container, '.badge')).toHaveLength(0)
    expect(view.getByTestId('bookmark-icon')).toHaveAttribute(
      'data-tippy',
      'Sign up or log in to save books for later!',
    )

    await fireEvent.click(toggler)
    expect(push.mock.calls).toEqual([[{ name: 'Login' }]])
    expect(store.state.ui.bookmarksOpen).toBe(false)
  })

  test('signed in, the badge counts bookmarks and the toggler opens and closes them', async () => {
    login({ b1: 'book', b2: 'book' })
    const view = renderWithApp(RightBar)
    const [toggler] = $$(view.container, '.bookmark-toggler')
    const [badge] = $$(view.container, '.badge')
    expect(badge).toHaveTextContent(/^2$/)
    expect(view.getByTestId('bookmark-icon')).toHaveAttribute(
      'data-tippy',
      'You have 2 saved books',
    )

    await fireEvent.click(toggler)
    expect(store.state.ui.bookmarksOpen).toBe(true)
    await fireEvent.click(toggler)
    expect(store.state.ui.bookmarksOpen).toBe(false)
    expect(push).not.toHaveBeenCalled()
  })

  test('the tooltip uses the singular for one saved book', () => {
    login({ b1: 'book' })
    const view = renderWithApp(RightBar)
    expect(view.getByTestId('bookmark-icon')).toHaveAttribute('data-tippy', 'You have 1 saved book')
  })

  test('hideBookmarks removes the bookmark toggler', () => {
    const view = renderWithApp(RightBar, { props: { hideBookmarks: true } })
    expect($$(view.container, '.bookmark-toggler')).toHaveLength(0)
    expect(view.getByRole('link', { name: 'Cover' })).toBeInTheDocument()
  })

  test('Cover is active by default, and clicking List switches the view mode', async () => {
    const view = renderWithApp(RightBar)
    expect(view.getByRole('link', { name: 'Cover' })).toHaveClass('active')
    expect(view.getByRole('link', { name: 'List' })).not.toHaveClass('active')
    expect(
      within(view.getByRole('link', { name: 'Cover' })).getByTestId('cover-view-icon'),
    ).toBeInTheDocument()
    expect(
      within(view.getByRole('link', { name: 'List' })).getByTestId('list-view-icon'),
    ).toBeInTheDocument()

    await fireEvent.click(view.getByRole('link', { name: 'List' }))
    expect(store.state.ui.viewMode).toBe('list')
    expect(view.getByRole('link', { name: 'List' })).toHaveClass('active')
    expect(view.getByRole('link', { name: 'Cover' })).not.toHaveClass('active')
  })

  test('the view options hide on routes other than Home and Bundles', async () => {
    const view = renderWithApp(RightBar)
    expect(view.getByRole('link', { name: 'Cover' })).toBeInTheDocument()

    await router.replace('/about')
    await nextTick()
    expect(view.queryByRole('link', { name: 'Cover' })).not.toBeInTheDocument()
    expect(view.queryByRole('link', { name: 'List' })).not.toBeInTheDocument()
    expect($$(view.container, '.bookmark-toggler')).toHaveLength(1)

    await router.replace('/')
    await nextTick()
    expect(view.getByRole('link', { name: 'Cover' })).toBeInTheDocument()

    await router.replace('/about')
    await router.replace('/bundles')
    await nextTick()
    expect(view.getByRole('link', { name: 'List' })).toBeInTheDocument()
  })
})

describe('shared list view mode', () => {
  /** Renders RightBar beside BooksView, as App lays them out. */
  const renderHome = () => renderWithApp({ render: () => [h(RightBar), h(BooksView)] })

  test('RightBar marks List active on a shared list though the stored mode is covers', () => {
    seedBooks()
    store.commit('books/setIdFilters', ['b3', 'b7'])
    const view = renderHome()
    expect(store.state.ui.viewMode).toBe('covers')
    expect(view.getByRole('link', { name: 'List' })).toHaveClass('active')
    expect(view.getByRole('link', { name: 'Cover' })).not.toHaveClass('active')
  })

  test('Cover switches the shared list to covers after a deferred second commit', async () => {
    vi.useFakeTimers()
    seedBooks()
    store.commit('books/setIdFilters', ['b3', 'b7'])
    const view = renderHome()
    expect($$(view.container, '.img-cover')).toHaveLength(2)

    await fireEvent.click(view.getByRole('link', { name: 'Cover' }))
    expect(store.state.ui.viewMode).toBe('list')

    vi.runAllTimers()
    await nextTick()
    expect(store.state.ui.viewMode).toBe('covers')
    expect($$(view.container, '.book-cover-wrapper')).toHaveLength(2)
    expect($$(view.container, '.img-cover')).toHaveLength(0)
    expect(headings(view, 1)).toEqual(['Book 3', 'Book 7'])
    expect(view.getByRole('link', { name: 'Cover' })).toHaveClass('active')
    expect(view.getByRole('link', { name: 'List' })).not.toHaveClass('active')
  })

  test('committing list then covers in one tick does not trigger the BooksView watcher', async () => {
    seedBooks()
    store.commit('books/setIdFilters', ['b3', 'b7'])
    const view = renderHome()

    store.commit('ui/setViewMode', 'list')
    store.commit('ui/setViewMode', 'covers')
    await nextTick()
    expect($$(view.container, '.img-cover')).toHaveLength(2)
    expect($$(view.container, '.book-cover-wrapper')).toHaveLength(0)
  })
})

describe('BookmarkButton', () => {
  const BOOK = { id: 'b1', isbn: '9780000000001', title: 'Book 1' }

  test('signed out, clicking pushes Signup and writes nothing', async () => {
    const view = renderWithApp(BookmarkButton, { props: { book: BOOK } })
    const icon = view.getByTestId('bookmark-icon')
    expect(icon).toHaveClass('fill-secondary-hover')
    expect(icon).not.toHaveClass('fill-primary')

    await fireEvent.click(icon)
    expect(push.mock.calls).toEqual([[{ name: 'Signup' }]])
    expect(fb.state.log).toEqual([])
  })

  test('signed in, clicking saves the bookmark to the profile while busy', async () => {
    login()
    const commit = vi.spyOn(store, 'commit')
    const view = renderWithApp(BookmarkButton, { props: { book: BOOK } })
    const icon = view.getByTestId('bookmark-icon')

    await fireEvent.click(icon)
    await vi.waitFor(() => expect(store.state.ui.busy).toBe(false))
    expect(writes()).toEqual([['set', 'users/u1/profile', { bookmarks: { b1: 'book' } }]])
    expect(icon).toHaveClass('fill-primary')
    expect(icon).not.toHaveClass('fill-secondary-hover')
    expect(
      commit.mock.calls.filter(([type]) => type === 'ui/setBusy').map(([, value]) => value),
    ).toEqual([true, false])
    expect(push).not.toHaveBeenCalled()
  })

  test('clicking a saved bookmark removes it', async () => {
    login({ b1: 'book' })
    const view = renderWithApp(BookmarkButton, { props: { book: BOOK } })
    const icon = view.getByTestId('bookmark-icon')
    expect(icon).toHaveClass('fill-primary')

    await fireEvent.click(icon)
    await vi.waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()).toEqual([['set', 'users/u1/profile', { bookmarks: {} }]])
    expect(icon).toHaveClass('fill-secondary-hover')
  })

  test('the click does not bubble to an enclosing book link', async () => {
    const view = renderWithApp(BookCoverView, { props: { book: BOOK } })
    await fireEvent.click(view.getAllByTestId('bookmark-icon')[0])
    expect(push.mock.calls).toEqual([[{ name: 'Signup' }]])
  })
})

describe('BookmarksView', () => {
  test('with no bookmarks, it shows the help text and no actions', () => {
    login()
    const view = renderWithApp(BookmarksView)
    expect(view.getByText("You don't have any bookmarks yet!")).toBeInTheDocument()
    expect(
      view.getByText('Click the bookmark icon on a book cover to add it to your list.'),
    ).toBeInTheDocument()
    expect(
      view.getByText('Click the bookmark icon in the upper right corner to close.'),
    ).toBeInTheDocument()
    expect(view.queryByText('Share List')).not.toBeInTheDocument()
    expect(view.queryByText('Unsave All')).not.toBeInTheDocument()
  })

  test('lists each bookmarked book in key order with Share List and Unsave All', () => {
    seedBooks()
    login({ b2: 'book', b1: 'book' })
    const view = renderWithApp(BookmarksView)
    expect(headings(view, 3)).toEqual(['Book 2', 'Book 1'])
    expect(view.getByText('Share List')).toBeInTheDocument()
    expect(view.getByText('Unsave All')).toBeInTheDocument()
    expect(view.queryByText("You don't have any bookmarks yet!")).not.toBeInTheDocument()
  })

  test('a bundle bookmark renders its type and id instead of a book', () => {
    seedBooks()
    login({ x9: 'bundle' })
    const view = renderWithApp(BookmarksView)
    expect(view.getByText('bundle: x9')).toBeInTheDocument()
    expect(headings(view, 3)).toEqual([])
  })

  test('a bookmark whose book is gone renders the missing-book placeholder', () => {
    seedBooks()
    login({ gone: 'book' })
    const view = renderWithApp(BookmarksView)
    expect(view.getByText('Oops! Missing book')).toBeInTheDocument()
    expect(view.getByText('gone')).toBeInTheDocument()
  })

  test('Unsave All clears the bookmarks in the profile', async () => {
    seedBooks()
    login({ b2: 'book', b1: 'book' })
    const view = renderWithApp(BookmarksView)
    await fireEvent.click(view.getByText('Unsave All'))
    await vi.waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()).toEqual([['set', 'users/u1/profile', { bookmarks: {} }]])
    expect(view.getByText("You don't have any bookmarks yet!")).toBeInTheDocument()
  })

  describe('Share List', () => {
    const LINK_PATH = '/s/atwxyy'

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(NOW))
      vi.spyOn(Math, 'random').mockReturnValue(0.001)
      seedBooks()
      login({ b2: 'book', b1: 'book' })
    })

    /** Returns the share link input, waiting for the share code to be created. */
    const shareInput = view => eventually(() => view.getByRole('textbox'))

    /**
     * Fakes setTimeout too, keeping Date frozen, so the 3000ms timer ui/popup starts to close its
     * notice cannot outlive the test. Call it only once nothing more needs eventually's real polling.
     */
    const fakeTimeouts = () => {
      vi.useRealTimers()
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
      vi.setSystemTime(new Date(NOW))
    }

    test('jsdom has no navigator.share', () => {
      expect('share' in window.navigator).toBe(false)
    })

    test('creates a share code and shows its link in a readonly input', async () => {
      const view = renderWithApp(BookmarksView)
      expect(view.queryByRole('textbox')).not.toBeInTheDocument()

      await fireEvent.click(view.getByText('Share List'))
      const input = await shareInput(view)

      expect(transactions()).toEqual([['links/count', null, 'atwxyy']])
      expect(writes()).toEqual([
        [
          'update',
          'links/index',
          {
            atwxyy: {
              createdAt: NOW,
              createdBy: 'u1',
              type: 'books',
              data: ['9780000000002', '9780000000001'],
            },
          },
        ],
      ])
      expect(input).toHaveValue(`${window.location.origin}${LINK_PATH}`)
      expect(new URL(input.value).pathname).toBe(LINK_PATH)
      expect(input).toHaveAttribute('readonly')
    })

    test('the share link resolves to the ShareList route with the code', () => {
      const route = router.resolve(LINK_PATH)
      expect({ name: route.name, params: route.params }).toEqual({
        name: 'ShareList',
        params: { code: 'atwxyy' },
      })
    })

    test('the copy button carries the link and, clicked, pops up a notice and a check', async () => {
      const view = renderWithApp(BookmarksView)
      await fireEvent.click(view.getByText('Share List'))
      await shareInput(view)
      fakeTimeouts()

      const [copy] = $$(view.container, '#copy-link')
      const [check] = $$(view.container, '.fa-check')
      expect(copy).toHaveAttribute('data-clipboard-text', `${window.location.origin}${LINK_PATH}`)
      expect(check).not.toBeVisible()

      await fireEvent.click(copy)
      expect(store.state.ui.popups.map(({ text, type }) => [text, type])).toEqual([
        ['Shareable link copied to clipboard', 'info'],
      ])
      expect(check).toBeVisible()

      vi.advanceTimersByTime(3000)
      await nextTick()
      expect(store.state.ui.popups).toEqual([])
      expect(check).toBeVisible()
    })

    test('hiding the link clears the copied check', async () => {
      const view = renderWithApp(BookmarksView)
      await fireEvent.click(view.getByText('Share List'))
      await shareInput(view)
      fakeTimeouts()

      await fireEvent.click($$(view.container, '#copy-link')[0])
      expect($$(view.container, '.fa-check')[0]).toBeVisible()

      await fireEvent.click(view.getByText('Share List'))
      expect($$(view.container, '.fa-check')).toHaveLength(0)

      await fireEvent.click(view.getByText('Share List'))
      expect(view.getByRole('textbox')).toHaveValue(`${window.location.origin}${LINK_PATH}`)
      expect($$(view.container, '.fa-check')[0]).not.toBeVisible()
      expect(transactions()).toHaveLength(1)
    })

    test('clicking Share List again hides the link, and a third time shows it without a new code', async () => {
      const view = renderWithApp(BookmarksView)
      await fireEvent.click(view.getByText('Share List'))
      await shareInput(view)

      await fireEvent.click(view.getByText('Share List'))
      expect(view.queryByRole('textbox')).not.toBeInTheDocument()

      await fireEvent.click(view.getByText('Share List'))
      expect(await shareInput(view)).toHaveValue(`${window.location.origin}${LINK_PATH}`)
      expect(transactions()).toHaveLength(1)
    })

    test('changing the bookmarks hides the link, and the next share creates a new code', async () => {
      const view = renderWithApp(BookmarksView)
      await fireEvent.click(view.getByText('Share List'))
      await shareInput(view)

      store.commit('user/setProfile', { bookmarks: { b1: 'book' } })
      await nextTick()
      expect(view.queryByRole('textbox')).not.toBeInTheDocument()

      await fireEvent.click(view.getByText('Share List'))
      expect(await shareInput(view)).toHaveValue(`${window.location.origin}/s/atwxyx`)
      expect(transactions()).toEqual([
        ['links/count', null, 'atwxyy'],
        ['links/count', 'atwxyy', 'atwxyx'],
      ])
      expect(writes().slice(1)).toEqual([
        [
          'update',
          'links/index',
          {
            atwxyx: { createdAt: NOW, createdBy: 'u1', type: 'books', data: ['9780000000001'] },
          },
        ],
      ])
    })

    test('with navigator.share, it shares the link natively and shows no input', async () => {
      const share = vi.fn()
      // jsdom's Navigator has no share, so this adds an own property that afterEach deletes
      window.navigator.share = share
      const view = renderWithApp(BookmarksView)

      await fireEvent.click(view.getByText('Share List'))
      await eventually(() => expect(share).toHaveBeenCalledTimes(1))
      expect(share.mock.calls).toEqual([
        [
          {
            title: 'Share',
            text: 'Share 2 Books',
            url: `${window.location.origin}${LINK_PATH}`,
          },
        ],
      ])
      expect(view.queryByRole('textbox')).not.toBeInTheDocument()

      await fireEvent.click(view.getByText('Share List'))
      await eventually(() => expect(share).toHaveBeenCalledTimes(2))
      expect(share.mock.calls[1]).toEqual(share.mock.calls[0])
      expect(transactions()).toHaveLength(1)
    })
  })
})
