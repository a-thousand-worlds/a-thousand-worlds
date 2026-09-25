/*
 * Characterization tests for the tag filtering and tagging components: Filter, Tag, Multiselect,
 * AddTag and MobileFooter. Dependency seams guarded:
 *
 * - @sindresorhus/slugify: tag names become the `?filters=` slugs that Filter, Tag and MobileFooter
 *   navigate to. '/' and ' / ' collapse to one dash, '&' becomes 'and', '+' and parentheses drop,
 *   diacritics are transliterated, and camel case is split.
 * - vue-router: the locations pushed for Home, People, Bundles, TagsManager and Login, their hrefs
 *   through router.resolve, router-link hrefs, and the catch-all route the app starts on.
 * - jsdom: a multiple <select> read through option.selected after a change event, mouseenter and
 *   mouseleave, innerHTML serializing '<br/>' as '<br>', and the !important priority on an inline
 *   style.
 * - vue: the innerHTML binding, the click-outside directive on an element and on a component root,
 *   declared emits, string and object style merging, option.selected patched as a DOM property,
 *   and a null style value leaving the inline property unset.
 * - Firebase write shape for tag assignment: the v8 ref(path).update/set calls AddTag produces.
 *
 * Firebase (pinned at v8, excluded from upgrades) is faked at 'firebase/app', one level below
 * '@/firebase', because each write imports '@/firebase' from two places at once and a vi.mock of
 * '@/firebase' let a concurrent import through.
 *
 * Navigation is recorded through push and replace alike, and where a filter change for bundles
 * lands is left unasserted: filterable's updateUrl means to replace when already on the page and
 * to send bundles to Bundles, but it always pushes and sends every non-books type to People.
 *
 * These components expose their state through classes, inline styles and bare elements with no
 * role or label, so the few DOM lookups that Testing Library cannot express live in the helpers
 * below, each with its reason.
 */
import { nextTick } from 'vue'
import { fireEvent, render, within } from '@testing-library/vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import router from '@/router'
import store from '@/store'
import mixins from '@/mixins/global'
import directives from '@/directives'
import Filter from '@/components/Filter.vue'
import Tag from '@/components/Tag.vue'
import Multiselect from '@/components/Multiselect.vue'
import AddTag from '@/components/AddTag.vue'
import MobileFooter from '@/components/MobileFooter.vue'

// start on a URL that resolves to the eager NotFound route, so the router's initial navigation
// never loads a lazy page, and keep jsdom's unimplemented scrollTo out of the scroll behavior
vi.hoisted(() => {
  window.history.replaceState(null, '', '/__test__')
  window.scrollTo = () => {}
})

/** Records every Firebase write as (method, path, value), in call order. */
const fb = vi.hoisted(() => ({ write: vi.fn() }))

vi.mock('firebase/app', () => {
  /** A fake v8 Reference that records its writes. */
  const ref = path => ({
    set: async value => fb.write('set', path, value),
    update: async value => fb.write('update', path, value),
    on: () => {},
    once: () => {},
  })
  return {
    default: {
      initializeApp: () => {},
      database: () => ({ ref, useEmulator: () => {} }),
    },
  }
})
vi.mock('firebase/auth', () => ({}))
vi.mock('firebase/database', () => ({}))
vi.mock('firebase/storage', () => ({}))

// vite hands back svg imports as URL strings, which Vue cannot render as components
vi.mock('@/assets/icons/bookmark.svg', async () => {
  const { h } = await import('vue')
  return { default: { render: () => h('svg') } }
})
vi.mock('@/assets/icons/books.svg', async () => {
  const { h } = await import('vue')
  return { default: { render: () => h('svg') } }
})
vi.mock('@/assets/icons/bundles.svg', async () => {
  const { h } = await import('vue')
  return { default: { render: () => h('svg') } }
})
vi.mock('@/assets/icons/filter.svg', async () => {
  const { h } = await import('vue')
  return { default: { render: () => h('svg') } }
})

/** Book tags in production shape: out of sortOrder, one parent with subtags, two hidden tags. */
const bookTags = {
  t1: { id: 't1', tag: 'Black / African American', sortOrder: 2, showOnFront: true },
  t2: { id: 't2', tag: 'Arab/Middle Eastern', sortOrder: 1, showOnFront: true },
  t3: { id: 't3', tag: 'Indigenous Peoples of the Americas', sortOrder: 3, showOnFront: true },
  t4: { id: 't4', tag: 'Gender', sortOrder: 4, showOnFront: true },
  t5: { id: 't5', tag: 'Girl', sortOrder: 4.01, parent: 't4', showOnFront: true },
  t6: { id: 't6', tag: 'Boy', sortOrder: 4.02, parent: 't4', showOnFront: true },
  t7: { id: 't7', tag: 'Hidden', sortOrder: 5, showOnFront: false },
  t8: { id: 't8', tag: 'Nonbinary', sortOrder: 4.03, parent: 't4', showOnFront: false },
}

/** People tags out of sortOrder, with one hidden from the public filters. */
const peopleTags = {
  p2: { id: 'p2', tag: 'Two-Spirit', sortOrder: 2, showOnFront: true },
  p1: { id: 'p1', tag: 'Latinx', sortOrder: 1, showOnFront: true },
  p3: { id: 'p3', tag: 'Hidden', sortOrder: 3, showOnFront: false },
}

