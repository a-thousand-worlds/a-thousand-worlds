/**
 * Characterizes the route table in src/router.js at the seams where it leans on third-party
 * behavior, so a dependency upgrade that changes behavior fails here first:
 * - vue-router: path-to-regexp style parsing (the greedy `:slug(.+)?-:isbn` pattern, the slugless
 * `(.*)` alias and how it ranks against `/edit`, static-before-param ranking, case-insensitive
 * and trailing-slash matching, percent-decoding of params), link generation from named routes,
 * query encoding, meta inheritance through aliases, lazy route components, and the scrollBehavior
 * hook's `{ left, top }` shape.
 * - @sindresorhus/slugify: the slugs the app puts into book and person URLs must survive a round
 * trip through the router. The real slugify runs here, with the same formulas BookDetailLink,
 * PersonDetailLink and PersonEdit use.
 * - vite and @vitejs/plugin-vue: every lazy `import('./pages/X.vue')` in the table, including the
 * extensionless `./pages/ReviewSubmissions/Rejected` and the directory `./pages/ReviewSubmissions`,
 * must still resolve to the same compiled page module a direct import yields.
 */
import slugify from '@sindresorhus/slugify'
import router from '@/router'
import NotFound from '@/pages/NotFound.vue'

// A boundary guard only: nothing below should reach Firebase, and if a page import ever starts to,
// it gets an inert stub rather than a live connection.
vi.mock('@/firebase', () => ({ default: {} }))

/** Resolves a URL or location through the real router and keeps only the name and params. */
const parse = to => {
  const { name, params } = router.resolve(to)
  return { name, params }
}

/** Resolves a location through the real router and returns the URL it generates. */
const link = to => router.resolve(to).fullPath

/** Reads a query parameter back the way Contact.vue does, from the search part of a fullPath. */
const contactField = (fullPath, key) =>
  new URLSearchParams(decodeURI(new URL(fullPath, window.location.origin).search)).get(key)

/** Reads a query parameter back the way the filterable store module does, with no decodeURI. */
const filtersField = (fullPath, key) =>
  new URLSearchParams(new URL(fullPath, window.location.origin).search).get(key)

