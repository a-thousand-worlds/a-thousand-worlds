/*
 * Characterization tests for the root layout, src/App.vue. Dependency seams guarded:
 *
 * - @vueuse/head: App's useHead defaults are written to document.head (title plus one meta per
 *   name), a routed page's useHead (BookDetail) replaces a same-named meta instead of adding a
 *   second one, a null page title leaves App's title in place while null page metas do not (the
 *   BookDetail TODO, held as an expected failure), and App's defaults come back once that page
 *   unmounts.
 * - vue-router: RouterView renders the matched lazy route component, route.meta.noLayout drops
 *   the whole layout, route.meta.access hides the right bar and the welcome banner, the route
 *   names BookEdit, PersonEdit and Login are the exceptions App checks for, and a page's
 *   beforeRouteLeave guard runs when App navigates away from it.
 * - vue: App's created runs before the routed page's setup, so the page's structured data wins;
 *   store state flows reactively into computed props, class bindings and child props.
 * - vue and vue-router warnings: any '[Vue warn]' or '[Vue Router warn]' fails the test that
 *   printed it, except the known ckeditor one in knownWarnings, so a deprecation surfaces here.
 * - vuex: the created hook's dispatch order through this.$store.
 * - lodash: the 0ms debounce that flushes structured data into the ld+json script, and the
 *   reverse(sortBy(createdAt)) that orders the SocialImage collage.
 * - jsdom: window.location.origin and href feed the social URLs.
 *
 * Firebase (pinned at v8, excluded from upgrades) is faked one level below '@/firebase', so the
 * real subscribe action runs offline. The chrome components other tests own are stubbed by their
 * registered names, Loader included; LeftBar and RightBar stubs echo their props so App's
 * bindings can be read.
 * The clock is fixed at 13:00 UTC, an epoch hour where the store picks theme 2. Meta tags are
 * compared by name rather than counted, since @vueuse/head 0.9 adds a head:count meta of its own.
 */
import { h, nextTick } from 'vue'
import { render, queryAllByAttribute, queryByAttribute } from '@testing-library/vue'
import { createHead } from '@vueuse/head'
import { createRouter, createMemoryHistory } from 'vue-router'
import router from '@/router'
import store from '@/store'
import mixins from '@/mixins/global'
import directives from '@/directives'
import App from '@/App.vue'

vi.hoisted(() => vi.setSystemTime(new Date('2026-09-24T13:00:00Z')))

const fb = vi.hoisted(() => {
  /** A fake v8 Reference whose listeners never fire. */
  const ref = () => ({
    on() {},
    once() {},
    off() {},
    set() {},
    update() {},
    transaction() {},
  })
  return {
    firebase: {
      initializeApp: () => {},
      auth: () => ({ currentUser: null, onAuthStateChanged() {} }),
      database: () => ({ ref, useEmulator: () => {} }),
    },
  }
})

vi.mock('firebase/app', () => ({ default: fb.firebase }))
vi.mock('firebase/auth', () => ({}))
vi.mock('firebase/database', () => ({}))
vi.mock('firebase/storage', () => ({}))

vi.mock('@/assets/icons/bookmark.svg', async () => {
  const { h } = await import('vue')
  return { default: { render: () => h('svg') } }
})

const description = 'Colorful Reads X Colorful People'
const title = 'A Thousand Worlds'
const bookTitle = 'The Undefeated @ A Thousand Worlds'
const bookUrl = '/book/the-undefeated-9781328780966'
const cover = 'https://covers.example/undefeated.jpg'

/** A stub that renders an empty marker div. */
const stub = name => ({ name, render: () => h('div', { 'data-testid': name }) })

/** A stub that echoes the props it receives as JSON on a data attribute. */
const propStub = (name, props) => ({
  name,
  props,
  setup: p => () => h('div', { 'data-testid': name, 'data-props': JSON.stringify(p) }),
})

const stubs = {
  // prop declarations mirror the real components
  LeftBar: propStub('LeftBar', { animateLogo: Boolean }),
  RightBar: propStub('RightBar', ['hideBookmarks']),
  MobileHeader: stub('MobileHeader'),
  MobileFooter: stub('MobileFooter'),
  BookmarksView: stub('BookmarksView'),
  ImpersonateHeader: stub('ImpersonateHeader'),
  WelcomeDismissable: stub('WelcomeDismissable'),
  Popups: stub('Popups'),
  Confirm: stub('Confirm'),
  Prompt: stub('Prompt'),
  Loader: stub('Loader'),
}