const initialState = JSON.parse(JSON.stringify(store.state))

/** Deep-copies a fixture so a commit never shares objects with it. */
const copy = value => JSON.parse(JSON.stringify(value))

/** Records every location handed to router.push or router.replace, in call order. */
const navigate = vi.fn()

/** Returns the location passed to the most recent router.push/replace. */
const lastLocation = () => navigate.mock.lastCall[0]

/** Serializes a location through the real router, as a link's href would show it. */
const hrefOf = location => router.resolve(location).href

/** Returns the recorded Firebase writes as [method, path, value] triples. */
const writes = () => fb.write.mock.calls

/** Returns the ids of a store module's active tag filters, in order. */
const filterIds = type => store.state[type].filters.map(filter => filter.id)

/**
 * Clicks an element one second after the last render. Vue skips a bubbled event in any listener
 * attached no earlier than the event's timestamp, so without the clock moving, a click fired in
 * the same millisecond as a render never reaches the outer handlers (and a click those handlers
 * would stop reaches the click-outside listener on document.body instead).
 */
const clickLater = element => {
  vi.setSystemTime(Date.now() + 1000)
  return fireEvent.click(element)
}

/**
 * Renders a component with the real store, the global mixins and the directives (v-tippy
 * stubbed), under the app's router unless another router is given.
 */
const renderWith = (component, { router: routerPlugin = router, ...options } = {}) =>
  render(component, {
    ...options,
    global: {
      plugins: [store, routerPlugin],
      mixins: [mixins],
      directives: { ...directives, tippy: () => {} },
    },
  })

/** Returns each Filter menu button's label as innerHTML, in document order. */
const labels = root =>
  // eslint-disable-next-line testing-library/no-node-access -- the label's innerHTML, <br> included, is the behavior
  [...root.querySelectorAll('ul.submenu > li > button > span:first-child')].map(
    span => span.innerHTML,
  )

/** Finds the Filter button whose label reads the given text, ignoring the <br>. */
const filterButton = (root, text) =>
  // eslint-disable-next-line testing-library/no-node-access -- an active button's name gains the — icon, so match its label instead
  within(root).getByText(text, { selector: 'button > span:first-child' }).closest('button')

/** Returns the <li> around a Filter button, which carries the hover and click listeners. */
const itemOf = button =>
  // eslint-disable-next-line testing-library/no-node-access -- the listeners sit on the bare <li>
  button.closest('li')

/** Returns the open subtag menu, or null. */
const subtagMenu = root =>
  // eslint-disable-next-line testing-library/no-node-access -- the menu is a bare div with no role or label
  root.querySelector('.subtag-menu')

/** Returns the labels of the open subtag menu's buttons, in order. */
const subtagLabels = root =>
  within(subtagMenu(root))
    .getAllByRole('button')
    .map(button => button.textContent.trim())

/** Returns the button-styled span a nolink Tag renders. */
const nolinkTag = root =>
  // eslint-disable-next-line testing-library/no-node-access -- a span with no role; the tag text sits in a child span
  root.querySelector('span.button.nolink')

/** Returns Multiselect's dropdown wrapper, which carries is-active. */
const dropdown = root =>
  // eslint-disable-next-line testing-library/no-node-access -- the wrapper has no role, text or label
  root.querySelector('.dropdown')

/** Returns Multiselect's dropdown items, in order. */
const dropdownItems = root =>
  // eslint-disable-next-line testing-library/no-node-access -- anchors without href have no role
  [...root.querySelectorAll('a.dropdown-item')]

/** Returns the Multiselect dropdown item with the given text. */
const dropdownItem = (root, text) => within(root).getByText(text, { selector: 'a.dropdown-item' })

/**
 * Returns an element's inline declarations as text. toHaveStyle reads the computed style, which
 * cannot tell an unset inline color from the one jsdom resolves by default.
 */
const inlineStyle = element => element.style.cssText

/** Returns the count badge inside an element, or null. */
const badgeIn = element =>
  // eslint-disable-next-line testing-library/no-node-access -- the badge is a bare span with no role or label
  element.querySelector('.badge')

/** Returns the count badge on a rendered MobileFooter's first item, the filter, or null. */
const filterBadge = screen => badgeIn(screen.getAllByRole('listitem')[0])

/** Returns MobileFooter's root <section>, which has no accessible name and so no region role. */
const footerSection = root =>
  // eslint-disable-next-line testing-library/no-node-access -- an unlabeled section has no role
  root.querySelector('section')

/** Returns the values of a rendered MobileFooter's filter options, in order. */
const optionValues = screen => screen.getAllByRole('option').map(option => option.value)

