/**
 * Characterizes the small Vue UI plugins the app installs, and the vue runtime internals its
 * components read, so an upgrade of any of them that changes behavior fails here and names the seam:
 * - vue-tippy: the default plugin installed in src/main.js, and every `v-tippy="{ content }"`
 * binding (Tag.vue, TagsTable.vue, InvitationTable.vue, Dashboard.vue, ...), including RightBar's
 * v-tippy on the BookmarkIcon component.
 * - vue-next-masonry: the default plugin installed in src/main.js and BooksView's
 * `<masonry :cols="{ default: 4, 1024: 3, 440: 2, 0: 1 }" :gutter="20">`.
 * - vuedraggable: TagsTable's `<draggable v-model @start @end :move item-key="id" tag="tbody">`,
 * including the callbacks it hands SortableJS. No pointer drag is simulated; Sortable's own drag
 * detection is out of scope.
 * - clipboard: `new Clipboard('#copy-link')` in BookDetail, BookEdit and BookmarksView, and
 * `new Clipboard('.copy-link')` in InvitationTable.
 * - vue: `shallowRef()._value` (router.currentRoute._value), `defineAsyncComponent().__asyncResolved`
 * (Content.vue), `$slots.default()[0].children` as a raw string (HighlightedText.vue, Content.vue),
 * and plain `<template>` children counted by `$slots.default().length` (MessageSequence.vue).
 *
 * Each package is exercised for real; the only stub is document.execCommand, which jsdom lacks.
 */
/* eslint-disable testing-library/no-node-access, testing-library/no-container, vue/one-component-per-file --
 * the contracts here are the DOM the packages build (masonry's column divs, tippy's body-level root,
 * Sortable's tbody) and the properties they write on elements (el._tippy), which Testing Library's
 * queries do not reach; each test mounts its own small harness component. */
import { createApp, defineAsyncComponent, defineComponent, h, nextTick, ref, shallowRef } from 'vue'
import { fireEvent, render } from '@testing-library/vue'
import VueTippy from 'vue-tippy'
import VueMasonry from 'vue-next-masonry'
import draggable from 'vuedraggable'
import Sortable from 'sortablejs'
import Clipboard from 'clipboard'
import HighlightedText from '@/components/HighlightedText'
import MessageSequence from '@/components/MessageSequence'

describe('vue-tippy', () => {
  afterEach(() => {
    document.querySelectorAll('[data-tippy-root]').forEach(root => root.remove())
  })

  /** Renders a button carrying `v-tippy="{ content: help }"` through the real plugin. */
  const renderTooltip = help =>
    render(
      defineComponent({
        setup: () => ({ help }),
        template: '<button v-tippy="{ content: help }">?</button>',
      }),
      { global: { plugins: [VueTippy] } },
    )

  test('the default export is a plugin whose install registers the tippy directive', () => {
    expect(Object.keys(VueTippy)).toEqual(['install'])
    const app = createApp({}).use(VueTippy)
    expect(app.directive('tippy')).toMatchObject({
      mounted: expect.any(Function),
      updated: expect.any(Function),
      unmounted: expect.any(Function),
    })
  })

  test('v-tippy="{ content }" gives the element a tippy with that content, which follows the binding', async () => {
    const help = ref('Help')
    const { getByRole } = renderTooltip(help)
    const button = getByRole('button')
    expect(button._tippy.props.content).toBe('Help')
    expect(button._tippy.props.trigger).toBe('mouseenter focus')

    help.value = 'Help me'
    await nextTick()
    expect(button._tippy.props.content).toBe('Help me')
  })

  test('hovering shows the content in a [data-tippy-root] appended to document.body, and mouseleave hides it', async () => {
    const { getByRole } = renderTooltip(ref('Help me'))
    const button = getByRole('button')

    await fireEvent.mouseEnter(button)
    await vi.waitFor(() => expect(document.querySelector('[data-tippy-root]')).not.toBeNull())
    const root = document.querySelector('[data-tippy-root]')
    expect(root.parentNode).toBe(document.body)
    expect(root.querySelector('.tippy-content')).toHaveTextContent(/^Help me$/)
    expect(button._tippy.state.isVisible).toBe(true)

    // tippy hides on the animation frame after mouseleave
    await fireEvent.mouseLeave(button)
    await vi.waitFor(() => expect(button._tippy.state.isVisible).toBe(false))
  })

  test('unmounting destroys the tippy and removes its shown tooltip', async () => {
    const { getByRole, unmount } = renderTooltip(ref('Help'))
    const button = getByRole('button')
    button._tippy.show()
    await vi.waitFor(() => expect(document.querySelectorAll('[data-tippy-root]')).toHaveLength(1))

    unmount()
    expect(button._tippy).toBeUndefined()
    expect(document.querySelectorAll('[data-tippy-root]')).toHaveLength(0)
  })

  test('v-tippy on a component lands on its root element, as RightBar puts it on BookmarkIcon', () => {
    const BookmarkIcon = { template: '<svg class="bookmark-icon"><path d="M0 0" /></svg>' }
    const { container } = render(
      defineComponent({
        components: { BookmarkIcon },
        data: () => ({ count: 2 }),
        template: `<a><BookmarkIcon v-tippy="{ content: \`You have \${count} saved books\` }" /></a>`,
      }),
      { global: { plugins: [VueTippy] } },
    )
    expect(container.querySelector('svg.bookmark-icon')._tippy.props.content).toBe(
      'You have 2 saved books',
    )
  })
})

