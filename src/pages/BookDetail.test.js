/**
 * BookDetail page (with BookDetailFooter) characterization tests. Seams guarded:
 * - vue-router: the '/book/:slug(.+)?-:isbn' path and its '/book/:slug?/:isbn(.*)' alias parse
 * the isbn out of the URL; getBook() reads the internal router.currentRoute._value of the
 * '@/router' singleton to feed the head; the page's beforeRouteLeave guard under RouterView;
 * $router.push for the owner edit shortcut.
 * - @vueuse/head 0.9: document.title and og:/twitter: meta from computed refs, deduped by name
 * over App.vue-style defaults and restored on unmount.
 * - isbn3: ISBN-10/13 conversion for the Amazon and Bookshop links.
 * - vue 3.5: <teleport>, :innerHTML binding, merged static and dynamic :style, window listeners.
 * - lodash sortBy: creator order in cards and in the social description.
 * - jsdom: the DOM, inline styles and events all of the above render into.
 */
import { h, ref } from 'vue'
import { RouterView } from 'vue-router'
// eslint-disable-next-line testing-library/no-manual-cleanup -- unmount before this file's own teardown
import { cleanup, render, fireEvent, within } from '@testing-library/vue'
import { createHead, useHead } from '@vueuse/head'
import router from '@/router'
import store from '@/store'
import mixins from '@/mixins/global'
import directives from '@/directives'
import BookDetail from '@/pages/BookDetail.vue'

// vite imports .svg as a URL string, which Vue cannot create an element from
vi.mock('@/assets/icons/bookmark.svg', async () => {
  const { h: hMock } = await import('vue')
  return { default: { render: () => hMock('svg') } }
})

// nothing rendered here should reach Firebase; fail loudly if a store action starts loading it
vi.mock('@/firebase', () => {
  throw new Error('BookDetail tests must not load @/firebase')
})

const ISBN = '9781328780966'
const COVER_URL = 'https://firebasestorage.example/b1.jpg'
const DESCRIPTION = 'Read The Undefeated by Kwame Alexander and Kadir Nelson at A Thousand Worlds'
const TITLE = 'The Undefeated @ A Thousand Worlds'

const people = {
  p1: { id: 'p1', name: 'Kwame Alexander' },
  p2: { id: 'p2', name: 'Kadir Nelson' },
  p3: { id: 'p3', name: 'Ekua Holmes' },
}

/** Returns a fresh copy of the seeded book, with optional overrides. */
const makeBook = overrides => ({
  id: 'b1',
  isbn: ISBN,
  title: 'The Undefeated',
  creators: { p2: 'illustrator', p1: 'author' },
  tags: { t1: true, gone: true },
  summary: '<p>An <b>ode</b> to Black life</p>',
  cover: { url: COVER_URL, cache: '/img/b1.png' },
  goodreads: 40796177,
  ...overrides,
})

/** Replaces the books collection with a single book. */
const setBook = book => store.commit('books/set', { [book.id]: book })

/** Sets the logged in user with the given roles. */
const setRoles = roles => store.commit('user/setUser', { uid: 'u1', roles, profile: {} })

/** Global mount config: the real store, router singleton, a fresh head, mixins and directives. */
const globalConfig = () => ({
  plugins: [store, router, createHead()],
  mixins: [mixins],
  directives: { ...directives, tippy: () => {} },
})

/** Navigates the real router to a url, then renders BookDetail directly. */
const renderAt = async url => {
  await router.push(url)
  return render(BookDetail, { global: globalConfig() })
}

/** A Testing Library text matcher that selects elements by class name, for unlabeled wrappers. */
const byClass = className => (content, element) => element.classList.contains(className)

/** Gets the elements in the document head matching a selector. */
const headTags = selector =>
  // eslint-disable-next-line testing-library/no-node-access -- the head is outside Testing Library's queries
  [...document.head.querySelectorAll(selector)]

/** Gets the content attribute of the first <meta name="..."> tag in the head. */
const metaContent = name => headTags(`meta[name="${name}"]`)[0]?.getAttribute('content')