/** Returns a rendered MobileFooter's filter options as [value, selected] pairs, in order. */
const optionStates = screen =>
  screen.getAllByRole('option').map(option => [option.value, option.selected])

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'))
  store.replaceState(copy(initialState))
  fb.write.mockReset()
  navigate.mockReset()
  vi.spyOn(router, 'push').mockImplementation(async location => navigate(location))
  vi.spyOn(router, 'replace').mockImplementation(async location => navigate(location))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Filter', () => {
  beforeEach(() => {
    store.commit('tags/books/set', copy(bookTags))
  })

  test('renders the top-level tags in sortOrder, breaking long names with <br>', () => {
    const { container } = renderWith(Filter, { props: { type: 'books' } })

    expect(labels(container)).toEqual([
      'Arab/Middle Eastern',
      'Black /<br> African American',
      'Indigenous<br> Peoples of the Americas',
      'Gender',
    ])
  })

  test('leaves subtags out of the main list and renders a hidden tag as an empty item', () => {
    const screen = renderWith(Filter, { props: { type: 'books' } })

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(5)
    expect(screen.queryByText('Girl')).not.toBeInTheDocument()
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument()
    expect(within(items[4]).queryByRole('button')).not.toBeInTheDocument()
    expect(items[4]).toBeEmptyDOMElement()
  })

  test('renders nothing until the tags are loaded', () => {
    store.replaceState(copy(initialState))

    const screen = renderWith(Filter, { props: { type: 'books' } })

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(screen.container).toBeEmptyDOMElement()
  })

  test('clicking a tag filters by it and navigates Home with its slug', async () => {
    const { container } = renderWith(Filter, { props: { type: 'books' } })

    await clickLater(filterButton(container, 'Black / African American'))

    expect(filterIds('books')).toEqual(['t1'])
    expect(store.state.books.filters[0]).toEqual(bookTags.t1)
    expect(lastLocation()).toEqual({ name: 'Home', query: { filters: 'black-african-american' } })
    expect(hrefOf(lastLocation())).toBe('/?filters=black-african-american')

    const button = filterButton(container, 'Black / African American')
    expect(button).toHaveClass('active')
    expect(within(button).getByText('—')).toHaveClass('remove-tag')
    expect(filterButton(container, 'Arab/Middle Eastern')).not.toHaveClass('active')
  })

  test('offsets the selection icon on the Arab/Middle Eastern tag', async () => {
    const { container } = renderWith(Filter, { props: { type: 'books' } })

    await clickLater(filterButton(container, 'Arab/Middle Eastern'))

    const icon = within(filterButton(container, 'Arab/Middle Eastern')).getByText('—')
    expect(icon).toHaveStyle({ marginLeft: '6px', top: '11px' })
    expect(lastLocation()).toEqual({ name: 'Home', query: { filters: 'arab-middle-eastern' } })
  })

  test('clicking an active tag again removes it and clears the query', async () => {
    const screen = renderWith(Filter, { props: { type: 'books' } })

    await clickLater(filterButton(screen.container, 'Black / African American'))
    await clickLater(filterButton(screen.container, 'Black / African American'))

    expect(filterIds('books')).toEqual([])
    expect(lastLocation()).toEqual({ name: 'Home', query: {} })
    expect(filterButton(screen.container, 'Black / African American')).not.toHaveClass('active')
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })

  test('two top-level tags join into one comma-separated query value', async () => {
    const { container } = renderWith(Filter, { props: { type: 'books' } })

    await clickLater(filterButton(container, 'Indigenous Peoples of the Americas'))
    await clickLater(filterButton(container, 'Arab/Middle Eastern'))

    expect(filterIds('books')).toEqual(['t3', 't2'])
    expect(lastLocation()).toEqual({
      name: 'Home',
      query: { filters: 'indigenous-peoples-of-the-americas,arab-middle-eastern' },
    })
    expect(hrefOf(lastLocation())).toBe(
      '/?filters=indigenous-peoples-of-the-americas,arab-middle-eastern',
    )
  })

  test('hovering a parent opens its submenu of visible subtags and highlights it', async () => {
    const { container } = renderWith(Filter, { props: { type: 'books' } })
    const gender = filterButton(container, 'Gender')

    expect(subtagMenu(container)).toBeNull()
    await fireEvent.mouseEnter(itemOf(gender))

    // Nonbinary is a subtag of Gender too, but showOnFront: false keeps it out of the menu
    expect(subtagLabels(container)).toEqual(['Girl', 'Boy'])
    expect(gender).toHaveClass('active')
    expect(within(gender).queryByText('—')).not.toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
  })

  test('hovering a tag without subtags opens no submenu', async () => {
    const { container } = renderWith(Filter, { props: { type: 'books' } })

    await fireEvent.mouseEnter(itemOf(filterButton(container, 'Arab/Middle Eastern')))

    expect(subtagMenu(container)).toBeNull()
    expect(filterButton(container, 'Arab/Middle Eastern')).not.toHaveClass('active')
  })

  test('leaving the parent closes its submenu', async () => {
    const { container } = renderWith(Filter, { props: { type: 'books' } })
    const item = itemOf(filterButton(container, 'Gender'))

    await fireEvent.mouseEnter(item)
    expect(subtagMenu(container)).toBeInTheDocument()
    await fireEvent.mouseLeave(item)

    expect(subtagMenu(container)).toBeNull()
    expect(filterButton(container, 'Gender')).not.toHaveClass('active')
  })

  test('a click outside the open submenu closes it', async () => {
    const { container } = renderWith(Filter, { props: { type: 'books' } })

    await fireEvent.mouseEnter(itemOf(filterButton(container, 'Gender')))
    expect(subtagMenu(container)).toBeInTheDocument()
    await clickLater(document.body)

    expect(subtagMenu(container)).toBeNull()
  })

  test('a sibling subtag replaces the other, and the parent shows as active', async () => {
    const { container } = renderWith(Filter, { props: { type: 'books' } })

    await clickLater(filterButton(container, 'Black / African American'))
    await fireEvent.mouseEnter(itemOf(filterButton(container, 'Gender')))
    const menu = subtagMenu(container)

    await clickLater(filterButton(menu, 'Girl'))
    expect(filterIds('books')).toEqual(['t1', 't5'])
    expect(lastLocation()).toEqual({
      name: 'Home',
      query: { filters: 'black-african-american,girl' },
    })
    expect(filterButton(menu, 'Girl')).toHaveClass('active')

    await clickLater(filterButton(menu, 'Boy'))
    expect(filterIds('books')).toEqual(['t1', 't6'])
    expect(lastLocation()).toEqual({
      name: 'Home',
      query: { filters: 'black-african-american,boy' },
    })
    expect(hrefOf(lastLocation())).toBe('/?filters=black-african-american,boy')

    // the clicks land inside the submenu, so its click-outside handler ignores them and it stays open
    expect(subtagMenu(container)).toBe(menu)
    expect(filterButton(menu, 'Girl')).not.toHaveClass('active')
    expect(filterButton(menu, 'Boy')).toHaveClass('active')
    expect(within(filterButton(menu, 'Boy')).getByText('—')).toHaveClass('remove-tag')

    await fireEvent.mouseLeave(itemOf(filterButton(container, 'Gender')))
    const gender = filterButton(container, 'Gender')
    expect(gender).toHaveClass('active')
    expect(within(gender).getByText('—')).toHaveClass('remove-tag')
  })

  test('clicking a parent tag does not filter by it', async () => {
    const { container } = renderWith(Filter, { props: { type: 'books' } })

    await clickLater(filterButton(container, 'Gender'))

    expect(filterIds('books')).toEqual([])
    expect(navigate).not.toHaveBeenCalled()
  })

  test('Reset Filter appears only while filtered and clears the filters and query', async () => {
    const screen = renderWith(Filter, { props: { type: 'books' } })

    expect(screen.queryByRole('button', { name: 'Reset Filter' })).not.toBeInTheDocument()
    await clickLater(filterButton(screen.container, 'Black / African American'))
    const reset = screen.getByRole('button', { name: 'Reset Filter' })
    expect(reset).toHaveClass('button', 'is-rounded', 'is-primary')

    await clickLater(reset)

    expect(store.state.books.filters).toEqual([])
    expect(lastLocation()).toEqual({ name: 'Home', query: {} })
    expect(hrefOf(lastLocation())).toBe('/')
    expect(screen.queryByRole('button', { name: 'Reset Filter' })).not.toBeInTheDocument()
  })

  test('Reset Filter also appears while a share list filters by ids', () => {
    store.commit('books/setIdFilters', ['b1'])

    const screen = renderWith(Filter, { props: { type: 'books' } })

    expect(screen.getByRole('button', { name: 'Reset Filter' })).toBeVisible()
    screen.getAllByRole('button').forEach(button => expect(button).not.toHaveClass('active'))
  })
})