describe('vue-next-masonry', () => {
  const defaultInnerWidth = window.innerWidth
  const books = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7']

  afterEach(() => {
    window.innerWidth = defaultInnerWidth
  })

  /** Renders a list of book ids through the real masonry with BooksView's cols and gutter. */
  const renderMasonry = list =>
    render(
      defineComponent({
        setup: () => ({ list }),
        template: `<masonry :cols="{ default: 4, 1024: 3, 440: 2, 0: 1 }" :gutter="20"
          ><div v-for="book of list" :key="book">{{ book }}</div></masonry
        >`,
      }),
      { global: { plugins: [VueMasonry] } },
    )

  /** Reads the masonry's columns, left to right, as the text of the items in each. */
  const columns = container =>
    [...container.firstElementChild.children].map(column =>
      [...column.children].map(item => item.textContent),
    )

  /** Waits until the masonry has measured the window, which it does on the tick after mounting. */
  const measured = container =>
    vi.waitFor(() => expect(container.firstElementChild).toHaveStyle({ marginLeft: '-20px' }))

  test('the default export is a plugin whose install registers <masonry> with cols and gutter props', () => {
    expect(Object.keys(VueMasonry)).toEqual(['install'])
    const masonry = createApp({}).use(VueMasonry).component('masonry')
    expect(masonry.props).toHaveProperty('cols')
    expect(masonry.props).toHaveProperty('gutter')
  })

  const fourColumns = [['b1', 'b5'], ['b2', 'b6'], ['b3', 'b7'], ['b4']]
  const threeColumns = [
    ['b1', 'b4', 'b7'],
    ['b2', 'b5'],
    ['b3', 'b6'],
  ]
  const twoColumns = [
    ['b1', 'b3', 'b5', 'b7'],
    ['b2', 'b4', 'b6'],
  ]

  test.each([
    [1440, fourColumns, 25],
    [1024, threeColumns, 100 / 3],
    [800, threeColumns, 100 / 3],
    [440, twoColumns, 50],
    [320, twoColumns, 50],
    [1, twoColumns, 50],
  ])(
    'at innerWidth %i the smallest breakpoint at or above the width deals items round-robin into columns',
    async (width, expected, percent) => {
      window.innerWidth = width
      const { container } = renderMasonry(ref(books))
      await measured(container)

      expect(columns(container)).toEqual(expected)
      const wrapper = container.firstElementChild
      expect(wrapper).toHaveStyle({ display: 'flex' })
      const columnElements = [...wrapper.children]
      columnElements.forEach(column => {
        expect(column).toHaveStyle({ borderLeftWidth: '20px' })
        expect(parseFloat(column.style.width)).toBeCloseTo(percent)
      })
    },
  )

  test('a window resize re-lays the items out for the new width', async () => {
    window.innerWidth = 1440
    const { container } = renderMasonry(ref(books))
    await measured(container)
    expect(columns(container)).toEqual(fourColumns)

    window.innerWidth = 400
    window.dispatchEvent(new Event('resize'))
    await vi.waitFor(() => expect(columns(container)).toEqual(twoColumns))
  })

  test('appending a book, as BooksView does when its limit grows, adds it to the next column and keeps the existing item elements', async () => {
    window.innerWidth = 400
    const list = ref(books)
    const { container, getByText } = renderMasonry(list)
    await measured(container)
    const first = getByText('b1')

    list.value = [...books, 'b8']
    await nextTick()
    expect(columns(container)).toEqual([
      ['b1', 'b3', 'b5', 'b7'],
      ['b2', 'b4', 'b6', 'b8'],
    ])
    expect(getByText('b1')).toBe(first)
  })
})

