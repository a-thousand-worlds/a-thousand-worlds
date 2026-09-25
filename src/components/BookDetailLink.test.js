/**
 * BookDetailLink, PersonDetailLink, PrevNext and PersonCard: the components that turn a book or
 * person into a URL and push it onto the router.
 *
 * Dependency seams guarded:
 *
 * The slug in every book and person URL comes from @sindresorhus/slugify 1.x: apostrophes are
 * removed for books but split words for people, diacritics and & are transliterated, camelCase is
 * split, and Æsop becomes 'a-esop', a decamelize quirk kept as a canary.
 *
 * vue-router 4 turns each location a component pushes into a URL through the real src/router.js
 * table, including the custom-regex BookDetail path '/book/:slug(.+)?-:isbn', and parses that URL
 * back to the same route without a warning. $route.name is read reactively from a window listener.
 * Parsing hand-written URLs against the table (the alias, /edit ranking and the rest) is pinned in
 * src/router.test.js and src/contracts/vue-router.test.js, not repeated here.
 *
 * vue 3.5 covers :style binding with a null value, class fallthrough onto the link's root <a>,
 * default slots, and the unmounted hook removing window listeners. jsdom covers KeyboardEvent key
 * on window and how its CSSStyleDeclaration serializes user-select and background-image url().
 *
 * Firebase is a boundary: nothing here should reach it, so '@/firebase' is replaced outright.
 * Navigation is captured with a spy on router.push, and each pushed location is followed through
 * router.resolve(...).href and back to a route name and params.
 */
import { render, fireEvent } from '@testing-library/vue'
import router from '@/router'
import store from '@/store'
import mixins from '@/mixins/global'
import directives from '@/directives'
import BookDetailLink from '@/components/BookDetailLink.vue'
import PersonDetailLink from '@/components/PersonDetailLink.vue'
import PrevNext from '@/components/PrevNext.vue'
import PersonCard from '@/components/PersonCard.vue'

// vitest hoists this above the imports. createWebHistory reads window.location when src/router.js
// is imported, so the initial navigation resolves to the eagerly imported NotFound page instead of
// lazy-loading Home.vue.
vi.hoisted(() => {
  window.history.replaceState(null, '', '/__test__')
  // router scrollBehavior calls it after a navigation, and jsdom does not implement it
  window.scrollTo = vi.fn()
})

vi.mock('@/firebase', () => ({
  default: {
    auth: () => {
      throw new Error('Unexpected firebase.auth() in link component tests')
    },
    database: () => {
      throw new Error('Unexpected firebase.database() in link component tests')
    },
  },
}))

// the edit pages are only navigated to, never rendered; stubs keep their editors out of the graph
vi.mock('@/pages/BookEdit.vue', () => ({ default: { name: 'BookEditStub', render: () => null } }))
vi.mock('@/pages/PersonEdit.vue', () => ({
  default: { name: 'PersonEditStub', render: () => null },
}))

const ISBN = '9781250140913'
const OWNER = { uid: 'o1', roles: { authorized: true, owner: true }, profile: {} }
const CONTRIBUTOR = { uid: 'c1', roles: { authorized: true, contributor: true }, profile: {} }
const pristine = JSON.parse(JSON.stringify(store.state))

let push

/** Renders a component with the real store and router plus the app's global mixins and directives. */
const renderWithApp = (component, options = {}) =>
  render(component, {
    ...options,
    global: {
      plugins: [store, router],
      mixins: [mixins],
      directives: { ...directives, tippy: () => {} },
    },
  })

/** Renders a BookDetailLink around the given text. */
const renderBookLink = (book, { edit = false, text = 'link' } = {}) =>
  renderWithApp(BookDetailLink, { props: { book, edit }, slots: { default: text } })

/** Renders a PersonDetailLink around the given text. */
const renderPersonLink = (person, { edit = false, text = 'link' } = {}) =>
  renderWithApp(PersonDetailLink, { props: { person, edit }, slots: { default: text } })

/** Returns the single location the component passed to router.push. */
const pushed = () => {
  expect(push).toHaveBeenCalledTimes(1)
  return push.mock.calls[0][0]
}

/**
 * Runs router.resolve and fails the test if vue-router warned while resolving, since a location it
 * starts to warn about would otherwise still resolve and pass.
 */
const resolveQuietly = to => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const route = router.resolve(to)
    expect(warn).not.toHaveBeenCalled()
    return route
  } finally {
    warn.mockRestore()
  }
}

/** Returns the URL the real route table generates for a pushed location. */
const hrefOf = location => resolveQuietly(location).href