/** Builds a book slug with the formula BookDetailLink uses: straight apostrophes are dropped. */
const bookSlug = title => slugify(title.replace(/'/g, ''))

describe('parsing book URLs', () => {
  test('a slugged book URL matches the strict path, splitting slug from isbn', () => {
    const route = router.resolve('/book/my-mommy-medicine-9781250140913')
    expect(route.name).toBe('BookDetail')
    expect(route.params).toEqual({ slug: 'my-mommy-medicine', isbn: '9781250140913' })
    expect(route.matched[0].path).toBe('/book/:slug(.+)?-:isbn')
    expect(route.matched[0].aliasOf).toBeUndefined()
  })

  test('a bare isbn matches the slugless alias with an empty slug', () => {
    const route = router.resolve('/book/9781250140913')
    expect(route.name).toBe('BookDetail')
    expect(route.params).toEqual({ slug: '', isbn: '9781250140913' })
    expect(route.matched[0].path).toBe('/book/:slug?/:isbn(.*)')
    expect(route.matched[0].aliasOf.path).toBe('/book/:slug(.+)?-:isbn')
  })

  test('a leading dash, which a slugless named link generates, matches the strict path', () => {
    const route = router.resolve('/book/-9781250140913')
    expect(parse('/book/-9781250140913')).toEqual({
      name: 'BookDetail',
      params: { slug: '', isbn: '9781250140913' },
    })
    expect(route.matched[0].path).toBe('/book/:slug(.+)?-:isbn')
    expect(route.matched[0].aliasOf).toBeUndefined()
  })

  test('the greedy slug splits at the last dash', () => {
    expect(parse('/book/a-b-c-123')).toEqual({
      name: 'BookDetail',
      params: { slug: 'a-b-c', isbn: '123' },
    })
    expect(parse('/book/the-bear-and-the-moon-145217191X')).toEqual({
      name: 'BookDetail',
      params: { slug: 'the-bear-and-the-moon', isbn: '145217191X' },
    })
  })

  test('a slug in its own segment matches the alias', () => {
    const route = router.resolve('/book/slug/9781250140913')
    expect(route.name).toBe('BookDetail')
    expect(route.params).toEqual({ slug: 'slug', isbn: '9781250140913' })
    expect(route.matched[0].aliasOf.path).toBe('/book/:slug(.+)?-:isbn')
  })

  test('a trailing slash still matches the strict path', () => {
    const route = router.resolve('/book/my-book-123/')
    expect(route.name).toBe('BookDetail')
    expect(route.params).toEqual({ slug: 'my-book', isbn: '123' })
    expect(route.matched[0].path).toBe('/book/:slug(.+)?-:isbn')
  })

  test('a slugged edit URL matches BookEdit on the strict path', () => {
    const route = router.resolve('/book/my-mommy-medicine-9781250140913/edit')
    expect(route.name).toBe('BookEdit')
    expect(route.params).toEqual({ slug: 'my-mommy-medicine', isbn: '9781250140913' })
    expect(route.matched[0].path).toBe('/book/:slug(.+)?-:isbn/edit')
    expect(route.matched[0].aliasOf).toBeUndefined()
  })

  test('a bare isbn edit URL ranks BookEdit above the greedy BookDetail alias', () => {
    const route = router.resolve('/book/9781250140913/edit')
    expect(route.name).toBe('BookEdit')
    expect(route.params).toEqual({ slug: '', isbn: '9781250140913' })
    expect(route.matched[0].path).toBe('/book/:slug?/:isbn(.*)/edit')
    expect(route.matched[0].aliasOf.path).toBe('/book/:slug(.+)?-:isbn/edit')
  })

  test('the BookEdit alias inherits the owner-only meta of the path it aliases', () => {
    expect(router.resolve('/book/9781250140913/edit').meta.access).toBe('owner')
    expect(router.resolve('/book/my-mommy-medicine-9781250140913/edit').meta.access).toBe('owner')
  })
})

describe('parsing other URLs', () => {
  test.each([
    ['/person/matthew-burgess', 'PersonDetail', { name: 'matthew-burgess' }],
    ['/person/matthew-burgess/edit', 'PersonEdit', { name: 'matthew-burgess' }],
    ['/s/abc123', 'ShareList', { code: 'abc123' }],
    ['/admin/review/books', 'ReviewSubmissions', { type: 'books' }],
    ['/admin/review/books/rejected', 'ReviewRejectedSubmissions', { type: 'books' }],
    ['/admin/bundles/update/xyz', 'BundleManagerUpdateForm', { bid: 'xyz' }],
    ['/suggest/book/thankyou', 'SubmissionThankYou', { type: 'book' }],
    ['/nope/deep/path', 'NotFound', { catchAll: 'nope/deep/path' }],
    ['/person/x/y', 'NotFound', { catchAll: 'person/x/y' }],
  ])('%s resolves to %s', (url, name, params) => {
    expect(parse(url)).toEqual({ name, params })
  })

  test('a percent-encoded person name is decoded into the param', () => {
    expect(parse('/person/jos%C3%A9')).toEqual({
      name: 'PersonDetail',
      params: { name: 'josé' },
    })
  })

  test('a static segment outranks a param in the same position', () => {
    expect(parse('/admin/bundles/add')).toEqual({ name: 'BundleManagerNewForm', params: {} })
  })

  test('paths match case-insensitively', () => {
    const route = router.resolve('/About')
    expect(route.name).toBe('About')
    expect(route.matched[0].path).toBe('/about')
  })
})

describe('generating links', () => {
  test('a slugged book link joins slug and isbn with a dash', () => {
    expect(
      link({ name: 'BookDetail', params: { isbn: '9781250140913', slug: 'my-mommy-medicine' } }),
    ).toBe('/book/my-mommy-medicine-9781250140913')
  })

  test('an empty or omitted slug leaves a leading dash', () => {
    expect(link({ name: 'BookDetail', params: { isbn: '9781250140913', slug: '' } })).toBe(
      '/book/-9781250140913',
    )
    expect(link({ name: 'BookDetail', params: { isbn: '9781250140913' } })).toBe(
      '/book/-9781250140913',
    )
  })

  test('book edit links append /edit to the same shape', () => {
    expect(
      link({ name: 'BookEdit', params: { isbn: '9781250140913', slug: 'my-mommy-medicine' } }),
    ).toBe('/book/my-mommy-medicine-9781250140913/edit')
    expect(link({ name: 'BookEdit', params: { isbn: '9781250140913', slug: '' } })).toBe(
      '/book/-9781250140913/edit',
    )
  })

  test('an isbn ending in X keeps it in href', () => {
    expect(
      router.resolve({ name: 'BookDetail', params: { isbn: '145217191X', slug: 'the-bear' } }).href,
    ).toBe('/book/the-bear-145217191X')
  })

  test('person and thank-you links fill their params', () => {
    expect(link({ name: 'PersonDetail', params: { name: 'matthew-burgess' } })).toBe(
      '/person/matthew-burgess',
    )
    expect(link({ name: 'SubmissionThankYou', params: { type: 'book' } })).toBe(
      '/suggest/book/thankyou',
    )
  })

  test('a non-ASCII person param is percent-encoded and decodes back', () => {
    const url = link({ name: 'PersonDetail', params: { name: 'josé' } })
    expect(url).toBe('/person/jos%C3%A9')
    expect(parse(url).params).toEqual({ name: 'josé' })
  })

  test('generating slugless book links emits no vue-router warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      link({ name: 'BookDetail', params: { isbn: '9781250140913' } })
      link({ name: 'BookEdit', params: { isbn: '9781250140913' } })
      link({ name: 'BookDetail', params: router.resolve('/book/9781250140913').params })
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

describe('switching between detail and edit with the current params', () => {
  test('BookDetail shift-click on a bare-isbn URL edits through the slugless shape', () => {
    const { params } = router.resolve('/book/9781250140913')
    expect(link({ name: 'BookEdit', params })).toBe('/book/-9781250140913/edit')
  })

  test('BookDetail shift-click on a slugged URL keeps the slug', () => {
    const { params } = router.resolve('/book/x-1')
    expect(link({ name: 'BookEdit', params })).toBe('/book/x-1/edit')
  })

  test('BookEdit back to detail keeps the slug, or the leading dash without one', () => {
    expect(link({ name: 'BookDetail', params: router.resolve('/book/x-1/edit').params })).toBe(
      '/book/x-1',
    )
    expect(
      link({ name: 'BookDetail', params: router.resolve('/book/9781250140913/edit').params }),
    ).toBe('/book/-9781250140913')
  })

  test("BookDetailLink's editOnClick spread swaps the name and keeps the params", () => {
    const route = { name: 'BookDetail', params: { isbn: '9781250140913', slug: 'x' } }
    expect(link({ ...route, name: 'BookEdit' })).toBe('/book/x-9781250140913/edit')
  })

  test('PersonDetail and PersonEdit round trip a decoded name param', () => {
    const { params } = router.resolve('/person/jos%C3%A9')
    const editUrl = link({ name: 'PersonEdit', params })
    expect(editUrl).toBe('/person/jos%C3%A9/edit')
    expect(link({ name: 'PersonDetail', params: router.resolve(editUrl).params })).toBe(
      '/person/jos%C3%A9',
    )
  })
})

describe('slug round trips with the real slugify', () => {
  const isbn = '9780316562584'

  test('a title with an apostrophe and punctuation', () => {
    const slug = bookSlug("Don't Touch My Hair!")
    expect(slug).toBe('dont-touch-my-hair')
    const url = link({ name: 'BookDetail', params: { isbn, slug } })
    expect(url).toBe('/book/dont-touch-my-hair-9780316562584')
    expect(parse(url)).toEqual({ name: 'BookDetail', params: { slug, isbn } })
  })

  test('a title with digits and commas keeps its digits in the slug', () => {
    const slug = bookSlug('1, 2, 3 Count With Me')
    expect(slug).toBe('1-2-3-count-with-me')
    const url = link({ name: 'BookDetail', params: { isbn, slug } })
    expect(url).toBe('/book/1-2-3-count-with-me-9780316562584')
    expect(parse(url).params).toEqual({ slug: '1-2-3-count-with-me', isbn })
  })

  test('a title that slugifies to nothing still links to the isbn', () => {
    const slug = bookSlug('!!!')
    expect(slug).toBe('')
    const url = link({ name: 'BookDetail', params: { isbn, slug } })
    expect(url).toBe('/book/-9780316562584')
    expect(parse(url)).toEqual({ name: 'BookDetail', params: { slug: '', isbn } })
  })

  test('PersonEdit rewrites the URL with a slugified name, apostrophes becoming dashes', () => {
    const name = slugify("Da'Shawn O'Neal")
    expect(name).toBe('da-shawn-o-neal')
    expect(link({ name: 'PersonEdit', params: { name } })).toBe('/person/da-shawn-o-neal/edit')
  })

  test('PersonDetailLink transliterates diacritics, so the URL needs no percent-encoding', () => {
    const name = slugify('José Martí')
    expect(name).toBe('jose-marti')
    const url = link({ name: 'PersonDetail', params: { name } })
    expect(url).toBe('/person/jose-marti')
    expect(parse(url)).toEqual({ name: 'PersonDetail', params: { name: 'jose-marti' } })
  })
})

describe('query encoding', () => {
  test.each([
    [
      'Nominate BIPOC Leader(s) to A Thousand Worlds',
      '/contact?subject=Nominate+BIPOC+Leader(s)+to+A+Thousand+Worlds',
    ],
    [
      'I am a BIPOC Leader in the book industry',
      '/contact?subject=I+am+a+BIPOC+Leader+in+the+book+industry',
    ],
  ])('the Support page subject %j prefills Contact intact', (subject, expected) => {
    const url = link({ name: 'Contact', query: { subject } })
    expect(url).toBe(expected)
    expect(router.resolve(url).query.subject).toBe(subject)
    expect(contactField(url, 'subject')).toBe(subject)
  })

  test('plus and ampersand are percent-encoded and survive the Contact parse', () => {
    const url = link({ name: 'Contact', query: { email: 'a+b@x.com', from: 'Ana & Bo' } })
    expect(url).toBe('/contact?email=a%2Bb@x.com&from=Ana+%26+Bo')
    expect(router.resolve(url).query).toEqual({ email: 'a+b@x.com', from: 'Ana & Bo' })
    expect(contactField(url, 'email')).toBe('a+b@x.com')
    expect(contactField(url, 'from')).toBe('Ana & Bo')
  })

  test('a TagsManager tab query is written plainly', () => {
    expect(link({ name: 'TagsManager', query: { active: 'people' } })).toBe(
      '/admin/tags?active=people',
    )
  })

  test('filter queries keep commas and slashes literal and read back unchanged', () => {
    const multi = link({ name: 'Home', query: { filters: 'lgbtqia,picture-book' } })
    expect(multi).toBe('/?filters=lgbtqia,picture-book')
    expect(filtersField(multi, 'filters')).toBe('lgbtqia,picture-book')

    const submenu = link({ name: 'Home', query: { filters: 'fantasy-fable/sub' } })
    expect(submenu).toBe('/?filters=fantasy-fable/sub')
    expect(filtersField(submenu, 'filters')).toBe('fantasy-fable/sub')
  })

  test('an empty query adds no question mark', () => {
    expect(link({ name: 'Home', query: {} })).toBe('/')
  })
})

describe('route meta', () => {
  test.each(['/dashboard', '/profile', '/account'])('%s requires any signed-in user', url => {
    expect(router.resolve(url).meta.access).toBe('authorized')
  })

  test.each([
    ['/suggest/book/thankyou', ['contributor', 'creator', 'advisor', 'owner']],
    ['/suggest/book', ['contributor', 'advisor', 'owner']],
    ['/suggest/bundle', ['contributor', 'advisor', 'owner']],
    ['/suggest/people', ['creator', 'advisor', 'owner']],
    ['/admin/email-templates', ['advisor', 'owner']],
    ['/admin/invitation-manager', ['advisor', 'owner']],
    ['/admin/review/books', ['advisor', 'owner']],
    ['/admin/review/books/rejected', ['advisor', 'owner']],
  ])('%s is open to %j', (url, roles) => {
    expect(router.resolve(url).meta.access).toEqual(roles)
  })

  test.each([
    '/admin/tags',
    '/admin/people',
    '/admin/books',
    '/admin/bundles',
    '/admin/bundles/add',
    '/admin/bundles/update/x',
    '/person/x/edit',
    '/book/x-1/edit',
  ])('%s is owner-only', url => {
    expect(router.resolve(url).meta.access).toBe('owner')
  })

  test.each(['/social-image', '/social-people'])('%s renders without the layout', url => {
    expect(router.resolve(url).meta).toEqual({ noLayout: true })
  })

  test.each([
    '/',
    '/s/x',
    '/book/x-1',
    '/book/9781250140913',
    '/person/x',
    '/people',
    '/bundles',
    '/support',
    '/about',
    '/contact',
    '/login',
    '/signup',
    '/password-reset',
    '/nope',
  ])('%s is public', url => {
    expect(router.resolve(url).meta.access).toBeUndefined()
    expect(router.resolve(url).meta.noLayout).toBeUndefined()
  })
})

describe('route components', () => {
  beforeEach(() => {
    // Support.vue reports missing PayPal env vars at import; that noise is not under test
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test.each([
    ['/', () => import('@/pages/Home.vue')],
    ['/s/x', () => import('@/pages/Home.vue')],
    ['/social-image', () => import('@/pages/SocialImage.vue')],
    ['/social-people', () => import('@/pages/SocialPeople.vue')],
    ['/bundles', () => import('@/pages/Bundles.vue')],
    ['/people', () => import('@/pages/People.vue')],
    ['/book/x-1', () => import('@/pages/BookDetail.vue')],
    ['/book/9781250140913', () => import('@/pages/BookDetail.vue')],
    ['/person/x', () => import('@/pages/PersonDetail.vue')],
    ['/support', () => import('@/pages/Support.vue')],
    ['/about', () => import('@/pages/About.vue')],
    ['/contact', () => import('@/pages/Contact.vue')],
    ['/login', () => import('@/pages/Login.vue')],
    ['/password-reset', () => import('@/pages/PasswordReset.vue')],
    ['/signup', () => import('@/pages/Login.vue')],
    ['/dashboard', () => import('@/pages/Dashboard.vue')],
    ['/profile', () => import('@/pages/PublicProfile.vue')],
    ['/account', () => import('@/pages/Login.vue')],
    ['/suggest/book/thankyou', () => import('@/pages/SubmissionThankYou.vue')],
    ['/suggest/book', () => import('@/pages/BookSubmissionForm.vue')],
    ['/suggest/bundle', () => import('@/pages/BundleSubmissionForm.vue')],
    ['/suggest/people', () => import('@/pages/PeopleSubmissionForm.vue')],
    ['/admin/tags', () => import('@/pages/TagsManager.vue')],
    ['/admin/people', () => import('@/pages/PeopleManager.vue')],
    ['/person/x/edit', () => import('@/pages/PersonEdit.vue')],
    ['/book/x-1/edit', () => import('@/pages/BookEdit.vue')],
    ['/book/9781250140913/edit', () => import('@/pages/BookEdit.vue')],
    ['/admin/books', () => import('@/pages/BooksManager.vue')],
    ['/admin/bundles', () => import('@/pages/BundlesManager.vue')],
    ['/admin/bundles/update/x', () => import('@/pages/BundleManagerForm.vue')],
    ['/admin/bundles/add', () => import('@/pages/BundleManagerForm.vue')],
    ['/admin/email-templates', () => import('@/pages/EmailTemplates.vue')],
    ['/admin/invitation-manager', () => import('@/pages/InvitationManager.vue')],
    // a directory import, resolved to its index.vue
    ['/admin/review/books', () => import('@/pages/ReviewSubmissions/index.vue')],
    // an extensionless import
    ['/admin/review/books/rejected', () => import('@/pages/ReviewSubmissions/Rejected.vue')],
  ])('%s lazily loads its page module', async (url, direct) => {
    const lazy = router.resolve(url).matched[0].components.default
    expect(typeof lazy).toBe('function')
    const loaded = await lazy()
    expect(loaded.default).toBe((await direct()).default)
  })

  test('NotFound is imported statically, not lazily', () => {
    expect(router.resolve('/nope').matched[0].components.default).toBe(NotFound)
  })
})

describe('scrollBehavior', () => {
  const { scrollBehavior } = router.options

  /** Makes jsdom's window.scrollY report the given offset until the mocks are restored. */
  const scrollTo = top => vi.spyOn(window, 'scrollY', 'get').mockReturnValue(top)

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('a saved position from back/forward is returned unchanged', () => {
    const savedPosition = { left: 3, top: 400 }
    expect(
      scrollBehavior(router.resolve('/about'), router.resolve('/contact'), savedPosition),
    ).toBe(savedPosition)
  })

  test('a new page scrolls to the top, however far the old one was scrolled', () => {
    scrollTo(250)
    expect(scrollBehavior(router.resolve('/about'), router.resolve('/contact'), null)).toEqual({
      left: 0,
      top: 0,
    })
  })

  test('the same page keeps the current scroll position', () => {
    const to = router.resolve('/?filters=lgbtqia')
    const from = router.resolve('/')
    expect(scrollBehavior(to, from, null)).toEqual({ left: 0, top: 0 })
    scrollTo(250)
    expect(scrollBehavior(to, from, null)).toEqual({ left: 0, top: 250 })
  })

  test('the same route name with different params counts as the same page', () => {
    scrollTo(250)
    expect(scrollBehavior(router.resolve('/book/a-1'), router.resolve('/book/b-2'), null)).toEqual({
      left: 0,
      top: 250,
    })
  })
})