describe('Filter for people', () => {
  test('renders the creator title filters before the identity tags', () => {
    store.commit('tags/people/set', copy(peopleTags))

    const { container } = renderWith(Filter, { props: { type: 'people' } })

    expect(labels(container)).toEqual([
      'Author',
      'Illustrator',
      'Author/Illustrator',
      'Latinx',
      'Two-Spirit',
    ])
  })

  test('renders nothing, not even the creator titles, until the people tags are loaded', () => {
    const screen = renderWith(Filter, { props: { type: 'people' } })

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(screen.queryByText('Author')).not.toBeInTheDocument()
  })

  test('clicking a creator title filters by it and navigates to People', async () => {
    store.commit('tags/people/set', copy(peopleTags))
    const { container } = renderWith(Filter, { props: { type: 'people' } })

    await clickLater(filterButton(container, 'Author/Illustrator'))

    expect(store.state.people.filters).toEqual([
      { id: 'author-illustrator', tag: 'Author/Illustrator' },
    ])
    expect(lastLocation()).toEqual({ name: 'People', query: { filters: 'author-illustrator' } })
    expect(hrefOf(lastLocation())).toBe('/people?filters=author-illustrator')
    const button = filterButton(container, 'Author/Illustrator')
    expect(button).toHaveClass('active')
    expect(within(button).getByText('—')).toHaveClass('remove-tag')
    expect(filterButton(container, 'Author')).not.toHaveClass('active')
    expect(store.state.books.filters).toEqual([])
  })

  test('clicking an identity tag navigates to People with its slug', async () => {
    store.commit('tags/people/set', copy(peopleTags))
    const { container } = renderWith(Filter, { props: { type: 'people' } })

    await clickLater(filterButton(container, 'Two-Spirit'))

    expect(filterIds('people')).toEqual(['p2'])
    expect(lastLocation()).toEqual({ name: 'People', query: { filters: 'two-spirit' } })
  })
})

describe('Filter for bundles', () => {
  beforeEach(() => {
    store.commit('tags/bundles/set', {
      j: { id: 'j', tag: 'Joy', sortOrder: 2, showOnFront: true },
      f: { id: 'f', tag: 'Family & Friends', sortOrder: 1, showOnFront: true },
    })
  })

  test('renders the bundle tags in sortOrder, with no special filters', () => {
    const { container } = renderWith(Filter, { props: { type: 'bundles' } })

    expect(labels(container)).toEqual(['Family &amp; Friends', 'Joy'])
  })

  test('clicking a bundle tag filters bundles by it', async () => {
    const { container } = renderWith(Filter, { props: { type: 'bundles' } })

    await clickLater(filterButton(container, 'Family & Friends'))

    expect(filterIds('bundles')).toEqual(['f'])
    expect(store.state.books.filters).toEqual([])
    expect(filterButton(container, 'Family & Friends')).toHaveClass('active')
    // one navigation, whose destination is left unasserted: updateUrl sends it to People today
    expect(navigate).toHaveBeenCalledTimes(1)
  })
})