/** Returns the name and params the real route table parses a URL back into. */
const match = path => {
  const { name, params } = resolveQuietly(path)
  return { name, params }
}

/** Presses or releases Shift on window, where the links listen for it. */
const shift = type => fireEvent[type](window, { key: 'Shift' })

beforeEach(async () => {
  store.replaceState(JSON.parse(JSON.stringify(pristine)))
  // a test that navigated leaves the router elsewhere; return it to the NotFound page
  if (router.options.history.location !== '/__test__') await router.replace('/__test__')
  push = vi.spyOn(router, 'push').mockResolvedValue()
})

afterEach(() => {
  push.mockRestore()
})

describe('BookDetailLink', () => {
  test.each([
    ["Mommy's Khimar", 'mommys-khimar'],
    ["Don't Touch My Hair!", 'dont-touch-my-hair'],
    ['Ñandú & Friends', 'nandu-and-friends'],
    ['Crème Brûlée', 'creme-brulee'],
    ['10 Little Fingers', '10-little-fingers'],
    ['Hey, Wall!', 'hey-wall'],
    ['Æsop', 'a-esop'],
  ])('clicking a link to "%s" pushes BookDetail with slug %s', async (title, slug) => {
    const { getByText } = renderBookLink({ isbn: ISBN, title }, { text: title })
    await fireEvent.click(getByText(title))
    expect(pushed()).toEqual({ name: 'BookDetail', params: { isbn: ISBN, slug } })
  })

  test('the pushed location becomes the slug-then-ISBN URL and parses back to the book', async () => {
    const { getByText } = renderBookLink({ isbn: ISBN, title: "Mommy's Khimar" })
    await fireEvent.click(getByText('link'))
    const href = hrefOf(pushed())
    expect(href).toBe('/book/mommys-khimar-9781250140913')
    expect(match(href)).toEqual({
      name: 'BookDetail',
      params: { slug: 'mommys-khimar', isbn: ISBN },
    })
  })

  test('a slug with digits and hyphens splits back off at the last hyphen', async () => {
    const { getByText } = renderBookLink({ isbn: ISBN, title: '10 Little Fingers' })
    await fireEvent.click(getByText('link'))
    const href = hrefOf(pushed())
    expect(href).toBe('/book/10-little-fingers-9781250140913')
    expect(match(href)).toEqual({
      name: 'BookDetail',
      params: { slug: '10-little-fingers', isbn: ISBN },
    })
  })

  test('an ISBN-10 ending in X stays intact after the slug', async () => {
    const { getByText } = renderBookLink({ isbn: '080442957X', title: 'A B C' })
    await fireEvent.click(getByText('link'))
    expect(pushed()).toEqual({ name: 'BookDetail', params: { isbn: '080442957X', slug: 'a-b-c' } })
    const href = hrefOf(pushed())
    expect(href).toBe('/book/a-b-c-080442957X')
    expect(match(href)).toEqual({
      name: 'BookDetail',
      params: { slug: 'a-b-c', isbn: '080442957X' },
    })
  })

  test('a title that slugifies to nothing still gives a URL that resolves back to the book', async () => {
    const { getByText } = renderBookLink({ isbn: ISBN, title: '小さな' })
    await fireEvent.click(getByText('link'))
    expect(pushed()).toEqual({ name: 'BookDetail', params: { isbn: ISBN, slug: '' } })
    const href = hrefOf(pushed())
    expect(href).toBe('/book/-9781250140913')
    expect(match(href)).toEqual({
      name: 'BookDetail',
      params: { slug: '', isbn: ISBN },
    })
  })

  test('with edit, it pushes BookEdit and the URL ends in /edit', async () => {
    const { getByText } = renderBookLink({ isbn: ISBN, title: "Mommy's Khimar" }, { edit: true })
    await fireEvent.click(getByText('link'))
    expect(pushed()).toEqual({ name: 'BookEdit', params: { isbn: ISBN, slug: 'mommys-khimar' } })
    const href = hrefOf(pushed())
    expect(href).toBe('/book/mommys-khimar-9781250140913/edit')
    expect(match(href)).toEqual({
      name: 'BookEdit',
      params: { slug: 'mommys-khimar', isbn: ISBN },
    })
  })

  test('the link renders its slot inside a selectable <a> with no href', () => {
    const { getByText } = renderBookLink({ isbn: ISBN, title: 'T' }, { text: 'Read more' })
    const link = getByText('Read more')
    expect(link.tagName).toBe('A')
    expect(link).not.toHaveAttribute('href')
    expect(link).not.toHaveStyle('user-select: none')
  })

  test('an owner holding Shift gets an unselectable link that pushes BookEdit', async () => {
    store.commit('user/setUser', OWNER)
    const { getByText } = renderBookLink({ isbn: ISBN, title: "Mommy's Khimar" })
    const link = getByText('link')

    await shift('keyDown')
    expect(link).toHaveStyle('user-select: none')
    await fireEvent.click(link)
    expect(pushed()).toEqual({ name: 'BookEdit', params: { isbn: ISBN, slug: 'mommys-khimar' } })
  })

  test('releasing Shift restores the owner link to BookDetail', async () => {
    store.commit('user/setUser', OWNER)
    const { getByText } = renderBookLink({ isbn: ISBN, title: "Mommy's Khimar" })
    const link = getByText('link')

    await shift('keyDown')
    await shift('keyUp')
    expect(link).not.toHaveStyle('user-select: none')
    await fireEvent.click(link)
    expect(pushed()).toEqual({ name: 'BookDetail', params: { isbn: ISBN, slug: 'mommys-khimar' } })
  })

  test('a key other than Shift leaves the owner link alone', async () => {
    store.commit('user/setUser', OWNER)
    const { getByText } = renderBookLink({ isbn: ISBN, title: "Mommy's Khimar" })
    await fireEvent.keyDown(window, { key: 'Control' })
    await fireEvent.click(getByText('link'))
    expect(pushed().name).toBe('BookDetail')
  })

  test.each([
    ['a contributor', CONTRIBUTOR],
    ['a signed-out visitor', null],
  ])('Shift has no effect for %s', async (label, user) => {
    store.commit('user/setUser', user)
    const { getByText } = renderBookLink({ isbn: ISBN, title: "Mommy's Khimar" })
    const link = getByText('link')

    await shift('keyDown')
    expect(link).not.toHaveStyle('user-select: none')
    await fireEvent.click(link)
    expect(pushed()).toEqual({ name: 'BookDetail', params: { isbn: ISBN, slug: 'mommys-khimar' } })
  })

  test('Shift does nothing while the router is already on BookEdit', async () => {
    store.commit('user/setUser', OWNER)
    const { getByText } = renderBookLink({ isbn: ISBN, title: "Mommy's Khimar" })
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('NotFound')
    await router.replace('/book/other-book-9780000000002/edit')
    expect(router.currentRoute.value.name).toBe('BookEdit')

    await shift('keyDown')
    expect(getByText('link')).not.toHaveStyle('user-select: none')
    await fireEvent.click(getByText('link'))
    expect(pushed().name).toBe('BookDetail')
  })

  test('unmounting removes the window key listeners it added', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    try {
      const { unmount } = renderBookLink({ isbn: ISBN, title: 'T' })
      const keyListeners = add.mock.calls.filter(([type]) => type === 'keydown' || type === 'keyup')
      expect(keyListeners.map(([type]) => type)).toEqual(['keydown', 'keyup'])

      unmount()
      keyListeners.forEach(([type, listener]) => {
        expect(remove).toHaveBeenCalledWith(type, listener)
      })
    } finally {
      add.mockRestore()
      remove.mockRestore()
    }
  })
})

