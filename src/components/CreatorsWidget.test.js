/**
 * CreatorsWidget, CreatorCard and Dropdown: the creator credits on book pages and cards, and the
 * title dropdowns admins use to change a creator's role.
 *
 * Dependency seams guarded:
 * - @sindresorhus/slugify: personPageActive compares slugify(person.name) with $route.params.name,
 * and PersonDetailLink builds the pushed route's name param from it.
 * - vue-router: the live $route after a real navigation to PersonDetail and PersonEdit, and the
 * exact location a name link pushes.
 * - vue 3.5: v-model on a component merged with an explicit @update:model-value listener, named
 * slots, dynamic :style bindings, prop validators, and the global click-outside directive on
 * document.body.
 * - @testing-library/jest-dom: toHaveClass, toHaveStyle, toHaveTextContent.
 *
 * Firebase is a boundary: 'firebase/app' is replaced with a fake v8 namespaced API that records
 * every database write, so a title change is pinned as the exact write it would send.
 */
import { fireEvent, render, within } from '@testing-library/vue'
import { nextTick } from 'vue'
import CreatorCard from '@/components/CreatorCard.vue'
import CreatorsWidget from '@/components/CreatorsWidget.vue'
import Dropdown from '@/components/Dropdown.vue'
import creatorTitles from '@/store/constants/creatorTitles'
import directives from '@/directives'
import mixins from '@/mixins/global'
import router from '@/router'
import store from '@/store'

const { write } = vi.hoisted(() => {
  // start on a static route so installing the router does not lazily load a real page
  window.history.replaceState(null, '', '/__test__')
  return { write: vi.fn() }
})

vi.mock('firebase/app', () => {
  /** A fake v8 Reference that records set/update calls as write(method, path, value). */
  const ref = path => ({
    set: async value => write('set', path, value),
    update: async value => write('update', path, value),
  })
  return { default: { initializeApp: () => {}, database: () => ({ ref }) } }
})
vi.mock('firebase/auth', () => ({}))
vi.mock('firebase/database', () => ({}))
vi.mock('firebase/storage', () => ({}))
vi.mock('@/pages/PersonDetail.vue', () => ({ default: { render: () => null } }))
vi.mock('@/pages/PersonEdit.vue', () => ({ default: { render: () => null } }))

window.scrollTo = vi.fn()

const PEOPLE = {
  p1: { id: 'p1', name: 'Yuyi Morales' },
  p2: { id: 'p2', name: 'Juana Martinez-Neal' },
  p3: { id: 'p3', name: "Sean O'Neal" },
}

const pristine = JSON.parse(JSON.stringify(store.state))

/** Renders a subject with the real store and router, global mixins, and the real click-outside directive (v-tippy stubbed). */
const renderWith = (component, props) =>
  render(component, {
    props,
    global: {
      plugins: [store, router],
      mixins: [mixins],
      directives: { ...directives, tippy: () => {} },
    },
  })

/** Renders a CreatorsWidget for book b1 with the given creators map and flags. */
const renderWidget = (creators, flags = {}) =>
  renderWith(CreatorsWidget, { book: { id: 'b1', creators }, ...flags })

/** Lists a CreatorsWidget's credit labels, names (tagged A or SPAN), and commas in document order. */
const creditLine = container =>
  // eslint-disable-next-line testing-library/no-node-access -- labels, names and commas have no role or label to query by, and the tag is the behavior
  [...container.querySelectorAll('b, .name, span.mr-2')].map(el =>
    el.matches('.name') ? `${el.tagName}:${el.textContent}` : el.textContent,
  )

/** Returns the .dropdown wrappers, which carry is-active and have no role of their own. */
const dropdownsIn = container =>
  // eslint-disable-next-line testing-library/no-node-access -- the wrapper has no role, text or label
  [...container.querySelectorAll('.dropdown')]

/** Returns a CreatorCard's avatar circle and the layers inside it, all bare divs. */
const avatarOf = container => {
  // eslint-disable-next-line testing-library/no-node-access -- the avatar is a bare div with no text, role or label
  const circle = container.querySelector('.bg-secondary')
  // eslint-disable-next-line testing-library/no-node-access -- as is the photo layer inside it
  return { circle, layers: circle ? [...circle.children] : [] }
}