describe('vuedraggable', () => {
  const tagA = { id: 'a', tag: 'A' }
  const tagB = { id: 'b', tag: 'B' }
  const tagC = { id: 'c', tag: 'C' }

  /** Renders tags through the real draggable with TagsTable's v-model, @start, @end, :move, item-key and tag. */
  const renderTags = ({ tags, start = vi.fn(), end = vi.fn(), move = vi.fn() }) =>
    render(
      defineComponent({
        components: { draggable },
        setup: () => ({ tags, start, end, move }),
        template: `<table>
          <draggable v-model="tags" @start="start" @end="end" :move="move" item-key="id" tag="tbody">
            <template #item="{ element: tag }">
              <tr :data-id="tag.id">{{ tag.tag }}</tr>
            </template>
          </draggable>
        </table>`,
      }),
    )

  /** Reads the rendered rows' text in DOM order. */
  const rowText = container =>
    [...container.querySelectorAll('tbody > tr')].map(row => row.textContent)

  /** Returns the SortableJS instance vuedraggable created on the tbody, and its rows. */
  const sortableOf = container => {
    const tbody = container.querySelector('tbody')
    return { tbody, rows: [...tbody.children], sortable: Sortable.get(tbody) }
  }

  test('the default export is the draggable component with the props and emits TagsTable binds', () => {
    expect(draggable.name).toBe('draggable')
    expect(Object.keys(draggable.props)).toEqual(
      expect.arrayContaining(['list', 'modelValue', 'itemKey', 'tag', 'move', 'componentData']),
    )
    expect(draggable.props.itemKey.required).toBe(true)
    expect(draggable.emits).toEqual(expect.arrayContaining(['start', 'end', 'update:modelValue']))
  })

  test('renders one tbody of rows in list order, each marked data-draggable, and no error block', () => {
    const { container } = renderTags({ tags: ref([tagA, tagB, tagC]) })
    expect(container.querySelectorAll('tbody')).toHaveLength(1)
    expect(rowText(container)).toEqual(['A', 'B', 'C'])
    container.querySelectorAll('tbody > tr').forEach(row => {
      expect(row.dataset.draggable).toBe('true')
    })
    // vuedraggable catches its own render errors and renders the stack in a <pre> instead of throwing
    expect(container.querySelector('pre')).toBeNull()
  })

  test('the Sortable it creates on the tbody drags only the data-draggable rows', () => {
    const { container } = renderTags({ tags: ref([tagA, tagB, tagC]) })
    const { tbody, sortable } = sortableOf(container)
    expect(sortable.el).toBe(tbody)
    expect(sortable.option('draggable')).toBe('[data-draggable]')
  })

  test("Sortable's onStart reaches @start on the next tick with the event TagsTable reads oldIndex from", async () => {
    const start = vi.fn()
    const { container } = renderTags({ tags: ref([tagA, tagB, tagC]), start })
    const { rows, sortable } = sortableOf(container)
    const event = { item: rows[1], oldIndex: 1 }

    sortable.option('onStart')(event)
    expect(start).not.toHaveBeenCalled()
    await nextTick()
    expect(start).toHaveBeenCalledTimes(1)
    expect(start.mock.calls[0][0]).toBe(event)
  })

  test("Sortable's onMove calls :move with the related row's list index and hands back its return value", () => {
    const move = vi.fn()
    const { container } = renderTags({ tags: ref([tagA, tagB, tagC]), move })
    const { tbody, rows, sortable } = sortableOf(container)
    sortable.option('onStart')({ item: rows[0], oldIndex: 0 })

    const result = sortable.option('onMove')(
      { to: tbody, from: tbody, related: rows[2], dragged: rows[0], willInsertAfter: true },
      new Event('dragover'),
    )
    expect(result).toBeUndefined()
    expect(move).toHaveBeenCalledTimes(1)
    const [event] = move.mock.calls[0]
    expect(event.willInsertAfter).toBe(true)
    expect(event.relatedContext.index).toBe(2)
    expect(event.relatedContext.element).toEqual(tagC)
    expect(event.relatedContext.list).toEqual([tagA, tagB, tagC])
    expect(event.draggedContext).toEqual({ element: tagA, index: 0, futureIndex: 2 })
  })

  test("Sortable's onUpdate emits update:modelValue with the row moved, which v-model re-renders", async () => {
    const tags = ref([tagA, tagB, tagC])
    const { container } = renderTags({ tags })
    const { tbody, rows, sortable } = sortableOf(container)
    sortable.option('onStart')({ item: rows[0], oldIndex: 0 })

    sortable.option('onUpdate')({ item: rows[0], from: tbody, oldIndex: 0, newIndex: 2 })
    expect(tags.value).toEqual([tagB, tagC, tagA])
    await nextTick()
    expect(rowText(container)).toEqual(['B', 'C', 'A'])
  })

  test("Sortable's onEnd reaches @end on the next tick with the oldIndex and newIndex TagsTable reads", async () => {
    const end = vi.fn()
    const { container } = renderTags({ tags: ref([tagA, tagB, tagC]), end })
    const { tbody, rows, sortable } = sortableOf(container)
    const event = { item: rows[0], from: tbody, to: tbody, oldIndex: 0, newIndex: 2 }

    sortable.option('onEnd')(event)
    expect(end).not.toHaveBeenCalled()
    await nextTick()
    expect(end).toHaveBeenCalledTimes(1)
    expect(end.mock.calls[0][0]).toMatchObject({ oldIndex: 0, newIndex: 2 })
  })

  test('replacing the list re-renders the rows by key in the new order, and moves read the new positions', async () => {
    const tags = ref([tagA, tagB, tagC])
    const move = vi.fn()
    const { container } = renderTags({ tags, move })

    tags.value = [tagC, tagA, tagB]
    await nextTick()
    expect(rowText(container)).toEqual(['C', 'A', 'B'])

    const { tbody, rows, sortable } = sortableOf(container)
    sortable.option('onStart')({ item: rows[0], oldIndex: 0 })
    sortable.option('onMove')(
      { to: tbody, from: tbody, related: rows[2], dragged: rows[0], willInsertAfter: false },
      new Event('dragover'),
    )
    const [event] = move.mock.calls[0]
    expect(event.relatedContext.index).toBe(2)
    expect(event.relatedContext.element).toEqual(tagB)
    expect(event.draggedContext).toEqual({ element: tagC, index: 0, futureIndex: 2 })
  })
})