describe('Tag', () => {
  test.each([
    {
      type: 'books',
      tag: { id: 't2', tag: 'Arab/Middle Eastern' },
      location: { name: 'Home', query: { filters: 'arab-middle-eastern' } },
      href: '/?filters=arab-middle-eastern',
    },
    {
      type: 'books',
      tag: { id: 'm', tag: 'Mirrors & Windows' },
      location: { name: 'Home', query: { filters: 'mirrors-and-windows' } },
      href: '/?filters=mirrors-and-windows',
    },
    {
      type: 'books',
      tag: { id: 'l', tag: 'LGBTQIA+' },
      location: { name: 'Home', query: { filters: 'lgbtqia' } },
      href: '/?filters=lgbtqia',
    },
    {
      type: 'books',
      tag: { id: 'k', tag: 'PreK-K' },
      location: { name: 'Home', query: { filters: 'pre-k-k' } },
      href: '/?filters=pre-k-k',
    },
    {
      type: 'people',
      tag: { id: 'p2', tag: 'Two-Spirit' },
      location: { name: 'People', query: { filters: 'two-spirit' } },
      href: '/people?filters=two-spirit',
    },
    {
      type: 'people',
      tag: { id: 'mt', tag: 'Métis' },
      location: { name: 'People', query: { filters: 'metis' } },
      href: '/people?filters=metis',
    },
    {
      type: 'bundles',
      tag: { id: 'n', tag: 'Neurodivergent (ADHD, Autism)' },
      location: { name: 'Bundles', query: { filters: 'neurodivergent-adhd-autism' } },
      href: '/bundles?filters=neurodivergent-adhd-autism',
    },
  ])('$type tag "$tag.tag" links to $href', async ({ type, tag, location, href }) => {
    const screen = renderWith(Tag, { props: { type, tag } })

    await clickLater(screen.getByText(tag.tag))

    expect(store.state[type].filters).toEqual([tag])
    expect(router.push).toHaveBeenCalledTimes(1)
    expect(router.push).toHaveBeenCalledWith(location)
    expect(hrefOf(location)).toBe(href)
  })

  test('a link tag also emits click with the tag', async () => {
    const tag = { id: 't2', tag: 'Arab/Middle Eastern' }
    const screen = renderWith(Tag, { props: { type: 'books', tag } })

    await clickLater(screen.getByText('Arab/Middle Eastern'))

    expect(screen.emitted('click')).toEqual([[tag]])
    expect(screen.emitted('remove')).toBeUndefined()
  })

  test('a link tag merges buttonClass into its button classes', () => {
    const screen = renderWith(Tag, {
      props: { type: 'books', tag: { id: 't1', tag: 'Asian' }, buttonClass: 'is-outlined' },
    })

    const button = screen.getByRole('button', { name: 'Asian' })
    expect(button.classList).toHaveLength(6)
    expect(button).toHaveClass(
      'button',
      'is-primary',
      'is-rounded',
      'is-mini',
      'mb-1',
      'is-outlined',
    )
  })

  test('an editable tag links to the tags manager for its type', async () => {
    const screen = renderWith(Tag, {
      props: { type: 'books', tag: { id: 't1', tag: 'Asian' }, editable: true },
    })

    await clickLater(screen.getByText('Asian'))

    expect(router.push).toHaveBeenCalledTimes(1)
    expect(router.push).toHaveBeenCalledWith({ name: 'TagsManager', query: { active: 'books' } })
    expect(hrefOf(lastLocation())).toBe('/admin/tags?active=books')
    expect(store.state.books.filters).toEqual([])
    // the anchor stops the click, so the button never emits click
    expect(screen.emitted('click')).toBeUndefined()
  })

  test('an editable tag emits remove when its ✕ is clicked', async () => {
    const tag = { id: 't1', tag: 'Asian' }
    const screen = renderWith(Tag, { props: { type: 'people', tag, editable: true } })

    await clickLater(screen.getByText('✕'))

    expect(screen.emitted('remove')).toEqual([[tag]])
    expect(navigate).not.toHaveBeenCalled()
  })

  test('a nolink tag renders a span with the tag text and never navigates', async () => {
    const tag = { id: 't1', tag: 'Asian' }
    const screen = renderWith(Tag, { props: { tag, nolink: true } })

    expect(nolinkTag(screen.container)).toHaveTextContent('Asian')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText('✕')).not.toBeInTheDocument()

    await clickLater(screen.getByText('Asian'))

    expect(screen.emitted('click')).toEqual([[tag]])
    expect(navigate).not.toHaveBeenCalled()
    expect(store.state.books.filters).toEqual([])
  })

  test('a nolink tag renders its slot in place of the tag text', () => {
    const screen = renderWith(Tag, {
      props: { tag: { id: 't1', tag: 'Asian' }, nolink: true },
      slots: { default: 'Custom label' },
    })

    expect(nolinkTag(screen.container)).toHaveTextContent('Custom label')
    expect(screen.queryByText('Asian')).not.toBeInTheDocument()
  })

  test('a nolink editable tag emits remove when its ✕ is clicked', async () => {
    const tag = { id: 't1', tag: 'Asian' }
    const screen = renderWith(Tag, { props: { tag, nolink: true, editable: true } })

    await clickLater(screen.getByText('✕'))

    expect(screen.emitted('remove')).toEqual([[tag]])
    expect(navigate).not.toHaveBeenCalled()
  })

  test('merges tagStyle over the static style, keeping !important', () => {
    const screen = renderWith(Tag, {
      props: {
        tag: { tag: 'ADD TAG' },
        nolink: true,
        tagStyle: 'background-color: #fff; color: #000 !important; cursor: pointer',
      },
    })

    const span = nolinkTag(screen.container)
    expect(span).toHaveStyle({
      backgroundColor: '#fff',
      color: '#000',
      cursor: 'pointer',
      fontSize: '10px',
    })
    expect(span.style.getPropertyPriority('color')).toBe('important')
    expect(span.style.getPropertyPriority('cursor')).toBe('')
  })

  test('logs an error when neither type nor nolink is given', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    renderWith(Tag, { props: { tag: { id: 't1', tag: 'Asian' } } })

    expect(error).toHaveBeenCalledWith(
      'components/Tag: Type attribute is required unless nolink is specified.',
    )
  })

  test('renders nothing without a tag', () => {
    const { container } = renderWith(Tag, { props: { tag: null, nolink: true } })

    expect(container).toBeEmptyDOMElement()
  })
})

