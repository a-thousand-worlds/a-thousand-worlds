/**
 * PersonDetail page characterization tests. Seams guarded:
 *
 * Slugify (@sindresorhus/slugify 1.x): the person is found by comparing slugify(name) with the
 * :name param (apostrophes split words, even a word-final 's that slugify 3.x contracts,
 * camelCase is split, diacritics transliterate, ö becomes oe, & becomes and), and
 * PersonDetailLink, CreatorsWidget and Tag build their URLs with it too.
 *
 * Router (vue-router 4): '/person/:name' matching (trailing slash, case), param decoding,
 * named-route pushes with params and query, the in-component beforeRouteLeave guard, component
 * reuse between people, and the RouterLink href inside NotFound. getPerson() reads the head's
 * person from router.currentRoute._value: that is Vue's ref internals, reached through
 * vue-router's currentRoute shallowRef, not a router API, and only its presence and its value at
 * mount and on store changes are pinned.
 *
 * Head (@vueuse/head 0.9): document.title and the og:/twitter: meta tags from computed refs.
 * Also lodash debounce for the application/ld+json structured data written after render; vue 3.5
 * for <teleport>, :innerHTML, dynamic :style and window key listeners; and jsdom for the DOM,
 * style declarations and events all of the above render into.
 *
 * Every test fails on any console.warn other than the page's own missing-title warning, so a
 * deprecation warning from an upgraded Vue, vue-router or @vueuse/head surfaces here.
 */
import { h } from 'vue'
import { RouterView } from 'vue-router'
// eslint-disable-next-line testing-library/no-manual-cleanup -- see afterEach
import { render, fireEvent, within, cleanup } from '@testing-library/vue'
import { createHead } from '@vueuse/head'
import router from '@/router'
import store from '@/store'
import mixins from '@/mixins/global'
import directives from '@/directives'
import PersonDetail from '@/pages/PersonDetail.vue'

// nothing on this page should reach Firebase; fail loudly if something tries
vi.mock('@/firebase', () => ({
  default: {
    database: () => {
      throw new Error('PersonDetail tests must not reach Firebase')
    },
  },
}))

// vite imports .svg as a URL string, which Vue cannot create an element from
vi.mock('@/assets/icons/bookmark.svg', async () => {
  const { h: hMock } = await import('vue')
  return { default: { render: () => hMock('svg') } }
})

const MISSING_TITLE_WARNING = 'Missing titles. Defaulting to Author.'
const P1_TITLE = "Da'Shawn O'Neal @ A Thousand Worlds"
const P1_DESCRIPTION = "Read books by Da'Shawn O'Neal at A Thousand Worlds"

const people = {
  p1: {
    id: 'p1',
    name: "Da'Shawn O'Neal",
    title: 'author-illustrator',
    pronouns: 'they',
    identities: { i1: true, gone: true },
    bio: "Da'Shawn O'Neal writes books.",
    website: 'https://dashawn.example',
    photo: { url: 'https://x/p1.jpg' },
  },
  p2: {
    id: 'p2',
    name: 'LeUyen Pham',
    title: 'nope',
    identities: { i2: true },
    bio: 'LeUyen Pham draws pictures.',
    photo: '/img/p2.png',
  },
  p3: { id: 'p3', name: 'José Rodríguez', photo: { url: '/relative.png' } },
  p4: { id: 'p4', name: 'Björk' },
  p5: { id: 'p5', name: 'Kwame Mbalia & Friends', title: 'author' },
  p6: { id: 'p6', name: "Conway's Studio", title: 'illustrator' },
}

const peopleTags = {
  i1: { id: 'i1', tag: 'Black', showOnFront: true, sortOrder: 1 },
  i2: { id: 'i2', tag: 'Asian & Pacific Islander', showOnFront: true, sortOrder: 2 },
}