/**
 * Warnings the suite prints today, and the only ones it swallows: the missing public/dbcache.js
 * (gitignored), and the ckeditor component main.js registers globally, which the edit routes use.
 */
const knownWarnings = [
  /^The cache has not been generated\./,
  /^\[Vue warn\]: Failed to resolve component: ckeditor/i,
]

/** Matches the prefix Vue and vue-router put on every warning they print. */
const frameworkWarning = /^\[Vue( Router)? warn\]/

const originalWarn = console.warn

/** Navigates the real router singleton, then renders App the way main.js mounts it. */
const renderAt = async url => {
  await router.push(url)
  return render(App, {
    global: {
      plugins: [store, router, createHead()],
      mixins: [mixins],
      directives: { ...directives, tippy: () => {} },
      stubs,
    },
  })
}

/** A Testing Library text matcher that selects elements by CSS selector, for class-only markup. */
const bySelector = selector => (content, element) => element.matches(selector)

/** Returns the content of every <meta name="..."> tag in the head, in document order. */
const metaContents = name =>
  queryAllByAttribute('name', document.head, name).map(meta => meta.getAttribute('content'))

/** Returns the parsed application/ld+json script, or null before the first flush. */
const ldJson = () => {
  const script = queryByAttribute('type', document.head, 'application/ld+json')
  return script ? JSON.parse(script.textContent) : null
}

/** Returns the props a propStub last rendered with, or null when it is not rendered. */
const stubProps = (utils, name) => {
  const el = utils.queryByTestId(name)
  return el ? JSON.parse(el.dataset.props) : null
}

// teleport targets that the real LeftBar would provide
;['books-filter-menu', 'people-filter-menu'].forEach(id => {
  const el = document.createElement('div')
  el.id = id
  document.body.appendChild(el)
})

beforeEach(async () => {
  // let a structured data flush still pending from the previous test land before the head is emptied
  await new Promise(resolve => setTimeout(resolve, 0))
  window.scrollTo = vi.fn()
  // swallow only the known warnings; anything else still reaches stderr
  vi.spyOn(console, 'warn').mockImplementation((...args) => {
    if (!knownWarnings.some(known => known.test(String(args[0])))) originalWarn(...args)
  })
  document.title = ''
  document.head.innerHTML = ''
  store.commit('books/reset')
  store.commit('people/reset')
  store.commit('ui/setLastVisited', undefined)
  store.commit('ui/setPageLoading', false)
  store.commit('ui/setBookmarksOpen', false)
})

afterEach(() => {
  const unexpected = console.warn.mock.calls
    .map(([message]) => String(message))
    .filter(message => frameworkWarning.test(message))
    .filter(message => !knownWarnings.some(known => known.test(message)))
  vi.restoreAllMocks()
  expect(unexpected).toEqual([])
})

afterAll(() => {
  vi.useRealTimers()
})

