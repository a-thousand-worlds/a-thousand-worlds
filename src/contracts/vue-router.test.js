/**
 * Characterizes vue-router (and the vue runtime it plugs into) at the seams the app relies on, so a
 * vue-router or vue upgrade that changes routing behavior fails here and names the seam:
 * - src/router.js: the route table's path patterns (the greedy `:slug(.+)?-:isbn` book path and
 * its alias), href generation from named routes, route meta, query stringify/parse, and
 * options.scrollBehavior as createWebHistory drives it.
 * - src/main.js: a global beforeEach with the `(to, from, next)` callback and a `next('/404')`
 * redirect, and afterEach.
 * - src/pages/Home.vue: options-API beforeRouteEnter/Update/Leave on one component serving two routes.
 * - src/pages/BookDetail.vue, PersonDetail.vue, BundleManagerForm.vue: reads of the private
 * `router.currentRoute._value`.
 * - src/components/MainMenu.vue and MobileFooter.vue: RouterLink's href, aria-current and active
 * classes, merged with a fallthrough `router-link-active` class.
 * - The managers' `$router.replace({ ...$route, query })` spread.
 */
import { createApp, h, nextTick } from 'vue'
import {
  createMemoryHistory,
  createRouter,
  createWebHistory,
  isNavigationFailure,
  NavigationFailureType,
  RouterLink,
  RouterView,
} from 'vue-router'
import { fireEvent, render, screen } from '@testing-library/vue'
import appRouter from '@/router'

/** Resolves a location through the real router and keeps only the name and params. */
const parse = to => {
  const { name, params } = appRouter.resolve(to)
  return { name, params }
}

/** Resolves a location through the real router and returns the URL it generates. */
const link = to => appRouter.resolve(to).fullPath

/** Lets queued microtasks and a macrotask run, as they would between two user actions. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

/** Builds an inline page that renders its own name, standing in for a lazily loaded page. */
const page = name => ({ name, render: () => h('h1', name) })

/**
 * Copies the real route table with every lazy page swapped for an inline stand-in, keeping each
 * path, alias, name and meta. `components` supplies a stand-in by route name.
 */
const standInRoutes = (components = {}) =>
  appRouter.options.routes.map(route => ({
    ...route,
    component: components[route.name] || page(route.name),
  }))

/** Builds a memory-history router over the stand-in route table. */
const memoryRouter = (components, options) =>
  createRouter({ history: createMemoryHistory(), routes: standInRoutes(components), ...options })

/** The root component App.vue boils down to: a RouterView. */
const App = { render: () => h(RouterView) }

/** Resolves on the next completed navigation, after afterEach hooks have run. */
const nextNavigation = router =>
  new Promise(resolve => {
    const remove = router.afterEach(to => {
      remove()
      resolve(to)
    })
  })

/** Returns every console.warn message vue-router emitted through the given spy. */
const routerWarnings = warn =>
  warn.mock.calls.map(args => String(args[0])).filter(message => message.includes('Vue Router'))