describe('Multiselect', () => {
  const options = [
    { id: 'a', tag: 'Asian' },
    { id: 'g', tag: 'Gender' },
    { id: 'g1', tag: 'Girl', parent: 'g' },
  ]

  /** Renders the dropdown with Girl selected. */
  const renderMultiselect = () =>
    renderWith(Multiselect, { props: { label: 'ADD TAG', options, selected: [{ id: 'g1' }] } })

  test('lists every option in order, indenting sub-options', () => {
    const { container } = renderMultiselect()

    expect(dropdownItems(container).map(a => a.textContent.trim())).toEqual([
      'Asian',
      'Gender',
      'Girl',
    ])
    expect(dropdownItem(container, 'Girl')).toHaveClass('ml-20')
    expect(dropdownItem(container, 'Asian')).not.toHaveClass('ml-20')
  })

  test('colors unselected options black and leaves selected ones unstyled', () => {
    const { container } = renderMultiselect()

    expect(dropdownItem(container, 'Asian')).toHaveStyle({ color: '#000' })
    // every style value is null for a selected leaf, so Vue sets no inline property at all
    expect(inlineStyle(dropdownItem(container, 'Girl'))).toBe('')
  })

  test('disables hover on a parent option and ignores clicks on it', async () => {
    const screen = renderMultiselect()
    const gender = dropdownItem(screen.container, 'Gender')

    expect(gender).toHaveStyle({ cursor: 'default', backgroundColor: '#fff', color: '#000' })
    expect(dropdownItem(screen.container, 'Asian')).not.toHaveStyle({ cursor: 'default' })

    await clickLater(screen.getByText('ADD TAG'))
    await clickLater(gender)

    expect(screen.emitted('select')).toBeUndefined()
    expect(dropdown(screen.container)).toHaveClass('is-active')
  })

  test('the ADD TAG tag toggles the dropdown open and closed', async () => {
    const screen = renderMultiselect()

    expect(dropdown(screen.container)).not.toHaveClass('is-active')
    await clickLater(screen.getByText('ADD TAG'))
    expect(dropdown(screen.container)).toHaveClass('is-active')
    await clickLater(screen.getByText('ADD TAG'))
    expect(dropdown(screen.container)).not.toHaveClass('is-active')
  })

  test('renders the ADD TAG trigger as a white nolink tag with a pointer', () => {
    const { container } = renderMultiselect()

    expect(nolinkTag(container)).toHaveTextContent('ADD TAG')
    expect(nolinkTag(container)).toHaveStyle({
      backgroundColor: '#fff',
      borderColor: '#000',
      color: '#000',
      cursor: 'pointer',
    })
  })

  test('choosing a selected option emits value false and closes the dropdown', async () => {
    const screen = renderMultiselect()

    await clickLater(screen.getByText('ADD TAG'))
    await clickLater(dropdownItem(screen.container, 'Girl'))

    expect(screen.emitted('select')).toEqual([[{ option: options[2], value: false }]])
    expect(dropdown(screen.container)).not.toHaveClass('is-active')
  })

  test('choosing an unselected option emits value true and closes the dropdown', async () => {
    const screen = renderMultiselect()

    await clickLater(screen.getByText('ADD TAG'))
    await clickLater(dropdownItem(screen.container, 'Asian'))

    expect(screen.emitted('select')).toEqual([[{ option: options[0], value: true }]])
    expect(dropdown(screen.container)).not.toHaveClass('is-active')
  })

  test('a click anywhere outside the tag closes the dropdown', async () => {
    const screen = renderMultiselect()

    await clickLater(screen.getByText('ADD TAG'))
    await clickLater(document.body)

    expect(dropdown(screen.container)).not.toHaveClass('is-active')
    expect(screen.emitted('select')).toBeUndefined()
  })
})