const books = {
  b1: { id: 'b1', isbn: '1', title: 'By creators', creators: { p1: 'author', p3: 'illustrator' } },
  b2: { id: 'b2', isbn: '2', title: 'By authors array', authors: ["Da'Shawn O'Neal"] },
  b3: { id: 'b3', isbn: '3', title: 'Other', creators: { p2: 'illustrator' } },
  b4: { id: 'b4', isbn: '4', title: 'By illustrators array', illustrators: ['Björk'] },
}

/** Global mount config: the real store, router singleton, a fresh head, mixins and directives. */
const globalConfig = () => ({
  plugins: [store, router, createHead()],
  mixins: [mixins],
  directives: { ...directives, tippy: () => {} },
})

/** Navigates the real router to a url, then renders PersonDetail directly. */
const renderAt = async url => {
  await router.push(url)
  return render(PersonDetail, { global: globalConfig() })
}

/** Navigates the real router to a url, then renders it through a RouterView, as App.vue does. */
const renderRouterViewAt = async url => {
  await router.push(url)
  return render({ render: () => h(RouterView) }, { global: globalConfig() })
}

/** A Testing Library text matcher that selects elements by CSS selector, for unlabeled markup. */
const bySelector = selector => (content, element) => element.matches(selector)

/** Gets the first element in the document head matching a selector. */
const headElement = selector =>
  // eslint-disable-next-line testing-library/no-node-access -- the head is outside Testing Library's queries
  document.head.querySelector(selector)

/** Gets the content attribute of a <meta name="..."> tag in the document head. */
const metaContent = name => headElement(`meta[name="${name}"]`)?.getAttribute('content')

/** Parses the application/ld+json script in the document head, or null if it is missing. */
const structuredData = () => {
  const script = headElement('script[type="application/ld+json"]')
  return script ? JSON.parse(script.textContent) : null
}

/**
 * Gets an element's raw style attribute. toHaveStyle parses both the expected and the actual value
 * with jsdom's cssstyle, so a value that cssstyle rejected would compare '' with '' and pass; the
 * raw attribute shows the value was really written.
 */
const styleAttribute = element => element.getAttribute('style')

/** Gets the titles of the books listed on the page, in order. */
const listedBooks = utils =>
  utils.queryAllByRole('heading', { level: 3 }).map(heading => heading.textContent)

/** Gets the anchor holding the person's name inside the h1. */
const nameLink = utils =>
  within(utils.getByRole('heading', { level: 1 })).getByText(bySelector('a'))

/** Sets the order PrevNext walks. The store is not strict, so shuffled is assigned directly. */
const setPeopleOrder = ids => {
  store.state.people.shuffled = ids.map(id => store.state.people.data[id])
}

/** Sets the logged in user with the given roles. */
const setRoles = roles => store.commit('user/setUser', { uid: 'u1', roles, profile: {} })

let menu = null
let warn = null

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  document.title = ''
  // a previous test's debounced ld+json write can still land after the head is cleared, so empty
  // the fields this page writes, and only this test's own writes can fill them back in
  store.commit('structuredData/set', { path: 'headline', value: undefined })
  store.commit('structuredData/set', { path: 'description', value: undefined })
  store.commit('structuredData/set', { path: 'image.url', value: undefined })
  document.head.innerHTML = ''
  menu = document.createElement('div')
  menu.id = 'people-filter-menu'
  document.body.appendChild(menu)
  store.commit('people/set', people)
  store.commit('tags/people/set', peopleTags)
  store.commit('books/set', books)
  store.commit('ui/setLastVisited', undefined)
})

afterEach(() => {
  // unmount now rather than in Testing Library's own afterEach, which runs after this one, so
  // warnings raised on unmount are still recorded by the spy
  cleanup()
  const unexpectedWarnings = warn.mock.calls.filter(
    ([message]) => message !== MISSING_TITLE_WARNING,
  )
  menu.remove()
  store.commit('people/reset')
  store.commit('people/resetFilters')
  store.state.people.shuffled = []
  store.commit('books/reset')
  store.commit('tags/people/reset')
  store.commit('user/setUser', null)
  vi.restoreAllMocks()
  vi.useRealTimers()
  // asserted last, so a failure here still leaves the store and mocks reset for the next test
  expect(unexpectedWarnings).toEqual([])
})