/** Gets [label, name] pairs of the rendered creator cards in document order. */
const creatorCards = utils => {
  const labels = utils.getAllByText(/^(words |pictures |words and pictures )?by$/)
  const names = utils.getAllByText(/^(Kwame Alexander|Kadir Nelson|Ekua Holmes)$/)
  return labels.map((label, i) => [label.textContent, names[i]?.textContent])
}

/** Gets the [type, handler] pairs of keydown/keyup calls recorded by an add/removeEventListener spy. */
const keyListeners = spy =>
  spy.mock.calls
    .filter(([type]) => type === 'keydown' || type === 'keyup')
    .map(([type, handler]) => [type, handler])

/**
 * Gets an element's declared inline color. toHaveStyle reads computed style instead, where jsdom
 * 24 leaves a CSS-wide keyword such as inherit as written and jsdom 27+ resolves it to a color.
 */
const inlineColor = element => element.style.color

/** Removes every listener recorded by a document.body addEventListener spy. */
const removeBodyListeners = spy =>
  spy.mock.calls.forEach(([type, handler, options]) =>
    document.body.removeEventListener(type, handler, options),
  )

/** The structuredData state as the store module initializes it, restored after each test. */
const initialStructuredData = JSON.stringify(store.state.structuredData.data)

let menu = null
let bodyListeners = null

beforeEach(() => {
  // jsdom does not implement scrollTo, which the router's scrollBehavior calls after navigating
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  // each mount's `new Clipboard('#copy-link')` delegates a click listener from document.body
  bodyListeners = vi.spyOn(document.body, 'addEventListener')
  document.title = ''
  document.head.innerHTML = ''
  menu = document.createElement('div')
  menu.id = 'books-filter-menu'
  document.body.appendChild(menu)
  store.commit('people/set', people)
  store.commit('tags/books/set', { t1: { id: 't1', tag: 'Picture book', showOnFront: true } })
  setBook(makeBook())
  setRoles({ owner: true })
  store.commit('ui/setLastVisited', undefined)
})