describe('AddTag', () => {
  /** Opens the dropdown and chooses the option with the given text. */
  const choose = async (screen, text) => {
    await clickLater(screen.getByText('ADD TAG'))
    await clickLater(dropdownItem(screen.container, text))
  }

  beforeEach(() => {
    store.commit('tags/books/set', {
      t1: { id: 't1', tag: 'Asian', sortOrder: 1 },
      t2: { id: 't2', tag: 'Black', sortOrder: 2 },
    })
    store.commit('tags/people/set', copy(peopleTags))
  })

  test('marks the item tags that still exist as selected', () => {
    const { container } = renderWith(AddTag, {
      props: { type: 'books', item: { id: 'b1', tags: { t1: true, gone: true } } },
    })

    expect(dropdownItems(container).map(a => a.textContent.trim())).toEqual(['Asian', 'Black'])
    expect(inlineStyle(dropdownItem(container, 'Asian'))).toBe('')
    expect(dropdownItem(container, 'Black')).toHaveStyle({ color: '#000' })
  })

  test('adding a book tag updates the book tags and marks the cache dirty', async () => {
    const screen = renderWith(AddTag, {
      props: { type: 'books', item: { id: 'b1', tags: { t1: true, gone: true } } },
    })

    await choose(screen, 'Black')

    await vi.waitFor(() => expect(writes()).toHaveLength(2))
    expect(writes()).toEqual([
      ['update', 'books/b1/tags', { t2: true }],
      ['set', 'cache/clean', false],
    ])
  })

  test('removing a book tag writes null for it', async () => {
    const screen = renderWith(AddTag, {
      props: { type: 'books', item: { id: 'b1', tags: { t1: true, gone: true } } },
    })

    await choose(screen, 'Asian')

    await vi.waitFor(() => expect(writes()).toHaveLength(2))
    expect(writes()).toEqual([
      ['update', 'books/b1/tags', { t1: null }],
      ['set', 'cache/clean', false],
    ])
  })

  test('a person reads and writes identities instead of tags', async () => {
    const screen = renderWith(AddTag, {
      props: { type: 'people', item: { id: 'x1', identities: { p1: true }, tags: { p2: true } } },
    })

    // hidden tags are still offered here: showOnFront only governs the public filters
    expect(dropdownItems(screen.container).map(a => a.textContent.trim())).toEqual([
      'Latinx',
      'Two-Spirit',
      'Hidden',
    ])
    expect(inlineStyle(dropdownItem(screen.container, 'Latinx'))).toBe('')
    expect(dropdownItem(screen.container, 'Two-Spirit')).toHaveStyle({ color: '#000' })

    await choose(screen, 'Two-Spirit')
    await vi.waitFor(() => expect(writes()).toHaveLength(2))
    await choose(screen, 'Latinx')
    await vi.waitFor(() => expect(writes()).toHaveLength(4))

    expect(writes()).toEqual([
      ['update', 'people/x1/identities', { p2: true }],
      ['set', 'cache/clean', false],
      ['update', 'people/x1/identities', { p1: null }],
      ['set', 'cache/clean', false],
    ])
  })
})