/** Lists the texts of a rendered dropdown menu's entries, in order. */
const entriesIn = menu =>
  within(menu)
    .getAllByText(/\S/)
    .map(el => el.textContent.trim())

/** Lists the option texts a rendered Dropdown menu marks selected. */
const selectedIn = menu =>
  creatorTitles
    .map(title => title.text)
    .filter(text => within(menu).getByText(text).classList.contains('selected'))

beforeEach(() => {
  store.replaceState(JSON.parse(JSON.stringify(pristine)))
  store.commit('people/set', JSON.parse(JSON.stringify(PEOPLE)))
  write.mockClear()
})

afterEach(async () => {
  vi.restoreAllMocks()
  // the history location outlives the unmounted app and would be replayed on the next install
  await router.replace('/__test__')
})

describe('CreatorsWidget credits', () => {
  test('an author-illustrator alone is credited "by", with no words or pictures credit', () => {
    const { container } = renderWidget({ p1: 'author-illustrator' })

    expect(creditLine(container)).toEqual(['by', 'SPAN:Yuyi Morales'])
    expect(container).toHaveTextContent(/^by ?Yuyi Morales$/)
  })

  test('a separate author and illustrator get "words by" and "pictures by"', () => {
    const { container } = renderWidget({ p1: 'author', p2: 'illustrator' })

    expect(creditLine(container)).toEqual([
      'words by',
      'SPAN:Yuyi Morales',
      'pictures by',
      'SPAN:Juana Martinez-Neal',
    ])
  })

  test('an author-illustrator is listed under both credits, in the key order of creators', () => {
    const { container } = renderWidget({
      p1: 'author-illustrator',
      p2: 'illustrator',
      p3: 'author',
    })

    expect(creditLine(container)).toEqual([
      'words by',
      'SPAN:Yuyi Morales',
      ',',
      "SPAN:Sean O'Neal",
      'pictures by',
      'SPAN:Yuyi Morales',
      ',',
      'SPAN:Juana Martinez-Neal',
    ])
    expect(container).toHaveTextContent(
      /^words by ?Yuyi Morales ?, ?Sean O'Neal ?pictures by ?Yuyi Morales ?, ?Juana Martinez-Neal$/,
    )
  })

  test('a creator id missing from people renders an empty name without crashing', () => {
    const { container } = renderWidget({ p1: 'author', ghost: 'author' }, { linked: true })

    expect(creditLine(container)).toEqual(['words by', 'A:Yuyi Morales', ',', 'SPAN:'])
  })

  test('without linked, every name is plain text', () => {
    const { container } = renderWidget({ p1: 'author', p3: 'author' })

    expect(creditLine(container)).toEqual([
      'words by',
      'SPAN:Yuyi Morales',
      ',',
      "SPAN:Sean O'Neal",
    ])
  })
})

describe('CreatorsWidget links', () => {
  test('linked names are anchors that push the slugified PersonDetail route', async () => {
    const push = vi.spyOn(router, 'push').mockResolvedValue()
    const { container, getAllByText, getByText } = renderWidget(
      { p1: 'author-illustrator', p2: 'illustrator', p3: 'author' },
      { linked: true },
    )

    expect(creditLine(container)).toEqual([
      'words by',
      'A:Yuyi Morales',
      ',',
      "A:Sean O'Neal",
      'pictures by',
      'A:Yuyi Morales',
      ',',
      'A:Juana Martinez-Neal',
    ])
    getAllByText('Yuyi Morales').forEach(el => expect(el).toHaveClass('name', 'linked'))

    await fireEvent.click(getByText("Sean O'Neal"))

    expect(push.mock.calls).toEqual([[{ name: 'PersonDetail', params: { name: 'sean-o-neal' } }]])
  })

  test('linked names in edit mode push the PersonEdit route', async () => {
    const push = vi.spyOn(router, 'push').mockResolvedValue()
    const { getByText } = renderWidget({ p2: 'illustrator' }, { linked: true, edit: true })

    await fireEvent.click(getByText('Juana Martinez-Neal'))

    expect(push.mock.calls).toEqual([
      [{ name: 'PersonEdit', params: { name: 'juana-martinez-neal' } }],
    ])
  })

  test.each([
    ['PersonDetail', '/person/yuyi-morales'],
    ['PersonEdit', '/person/yuyi-morales/edit'],
  ])(
    'on the %s page of a creator, that creator is plain text and the others stay linked',
    async (routeName, path) => {
      const { container } = renderWidget(
        { p1: 'author-illustrator', p2: 'illustrator', p3: 'author' },
        { linked: true },
      )

      await router.push(path)
      await nextTick()

      expect(router.currentRoute.value.name).toBe(routeName)
      expect(router.currentRoute.value.params).toEqual({ name: 'yuyi-morales' })
      expect(creditLine(container)).toEqual([
        'words by',
        'SPAN:Yuyi Morales',
        ',',
        "A:Sean O'Neal",
        'pictures by',
        'SPAN:Yuyi Morales',
        ',',
        'A:Juana Martinez-Neal',
      ])
    },
  )

  test('a person page matches a creator whose name slugifies with transliteration', async () => {
    store.commit('people/set', { p4: { id: 'p4', name: 'Ángela Dominguez' } })
    const { container } = renderWidget({ p4: 'author' }, { linked: true })
    expect(creditLine(container)).toEqual(['words by', 'A:Ángela Dominguez'])

    await router.push('/person/angela-dominguez')
    await nextTick()

    expect(creditLine(container)).toEqual(['words by', 'SPAN:Ángela Dominguez'])
  })
})