describe('PersonDetailLink', () => {
  test.each([
    ["Sean O'Neal", 'sean-o-neal'],
    ['LeUyen Pham', 'le-uyen-pham'],
    ['JaNay Brown-Wood', 'ja-nay-brown-wood'],
    ['Matt de la Peña', 'matt-de-la-pena'],
    ['Björk', 'bjoerk'],
  ])('clicking a link to "%s" pushes PersonDetail with name %s', async (name, slug) => {
    const { getByText } = renderPersonLink({ name }, { text: name })
    await fireEvent.click(getByText(name))
    expect(pushed()).toEqual({ name: 'PersonDetail', params: { name: slug } })
  })

  test('the pushed location becomes /person/<slug> and parses back to the person', async () => {
    const { getByText } = renderPersonLink({ name: "Sean O'Neal" })
    await fireEvent.click(getByText('link'))
    const href = hrefOf(pushed())
    expect(href).toBe('/person/sean-o-neal')
    expect(match(href)).toEqual({ name: 'PersonDetail', params: { name: 'sean-o-neal' } })
  })

  test('with edit, it pushes PersonEdit and the URL ends in /edit', async () => {
    const { getByText } = renderPersonLink({ name: 'Matt de la Peña' }, { edit: true })
    await fireEvent.click(getByText('link'))
    expect(pushed()).toEqual({ name: 'PersonEdit', params: { name: 'matt-de-la-pena' } })
    const href = hrefOf(pushed())
    expect(href).toBe('/person/matt-de-la-pena/edit')
    expect(match(href)).toEqual({ name: 'PersonEdit', params: { name: 'matt-de-la-pena' } })
  })

  test('a person with no name links to the People page', async () => {
    const { getByText } = renderPersonLink({ id: 'p0' })
    await fireEvent.click(getByText('link'))
    expect(pushed()).toEqual({ name: 'People' })
    const href = hrefOf(pushed())
    expect(href).toBe('/people')
    expect(match(href)).toEqual({ name: 'People', params: {} })
  })

  test('an owner holding Shift gets an unselectable link that pushes PersonEdit', async () => {
    store.commit('user/setUser', OWNER)
    const { getByText } = renderPersonLink({ name: 'LeUyen Pham' })
    const link = getByText('link')

    await shift('keyDown')
    expect(link).toHaveStyle('user-select: none')
    await fireEvent.click(link)
    expect(pushed()).toEqual({ name: 'PersonEdit', params: { name: 'le-uyen-pham' } })
  })

  test('releasing Shift restores the owner link to PersonDetail', async () => {
    store.commit('user/setUser', OWNER)
    const { getByText } = renderPersonLink({ name: 'LeUyen Pham' })
    const link = getByText('link')

    await shift('keyDown')
    await shift('keyUp')
    expect(link).not.toHaveStyle('user-select: none')
    await fireEvent.click(link)
    expect(pushed()).toEqual({ name: 'PersonDetail', params: { name: 'le-uyen-pham' } })
  })

  test('Shift has no effect for a contributor', async () => {
    store.commit('user/setUser', CONTRIBUTOR)
    const { getByText } = renderPersonLink({ name: 'LeUyen Pham' })
    await shift('keyDown')
    await fireEvent.click(getByText('link'))
    expect(pushed()).toEqual({ name: 'PersonDetail', params: { name: 'le-uyen-pham' } })
  })

  test('Shift does nothing while the router is already on PersonEdit', async () => {
    store.commit('user/setUser', OWNER)
    const { getByText } = renderPersonLink({ name: 'LeUyen Pham' })
    await router.isReady()
    await router.replace('/person/someone-else/edit')
    expect(router.currentRoute.value.name).toBe('PersonEdit')

    await shift('keyDown')
    await fireEvent.click(getByText('link'))
    expect(pushed().name).toBe('PersonDetail')
  })
})