describe('MobileFooter', () => {
  beforeEach(() => {
    store.commit('tags/books/set', copy(bookTags))
  })

  test('the test URL resolves to the catch-all NotFound route, where it lists book tags', async () => {
    const screen = renderWith(MobileFooter)
    await router.isReady()

    expect(router.currentRoute.value.name).toBe('NotFound')
    expect(router.currentRoute.value.fullPath).toBe('/__test__')
    expect(optionValues(screen)).toEqual(['t2', 't1', 't3', 't4', 't5', 't6'])
  })

  test('lists the visible book tags, subtags included, in sortOrder, none selected', async () => {
    const screen = renderWith(MobileFooter)
    await router.isReady()

    expect(optionStates(screen)).toEqual([
      ['t2', false],
      ['t1', false],
      ['t3', false],
      ['t4', false],
      ['t5', false],
      ['t6', false],
    ])
    expect(screen.getAllByRole('option').map(option => option.textContent.trim())).toEqual([
      'Arab/Middle Eastern',
      'Black / African American',
      'Indigenous Peoples of the Americas',
      'Gender',
      'Girl',
      'Boy',
    ])
    expect(screen.getByRole('listbox')).toHaveProperty('multiple', true)
    expect(filterBadge(screen)).toBeNull()
  })

  test('selecting options sets the filters, navigates Home, and shows the count', async () => {
    const screen = renderWith(MobileFooter)
    await router.isReady()
    const select = screen.getByRole('listbox')

    screen.getByRole('option', { name: 'Black / African American' }).selected = true
    screen.getByRole('option', { name: 'Gender' }).selected = true
    await fireEvent.change(select)

    expect(filterIds('books')).toEqual(['t1', 't4'])
    expect(lastLocation()).toEqual({
      name: 'Home',
      query: { filters: 'black-african-american,gender' },
    })
    expect(hrefOf(lastLocation())).toBe('/?filters=black-african-american,gender')
    expect(filterBadge(screen)).toHaveTextContent('2')
    expect(optionStates(screen)).toEqual([
      ['t2', false],
      ['t1', true],
      ['t3', false],
      ['t4', true],
      ['t5', false],
      ['t6', false],
    ])
  })

  test('selects and deselects the options for filters set elsewhere', async () => {
    const screen = renderWith(MobileFooter)
    await router.isReady()

    store.commit('books/setFilters', [copy(bookTags.t3)])
    await nextTick()

    expect(optionStates(screen)).toEqual([
      ['t2', false],
      ['t1', false],
      ['t3', true],
      ['t4', false],
      ['t5', false],
      ['t6', false],
    ])
    expect(filterBadge(screen)).toHaveTextContent('1')

    store.commit('books/setFilters', [])
    await nextTick()

    expect(optionStates(screen).filter(([, selected]) => selected)).toEqual([])
    expect(filterBadge(screen)).toBeNull()
    expect(navigate).not.toHaveBeenCalled()
  })

  test('links Books to / and Bundles to /bundles', async () => {
    const screen = renderWith(MobileFooter)
    await router.isReady()

    const books = screen.getByRole('link', { name: 'Books' })
    expect(books).toHaveAttribute('href', '/')
    expect(books).not.toHaveClass('router-link-active')
    expect(screen.getByRole('link', { name: 'Bundles' })).toHaveAttribute('href', '/bundles')
  })

  test('sends a logged out visitor to Login from Saved Items', async () => {
    const screen = renderWith(MobileFooter)
    await router.isReady()
    const toggler = screen.getByRole('link', { name: 'Saved Items' })

    expect(toggler).toHaveClass('bookmarks-toggler')
    expect(badgeIn(toggler)).toBeNull()
    await clickLater(toggler)

    expect(router.push).toHaveBeenCalledTimes(1)
    expect(router.push).toHaveBeenCalledWith({ name: 'Login' })
    expect(hrefOf(lastLocation())).toBe('/login')
    expect(store.state.ui.bookmarksOpen).toBe(false)
  })

  test('toggles the bookmarks panel for a logged in user and counts bookmarks', async () => {
    store.commit('user/setUser', {
      uid: 'u1',
      roles: { authorized: true },
      profile: { bookmarks: { b1: 'book', b2: 'book' } },
    })
    const screen = renderWith(MobileFooter)
    await router.isReady()
    const toggler = screen.getByRole('link', { name: /^Saved Items/ })

    expect(badgeIn(toggler)).toHaveTextContent('2')
    expect(toggler).not.toHaveClass('router-link-active')

    await clickLater(toggler)

    expect(store.state.ui.bookmarksOpen).toBe(true)
    expect(toggler).toHaveClass('router-link-active')
    expect(footerSection(screen.container)).toHaveClass('bookmarksOpen')
    expect(navigate).not.toHaveBeenCalled()

    await clickLater(toggler)

    expect(store.state.ui.bookmarksOpen).toBe(false)
    expect(toggler).not.toHaveClass('router-link-active')
    expect(footerSection(screen.container)).not.toHaveClass('bookmarksOpen')
  })
})

describe('MobileFooter off the books pages', () => {
  /** A blank page for the memory router. */
  const page = { render: () => null }

  /**
   * Renders MobileFooter under a memory router parked on a path, so $route can name a page that
   * the app's router would only reach by loading it lazily. Navigation from the filters still goes
   * through the app's router, which the store imports directly.
   */
  const renderAt = async path => {
    const pageRouter = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'Home', component: page },
        { path: '/bundles', name: 'Bundles', component: page },
        { path: '/people', name: 'People', component: page },
        { path: '/person/:name', name: 'PersonDetail', component: page },
      ],
    })
    await pageRouter.replace(path)
    return renderWith(MobileFooter, { router: pageRouter })
  }

  beforeEach(() => {
    store.commit('tags/books/set', copy(bookTags))
    store.commit('tags/people/set', copy(peopleTags))
    store.commit('tags/bundles/set', {
      j: { id: 'j', tag: 'Joy', sortOrder: 1, showOnFront: true },
    })
  })

  test('on People it filters people and navigates to People', async () => {
    const screen = await renderAt('/people')

    expect(optionValues(screen)).toEqual(['p1', 'p2'])
    screen.getByRole('option', { name: 'Two-Spirit' }).selected = true
    await fireEvent.change(screen.getByRole('listbox'))

    expect(filterIds('people')).toEqual(['p2'])
    expect(store.state.books.filters).toEqual([])
    expect(lastLocation()).toEqual({ name: 'People', query: { filters: 'two-spirit' } })
    expect(hrefOf(lastLocation())).toBe('/people?filters=two-spirit')
  })

  test('on a person page it filters people and highlights Books', async () => {
    const screen = await renderAt('/person/jane-doe')

    expect(optionValues(screen)).toEqual(['p1', 'p2'])
    expect(screen.getByRole('link', { name: 'Books' })).toHaveClass('router-link-active')
  })

  test('on Bundles it lists the bundle tags and sets the bundle filters', async () => {
    const screen = await renderAt('/bundles')

    expect(optionValues(screen)).toEqual(['j'])
    screen.getByRole('option', { name: 'Joy' }).selected = true
    await fireEvent.change(screen.getByRole('listbox'))

    expect(filterIds('bundles')).toEqual(['j'])
    expect(store.state.books.filters).toEqual([])
    expect(filterBadge(screen)).toHaveTextContent('1')
    // one navigation, whose destination is left unasserted: updateUrl sends it to People today
    expect(navigate).toHaveBeenCalledTimes(1)
  })
})