describe('CreatorsWidget title dropdowns', () => {
  test('clicking a credit opens only its own dropdown, and a body click closes it', async () => {
    const { container, getByText } = renderWidget(
      { p1: 'author', p3: 'author', p2: 'illustrator' },
      { edit: true },
    )
    const [authorDropdown, illustratorDropdown] = dropdownsIn(container)

    await fireEvent.click(getByText('words by'))

    expect(authorDropdown).toHaveClass('is-active')
    expect(illustratorDropdown).not.toHaveClass('is-active')
    expect(getByText('words by')).toHaveClass('is-primary')

    await fireEvent.click(document.body)

    expect(authorDropdown).not.toHaveClass('is-active')
    expect(getByText('words by')).not.toHaveClass('is-primary')

    await fireEvent.click(getByText('pictures by'))

    expect(authorDropdown).not.toHaveClass('is-active')
    expect(illustratorDropdown).toHaveClass('is-active')
  })

  test('each credit has a dropdown listing every creator title', () => {
    const { getAllByRole } = renderWidget({ p1: 'author', p2: 'illustrator' }, { edit: true })

    const menus = getAllByRole('menu')
    expect(menus).toHaveLength(2)
    expect(menus.map(entriesIn)).toEqual([
      ['Author', 'Illustrator', 'Author/Illustrator'],
      ['Author', 'Illustrator', 'Author/Illustrator'],
    ])
  })

  test('choosing Author/Illustrator for the authors updates every author and marks the cache dirty', async () => {
    const { container, getAllByRole } = renderWidget(
      { p1: 'author', p3: 'author', p2: 'illustrator' },
      { edit: true },
    )
    const [authorMenu] = getAllByRole('menu')

    await fireEvent.click(within(authorMenu).getByText('Author/Illustrator'))

    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2))
    expect(write.mock.calls).toEqual([
      ['update', 'books/b1/creators', { p1: 'author-illustrator', p3: 'author-illustrator' }],
      ['set', 'cache/clean', false],
    ])
    expect(dropdownsIn(container)[0]).not.toHaveClass('is-active')
  })

  test('choosing the unchanged title writes nothing, and a real change still writes', async () => {
    const { getAllByRole } = renderWidget(
      { p1: 'author', p3: 'author', p2: 'illustrator' },
      { edit: true },
    )
    const [, illustratorMenu] = getAllByRole('menu')

    await fireEvent.click(within(illustratorMenu).getByText('Illustrator'))
    // a second, real change acts as a sentinel: once it lands, any write from the first would too
    await fireEvent.click(within(illustratorMenu).getByText('Author'))

    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2))
    expect(write.mock.calls).toEqual([
      ['update', 'books/b1/creators', { p2: 'author' }],
      ['set', 'cache/clean', false],
    ])
  })

  test('when every author is an author-illustrator, choosing Author demotes them to author', async () => {
    const { getAllByRole, getByText } = renderWidget({ p1: 'author-illustrator' }, { edit: true })
    const menus = getAllByRole('menu')

    expect(menus).toHaveLength(1)
    expect(getByText('by').tagName).toBe('A')

    await fireEvent.click(within(menus[0]).getByText('Author'))

    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2))
    expect(write.mock.calls).toEqual([
      ['update', 'books/b1/creators', { p1: 'author' }],
      ['set', 'cache/clean', false],
    ])
  })
})