describe('created hook', () => {
  test('sets four structured data paths, then dispatches loadCache and subscribe once each', async () => {
    const { origin } = window.location
    const dispatch = vi.spyOn(store, 'dispatch')
    await renderAt('/about')

    // each structuredData/set re-dispatches structuredData/updateHead through the store
    const calls = dispatch.mock.calls.filter(([type]) => type !== 'structuredData/updateHead')
    expect(calls.slice(0, 6)).toEqual([
      ['structuredData/set', { path: 'description', value: description }],
      ['structuredData/set', { path: 'image.url', value: `${origin}/social/home.png` }],
      [
        'structuredData/set',
        {
          path: 'publisher.logo',
          value: {
            '@type': 'ImageObject',
            url: `${origin}/logo/logo2.png`,
            width: 2176,
            height: 725,
          },
        },
      ],
      ['structuredData/set', { path: 'headline', value: title }],
      ['loadCache'],
      ['subscribe'],
    ])
    const types = dispatch.mock.calls.map(([type]) => type)
    expect(types.filter(type => type === 'loadCache')).toHaveLength(1)
    expect(types.filter(type => type === 'subscribe')).toHaveLength(1)
  })

  test('warns that the cache has not been generated when window.dbcache is absent', async () => {
    expect(window.dbcache).toBeUndefined()
    await renderAt('/about')
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringMatching(/^The cache has not been generated\. Run `npm run update:dbcache/),
    )
  })

  test('renders /about without any Vue or vue-router warning, known ones included', async () => {
    await renderAt('/about')
    await vi.waitFor(() => expect(document.title).toBe(title))
    const frameworkWarnings = console.warn.mock.calls
      .map(([message]) => String(message))
      .filter(message => frameworkWarning.test(message))
    expect(frameworkWarnings).toEqual([])
  })
})

describe('head', () => {
  test('writes the default title and social meta tags on a page without its own head', async () => {
    await renderAt('/about')
    const { origin } = window.location
    await vi.waitFor(() => expect(document.title).toBe(title))

    const names = [
      'og:description',
      'og:image',
      'og:title',
      'og:type',
      'og:url',
      'twitter:card',
      'twitter:description',
      'twitter:image',
      'twitter:site',
      'twitter:title',
      'twitter:url',
      'fb:pages',
      'article:opinion',
      'article:content_tier',
    ]
    expect(Object.fromEntries(names.map(name => [name, metaContents(name)]))).toEqual({
      'og:description': [description],
      'og:image': [`${origin}/social/home.png?fbreset=1`],
      'og:title': [title],
      'og:type': ['article'],
      'og:url': [`${origin}/about`],
      'twitter:card': ['summary_large_image'],
      'twitter:description': [description],
      'twitter:image': [`${origin}/social/home.png`],
      'twitter:site': ['@worlds_thousand'],
      'twitter:title': [title],
      'twitter:url': [`${origin}/about`],
      'fb:pages': ['102421671707042'],
      'article:opinion': ['false'],
      'article:content_tier': ['free'],
    })
  })

  test('og:url and twitter:url are window.location.href at mount, query included', async () => {
    await renderAt('/about?ref=newsletter')
    const href = window.location.href
    await vi.waitFor(() => expect(document.title).toBe(title))
    expect(href).toBe(`${window.location.origin}/about?ref=newsletter`)
    expect(metaContents('og:url')).toEqual([href])
    expect(metaContents('twitter:url')).toEqual([href])
  })

  test('flushes the default structured data into the ld+json script after the debounce', async () => {
    const { origin } = window.location
    await renderAt('/about')
    const logo = {
      '@type': 'ImageObject',
      url: `${origin}/logo/logo2.png`,
      width: 2176,
      height: 725,
    }
    expect(store.getters['structuredData/get']('publisher.logo')).toEqual(logo)
    // the head was emptied before this render, so the script only exists once the debounce fires
    expect(ldJson()).toBeNull()

    await vi.waitFor(() => expect(ldJson()).not.toBeNull())
    expect(ldJson()).toMatchObject({
      '@context': 'http://schema.org',
      '@type': 'NewsArticle',
      headline: title,
      description,
      image: { '@type': 'ImageObject', url: `${origin}/social/home.png` },
      publisher: { '@type': 'Organization', name: 'A Thousand Worlds', logo },
    })
  })

  describe('with a book page', () => {
    beforeEach(() => {
      store.commit('people/set', {
        p1: { id: 'p1', name: 'Kwame Alexander' },
        p2: { id: 'p2', name: 'Kadir Nelson' },
      })
      store.commit('books/set', {
        b1: {
          id: 'b1',
          isbn: '9781328780966',
          title: 'The Undefeated',
          creators: { p1: 'author', p2: 'illustrator' },
          cover: { url: cover },
        },
      })
    })

    test("the page's useHead replaces App's defaults instead of duplicating them", async () => {
      await renderAt(bookUrl)
      await vi.waitFor(() => expect(document.title).toBe(bookTitle))

      expect(metaContents('og:title')).toEqual([bookTitle])
      expect(metaContents('twitter:title')).toEqual([bookTitle])
      expect(metaContents('og:image')).toEqual([cover])
      expect(metaContents('twitter:image')).toEqual([cover])
      expect(metaContents('og:description')).toEqual([
        'Read The Undefeated by Kwame Alexander and Kadir Nelson at A Thousand Worlds',
      ])
      // App defaults the page does not set stay in place
      expect(metaContents('og:type')).toEqual(['article'])
      expect(metaContents('twitter:site')).toEqual(['@worlds_thousand'])
      expect(metaContents('fb:pages')).toEqual(['102421671707042'])
    })

    test("App's defaults come back once the page unmounts", async () => {
      const { origin } = window.location
      await renderAt(bookUrl)
      await vi.waitFor(() => expect(document.title).toBe(bookTitle))

      await router.push('/about')
      await vi.waitFor(() => expect(document.title).toBe(title))
      expect(metaContents('og:title')).toEqual([title])
      expect(metaContents('og:description')).toEqual([description])
      expect(metaContents('og:image')).toEqual([`${origin}/social/home.png?fbreset=1`])
      expect(metaContents('twitter:title')).toEqual([title])
      expect(metaContents('twitter:description')).toEqual([description])
      expect(metaContents('twitter:image')).toEqual([`${origin}/social/home.png`])
    })

    test("App's created runs before the page's setup, so the page's structured data wins", async () => {
      await renderAt(bookUrl)
      // App's created and the page's watchEffects all write before the one debounced flush
      await vi.waitFor(() => expect(ldJson()).not.toBeNull())
      expect(ldJson()).toMatchObject({
        headline: bookTitle,
        description: 'Read The Undefeated by Kwame Alexander and Kadir Nelson at A Thousand Worlds',
        image: { '@type': 'ImageObject', url: cover },
      })
    })
  })

  describe('with a book page whose book is not found', () => {
    /** The six metas BookDetail's useHead sets, each to null while its book is not found. */
    const pageNames = [
      'og:title',
      'og:description',
      'og:image',
      'twitter:title',
      'twitter:description',
      'twitter:image',
    ]

    /** Renders the book page before books load, then waits for the head to be written. */
    const renderNotFound = async () => {
      await renderAt('/book/any-9780000000000')
      await vi.waitFor(() => expect(document.title).toBe(title))
    }

    test("a null page title leaves App's title, and each null meta still takes its name", async () => {
      await renderNotFound()
      expect(store.state.books.loaded).toBe(false)
      pageNames.forEach(name => expect(metaContents(name)).toHaveLength(1))
      // App defaults the page does not set stay in place
      expect(metaContents('og:type')).toEqual(['article'])
      expect(metaContents('twitter:site')).toEqual(['@worlds_thousand'])
      expect(metaContents('fb:pages')).toEqual(['102421671707042'])
    })

    // Expected to fail. @vueuse/head 0.9 renders a null meta content as the string 'null',
    // overriding App's default, which the TODO in BookDetail.vue calls unintended. An upgrade
    // that drops null tags instead, as unhead-based @vueuse/head 2 is expected to, makes this
    // pass and so fails the suite: drop .fails and the TODO then.
    test.fails("null page metas let App's defaults through (BookDetail TODO)", async () => {
      const { origin } = window.location
      await renderNotFound()
      expect(Object.fromEntries(pageNames.map(name => [name, metaContents(name)]))).toEqual({
        'og:title': [title],
        'og:description': [description],
        'og:image': [`${origin}/social/home.png?fbreset=1`],
        'twitter:title': [title],
        'twitter:description': [description],
        'twitter:image': [`${origin}/social/home.png`],
      })
    })
  })
})

describe('layout', () => {
  test('the layout root carries the theme class the store picked for the hour', async () => {
    const utils = await renderAt('/about')
    expect(store.state.theme).toBe(2)
    const root = utils.getByText(bySelector('.theme2'))
    expect(root).toHaveClass('theme2', { exact: true })
    expect(root).toContainElement(utils.getByTestId('ImpersonateHeader'))
    expect(root).toContainElement(utils.getByTestId('MobileFooter'))
  })

  test('a noLayout route renders only the page, with the collage newest first', async () => {
    store.commit('books/set', {
      old: {
        id: 'old',
        title: 'Old',
        createdAt: '2019-05-01T00:00:00.000Z',
        cover: { url: '/2019' },
      },
      new: {
        id: 'new',
        title: 'New',
        createdAt: '2021-05-01T00:00:00.000Z',
        cover: { url: '/2021' },
      },
      mid: {
        id: 'mid',
        title: 'Mid',
        createdAt: '2020-05-01T00:00:00.000Z',
        cover: { url: '/2020' },
      },
    })
    const utils = await renderAt('/social-image')

    expect(router.currentRoute.value.name).toBe('SocialImage')
    ;['LeftBar', 'RightBar', 'MobileHeader', 'MobileFooter', 'ImpersonateHeader'].forEach(name =>
      expect(utils.queryByTestId(name)).not.toBeInTheDocument(),
    )
    expect(utils.queryByText(bySelector('.site'))).not.toBeInTheDocument()
    expect(utils.queryByText(bySelector('.theme2'))).not.toBeInTheDocument()
    expect(utils.getAllByRole('img').map(img => img.getAttribute('src'))).toEqual([
      '/2021',
      '/2020',
      '/2019',
    ])
  })

  test('a public route shows the right bar and its border', async () => {
    const utils = await renderAt('/about')
    expect(utils.getByTestId('RightBar')).toBeInTheDocument()
    expect(utils.getByText(bySelector('section.rightbar'))).toContainElement(
      utils.getByTestId('RightBar'),
    )
    expect(utils.getByText(bySelector('.site > .rightbar-border'))).toBeInTheDocument()
  })

  test('a route with meta.access hides the right bar, its border and the welcome banner', async () => {
    const utils = await renderAt('/admin/books')
    expect(router.currentRoute.value.name).toBe('BooksManager')
    expect(utils.getByRole('heading', { name: 'Books Manager' })).toBeInTheDocument()
    expect(utils.queryByTestId('RightBar')).not.toBeInTheDocument()
    expect(utils.queryByText(bySelector('section.rightbar'))).not.toBeInTheDocument()
    expect(utils.queryByText(bySelector('.rightbar-border'))).not.toBeInTheDocument()
    expect(utils.queryByTestId('WelcomeDismissable')).not.toBeInTheDocument()
    expect(stubProps(utils, 'LeftBar')).toEqual({ animateLogo: false })
  })

  test.each([
    ['/book/x-1/edit', 'BookEdit'],
    ['/person/x/edit', 'PersonEdit'],
  ])('%s keeps the right bar despite meta.access, by route name %s', async (url, name) => {
    const utils = await renderAt(url)
    expect(router.currentRoute.value.name).toBe(name)
    expect(router.currentRoute.value.meta.access).toBe('owner')
    expect(stubProps(utils, 'RightBar')).toEqual({ hideBookmarks: false })
    expect(utils.getByText(bySelector('.rightbar-border'))).toBeInTheDocument()
  })

  test('the loader renders inside the main column while ui.pageLoading is set', async () => {
    const utils = await renderAt('/about')
    expect(utils.queryByTestId('Loader')).not.toBeInTheDocument()

    store.commit('ui/setPageLoading', true)
    await nextTick()
    expect(utils.getByText(bySelector('section.main'))).toContainElement(
      utils.getByTestId('Loader'),
    )

    store.commit('ui/setPageLoading', false)
    await nextTick()
    expect(utils.queryByTestId('Loader')).not.toBeInTheDocument()
  })

  test('open bookmarks render BookmarksView beside a main column marked with-bookmarks', async () => {
    const utils = await renderAt('/about')
    const main = utils.getByText(bySelector('section.main'))
    expect(main).not.toHaveClass('with-bookmarks')
    expect(utils.queryByTestId('BookmarksView')).not.toBeInTheDocument()

    store.commit('ui/setBookmarksOpen', true)
    await nextTick()
    expect(main).toHaveClass('with-bookmarks')
    expect(utils.getByText(bySelector('section.bookmarks'))).toContainElement(
      utils.getByTestId('BookmarksView'),
    )
  })
})

describe('welcome banner', () => {
  test('shows on a first visit, animating the logo and hiding bookmarks', async () => {
    const utils = await renderAt('/about')
    expect(utils.getByTestId('WelcomeDismissable')).toBeInTheDocument()
    expect(utils.getByText(bySelector('.site'))).toHaveClass('border-top')
    expect(stubProps(utils, 'LeftBar')).toEqual({ animateLogo: true })
    expect(stubProps(utils, 'RightBar')).toEqual({ hideBookmarks: true })
  })

  test('disappears once ui.lastVisited is set', async () => {
    const utils = await renderAt('/about')
    expect(utils.getByTestId('WelcomeDismissable')).toBeInTheDocument()

    store.commit('ui/setLastVisited', new Date())
    await nextTick()
    expect(utils.queryByTestId('WelcomeDismissable')).not.toBeInTheDocument()
    expect(utils.getByText(bySelector('.site'))).not.toHaveClass('border-top')
    expect(stubProps(utils, 'LeftBar')).toEqual({ animateLogo: false })
    expect(stubProps(utils, 'RightBar')).toEqual({ hideBookmarks: false })
  })

  test('never shows on the Login route', async () => {
    const utils = await renderAt('/login')
    expect(router.currentRoute.value.name).toBe('Login')
    expect(utils.queryByTestId('WelcomeDismissable')).not.toBeInTheDocument()
    expect(stubProps(utils, 'LeftBar')).toEqual({ animateLogo: false })
    expect(stubProps(utils, 'RightBar')).toEqual({ hideBookmarks: false })
  })

  test('leaving a book page runs its beforeRouteLeave, which takes the banner down', async () => {
    const utils = await renderAt('/book/any-9780000000000')
    expect(router.currentRoute.value.name).toBe('BookDetail')
    expect(utils.getByTestId('WelcomeDismissable')).toBeInTheDocument()

    await router.push('/about')
    await nextTick()
    expect(store.state.ui.lastVisited).toEqual(new Date('2026-09-24T13:00:00Z'))
    expect(utils.queryByTestId('WelcomeDismissable')).not.toBeInTheDocument()
  })

  describe('before the first navigation resolves', () => {
    /** The window location and history.state that the singleton router's web history relies on. */
    let saved

    beforeEach(() => {
      const { pathname, search, hash } = window.location
      saved = { state: window.history.state, url: pathname + search + hash }
    })

    afterEach(() => {
      window.history.replaceState(saved.state, '', saved.url)
    })

    /** Moves the window to a path, keeping history.state intact for the singleton router. */
    const moveWindowTo = path => window.history.replaceState(window.history.state, '', path)

    /** Renders App on a fresh router that has not navigated yet, so $route is the start location. */
    const renderBeforeNavigation = () => {
      const fresh = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: '/:any(.*)*', name: 'Any', component: stub('Page') }],
      })
      const utils = render(App, {
        global: {
          plugins: [store, fresh, createHead()],
          mixins: [mixins],
          directives: { ...directives, tippy: () => {} },
          stubs,
        },
      })
      return { fresh, utils }
    }

    test('the banner shows at once when the window is at /', () => {
      moveWindowTo('/')
      const { fresh, utils } = renderBeforeNavigation()
      expect(fresh.currentRoute.value.name).toBeUndefined()
      expect(utils.getByTestId('WelcomeDismissable')).toBeInTheDocument()
      expect(stubProps(utils, 'LeftBar')).toEqual({ animateLogo: true })
    })

    test('the banner waits for the route to load when the window is elsewhere', async () => {
      moveWindowTo('/about')
      const { fresh, utils } = renderBeforeNavigation()
      expect(fresh.currentRoute.value.name).toBeUndefined()
      expect(utils.queryByTestId('WelcomeDismissable')).not.toBeInTheDocument()
      // showWelcome evaluates to $route.name, undefined, which Vue 3.5 passes through a Boolean
      // prop uncast; LeftBar only tests it for truthiness, so falsy is the contract
      expect(stubProps(utils, 'LeftBar').animateLogo).toBeFalsy()

      await fresh.isReady()
      await nextTick()
      expect(fresh.currentRoute.value.name).toBe('Any')
      expect(utils.getByTestId('WelcomeDismissable')).toBeInTheDocument()
      expect(stubProps(utils, 'LeftBar')).toEqual({ animateLogo: true })
    })
  })
})