describe('PrevNext', () => {
  const alpha = { id: 'a', isbn: '1', title: 'Alpha Book' }
  const beta = { id: 'b', isbn: '2', title: 'Beta Book' }
  const gamma = { id: 'c', isbn: '3', title: 'Gamma Book' }

  /** Seeds books into the store in the order Beta, Alpha, Gamma, bypassing the random shuffle. */
  const seedBooks = () => {
    store.commit('books/set', { a: alpha, b: beta, c: gamma })
    store.state.books.shuffled = [beta, alpha, gamma]
  }

  /** Renders PrevNext for an item of the given type. */
  const renderPrevNext = (item, type) => renderWithApp(PrevNext, { props: { item, type } })

  test('a middle book shows a mobile and a desktop link in each direction', () => {
    seedBooks()
    const { getAllByText } = renderPrevNext(alpha, 'books')
    const prev = getAllByText('< Previous Book')
    const next = getAllByText('Next Book >')
    expect(prev).toHaveLength(2)
    expect(next).toHaveLength(2)
    // the parent's class attribute falls through onto each link's root <a>
    const directions = [prev, next]
    directions.forEach(([mobile, desktop]) => {
      expect(mobile).toHaveClass('is-hidden-tablet', 'button')
      expect(mobile).not.toHaveClass('is-hidden-mobile')
      expect(desktop).toHaveClass('is-hidden-mobile')
      // one class per assertion: a negated multi-class toHaveClass passes if any one is missing
      expect(desktop).not.toHaveClass('is-hidden-tablet')
      expect(desktop).not.toHaveClass('button')
    })
  })

  test('Next pushes the following book in shuffled order', async () => {
    seedBooks()
    const { getAllByText } = renderPrevNext(alpha, 'books')
    await fireEvent.click(getAllByText('Next Book >')[0])
    expect(pushed()).toEqual({ name: 'BookDetail', params: { isbn: '3', slug: 'gamma-book' } })
  })

  test('Previous pushes the preceding book in shuffled order', async () => {
    seedBooks()
    const { getAllByText } = renderPrevNext(alpha, 'books')
    await fireEvent.click(getAllByText('< Previous Book')[1])
    expect(pushed()).toEqual({ name: 'BookDetail', params: { isbn: '2', slug: 'beta-book' } })
  })

  test('the first book shows only Next', () => {
    seedBooks()
    const { queryAllByText } = renderPrevNext(beta, 'books')
    expect(queryAllByText('< Previous Book')).toHaveLength(0)
    expect(queryAllByText('Next Book >')).toHaveLength(2)
  })

  test('the last book shows only Previous', () => {
    seedBooks()
    const { queryAllByText } = renderPrevNext(gamma, 'books')
    expect(queryAllByText('< Previous Book')).toHaveLength(2)
    expect(queryAllByText('Next Book >')).toHaveLength(0)
  })

  test('a book missing from the list points Next at the first book and has no Previous', async () => {
    seedBooks()
    const { queryAllByText, getAllByText } = renderPrevNext({ id: 'zzz' }, 'books')
    expect(queryAllByText('< Previous Book')).toHaveLength(0)
    await fireEvent.click(getAllByText('Next Book >')[0])
    expect(pushed()).toEqual({ name: 'BookDetail', params: { isbn: '2', slug: 'beta-book' } })
  })

  test('a filter that matches nothing leaves no links', () => {
    seedBooks()
    store.commit('books/setFilters', [{ id: 'x' }])
    const { queryAllByText } = renderPrevNext(alpha, 'books')
    expect(queryAllByText(/Previous|Next/)).toHaveLength(0)
  })

  test('people link by name slug, first person showing only Next', async () => {
    store.state.people.shuffled = [
      { id: 'p', name: 'Yuyi Morales' },
      { id: 'q', name: "Sean O'Neal" },
    ]
    const { queryAllByText, getAllByText } = renderPrevNext({ id: 'p' }, 'people')
    expect(queryAllByText('< Previous Person')).toHaveLength(0)
    expect(getAllByText('Next Person >')).toHaveLength(2)
    await fireEvent.click(getAllByText('Next Person >')[0])
    expect(pushed()).toEqual({ name: 'PersonDetail', params: { name: 'sean-o-neal' } })
  })

  test('the last person shows only Previous, pushing the person before', async () => {
    store.state.people.shuffled = [
      { id: 'p', name: 'Yuyi Morales' },
      { id: 'q', name: "Sean O'Neal" },
    ]
    const { queryAllByText, getAllByText } = renderPrevNext({ id: 'q' }, 'people')
    expect(queryAllByText('Next Person >')).toHaveLength(0)
    expect(getAllByText('< Previous Person')).toHaveLength(2)
    await fireEvent.click(getAllByText('< Previous Person')[1])
    expect(pushed()).toEqual({ name: 'PersonDetail', params: { name: 'yuyi-morales' } })
  })
})