describe('CreatorCard', () => {
  test.each([
    ['author', false, 'words by'],
    ['illustrator', false, 'pictures by'],
    ['author-illustrator', false, 'by'],
    ['author-illustrator', true, 'words and pictures by'],
    ['author', true, 'words by'],
  ])('role %s with longlabel %s is titled "%s"', (role, longlabel, title) => {
    const { container, getByText } = renderWith(CreatorCard, { id: 'p1', role, longlabel })

    expect(getByText(title)).toHaveClass('nowrap')
    expect(getByText('Yuyi Morales').tagName).toBe('A')
    expect(container).toHaveTextContent(new RegExp(`^${title} ?Yuyi Morales$`))
  })

  test.each([
    ['an object with a url', { url: 'https://x/y.jpg' }],
    ['a url string', 'https://x/y.jpg'],
  ])('a photo given as %s becomes the avatar background', (_, photo) => {
    store.commit('people/set', { p1: { id: 'p1', name: 'Yuyi Morales', photo } })
    const { container } = renderWith(CreatorCard, { id: 'p1', role: 'author' })

    const { circle, layers } = avatarOf(container)
    expect(circle).toHaveStyle({ width: '70px', height: '70px', borderRadius: '999px' })
    expect(layers).toHaveLength(1)
    expect(layers[0]).toHaveStyle({
      backgroundImage: 'url(https://x/y.jpg)',
      backgroundSize: 'cover',
    })
  })

  test('without a photo the avatar is an empty circle', () => {
    const { container } = renderWith(CreatorCard, { id: 'p1', role: 'author' })

    const { circle, layers } = avatarOf(container)
    expect(circle).toHaveStyle({ width: '70px', height: '70px' })
    expect(layers).toHaveLength(0)
  })

  test('an id missing from people renders the title but no avatar or name link', () => {
    const { container, getByText } = renderWith(CreatorCard, { id: 'ghost', role: 'illustrator' })

    expect(getByText('pictures by')).toHaveClass('nowrap')
    expect(container).toHaveTextContent(/^pictures by$/)
    expect(avatarOf(container).circle).toBeNull()
  })

  test('the name links to the slugified PersonDetail route, or PersonEdit in edit mode', async () => {
    const push = vi.spyOn(router, 'push').mockResolvedValue()
    const view = renderWith(CreatorCard, { id: 'p3', role: 'author' })

    await fireEvent.click(view.getByText("Sean O'Neal"))
    view.unmount()
    const edit = renderWith(CreatorCard, { id: 'p3', role: 'author', edit: true })
    await fireEvent.click(edit.getByText("Sean O'Neal"))

    expect(push.mock.calls).toEqual([
      [{ name: 'PersonDetail', params: { name: 'sean-o-neal' } }],
      [{ name: 'PersonEdit', params: { name: 'sean-o-neal' } }],
    ])
  })

  test('in edit mode the title is a dropdown with a remove action slotted before the titles', () => {
    const { getByRole, getByText } = renderWith(CreatorCard, {
      id: 'p1',
      role: 'author',
      edit: true,
    })

    expect(getByText('words by').tagName).toBe('A')
    expect(getByText('words by')).toHaveClass('primary-hover')
    expect(getByText('words by')).toHaveStyle({ fontWeight: 'bold' })
    const menu = getByRole('menu')
    expect(entriesIn(menu)).toEqual([
      'REMOVE CREATOR',
      'Author',
      'Illustrator',
      'Author/Illustrator',
    ])
    expect(within(menu).getByRole('separator').tagName).toBe('HR')
    expect(selectedIn(menu)).toEqual(['Author'])
  })

  test('REMOVE CREATOR emits remove, and choosing a title emits updateTitle and selects it', async () => {
    const { emitted, getByRole, getByText } = renderWith(CreatorCard, {
      id: 'p1',
      role: 'author',
      edit: true,
    })
    const menu = getByRole('menu')

    await fireEvent.click(getByText('REMOVE CREATOR'))
    await fireEvent.click(within(menu).getByText('Illustrator'))

    expect(emitted().remove).toEqual([[]])
    expect(emitted().updateTitle).toEqual([['illustrator']])
    // v-model moved the local title; the label still follows the role prop
    expect(selectedIn(menu)).toEqual(['Illustrator'])
    expect(getByText('words by').tagName).toBe('A')
  })
})