describe('clipboard', () => {
  const shareLink = 'https://athousandworlds.test/s/happy-blue-otter'
  let clipboards = []

  /** Creates a real Clipboard on a selector and tracks it so it is destroyed after the test. */
  const listen = selector => {
    const clipboard = new Clipboard(selector)
    clipboards = [...clipboards, clipboard]
    return clipboard
  }

  /** Appends markup to document.body, where Clipboard's delegated click listener sees it. */
  const fixture = html => {
    const div = document.createElement('div')
    div.dataset.fixture = ''
    div.innerHTML = html
    document.body.appendChild(div)
    return div
  }

  beforeEach(() => {
    // jsdom has no execCommand, so this adds it as an own property that afterEach deletes
    document.execCommand = vi.fn(() => true)
  })

  afterEach(() => {
    clipboards.forEach(clipboard => clipboard.destroy())
    clipboards = []
    Reflect.deleteProperty(document, 'execCommand')
    document.querySelectorAll('[data-fixture]').forEach(div => div.remove())
  })

  test('the default export is a constructor of event emitters', () => {
    expect(typeof Clipboard).toBe('function')
    const clipboard = listen('#copy-link')
    expect(clipboard).toBeInstanceOf(Clipboard)
    expect(typeof clipboard.on).toBe('function')
    expect(typeof clipboard.destroy).toBe('function')
  })

  test("clicking #copy-link copies its data-clipboard-text with execCommand('copy') and fires success", () => {
    const success = vi.fn()
    const error = vi.fn()
    listen('#copy-link').on('success', success).on('error', error)
    const container = fixture(
      `<button id="copy-link" data-clipboard-text="${shareLink}"><i class="fa fa-clipboard"></i></button>`,
    )
    const button = container.querySelector('#copy-link')

    button.click()
    expect(document.execCommand).toHaveBeenCalledTimes(1)
    expect(document.execCommand).toHaveBeenCalledWith('copy')
    expect(error).not.toHaveBeenCalled()
    expect(success).toHaveBeenCalledTimes(1)
    expect(success.mock.calls[0][0]).toMatchObject({ action: 'copy', text: shareLink })
    expect(success.mock.calls[0][0].trigger).toBe(button)
    expect(document.body.querySelector('textarea')).toBeNull()
  })

  test('a #copy-link Vue renders after mount, like BookmarksView share link, copies alongside its @click.prevent', async () => {
    const success = vi.fn()
    const shareAll = vi.fn()
    const { getByRole, getByText } = render(
      defineComponent({
        data: () => ({ show: false, link: shareLink }),
        mounted() {
          listen('#copy-link').on('success', success)
        },
        methods: { shareAll },
        template: `<div>
          <button @click="show = true">Share List</button>
          <a v-if="show" id="copy-link" @click.prevent="shareAll" :data-clipboard-text="link">copy</a>
        </div>`,
      }),
    )

    await fireEvent.click(getByRole('button', { name: 'Share List' }))
    await fireEvent.click(getByText('copy'))
    expect(shareAll).toHaveBeenCalledTimes(1)
    expect(document.execCommand).toHaveBeenCalledWith('copy')
    expect(success).toHaveBeenCalledTimes(1)
    expect(success.mock.calls[0][0].text).toBe(shareLink)
  })

  test("a .copy-link class selector copies each button's own text, also when its icon is clicked", () => {
    const success = vi.fn()
    listen('.copy-link').on('success', success)
    const container = fixture(`
      <button class="copy-link" data-clipboard-text="https://athousandworlds.test/signup?code=AAA"><i class="fas fa-link"></i></button>
      <button class="copy-link" data-clipboard-text="https://athousandworlds.test/signup?code=BBB"><i class="fas fa-link"></i></button>
    `)
    const [first, second] = container.querySelectorAll('button')

    first.querySelector('i').click()
    second.click()
    expect(success.mock.calls.map(([event]) => event.text)).toEqual([
      'https://athousandworlds.test/signup?code=AAA',
      'https://athousandworlds.test/signup?code=BBB',
    ])
    expect(success.mock.calls[0][0].trigger).toBe(first)
    expect(success.mock.calls[1][0].trigger).toBe(second)
  })

  test('after destroy(), a click neither copies nor fires an event', () => {
    const success = vi.fn()
    const clipboard = listen('.copy-link').on('success', success)
    const container = fixture(
      `<button class="copy-link" data-clipboard-text="${shareLink}"></button>`,
    )

    clipboard.destroy()
    container.querySelector('button').click()
    expect(success).not.toHaveBeenCalled()
    expect(document.execCommand).not.toHaveBeenCalled()
  })
})