afterEach(async () => {
  // vitest runs after-hooks in stack order, so Testing Library's auto-cleanup would unmount only
  // after this hook; unmount first so the resets below re-render nothing and dispatch nothing
  cleanup()
  // drain the 0ms-debounced structuredData head write and the head's nextTick DOM update
  await new Promise(resolve => setTimeout(resolve))
  removeBodyListeners(bodyListeners)
  menu.remove()
  store.commit('books/reset')
  store.commit('people/reset')
  store.commit('tags/books/reset')
  store.commit('user/setUser', null)
  store.commit('structuredData/set', { value: JSON.parse(initialStructuredData) })
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('route lookup', () => {
  test.each([
    ['/book/the-undefeated-9781328780966', { slug: 'the-undefeated', isbn: ISBN }],
    ['/book/9781328780966', { slug: '', isbn: ISBN }],
    ['/book/-9781328780966', { slug: '', isbn: ISBN }],
    ['/book/any-other-slug-9781328780966', { slug: 'any-other-slug', isbn: ISBN }],
  ])('%s parses to %o and finds the book by isbn alone', async (url, params) => {
    const utils = await renderAt(url)
    expect(router.currentRoute.value.name).toBe('BookDetail')
    expect(router.currentRoute.value.params).toEqual(params)
    expect(utils.getByRole('heading', { level: 1 })).toHaveTextContent('The Undefeated')
    expect(utils.getByText(byClass('book-detail'))).toHaveAttribute('data-book-id', 'b1')
  })

  test('an unknown isbn renders NotFound with a Home link to /', async () => {
    const utils = await renderAt('/book/the-undefeated-0000000000000')
    expect(router.currentRoute.value.params).toEqual({
      slug: 'the-undefeated',
      isbn: '0000000000000',
    })
    expect(utils.getByRole('heading', { level: 1 })).toHaveTextContent('Oops... Page Not Found')
    expect(utils.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/')
    expect(utils.getByText(byClass('book-detail'))).not.toHaveAttribute('data-book-id')
    expect(utils.queryByRole('link', { name: 'LOCAL LIBRARY' })).not.toBeInTheDocument()
  })

  test('before books are loaded the Loader renders instead of NotFound', async () => {
    store.commit('books/reset')
    const utils = await renderAt(`/book/the-undefeated-${ISBN}`)
    expect(utils.queryAllByText(byClass('loading-spinner'))).toHaveLength(1)
    expect(utils.queryByText('Oops... Page Not Found')).not.toBeInTheDocument()
    expect(utils.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
  })
})

describe('head via @vueuse/head', () => {
  test('sets the document title and og/twitter title, description and image meta', async () => {
    await renderAt(`/book/the-undefeated-${ISBN}`)
    await vi.waitFor(() => expect(document.title).toBe(TITLE))
    expect(metaContent('og:title')).toBe(TITLE)
    expect(metaContent('twitter:title')).toBe(TITLE)
    expect(metaContent('og:description')).toBe(DESCRIPTION)
    expect(metaContent('twitter:description')).toBe(DESCRIPTION)
    expect(metaContent('og:image')).toBe(COVER_URL)
    expect(metaContent('twitter:image')).toBe(COVER_URL)
  })

  test('the description keeps insertion order for creators sharing a role', async () => {
    setBook(makeBook({ creators: { p3: 'illustrator', p2: 'author', p1: 'author' } }))
    await renderAt(`/book/${ISBN}`)
    await vi.waitFor(() =>
      expect(metaContent('og:description')).toBe(
        'Read The Undefeated by Kadir Nelson, Kwame Alexander and Ekua Holmes at A Thousand Worlds',
      ),
    )
  })

  test('a legacy string cover is used as-is for the image meta and the cover img', async () => {
    setBook(makeBook({ cover: 'https://legacy.example/b1.jpg' }))
    const utils = await renderAt(`/book/${ISBN}`)
    await vi.waitFor(() => expect(metaContent('og:image')).toBe('https://legacy.example/b1.jpg'))
    expect(utils.getByRole('img')).toHaveAttribute('src', 'https://legacy.example/b1.jpg')
  })

  test('writes the structured data ld+json script after the debounced update', async () => {
    await renderAt(`/book/the-undefeated-${ISBN}`)
    await vi.waitFor(() => {
      const [script] = headTags('script[type="application/ld+json"]')
      const data = JSON.parse(script.textContent)
      expect(data.headline).toBe(TITLE)
      expect(data.description).toBe(DESCRIPTION)
      expect(data.image).toEqual({ '@type': 'ImageObject', url: COVER_URL })
    })
  })
})

describe('head layered over App.vue-style defaults', () => {
  /** Renders BookDetail inside a shell that sets default head tags as App.vue does, toggled by a ref. */
  const renderUnderDefaultsAt = async url => {
    await router.push(url)
    const show = ref(true)
    const Shell = {
      setup() {
        useHead({
          title: 'A Thousand Worlds',
          meta: [
            { name: 'og:title', content: 'A Thousand Worlds' },
            { name: 'og:image', content: 'https://athousandworlds.example/social.png' },
            { name: 'og:type', content: 'article' },
          ],
        })
        return () => (show.value ? h(BookDetail) : null)
      },
    }
    render(Shell, { global: globalConfig() })
    return show
  }

  test('the page overrides default tags by name, leaving one tag per name', async () => {
    await renderUnderDefaultsAt(`/book/${ISBN}`)
    await vi.waitFor(() => expect(document.title).toBe(TITLE))
    expect(headTags('title')).toHaveLength(1)
    expect(headTags('meta[name="og:title"]')).toHaveLength(1)
    expect(headTags('meta[name="og:image"]')).toHaveLength(1)
    expect(metaContent('og:title')).toBe(TITLE)
    expect(metaContent('og:image')).toBe(COVER_URL)
    expect(metaContent('og:type')).toBe('article')
  })

  test('unmounting the page restores the default title and meta', async () => {
    const show = await renderUnderDefaultsAt(`/book/${ISBN}`)
    await vi.waitFor(() => expect(document.title).toBe(TITLE))
    show.value = false
    await vi.waitFor(() => expect(document.title).toBe('A Thousand Worlds'))
    expect(metaContent('og:title')).toBe('A Thousand Worlds')
    expect(metaContent('og:image')).toBe('https://athousandworlds.example/social.png')
    expect(metaContent('og:type')).toBe('article')
    expect(headTags('meta[name="og:description"]')).toEqual([])
    expect(headTags('meta[name="twitter:title"]')).toEqual([])
  })
})

describe('page body', () => {
  test('the cover prefers cover.cache and falls back to cover.url on error', async () => {
    const utils = await renderAt(`/book/${ISBN}`)
    expect(utils.getByRole('img')).toHaveAttribute('src', '/img/b1.png')
    await fireEvent.error(utils.getByRole('img'))
    expect(utils.getByRole('img')).toHaveAttribute('src', COVER_URL)
  })

  test('the summary is rendered as HTML', async () => {
    const utils = await renderAt(`/book/${ISBN}`)
    expect(utils.container).toContainHTML('<p>An <b>ode</b> to Black life</p>')
    expect(utils.getByText('ode').tagName).toBe('B')
    expect(utils.queryByText(/<b>/)).not.toBeInTheDocument()
  })

  test('without a summary the description is rendered instead', async () => {
    setBook(makeBook({ summary: undefined, description: 'A <i>poem</i> for the unforgettable' }))
    const utils = await renderAt(`/book/${ISBN}`)
    expect(utils.container).toContainHTML('A <i>poem</i> for the unforgettable')
    expect(utils.getByText('poem').tagName).toBe('I')
  })

  test('renders only known tags, dropping tag ids missing from the tags collection', async () => {
    const utils = await renderAt(`/book/${ISBN}`)
    const tags = within(utils.getByText(byClass('tags'))).getAllByRole('button')
    expect(tags.map(tag => tag.textContent)).toEqual(['Picture book'])
  })

  test('teleports the books Filter into #books-filter-menu', async () => {
    const utils = await renderAt(`/book/${ISBN}`)
    const filter = within(menu).getByRole('complementary')
    expect(within(filter).getByRole('button', { name: 'Picture book' })).toBeInTheDocument()
    // without the teleport the Filter would render in place, inside the render container
    expect(within(utils.container).queryByRole('complementary')).not.toBeInTheDocument()
    expect(utils.getAllByRole('complementary')).toEqual([filter])
  })
})

describe('creator labels', () => {
  test('author then illustrator, labeled words by and pictures by', async () => {
    setBook(makeBook({ creators: { p1: 'author', p2: 'illustrator' } }))
    const utils = await renderAt(`/book/${ISBN}`)
    expect(creatorCards(utils)).toEqual([
      ['words by', 'Kwame Alexander'],
      ['pictures by', 'Kadir Nelson'],
    ])
  })

  test('cards are sorted by role, whatever the key order', async () => {
    const utils = await renderAt(`/book/${ISBN}`)
    expect(creatorCards(utils)).toEqual([
      ['words by', 'Kwame Alexander'],
      ['pictures by', 'Kadir Nelson'],
    ])
  })

  test('a lone author-illustrator is labeled by', async () => {
    setBook(makeBook({ creators: { p1: 'author-illustrator' } }))
    const utils = await renderAt(`/book/${ISBN}`)
    expect(creatorCards(utils)).toEqual([['by', 'Kwame Alexander']])
  })

  test('an author-illustrator alongside an illustrator is labeled words and pictures by', async () => {
    setBook(makeBook({ creators: { p1: 'author-illustrator', p2: 'illustrator' } }))
    const utils = await renderAt(`/book/${ISBN}`)
    expect(creatorCards(utils)).toEqual([
      ['words and pictures by', 'Kwame Alexander'],
      ['pictures by', 'Kadir Nelson'],
    ])
  })
})

describe('BookDetailFooter links through isbn3', () => {
  test('links the local library by isbn and goodreads by id', async () => {
    const utils = await renderAt(`/book/${ISBN}`)
    expect(utils.getByRole('link', { name: 'LOCAL LIBRARY' })).toHaveAttribute(
      'href',
      `https://worldcat.org/isbn/${ISBN}`,
    )
    expect(utils.getByRole('link', { name: 'GOODREADS' })).toHaveAttribute(
      'href',
      'https://www.goodreads.com/book/show/40796177',
    )
  })

  test('an ISBN-13 becomes an ISBN-10 for Amazon and stays ISBN-13 for Bookshop', async () => {
    vi.stubEnv('VUE_APP_AMAZON_AFFILIATE_CODE', 'atw-20')
    vi.stubEnv('VUE_APP_BOOKSHOP_AFFILIATE_CODE', '12345')
    const utils = await renderAt(`/book/${ISBN}`)
    expect(utils.getByRole('link', { name: 'AMAZON' })).toHaveAttribute(
      'href',
      'https://amzn.com/dp/1328780961?tag=atw-20',
    )
    expect(utils.getByRole('link', { name: 'BOOKSHOP' })).toHaveAttribute(
      'href',
      `https://www.bookshop.org/a/12345/${ISBN}`,
    )
  })

  test('an ISBN-10 stays ISBN-10 for Amazon and becomes ISBN-13 for Bookshop', async () => {
    vi.stubEnv('VUE_APP_AMAZON_AFFILIATE_CODE', 'atw-20')
    vi.stubEnv('VUE_APP_BOOKSHOP_AFFILIATE_CODE', '12345')
    setBook(makeBook({ isbn: '1452171912' }))
    const utils = await renderAt('/book/1452171912')
    expect(utils.getByRole('link', { name: 'AMAZON' })).toHaveAttribute(
      'href',
      'https://amzn.com/dp/1452171912?tag=atw-20',
    )
    expect(utils.getByRole('link', { name: 'BOOKSHOP' })).toHaveAttribute(
      'href',
      'https://www.bookshop.org/a/12345/9781452171913',
    )
    expect(utils.getByRole('link', { name: 'LOCAL LIBRARY' })).toHaveAttribute(
      'href',
      'https://worldcat.org/isbn/1452171912',
    )
  })

  test('an ASIN that isbn3 rejects falls back to the raw value in both links', async () => {
    vi.stubEnv('VUE_APP_AMAZON_AFFILIATE_CODE', 'atw-20')
    vi.stubEnv('VUE_APP_BOOKSHOP_AFFILIATE_CODE', '12345')
    setBook(makeBook({ isbn: 'B08XYZ1234', goodreads: undefined }))
    const utils = await renderAt('/book/the-undefeated-B08XYZ1234')
    expect(utils.getByRole('link', { name: 'AMAZON' })).toHaveAttribute(
      'href',
      'https://amzn.com/dp/B08XYZ1234?tag=atw-20',
    )
    expect(utils.getByRole('link', { name: 'BOOKSHOP' })).toHaveAttribute(
      'href',
      'https://www.bookshop.org/a/12345/B08XYZ1234',
    )
    expect(utils.queryByRole('link', { name: 'GOODREADS' })).not.toBeInTheDocument()
  })

  test('without affiliate codes the Amazon and Bookshop links are absent', async () => {
    vi.stubEnv('VUE_APP_AMAZON_AFFILIATE_CODE', undefined)
    vi.stubEnv('VUE_APP_BOOKSHOP_AFFILIATE_CODE', undefined)
    const utils = await renderAt(`/book/${ISBN}`)
    expect(utils.queryByRole('link', { name: 'AMAZON' })).not.toBeInTheDocument()
    expect(utils.queryByRole('link', { name: 'BOOKSHOP' })).not.toBeInTheDocument()
    expect(utils.getByRole('link', { name: 'LOCAL LIBRARY' })).toHaveAttribute(
      'href',
      `https://worldcat.org/isbn/${ISBN}`,
    )
  })
})

describe('owner edit shortcut', () => {
  test('shift-click on the title pushes BookEdit with the current route params', async () => {
    const utils = await renderAt(`/book/the-undefeated-${ISBN}`)
    const push = vi.spyOn(router, 'push').mockResolvedValue()
    await fireEvent.click(utils.getByText('The Undefeated'), { shiftKey: true })
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith({
      name: 'BookEdit',
      params: { slug: 'the-undefeated', isbn: ISBN },
    })
  })

  test('shift-click on the cover pushes BookEdit too', async () => {
    const utils = await renderAt(`/book/the-undefeated-${ISBN}`)
    const push = vi.spyOn(router, 'push').mockResolvedValue()
    await fireEvent.click(utils.getByRole('img'), { shiftKey: true })
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith({
      name: 'BookEdit',
      params: { slug: 'the-undefeated', isbn: ISBN },
    })
  })

  test('from the slugless alias the pushed slug is empty', async () => {
    const utils = await renderAt(`/book/${ISBN}`)
    const push = vi.spyOn(router, 'push').mockResolvedValue()
    await fireEvent.click(utils.getByText('The Undefeated'), { shiftKey: true })
    expect(push).toHaveBeenCalledWith({ name: 'BookEdit', params: { slug: '', isbn: ISBN } })
  })

  test('a click without shift does not navigate', async () => {
    const utils = await renderAt(`/book/${ISBN}`)
    const push = vi.spyOn(router, 'push').mockResolvedValue()
    await fireEvent.click(utils.getByText('The Undefeated'))
    expect(push).not.toHaveBeenCalled()
  })

  test('a non-owner shift-click does not navigate', async () => {
    setRoles({ contributor: true })
    const utils = await renderAt(`/book/${ISBN}`)
    const push = vi.spyOn(router, 'push').mockResolvedValue()
    await fireEvent.click(utils.getByText('The Undefeated'), { shiftKey: true })
    expect(push).not.toHaveBeenCalled()
  })

  test('holding Shift as owner switches the title cursor, and releasing restores it', async () => {
    const utils = await renderAt(`/book/${ISBN}`)
    const title = utils.getByText('The Undefeated')
    // the static style="color: inherit" survives the merge with :style
    expect(inlineColor(title)).toBe('inherit')
    expect(title).toHaveStyle({ cursor: 'default' })
    await fireEvent.keyDown(window, { key: 'Shift' })
    expect(inlineColor(title)).toBe('inherit')
    expect(title).toHaveStyle({ cursor: 'context-menu', userSelect: 'none' })
    await fireEvent.keyUp(window, { key: 'Shift' })
    expect(inlineColor(title)).toBe('inherit')
    expect(title).toHaveStyle({ cursor: 'default' })
    expect(title).not.toHaveStyle({ userSelect: 'none' })
  })

  test('holding Shift as a non-owner changes nothing', async () => {
    setRoles({ contributor: true })
    const utils = await renderAt(`/book/${ISBN}`)
    const title = utils.getByText('The Undefeated')
    await fireEvent.keyDown(window, { key: 'Shift' })
    expect(title).toHaveStyle({ cursor: 'default' })
    expect(title).not.toHaveStyle({ userSelect: 'none' })
  })

  test('unmounting removes every window key listener the page added', async () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const utils = await renderAt(`/book/${ISBN}`)
    const added = keyListeners(add)
    expect(added.map(([type]) => type)).toEqual(expect.arrayContaining(['keydown', 'keyup']))
    expect(keyListeners(remove)).toEqual([])
    utils.unmount()
    const removed = keyListeners(remove)
    expect(removed).toHaveLength(added.length)
    expect(removed).toEqual(expect.arrayContaining(added))
  })
})

describe('beforeRouteLeave via RouterView', () => {
  /** Renders the router's matched component through RouterView, as the app does. */
  const renderRouterViewAt = async url => {
    await router.push(url)
    return render({ render: () => h(RouterView) }, { global: globalConfig() })
  }

  test('leaving the page records the first visit time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'))
    const utils = await renderRouterViewAt(`/book/the-undefeated-${ISBN}`)
    expect(utils.getByRole('heading', { level: 1 })).toHaveTextContent('The Undefeated')
    await router.push('/no-such-page')
    expect(store.state.ui.lastVisited).toEqual(new Date('2026-01-02T03:04:05.000Z'))
    expect(await utils.findByText('Oops... Page Not Found')).toBeInTheDocument()
  })

  test('leaving the page keeps an existing visit time', async () => {
    const earlier = new Date('2025-05-05T05:05:05.000Z')
    store.commit('ui/setLastVisited', earlier)
    const utils = await renderRouterViewAt(`/book/the-undefeated-${ISBN}`)
    await router.push('/no-such-page')
    expect(await utils.findByText('Oops... Page Not Found')).toBeInTheDocument()
    expect(store.state.ui.lastVisited).toBe(earlier)
  })
})