describe('slug lookup', () => {
  test.each([
    // apostrophes split words
    ['/person/da-shawn-o-neal', 'da-shawn-o-neal', 'p1', "Da'Shawn O'Neal"],
    // a word-final 's is split off too; slugify 3.x contracts it to conways-studio
    ['/person/conway-s-studio', 'conway-s-studio', 'p6', "Conway's Studio"],
    // camelCase is split into words
    ['/person/le-uyen-pham', 'le-uyen-pham', 'p2', 'LeUyen Pham'],
    // diacritics are transliterated to ASCII
    ['/person/jose-rodriguez', 'jose-rodriguez', 'p3', 'José Rodríguez'],
    // ö is transliterated to oe, not o
    ['/person/bjoerk', 'bjoerk', 'p4', 'Björk'],
    // & is replaced by "and"
    [
      '/person/kwame-mbalia-and-friends',
      'kwame-mbalia-and-friends',
      'p5',
      'Kwame Mbalia & Friends',
    ],
    // a trailing slash still matches the route
    ['/person/da-shawn-o-neal/', 'da-shawn-o-neal', 'p1', "Da'Shawn O'Neal"],
    // percent-encoded ASCII is decoded before the comparison
    ['/person/da%2Dshawn-o-neal', 'da-shawn-o-neal', 'p1', "Da'Shawn O'Neal"],
  ])('%s decodes to name %s and renders %s', async (url, param, id, name) => {
    const utils = await renderAt(url)
    expect(router.currentRoute.value.name).toBe('PersonDetail')
    expect(router.currentRoute.value.params).toEqual({ name: param })
    expect(utils.getByRole('heading', { level: 1 })).toHaveTextContent(name)
    expect(utils.getByText(bySelector('[data-person-id]'))).toHaveAttribute('data-person-id', id)
    expect(utils.queryByText('Oops... Page Not Found')).not.toBeInTheDocument()
  })

  test.each([
    // apostrophes are not simply dropped
    ['/person/dashawn-oneal', 'dashawn-oneal'],
    // not even a possessive 's, which slugify 3.x drops
    ['/person/conways-studio', 'conways-studio'],
    // the decoded non-ASCII param never equals ASCII slugify output
    ['/person/jos%C3%A9-rodr%C3%ADguez', 'josé-rodríguez'],
    // ö must be written oe
    ['/person/bjork', 'bjork'],
    // the route matches regardless of case, but the slug comparison is exact
    ['/person/Da-Shawn-O-Neal', 'Da-Shawn-O-Neal'],
  ])('%s decodes to name %s and renders NotFound', async (url, param) => {
    const utils = await renderAt(url)
    expect(router.currentRoute.value.name).toBe('PersonDetail')
    expect(router.currentRoute.value.params).toEqual({ name: param })
    expect(utils.getByRole('heading', { level: 1 })).toHaveTextContent('Oops... Page Not Found')
    expect(utils.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/')
    expect(utils.queryByText(bySelector('[data-person-id]'))).not.toBeInTheDocument()
  })

  test('before people are loaded the Loader renders instead of NotFound', async () => {
    store.commit('people/reset')
    const utils = await renderAt('/person/da-shawn-o-neal')
    expect(utils.queryAllByText(bySelector('.loading-spinner'))).toHaveLength(1)
    expect(utils.queryByText('Oops... Page Not Found')).not.toBeInTheDocument()
    expect(utils.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
  })

  test('the page and the head fill in once people load after mount', async () => {
    store.commit('people/reset')
    const utils = await renderAt('/person/da-shawn-o-neal')
    expect(utils.queryAllByText(bySelector('.loading-spinner'))).toHaveLength(1)

    store.commit('people/set', people)
    expect(await utils.findByRole('heading', { level: 1 })).toHaveTextContent("Da'Shawn O'Neal")
    expect(utils.queryByText(bySelector('.loading-spinner'))).not.toBeInTheDocument()
    await vi.waitFor(() => expect(document.title).toBe(P1_TITLE))
  })
})

describe('head via @vueuse/head', () => {
  test('sets the document title and the og/twitter title, description and image meta', async () => {
    await renderAt('/person/da-shawn-o-neal')
    await vi.waitFor(() => expect(document.title).toBe(P1_TITLE))
    expect(metaContent('og:title')).toBe(P1_TITLE)
    expect(metaContent('twitter:title')).toBe(P1_TITLE)
    expect(metaContent('og:description')).toBe(P1_DESCRIPTION)
    expect(metaContent('twitter:description')).toBe(P1_DESCRIPTION)
    expect(metaContent('og:image')).toBe('https://x/p1.jpg')
    expect(metaContent('twitter:image')).toBe('https://x/p1.jpg')
  })

  test('a string photo is used as-is for the image meta, even when it is relative', async () => {
    await renderAt('/person/le-uyen-pham')
    await vi.waitFor(() => expect(document.title).toBe('LeUyen Pham @ A Thousand Worlds'))
    expect(metaContent('og:image')).toBe('/img/p2.png')
    expect(metaContent('twitter:image')).toBe('/img/p2.png')
    expect(metaContent('og:description')).toBe('Read books by LeUyen Pham at A Thousand Worlds')
  })

  test('the ld+json headline, description and image match the head after the debounce', async () => {
    await renderAt('/person/da-shawn-o-neal')
    await vi.waitFor(() => expect(structuredData()?.headline).toBe(P1_TITLE))
    const data = structuredData()
    expect(data.description).toBe(P1_DESCRIPTION)
    expect(data.image).toEqual({ '@type': 'ImageObject', url: 'https://x/p1.jpg' })
    expect(data['@type']).toBe('NewsArticle')
  })
})

describe('person details', () => {
  test('renders title, pronouns, known identity tags and a photo for a complete person', async () => {
    const utils = await renderAt('/person/da-shawn-o-neal')
    expect(utils.getByText(bySelector('.title-container .name'))).toHaveTextContent(
      'Author/Illustrator',
    )
    expect(utils.getByText(bySelector('.prounouns'))).toHaveTextContent('They/Them/Theirs')
    const tagButtons = within(utils.getByText(bySelector('.tags'))).getAllByRole('button')
    expect(tagButtons.map(button => button.textContent)).toEqual(['Black'])
    const cover = utils.getByText(bySelector('.cover-photo'))
    expect(cover).toHaveStyle({ backgroundImage: 'url(https://x/p1.jpg)', cursor: 'default' })
    expect(styleAttribute(cover)).toContain('https://x/p1.jpg')
    expect(warn).not.toHaveBeenCalledWith(MISSING_TITLE_WARNING)
  })

  test('the first mention of the name in the bio links to the website', async () => {
    const utils = await renderAt('/person/da-shawn-o-neal')
    expect(utils.getByText(bySelector('.person-bio')).innerHTML).toBe(
      '<a href="https://dashawn.example" target="_blank">Da\'Shawn O\'Neal</a> writes books.',
    )
  })

  test('an unknown title falls back to Author with a warning, and the bio stays raw', async () => {
    const utils = await renderAt('/person/le-uyen-pham')
    expect(utils.getByText(bySelector('.title-container .name'))).toHaveTextContent(/^Author$/)
    expect(warn).toHaveBeenCalledWith(MISSING_TITLE_WARNING)
    expect(utils.queryByText(bySelector('.prounouns'))).not.toBeInTheDocument()
    expect(utils.getByText(bySelector('.person-bio')).innerHTML).toBe('LeUyen Pham draws pictures.')
    const cover = utils.getByText(bySelector('.cover-photo'))
    expect(cover).toHaveStyle({ backgroundImage: 'url(/img/p2.png)' })
    expect(styleAttribute(cover)).toContain('/img/p2.png')
  })

  test.each([
    ['/person/jose-rodriguez', 'p3', 'a relative photo url'],
    ['/person/bjoerk', 'p4', 'no photo'],
  ])('%s (%s) with %s renders no cover photo and no bio', async (url, id) => {
    const utils = await renderAt(url)
    expect(utils.getByText(bySelector('[data-person-id]'))).toHaveAttribute('data-person-id', id)
    expect(utils.queryByText(bySelector('.cover-photo'))).not.toBeInTheDocument()
    expect(utils.queryByText(bySelector('.person-bio'))).not.toBeInTheDocument()
  })

  test('the people filter menu is teleported into #people-filter-menu', async () => {
    const utils = await renderAt('/person/da-shawn-o-neal')
    expect(within(utils.container).queryByRole('complementary')).not.toBeInTheDocument()
    const filterMenu = within(menu).getByRole('complementary')
    expect(
      within(filterMenu)
        .getAllByRole('button')
        .map(button => button.textContent),
    ).toEqual(['Author', 'Illustrator', 'Author/Illustrator', 'Black', 'Asian & Pacific Islander'])
  })
})

describe('books listing', () => {
  test.each([
    ['/person/da-shawn-o-neal', 'p1', ['By creators', 'By authors array']],
    ['/person/le-uyen-pham', 'p2', ['Other']],
    ['/person/jose-rodriguez', 'p3', ['By creators']],
    ['/person/bjoerk', 'p4', ['By illustrators array']],
    ['/person/kwame-mbalia-and-friends', 'p5', []],
  ])('%s renders %s and lists %j', async (url, id, titles) => {
    const utils = await renderAt(url)
    // NotFound lists no books either, so an empty list only counts once the person is found
    expect(utils.getByText(bySelector('[data-person-id]'))).toHaveAttribute('data-person-id', id)
    expect(listedBooks(utils)).toEqual(titles)
  })
})

describe('links built from slugs', () => {
  test('the person is plain text in their own books, and co-creators link to their page', async () => {
    const utils = await renderAt('/person/da-shawn-o-neal')
    const names = utils.getAllByText(bySelector('.creators-widget .name'))
    expect(names.map(el => [el.tagName, el.textContent])).toEqual([
      ['SPAN', "Da'Shawn O'Neal"],
      ['A', 'José Rodríguez'],
    ])

    await fireEvent.click(names[1])
    await vi.waitFor(() =>
      expect(router.currentRoute.value.fullPath).toBe('/person/jose-rodriguez'),
    )
    expect(await utils.findByRole('heading', { level: 1 })).toHaveTextContent('José Rodríguez')
  })

  test('Next Person and Previous Person navigate to the slugs of the neighbors', async () => {
    setPeopleOrder(['p4', 'p1', 'p3'])
    const utils = await renderAt('/person/da-shawn-o-neal')
    expect(utils.getAllByText('< Previous Person')).toHaveLength(2)

    await fireEvent.click(utils.getAllByText('Next Person >')[0])
    await vi.waitFor(() =>
      expect(router.currentRoute.value.fullPath).toBe('/person/jose-rodriguez'),
    )
    expect(utils.getByRole('heading', { level: 1 })).toHaveTextContent('José Rodríguez')

    await router.push('/person/da-shawn-o-neal')
    await fireEvent.click(utils.getAllByText('< Previous Person')[1])
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/person/bjoerk'))
    expect(utils.getByRole('heading', { level: 1 })).toHaveTextContent('Björk')
  })

  test('an identity tag sets the people filter and pushes its slug as the filters query', async () => {
    const utils = await renderAt('/person/le-uyen-pham')
    const push = vi.spyOn(router, 'push').mockResolvedValue()
    await fireEvent.click(within(utils.getByText(bySelector('.tags'))).getByText(/Pacific/))

    const route = { name: 'People', query: { filters: 'asian-and-pacific-islander' } }
    expect(push.mock.calls).toEqual([[route]])
    expect(router.resolve(route).fullPath).toBe('/people?filters=asian-and-pacific-islander')
    expect(store.state.people.filters).toEqual([peopleTags.i2])
  })
})

describe('owner edit shortcut', () => {
  test('holding Shift as owner switches the cursor, and releasing it switches it back', async () => {
    setRoles({ owner: true })
    const utils = await renderAt('/person/da-shawn-o-neal')
    const cover = utils.getByText(bySelector('.cover-photo'))
    const link = nameLink(utils)

    await fireEvent.keyDown(window, { key: 'Shift' })
    expect(cover).toHaveStyle({ cursor: 'context-menu', userSelect: 'none' })
    expect(link).toHaveStyle({ cursor: 'context-menu', userSelect: 'none' })
    expect(styleAttribute(cover)).toContain('cursor: context-menu')

    await fireEvent.keyUp(window, { key: 'Shift' })
    expect(cover).toHaveStyle({ cursor: 'default' })
    expect(link).toHaveStyle({ cursor: 'default' })
    expect(cover).not.toHaveStyle({ userSelect: 'none' })
    expect(link).not.toHaveStyle({ userSelect: 'none' })
  })

  test('shift-clicking the name as owner pushes PersonEdit with the current params', async () => {
    setRoles({ owner: true })
    const utils = await renderAt('/person/da-shawn-o-neal')
    const push = vi.spyOn(router, 'push').mockResolvedValue()

    await fireEvent.click(nameLink(utils))
    expect(push).not.toHaveBeenCalled()

    await fireEvent.click(nameLink(utils), { shiftKey: true })
    const route = { name: 'PersonEdit', params: { name: 'da-shawn-o-neal' } }
    expect(push.mock.calls).toEqual([[route]])
    expect(router.resolve(route).fullPath).toBe('/person/da-shawn-o-neal/edit')
  })

  test('a non-owner gets neither the cursor nor the edit navigation', async () => {
    setRoles({ advisor: true })
    const utils = await renderAt('/person/da-shawn-o-neal')
    const push = vi.spyOn(router, 'push').mockResolvedValue()

    await fireEvent.keyDown(window, { key: 'Shift' })
    expect(utils.getByText(bySelector('.cover-photo'))).toHaveStyle({ cursor: 'default' })
    await fireEvent.click(nameLink(utils), { shiftKey: true })
    expect(push).not.toHaveBeenCalled()
  })
})

describe('route lifecycle through RouterView', () => {
  test('leaving for another page records the visit time', async () => {
    vi.setSystemTime(new Date('2024-01-02T03:04:05Z'))
    const utils = await renderRouterViewAt('/person/le-uyen-pham')
    expect(utils.getByRole('heading', { level: 1 })).toHaveTextContent('LeUyen Pham')
    expect(store.state.ui.lastVisited).toBeUndefined()

    await router.push('/no-such-page')
    expect(router.currentRoute.value.name).toBe('NotFound')
    expect(store.state.ui.lastVisited).toEqual(new Date('2024-01-02T03:04:05Z'))
  })

  test('leaving keeps an earlier visit time', async () => {
    const earlier = new Date('2023-05-06T07:08:09Z')
    store.commit('ui/setLastVisited', earlier)
    await renderRouterViewAt('/person/le-uyen-pham')

    await router.push('/no-such-page')
    expect(router.currentRoute.value.name).toBe('NotFound')
    expect(store.state.ui.lastVisited).toBe(earlier)
  })

  test('moving between people reuses the page and does not count as leaving', async () => {
    const utils = await renderRouterViewAt('/person/da-shawn-o-neal')
    const page = utils.getByText(bySelector('.wide-page'))
    expect(utils.getByRole('heading', { level: 1 })).toHaveTextContent("Da'Shawn O'Neal")

    await router.push('/person/jose-rodriguez')
    expect(utils.getByRole('heading', { level: 1 })).toHaveTextContent('José Rodríguez')
    expect(utils.getByText(bySelector('[data-person-id]'))).toHaveAttribute('data-person-id', 'p3')
    expect(utils.getByText(bySelector('.wide-page'))).toBe(page)
    expect(store.state.ui.lastVisited).toBeUndefined()
  })
})