describe('vue runtime internals', () => {
  /** Reads a ref's private _value, as BookDetail.vue reads router.currentRoute._value. */
  const privateValue = currentRef => currentRef._value

  test('shallowRef()._value is the same object as .value and tracks reassignment, as router.currentRoute._value relies on', () => {
    const route = { name: 'BookDetail' }
    const currentRoute = shallowRef(route)
    expect(privateValue(currentRoute)).toBe(route)
    expect(privateValue(currentRoute)).toBe(currentRoute.value)

    const next = { name: 'PersonDetail' }
    currentRoute.value = next
    expect(privateValue(currentRoute)).toBe(next)
  })

  test('defineAsyncComponent loads on first mount only and then exposes the component as __asyncResolved, which Content.vue polls', async () => {
    const Loaded = { render: () => h('p', 'editor') }
    const loader = vi.fn(() => Promise.resolve(Loaded))
    const AsyncEditor = defineAsyncComponent({ loader })
    expect(AsyncEditor.__asyncResolved).toBeUndefined()
    expect(loader).not.toHaveBeenCalled()

    const first = render({ render: () => h('div', [h(AsyncEditor)]) })
    await vi.waitFor(() => expect(AsyncEditor.__asyncResolved).toBe(Loaded))
    expect(first.container).toHaveTextContent(/^editor$/)
    first.unmount()

    const second = render({ render: () => h('div', [h(AsyncEditor)]) })
    expect(second.container).toHaveTextContent(/^editor$/)
    expect(loader).toHaveBeenCalledTimes(1)
    expect(AsyncEditor.__asyncResolved).toBe(Loaded)
  })

  /** A child that reports its first default-slot vnode's children, as HighlightedText and Content read them. */
  const SlotText = {
    props: { seen: Function },
    render() {
      const { children } = this.$slots.default()[0]
      this.seen(children)
      return h('span', children)
    },
  }

  test.each([
    ['static text', '<SlotText :seen="seen">Zoë Ruiz</SlotText>', 'Zoë Ruiz'],
    [
      "an interpolation formatted as BooksManager's",
      `<SlotText :seen="seen">{{
          name
        }}</SlotText>`,
      'Zoë Ruiz',
    ],
    ['a numeric interpolation', '<SlotText :seen="seen">{{ isbn }}</SlotText>', '9780525553366'],
    [
      "multi-line text, as Dashboard's Content defaults are written",
      `<SlotText :seen="seen">
          As a leader in the industry and a contributor to ATW you have special access to two
          Submission Forms: BOOKS and BUNDLES.
        </SlotText>`,
      ' As a leader in the industry and a contributor to ATW you have special access to two Submission Forms: BOOKS and BUNDLES. ',
    ],
  ])('$slots.default()[0].children is a plain string for %s', (_, template, expected) => {
    const seen = vi.fn()
    render(
      defineComponent({
        components: { SlotText },
        data: () => ({ seen, name: 'Zoë Ruiz', isbn: 9780525553366 }),
        template,
      }),
    )
    expect(seen).toHaveBeenLastCalledWith(expected)
  })

  test('HighlightedText highlights the search match inside interpolated slot text', () => {
    const { container } = render(
      defineComponent({
        components: { HighlightedText },
        data: () => ({ name: 'Zoë Ruiz' }),
        template: `<p><HighlightedText field="author" search="ruiz">{{
            name
          }}</HighlightedText></p>`,
      }),
    )
    expect(container.querySelector('p')).toHaveTextContent(/^Zoë Ruiz$/)
    expect(container.querySelector('.bg-primary')).toHaveTextContent(/^Ruiz$/)
  })

  test('plain <template> children arrive as one native template vnode each, whose children render the step', () => {
    const seen = vi.fn()
    const Steps = {
      render() {
        const steps = this.$slots.default()
        seen(steps.map(step => step.type))
        return h('div', steps[1].children)
      },
    }
    const { container } = render(
      defineComponent({
        components: { Steps },
        template: `<Steps>
          <template>
            <h2>One</h2>
            <p>a</p>
          </template>

          <template>
            <h2>Two</h2>
          </template>

          <template>
            <h2>Three</h2>
          </template>
        </Steps>`,
      }),
    )
    expect(seen).toHaveBeenLastCalledWith(['template', 'template', 'template'])
    expect(container.firstElementChild.innerHTML).toBe('<h2>Two</h2>')
  })

  test('MessageSequence counts its <template> steps, showing each in turn and completing after the last', async () => {
    const completed = vi.fn()
    const { container, getByRole, queryByRole } = render(
      defineComponent({
        components: { MessageSequence },
        methods: { completed },
        template: `<MessageSequence storageKey="test" @completed="completed">
          <template>
            <h2>One</h2>
            <p>a</p>
          </template>
          <template>
            <h2>Two</h2>
          </template>
          <template>
            <h2>Three</h2>
          </template>
        </MessageSequence>`,
      }),
      { global: { mocks: { $store: { state: {}, dispatch: vi.fn() } } } },
    )
    expect(getByRole('heading')).toHaveTextContent(/^One$/)
    expect(queryByRole('heading', { name: 'Two' })).not.toBeInTheDocument()

    await fireEvent.click(getByRole('button', { name: 'Next' }))
    expect(getByRole('heading')).toHaveTextContent(/^Two$/)
    await fireEvent.click(getByRole('button', { name: 'Next' }))
    expect(getByRole('heading')).toHaveTextContent(/^Three$/)
    expect(completed).not.toHaveBeenCalled()

    await fireEvent.click(getByRole('button', { name: 'Okay' }))
    expect(completed).toHaveBeenCalledWith(true)
    expect(container.firstElementChild).toHaveStyle({ display: 'none' })
  })
})