describe('Dropdown', () => {
  /** Renders a Dropdown over the creator titles with the given props. */
  const renderDropdown = props => renderWith(Dropdown, { options: creatorTitles, ...props })

  test('a button shows the default value as its label and marks that option selected', () => {
    const { getByRole } = renderDropdown({ format: 'button', defaultValue: 'illustrator' })

    expect(getByRole('button')).toHaveTextContent(/^Illustrator$/)
    expect(selectedIn(getByRole('menu'))).toEqual(['Illustrator'])
  })

  test('modelValue takes precedence over defaultValue', () => {
    const { getByRole } = renderDropdown({
      format: 'button',
      modelValue: 'author',
      defaultValue: 'illustrator',
    })

    expect(getByRole('button')).toHaveTextContent(/^Author$/)
    expect(selectedIn(getByRole('menu'))).toEqual(['Author'])
  })

  test('a button with no value and no placeholder reads "Choose"', () => {
    const { getByRole } = renderDropdown({ format: 'button' })

    expect(getByRole('button')).toHaveTextContent(/^Choose$/)
    expect(selectedIn(getByRole('menu'))).toEqual([])
  })

  test('a link is the default format and shows the placeholder when nothing is selected', () => {
    const { getByText, queryByRole } = renderDropdown({ placeholder: 'Pick' })

    expect(getByText('Pick').tagName).toBe('A')
    expect(getByText('Pick')).toHaveClass('primary-hover')
    expect(queryByRole('button')).not.toBeInTheDocument()
  })

  test('a label overrides both the selected option and the placeholder', () => {
    const button = renderDropdown({
      format: 'button',
      label: 'Role',
      modelValue: 'author',
      placeholder: 'Pick',
    })
    expect(button.getByRole('button')).toHaveTextContent(/^Role$/)
    button.unmount()

    const link = renderDropdown({ label: 'Role', modelValue: 'author', placeholder: 'Pick' })
    expect(link.getByText('Role').tagName).toBe('A')
    expect(link.queryByText('Pick')).not.toBeInTheDocument()
  })

  test('the button toggles the menu, and a click anywhere else closes it', async () => {
    const { container, getByRole } = renderDropdown({ format: 'button' })
    const [dropdown] = dropdownsIn(container)

    await fireEvent.click(getByRole('button'))
    expect(dropdown).toHaveClass('is-active')

    await fireEvent.click(getByRole('button'))
    expect(dropdown).not.toHaveClass('is-active')

    await fireEvent.click(getByRole('button'))
    await fireEvent.click(document.body)
    expect(dropdown).not.toHaveClass('is-active')
  })

  test('choosing an option emits update:modelValue and closes the menu', async () => {
    const { container, emitted, getByText } = renderDropdown({ placeholder: 'Pick' })
    const [dropdown] = dropdownsIn(container)

    await fireEvent.click(getByText('Pick'))
    expect(dropdown).toHaveClass('is-active')
    expect(getByText('Pick')).toHaveClass('is-primary')

    await fireEvent.click(getByText('Author'))

    expect(emitted()['update:modelValue']).toEqual([['author']])
    expect(dropdown).not.toHaveClass('is-active')
  })

  test('an unknown format fails the prop validator and renders no trigger', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { queryByRole, queryByText } = renderDropdown({ format: 'menu', placeholder: 'Pick' })

    expect(warn.mock.calls.map(call => call[0])).toContainEqual(
      expect.stringContaining('Invalid prop: custom validator check failed for prop "format"'),
    )
    expect(queryByRole('button')).not.toBeInTheDocument()
    expect(queryByText('Pick')).not.toBeInTheDocument()
  })
})