beforeEach(() => {
  // jsdom does not implement scrolling; vue-router calls window.scrollTo after navigations
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('vue-router exports', () => {
  test('the factories and helpers the app imports are functions', () => {
    expect(typeof createRouter).toBe('function')
    expect(typeof createWebHistory).toBe('function')
    expect(typeof createMemoryHistory).toBe('function')
    expect(typeof isNavigationFailure).toBe('function')
  })

  test('RouterLink and RouterView are named components taking `to` and `name` props', () => {
    expect(RouterLink.name).toBe('RouterLink')
    expect(RouterLink.props).toHaveProperty('to')
    expect(RouterView.name).toBe('RouterView')
    expect(RouterView.props).toHaveProperty('name')
  })

  test('NavigationFailureType keeps its numeric flags', () => {
    expect(NavigationFailureType.aborted).toBe(4)
    expect(NavigationFailureType.cancelled).toBe(8)
    expect(NavigationFailureType.duplicated).toBe(16)
  })

  test('installing a router registers router-link and router-view and the $router/$route globals', async () => {
    const router = memoryRouter()
    await router.push('/about')
    const app = createApp({})
    app.use(router)
    expect(app.component('RouterLink')).toBe(RouterLink)
    expect(app.component('RouterView')).toBe(RouterView)
    expect(app.config.globalProperties.$router).toBe(router)
    expect(app.config.globalProperties.$route.name).toBe('About')
  })
})

describe('the real route table: generating links', () => {
  test.each([
    [
      { name: 'BookDetail', params: { slug: 'my-mommy-medicine', isbn: '9781250140913' } },
      '/book/my-mommy-medicine-9781250140913',
    ],
    [
      { name: 'BookEdit', params: { slug: 'my-mommy-medicine', isbn: '9781250140913' } },
      '/book/my-mommy-medicine-9781250140913/edit',
    ],
    [{ name: 'BookDetail', params: { slug: '', isbn: '9781250140913' } }, '/book/-9781250140913'],
    [{ name: 'BookDetail', params: { isbn: '9781250140913' } }, '/book/-9781250140913'],
    [
      { name: 'PersonDetail', params: { name: 'juana-martinez-neal' } },
      '/person/juana-martinez-neal',
    ],
    [{ name: 'ReviewSubmissions', params: { type: 'books' } }, '/admin/review/books'],
    [{ name: 'SubmissionThankYou', params: { type: 'book' } }, '/suggest/book/thankyou'],
  ])('%j links to %s', (to, href) => {
    const route = appRouter.resolve(to)
    expect(route.href).toBe(href)
    expect(route.fullPath).toBe(href)
  })
})

describe('the real route table: parsing URLs', () => {
  test.each([
    [
      '/book/my-mommy-medicine-9781250140913',
      'BookDetail',
      { slug: 'my-mommy-medicine', isbn: '9781250140913' },
    ],
    // the slug is greedy, so the isbn is whatever follows the last dash, an ASIN included
    ['/book/sulwe-B07ABCDE12', 'BookDetail', { slug: 'sulwe', isbn: 'B07ABCDE12' }],
    ['/book/-9781250140913', 'BookDetail', { slug: '', isbn: '9781250140913' }],
    ['/book/9781250140913', 'BookDetail', { slug: '', isbn: '9781250140913' }],
    [
      '/book/my-mommy-medicine/9781250140913',
      'BookDetail',
      { slug: 'my-mommy-medicine', isbn: '9781250140913' },
    ],
    ['/book/9781250140913/edit', 'BookEdit', { slug: '', isbn: '9781250140913' }],
    [
      '/book/my-mommy-medicine-9781250140913/edit',
      'BookEdit',
      { slug: 'my-mommy-medicine', isbn: '9781250140913' },
    ],
    ['/person/juana-martinez-neal/edit', 'PersonEdit', { name: 'juana-martinez-neal' }],
    ['/s/happy-blue-otter', 'ShareList', { code: 'happy-blue-otter' }],
    ['/admin/review/books/rejected', 'ReviewRejectedSubmissions', { type: 'books' }],
    ['/admin/bundles/update/abc', 'BundleManagerUpdateForm', { bid: 'abc' }],
    ['/nope/at/all', 'NotFound', { catchAll: 'nope/at/all' }],
    ['/404', 'NotFound', { catchAll: '404' }],
  ])('%s resolves to %s', (url, name, params) => {
    expect(parse(url)).toEqual({ name, params })
  })
})

describe('the real route table: meta', () => {
  test('access and layout flags come through resolve()', () => {
    expect(appRouter.resolve('/dashboard').meta.access).toBe('authorized')
    expect(appRouter.resolve('/suggest/book').meta.access).toEqual([
      'contributor',
      'advisor',
      'owner',
    ])
    expect(appRouter.resolve('/admin/tags').meta.access).toBe('owner')
    expect(appRouter.resolve('/social-image').meta.noLayout).toBe(true)
  })
})

describe('query strings', () => {
  test.each([
    [{ name: 'Home', query: { filters: 'lgbtqia' } }, '/?filters=lgbtqia'],
    // ',' and '/' stay literal, which the filterable store module's URL format relies on
    [
      { name: 'People', query: { filters: 'indigenous,gender/trans' } },
      '/people?filters=indigenous,gender/trans',
    ],
    [
      { name: 'Home', query: { search: 'Zoë Ruiz', sort: 'title', dir: 'asc' } },
      '/?search=Zo%C3%AB+Ruiz&sort=title&dir=asc',
    ],
    [
      { name: 'Home', query: { search: 'title:Hair Love', sort: 'updated', dir: 'desc' } },
      '/?search=title:Hair+Love&sort=updated&dir=desc',
    ],
    [{ name: 'Home', query: { filters: 'lgbtq+ & friends' } }, '/?filters=lgbtq%2B+%26+friends'],
    [{ name: 'TagsManager', query: { active: 'people' } }, '/admin/tags?active=people'],
    [{ name: 'Home', query: {} }, '/'],
  ])('%j serializes to %s', (to, fullPath) => {
    expect(link(to)).toBe(fullPath)
  })

  test('an encoded comma is decoded when parsed', () => {
    expect(appRouter.resolve('/?filters=lgbtqia%2Cfantasy-fable').query.filters).toBe(
      'lgbtqia,fantasy-fable',
    )
  })

  test('a repeated key parses to an array', () => {
    expect(appRouter.resolve('/?filters=a,b&filters=c').query.filters).toEqual(['a,b', 'c'])
  })

  test("the managers' { ...$route, query } spread keeps the page and rewrites only the query", () => {
    const route = appRouter.resolve('/admin/books?sort=title&dir=asc')
    expect(link({ ...route, query: { ...route.query, search: 'hair love' } })).toBe(
      '/admin/books?sort=title&dir=asc&search=hair+love',
    )
    // an emptied search box writes `search: undefined`, which drops the key
    expect(link({ ...route, query: { ...route.query, search: undefined } })).toBe(
      '/admin/books?sort=title&dir=asc',
    )
  })
})

describe('currentRoute', () => {
  test('the private _value the pages read is the current route', async () => {
    const router = memoryRouter()
    await router.push('/book/hair-love-9780525553366')
    expect(router.currentRoute._value).toBe(router.currentRoute.value)
    expect(router.currentRoute._value.name).toBe('BookDetail')
    expect(router.currentRoute._value.params).toEqual({ slug: 'hair-love', isbn: '9780525553366' })
  })

  test('a page reads currentRoute._value and $route.params in created(), as BundleManagerForm does', async () => {
    const created = vi.fn()
    const BundleForm = {
      created() {
        created(this.$router.currentRoute._value.name, this.$route.params.bid)
      },
      render: () => h('h1', 'Update Bundle'),
    }
    const router = memoryRouter({ BundleManagerUpdateForm: BundleForm })
    await router.push('/admin/bundles/update/abc')
    render(App, { global: { plugins: [router] } })
    expect(screen.getByRole('heading')).toHaveTextContent('Update Bundle')
    expect(created.mock.calls).toEqual([['BundleManagerUpdateForm', 'abc']])
  })
})

describe('global guards with the main.js callback shape', () => {
  /** Builds a router guarded like main.js: routes with meta.access pass only when `allowed()`. */
  const guardedRouter = allowed => {
    const router = memoryRouter()
    router.beforeEach((to, from, next) => {
      if (!to.meta || !to.meta.access) {
        next()
        return
      }
      if (allowed()) next()
      else next('/404')
    })
    return router
  }

  test('a blocked page redirects to /404 and renders NotFound, remembering where it came from', async () => {
    const router = guardedRouter(() => false)
    await router.push('/')
    await router.isReady()
    render(App, { global: { plugins: [router] } })

    const result = await router.push('/dashboard')
    await nextTick()

    expect(result).toBeUndefined()
    const route = router.currentRoute.value
    expect(route.fullPath).toBe('/404')
    expect(route.name).toBe('NotFound')
    expect(route.params).toEqual({ catchAll: '404' })
    expect(route.redirectedFrom.fullPath).toBe('/dashboard')
    expect(screen.getByRole('heading')).toHaveTextContent('NotFound')
  })

  test('an allowed page renders', async () => {
    const router = guardedRouter(() => true)
    await router.push('/')
    await router.isReady()
    render(App, { global: { plugins: [router] } })

    await router.push('/dashboard')
    await nextTick()

    expect(router.currentRoute.value.name).toBe('Dashboard')
    expect(screen.getByRole('heading')).toHaveTextContent('Dashboard')
  })

  test('afterEach runs once per completed navigation, after any redirect, with no router warnings', async () => {
    const warn = vi.spyOn(console, 'warn')
    let allowed = false
    const router = guardedRouter(() => allowed)
    const after = vi.fn()
    router.afterEach((to, from) => after(to.name, from.name ?? null))

    await router.push('/')
    await router.push('/s/happy-blue-otter')
    await router.push('/s/sad-red-fox')
    await router.push('/about')
    await router.push('/dashboard')
    allowed = true
    await router.push('/dashboard')

    expect(after.mock.calls).toEqual([
      ['Home', null],
      ['ShareList', 'Home'],
      ['ShareList', 'ShareList'],
      ['About', 'ShareList'],
      ['NotFound', 'About'],
      ['Dashboard', 'NotFound'],
    ])
    expect(routerWarnings(warn)).toEqual([])
  })
})

describe('options-API in-component guards, as Home.vue uses them', () => {
  /** Names a route for the guard log: its name and share code, or null for the start location. */
  const label = route =>
    route.name === undefined ? null : [route.name, route.params.code].filter(x => x).join(' ')

  test('one component serving / and /s/:code is entered, left, re-entered, updated, then left', async () => {
    const warn = vi.spyOn(console, 'warn')
    const guard = vi.fn()
    const created = vi.fn()
    const HomeStandIn = {
      beforeRouteEnter(to, from, next) {
        guard('enter', label(from), label(to))
        next()
      },
      beforeRouteUpdate(to, from, next) {
        guard('update', label(from), label(to))
        next()
      },
      beforeRouteLeave(to, from, next) {
        // Home.vue reads this.$store here; `this` is the mounted page, still on the old route
        guard('leave', label(from), label(to), this.$route.fullPath)
        next()
      },
      created() {
        created()
      },
      render() {
        return h('h1', label(this.$route))
      },
    }
    const router = memoryRouter({ Home: HomeStandIn, ShareList: HomeStandIn })

    await router.push('/')
    render(App, { global: { plugins: [router] } })
    await settle()
    expect(screen.getByRole('heading')).toHaveTextContent('Home')

    await router.push('/s/happy-blue-otter')
    await settle()
    expect(screen.getByRole('heading')).toHaveTextContent('ShareList happy-blue-otter')

    await router.push('/s/sad-red-fox')
    await settle()
    expect(screen.getByRole('heading')).toHaveTextContent('ShareList sad-red-fox')

    await router.push('/about')
    await settle()
    expect(screen.getByRole('heading')).toHaveTextContent('About')

    expect(guard.mock.calls).toEqual([
      ['enter', null, 'Home'],
      // Home and ShareList are separate route records, so leaving Home runs the leave guard (and
      // Home.vue marks the visit) even though RouterView goes on to reuse the same instance
      ['leave', 'Home', 'ShareList happy-blue-otter', '/'],
      ['enter', 'Home', 'ShareList happy-blue-otter'],
      ['update', 'ShareList happy-blue-otter', 'ShareList sad-red-fox'],
      ['leave', 'ShareList sad-red-fox', 'About', '/s/sad-red-fox'],
    ])
    // Home -> ShareList -> ShareList keeps the mounted instance rather than creating a new one
    expect(created).toHaveBeenCalledTimes(1)
    expect(routerWarnings(warn)).toEqual([])
  })
})

describe('navigation failures', () => {
  test('pushing the current location again resolves to a duplicated failure and still runs afterEach', async () => {
    const router = memoryRouter()
    await router.push('/about')
    const after = vi.fn()
    router.afterEach(after)

    const failure = await router.push('/about')

    expect(isNavigationFailure(failure)).toBe(true)
    expect(isNavigationFailure(failure, NavigationFailureType.duplicated)).toBe(true)
    expect(isNavigationFailure(failure, NavigationFailureType.aborted)).toBe(false)
    expect(failure.type).toBe(NavigationFailureType.duplicated)
    expect(after).toHaveBeenCalledTimes(1)
    expect(after.mock.calls[0][2]).toBe(failure)
  })
})

describe('RouterLink', () => {
  /** Mounts a template of <router-link>s, the way the app's SFC templates use them, at `path`. */
  const renderLinks = async (path, template) => {
    const router = memoryRouter()
    await router.push(path)
    await router.isReady()
    render({ template }, { global: { plugins: [router] } })
    return router
  }

  test('marks the exact current route active and current, and leaves other links unmarked', async () => {
    await renderLinks(
      '/about',
      `<nav>
        <router-link :to="{ name: 'About' }">About</router-link>
        <router-link :to="{ name: 'Home' }">Books</router-link>
        <router-link :to="{ name: 'BookDetail', params: { slug: 'hair-love', isbn: '9780525553366' } }">Hair Love</router-link>
      </nav>`,
    )

    const about = screen.getByRole('link', { name: 'About' })
    expect(about).toHaveAttribute('href', '/about')
    expect(about).toHaveAttribute('aria-current', 'page')
    expect(about).toHaveClass('router-link-active router-link-exact-active', { exact: true })

    const books = screen.getByRole('link', { name: 'Books' })
    expect(books).toHaveAttribute('href', '/')
    expect(books).toHaveClass('', { exact: true })
    expect(books).not.toHaveAttribute('aria-current')

    expect(screen.getByRole('link', { name: 'Hair Love' })).toHaveAttribute(
      'href',
      '/book/hair-love-9780525553366',
    )
  })

  test('a query on the current route does not stop a link to its page being exact-active', async () => {
    await renderLinks(
      '/?filters=lgbtqia',
      `<router-link :to="{ name: 'Home' }">Books</router-link>`,
    )
    expect(screen.getByRole('link', { name: 'Books' })).toHaveClass(
      'router-link-active router-link-exact-active',
      { exact: true },
    )
  })

  test("MainMenu's fallthrough router-link-active class merges with RouterLink's own", async () => {
    const template = `<router-link
      :to="{ name: 'Home' }"
      :class="{ 'router-link-active': $route.name === 'BookDetail' || $route.name === 'BookEdit' }"
    >Books</router-link>`

    await renderLinks('/book/hair-love-9780525553366', template)
    const books = screen.getByRole('link', { name: 'Books' })
    expect(books).toHaveClass('router-link-active', { exact: true })
    expect(books).not.toHaveAttribute('aria-current')
  })

  test('clicking a link pushes its location', async () => {
    const router = await renderLinks(
      '/about',
      `<router-link :to="{ name: 'BookDetail', params: { slug: 'hair-love', isbn: '9780525553366' } }">Hair Love</router-link>`,
    )
    const navigated = nextNavigation(router)
    await fireEvent.click(screen.getByRole('link', { name: 'Hair Love' }))
    const to = await navigated
    expect(to.name).toBe('BookDetail')
    expect(to.params).toEqual({ slug: 'hair-love', isbn: '9780525553366' })
  })
})

describe('scrollBehavior', () => {
  const { scrollBehavior } = appRouter.options

  /** Makes jsdom's window.scrollY report the given offset until the mocks are restored. */
  const scrolledTo = top => vi.spyOn(window, 'scrollY', 'get').mockReturnValue(top)

  test('keeps the scroll position on the same route and scrolls to top on a new one', () => {
    scrolledTo(250)
    const home = appRouter.resolve('/')
    const filtered = appRouter.resolve('/?filters=lgbtqia')
    expect(scrollBehavior(filtered, home, null)).toEqual({ left: 0, top: 250 })
    expect(scrollBehavior(appRouter.resolve('/about'), home, null)).toEqual({ left: 0, top: 0 })
  })

  test('returns a saved back/forward position unchanged', () => {
    scrolledTo(250)
    const savedPosition = { left: 0, top: 900 }
    expect(scrollBehavior(appRouter.resolve('/about'), appRouter.resolve('/'), savedPosition)).toBe(
      savedPosition,
    )
  })

  test('a web-history router calls it on every navigation and scrolls to what it returns', async () => {
    const spy = vi.fn(scrollBehavior)
    const router = createRouter({
      history: createWebHistory(),
      routes: standInRoutes(),
      scrollBehavior: spy,
    })
    /** Summarizes each scrollBehavior call as [to.name, from.name, savedPosition]. */
    const calls = () =>
      spy.mock.calls.map(([to, from, saved]) => [to.name, from.name ?? null, saved])

    try {
      await router.push('/')
      await settle()
      expect(calls()).toEqual([['Home', null, null]])

      scrolledTo(900)
      await router.push('/about')
      await settle()
      expect(calls()).toEqual([
        ['Home', null, null],
        ['About', 'Home', null],
      ])
      expect(window.scrollTo).toHaveBeenLastCalledWith({ left: 0, top: 0 })
      expect(window.location.pathname).toBe('/about')

      // clicking a link to the current page is a duplicate, scrolled as the same page
      await router.push('/about')
      await settle()
      expect(calls().at(-1)).toEqual(['About', 'About', null])
      expect(window.scrollTo).toHaveBeenLastCalledWith({ left: 0, top: 900 })

      // back restores the offset the page had when it was left, not the current one
      scrolledTo(40)
      router.back()
      await vi.waitFor(() => expect(calls()).toHaveLength(4))
      expect(calls().at(-1)).toEqual(['Home', 'About', { left: 0, top: 900 }])
      await settle()
      expect(window.scrollTo).toHaveBeenLastCalledWith({ left: 0, top: 900 })
      expect(window.location.pathname).toBe('/')
    } finally {
      router.options.history.destroy()
      history.replaceState(null, '', '/')
    }
  })
})