describe('PersonCard', () => {
  /** Returns the inline background-image of the card's photo circle. */
  const backgroundOf = person => {
    const { container } = renderWithApp(PersonCard, { props: { person } })
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- a bare div with no text, role or label
    return container.querySelector('.photo-wrapper').style.backgroundImage
  }

  // rows are [label, expected, photo] so the title names the background-image the card really gets
  test.each([
    ['a string photo', 'url("https://x/p.jpg")', 'https://x/p.jpg'],
    ['a relative string photo', 'url("/img/p2.png")', '/img/p2.png'],
    ['an http photo object', 'url("https://x/q.jpg")', { url: 'https://x/q.jpg' }],
    [
      'a storage download URL',
      'url("https://storage.test/o/people%2Fp.jpg?alt=media&token=t-1")',
      { url: 'https://storage.test/o/people%2Fp.jpg?alt=media&token=t-1' },
    ],
    ['a gs:// photo object', 'url("")', { url: 'gs://bucket/p.jpg' }],
    ['a photo object with no url', 'url("")', {}],
    ['no photo', 'url("")', undefined],
  ])('%s gives background-image %s', (label, expected, photo) => {
    expect(backgroundOf({ name: 'LeUyen Pham', photo })).toBe(expected)
  })

  test('shows the name and links to the person by slug', async () => {
    const { getByText } = renderWithApp(PersonCard, {
      props: { person: { name: 'LeUyen Pham', photo: 'https://x/p.jpg' } },
    })
    await fireEvent.click(getByText('LeUyen Pham'))
    expect(pushed()).toEqual({ name: 'PersonDetail', params: { name: 'le-uyen-pham' } })
  })
})
