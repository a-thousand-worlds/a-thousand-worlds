/*
 * CEditor (the CKEditor wrapper) and Content (the owner-editable text block that lazy-loads it).
 *
 * Dependency seams guarded:
 * - @ckeditor/ckeditor5-vue: the default export installed with app.use (as main.js does), the
 *   editable being the component's own root <div>, initialData from modelValue, the modelValue
 *   watcher that calls editor.data.set, the disabled watcher toggling read-only mode, and the
 *   300 ms leading-edge debounce on update:modelValue.
 * - @ckeditor/ckeditor5-build-balloon: the inline editable's classes, role and contenteditable,
 *   getData() normalization, the placeholder config, and extraPlugins wiring
 *   FirebaseUploadAdapter onto FileRepository.
 * - vue: defineAsyncComponent's private __asyncResolved, which Content polls every 100 ms; the
 *   $slots.default()[0].children fallback read outside render; class fallthrough onto the
 *   editable; and the non-deep string-path watcher on $store.state.content.data.
 * - lodash: the 500 ms debounce on Content.save, shared by every Content instance.
 * - jsdom: contenteditable, and the hidden-element checks that keep the preloading editor out
 *   of role queries.
 *
 * Firebase is the boundary. It is faked at 'firebase/app' rather than '@/firebase', so that
 * concurrent dynamic imports of '@/firebase' cannot slip past the mock to the real SDK.
 */
import { nextTick } from 'vue'
import { fireEvent, render as vueRender, screen } from '@testing-library/vue'
import CKEditorPlugin from '@ckeditor/ckeditor5-vue'
import CEditor from '@/components/CEditor.vue'
import Content from '@/components/Content.vue'
import store from '@/store'
import mixins from '@/mixins/global'
import directives from '@/directives'

/** A fake of the v8 namespaced database and storage APIs that records every call in order. */
const fake = vi.hoisted(() => {
  const state = { writes: [], puts: [] }

  /** Deep-copies a written value so later mutation cannot change the record. */
  const clone = value => JSON.parse(JSON.stringify(value))

  /** A fake database Reference that records set and update. */
  const dbRef = path => ({
    set: async value => {
      state.writes = [...state.writes, ['set', path, clone(value)]]
    },
    update: async value => {
      state.writes = [...state.writes, ['update', path, clone(value)]]
    },
    once: () => {},
  })

  /** A fake storage Reference whose upload task reports one progress snapshot and completes. */
  const storageRef = path => ({
    put: file => {
      state.puts = [...state.puts, [path, file]]
      return {
        on: (event, progress, error, complete) => {
          progress({ totalBytes: 4, bytesTransferred: 4 })
          complete()
        },
        cancel: () => {},
      }
    },
    getDownloadURL: async () => `https://storage.example/${path}`,
  })

  const firebase = {
    initializeApp: () => {},
    database: () => ({ ref: dbRef, useEmulator: () => {} }),
    storage: () => ({ ref: storageRef }),
  }

  return { state, firebase }
})

vi.mock('firebase/app', () => ({ default: fake.firebase }))
vi.mock('firebase/auth', () => ({}))
vi.mock('firebase/database', () => ({}))
vi.mock('firebase/storage', () => ({}))

/** Console warnings that are current, known behavior rather than failures. */
const KNOWN_WARNINGS = [
  // Content.getContent reads the default slot from data(), outside of render
  'Slot "default" invoked outside of the render function',
]

const initialState = JSON.parse(JSON.stringify(store.state))
const owner = { roles: { authorized: true, owner: true } }
const consoleWarn = console.warn

/** Renders with the store, global mixins and directives, and the CKEditor plugin, as main.js does. */
const render = (component, options = {}) =>
  vueRender(component, {
    ...options,
    global: {
      plugins: [store, CKEditorPlugin],
      mixins: [mixins],
      directives: { ...directives, tippy: () => {} },
    },
  })

/** Returns the rendered component's root element, which has no role, text or label to query by. */
// eslint-disable-next-line testing-library/no-node-access -- the root is a bare span or div
const rootOf = container => container.firstElementChild

/** Returns the div a visitor sees Content's HTML in, which has no role and may split its text. */
// eslint-disable-next-line testing-library/no-node-access -- a bare div holding raw innerHTML
const renderedHtml = container => rootOf(container).querySelector(':scope > div')

/** Returns an editable's first paragraph, which is empty while it shows a placeholder. */
// eslint-disable-next-line testing-library/no-node-access -- an empty <p> has nothing to query by
const firstParagraph = editable => editable.querySelector('p')

/** Waits until the visible textbox has a CKEditor attached, and returns the editable and editor. */
const waitForEditor = () =>
  vi.waitFor(() => {
    const el = screen.getByRole('textbox')
    if (!el.ckeditorInstance) throw new Error('No CKEditor has been created on the textbox yet')
    return { el, editor: el.ckeditorInstance }
  })

/** Waits until Content has loaded CEditor and shows its visible textbox, and returns it. */
const waitForTextbox = () => vi.waitFor(() => screen.getByRole('textbox'))

/** Waits until the recorded Firebase writes equal expected. */
const waitForWrites = expected => vi.waitFor(() => expect(fake.state.writes).toEqual(expected))

beforeEach(() => {
  store.replaceState(JSON.parse(JSON.stringify(initialState)))
  fake.state.writes = []
  fake.state.puts = []
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  })
  // jsdom has no ResizeObserver, and the balloon editor constructs one on create
  vi.stubGlobal('ResizeObserver', function () {
    return { observe() {}, unobserve() {}, disconnect() {} }
  })
  vi.spyOn(console, 'warn').mockImplementation((...args) => {
    if (!KNOWN_WARNINGS.some(known => String(args[0]).includes(known))) consoleWarn(...args)
  })
})

afterEach(() => {
  // Content.save is one debounced function shared by every instance, so drop any pending call
  Content.methods.save.cancel()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('CEditor as a plain input', () => {
  test('format oneline renders a text input with class input, and typing emits update:modelValue', async () => {
    const { emitted } = render(CEditor, { props: { modelValue: 'Hi', format: 'oneline' } })
    const input = screen.getByRole('textbox')

    expect(input.tagName).toBe('INPUT')
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveClass('input', { exact: true })
    expect(input).toBeEnabled()
    expect(input).toHaveValue('Hi')
    expect(screen.getAllByRole('textbox', { hidden: true })).toEqual([input])

    await fireEvent.update(input, 'Bye')

    expect(emitted()['update:modelValue']).toEqual([['Bye']])
  })

  test('format inline with disabled renders a disabled input with class inline', () => {
    render(CEditor, { props: { modelValue: 'Hi', format: 'inline', disabled: true } })
    const input = screen.getByRole('textbox')

    expect(input.tagName).toBe('INPUT')
    expect(input).toHaveClass('inline', { exact: true })
    expect(input).toBeDisabled()
  })

  test('a new modelValue prop replaces the input value and is echoed back as update:modelValue', async () => {
    const { emitted, rerender } = render(CEditor, {
      props: { modelValue: 'Hi', format: 'oneline' },
    })

    await rerender({ modelValue: 'Changed' })

    expect(screen.getByRole('textbox')).toHaveValue('Changed')
    expect(emitted()['update:modelValue']).toEqual([['Changed']])
  })
})

describe('CEditor as a balloon CKEditor', () => {
  test('mounts BalloonEditor in place on the component root div with the modelValue as data', async () => {
    const { container, emitted } = render(CEditor, {
      props: { modelValue: '<p>Hello <strong>world</strong></p>', placeholder: 'Type' },
    })

    const { el, editor } = await waitForEditor()

    expect(rootOf(container)).toBe(el)
    expect(el.tagName).toBe('DIV')
    expect(el).toHaveAttribute('contenteditable', 'true')
    expect(el).toHaveClass('ck-content', 'ck-editor__editable', 'ck-editor__editable_inline')
    expect(editor.getData()).toBe('<p>Hello <strong>world</strong></p>')
    expect(editor.isReadOnly).toBe(false)
    expect(el.innerHTML).toBe('<p data-placeholder="Type">Hello <strong>world</strong></p>')
    // creating the editor with initialData is not a change
    expect(emitted()).not.toHaveProperty('update:modelValue')
  })

  test('a new modelValue prop is set into the editor and echoed back as update:modelValue', async () => {
    const { emitted, rerender } = render(CEditor, { props: { modelValue: '<p>Hello</p>' } })
    const { editor } = await waitForEditor()

    await rerender({ modelValue: '<p>Changed</p>' })

    expect(editor.getData()).toBe('<p>Changed</p>')
    expect(emitted()['update:modelValue']).toEqual([['<p>Changed</p>']])
  })

  test('editor changes emit update:modelValue on the leading edge, then once after 300 ms', async () => {
    const { emitted } = render(CEditor, { props: { modelValue: '<p>Hello</p>' } })
    const { editor } = await waitForEditor()

    editor.setData('<p>One</p>')
    await nextTick()

    expect(emitted()['update:modelValue']).toEqual([['<p>One</p>']])

    editor.setData('<p>Two</p>')
    editor.setData('<p>From editor</p>')
    await nextTick()
    vi.advanceTimersByTime(299)
    await nextTick()

    expect(emitted()['update:modelValue']).toEqual([['<p>One</p>']])

    vi.advanceTimersByTime(1)
    await nextTick()

    expect(emitted()['update:modelValue']).toEqual([['<p>One</p>'], ['<p>From editor</p>']])
  })

  test('disabled makes the editor read-only, and clearing it makes the editor editable again', async () => {
    const { rerender } = render(CEditor, { props: { modelValue: '<p>Locked</p>', disabled: true } })
    const { el, editor } = await waitForEditor()

    expect(editor.isReadOnly).toBe(true)
    expect(el).toHaveAttribute('contenteditable', 'false')

    await rerender({ disabled: false })

    expect(editor.isReadOnly).toBe(false)
    expect(el).toHaveAttribute('contenteditable', 'true')
  })

  test('an empty modelValue shows the placeholder on the first paragraph', async () => {
    render(CEditor, { props: { modelValue: '', placeholder: 'No bio' } })
    const { el, editor } = await waitForEditor()

    expect(editor.getData()).toBe('')
    expect(firstParagraph(el)).toHaveClass('ck-placeholder')
    expect(firstParagraph(el)).toHaveAttribute('data-placeholder', 'No bio')
  })

  test('extraPlugins wires FirebaseUploadAdapter into FileRepository, uploading to content/', async () => {
    render(CEditor, { props: { modelValue: '<p>Pic</p>' } })
    const { editor } = await waitForEditor()
    const file = new File(['x'], 'pic.png', { type: 'image/png' })
    const loader = { file: Promise.resolve(file) }

    expect(editor.plugins.has('FileRepository')).toBe(true)

    const adapter = editor.plugins.get('FileRepository').createUploadAdapter(loader)

    await expect(adapter.upload()).resolves.toEqual({
      default: 'https://storage.example/content/pic.png',
    })
    expect(fake.state.puts).toEqual([['content/pic.png', file]])
    expect(loader.uploadTotal).toBe(4)
    expect(loader.uploaded).toBe(4)
  })
})

describe('Content for a visitor who cannot edit', () => {
  test('renders stored content as innerHTML of a div carrying the class prop', () => {
    store.commit('content/set', { welcome: { left: '<b>Colorful</b> Reads' } })

    const { container } = render(Content, {
      props: { name: 'welcome/left', class: 'big', format: 'label' },
    })

    expect(rootOf(container).tagName).toBe('SPAN')
    expect(rootOf(container).className).toBe('content-component format-label')
    expect(renderedHtml(container).className).toBe('big')
    expect(renderedHtml(container).innerHTML).toBe('<b>Colorful</b> Reads')
    expect(screen.queryByRole('textbox', { hidden: true })).not.toBeInTheDocument()
  })

  test('falls back to the default slot text when the store has no content at name', () => {
    const { container } = render(Content, {
      props: { name: 'missing/key' },
      slots: { default: 'Fallback text' },
    })

    expect(rootOf(container).className).toBe('content-component format-multiline')
    expect(renderedHtml(container).innerHTML).toBe('Fallback text')
  })

  test('replacing the content data re-renders every instance and emits data, without saving', async () => {
    store.commit('content/set', { welcome: { left: '<b>Colorful</b> Reads' } })
    const left = render(Content, { props: { name: 'welcome/left' } })
    const missing = render(Content, {
      props: { name: 'missing/key' },
      slots: { default: 'Fallback text' },
    })

    store.commit('content/set', { welcome: { left: 'Updated' }, missing: { key: 'Now here' } })
    await nextTick()

    expect(renderedHtml(left.container).innerHTML).toBe('Updated')
    expect(renderedHtml(missing.container).innerHTML).toBe('Now here')
    expect(left.emitted().data).toEqual([[{ data: 'Updated', name: 'welcome/left' }]])
    expect(missing.emitted().data).toEqual([[{ data: 'Now here', name: 'missing/key' }]])
    expect(left.emitted().change).toEqual([[{ html: 'Updated', name: 'welcome/left' }]])

    await vi.advanceTimersByTimeAsync(500)

    expect(fake.state.writes).toEqual([])
  })

  test('content data without a value at name leaves the rendered content as it was', async () => {
    store.commit('content/set', { welcome: { left: 'Kept' } })
    const { container, emitted } = render(Content, { props: { name: 'welcome/left' } })

    store.commit('content/set', { other: { key: 'x' } })
    await nextTick()

    expect(renderedHtml(container).innerHTML).toBe('Kept')
    expect(emitted()).not.toHaveProperty('data')
  })

  test('setting a single key in place does not re-render, since the store watcher is not deep', async () => {
    store.commit('content/set', { welcome: { left: 'Before' } })
    const { container, emitted } = render(Content, { props: { name: 'welcome/left' } })

    store.commit('content/setOne', { path: 'welcome.left', value: 'After' })
    await nextTick()

    expect(store.getters['content/get']('welcome/left')).toBe('After')
    expect(renderedHtml(container).innerHTML).toBe('Before')
    expect(emitted()).not.toHaveProperty('data')
  })

  test('a new name prop reloads the content from the store', async () => {
    store.commit('content/set', { welcome: { left: 'Left', right: 'Right' } })
    const { container, emitted, rerender } = render(Content, { props: { name: 'welcome/left' } })

    await rerender({ name: 'welcome/right' })

    expect(renderedHtml(container).innerHTML).toBe('Right')
    expect(emitted().change).toEqual([[{ html: 'Right', name: 'welcome/right' }]])
  })
})

describe('Content for an owner', () => {
  test('loads CEditor asynchronously and saves a oneline edit to Firebase after 500 ms', async () => {
    store.commit('user/setUser', owner)
    const { container, emitted } = render(Content, {
      props: { name: 'email/invite/user/subject', format: 'oneline' },
    })

    expect(rootOf(container).className).toBe('content-component format-oneline can-edit')

    const input = await waitForTextbox()

    // Content polls Vue's private __asyncResolved to learn that the chunk has loaded
    expect(Content.components.CEditor.__asyncResolved).toBe(CEditor)
    expect(input.tagName).toBe('INPUT')
    expect(input).toHaveClass('input', { exact: true })
    expect(input).toHaveValue('')
    // the hidden multiline CEditor that triggered the chunk load is gone
    expect(screen.getAllByRole('textbox', { hidden: true })).toEqual([input])

    await fireEvent.update(input, 'Welcome FIRST_NAME')

    expect(emitted().change).toEqual([
      [{ html: 'Welcome FIRST_NAME', name: 'email/invite/user/subject' }],
    ])

    await vi.advanceTimersByTimeAsync(499)

    expect(fake.state.writes).toEqual([])

    await vi.advanceTimersByTimeAsync(1)
    await waitForWrites([
      ['set', 'content/email/invite/user/subject', 'Welcome FIRST_NAME'],
      ['set', 'cache/clean', false],
    ])
  })

  test('shows the editor after one 100 ms poll once the CEditor chunk has loaded', async () => {
    store.commit('user/setUser', owner)
    const first = render(Content, { props: { name: 'support/title', format: 'inline' } })
    await waitForTextbox()
    first.unmount()

    render(Content, { props: { name: 'support/title', format: 'inline' } })
    await nextTick()

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(99)

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(1)

    expect(screen.getByRole('textbox')).toHaveClass('inline', { exact: true })
  })

  test('rapid edits are saved once, with the last value', async () => {
    store.commit('user/setUser', owner)
    render(Content, { props: { name: 'email/invite/user/subject', format: 'oneline' } })
    const input = await waitForTextbox()

    await fireEvent.update(input, 'W')
    await vi.advanceTimersByTimeAsync(300)
    await fireEvent.update(input, 'We')
    await vi.advanceTimersByTimeAsync(499)

    expect(fake.state.writes).toEqual([])

    await vi.advanceTimersByTimeAsync(1)
    await waitForWrites([
      ['set', 'content/email/invite/user/subject', 'We'],
      ['set', 'cache/clean', false],
    ])
  })

  test('multiline loads the stored content into CKEditor, and an editor change is saved', async () => {
    store.commit('user/setUser', owner)
    store.commit('content/set', { about: { intro: '<p>Hi there</p>' } })
    const { container, emitted } = render(Content, {
      props: { name: 'about/intro', class: 'intro' },
    })

    const { el, editor } = await waitForEditor()

    // the class prop falls through CEditor and ckeditor5-vue onto the editable itself
    expect(el).toHaveClass('intro', 'ck-content', 'ck-editor__editable_inline')
    expect(rootOf(container)).toContainElement(el)
    expect(screen.getAllByRole('textbox', { hidden: true })).toEqual([el])
    expect(editor.getData()).toBe('<p>Hi there</p>')

    editor.setData('<p>Bye</p>')
    await nextTick()

    expect(emitted().change).toEqual([[{ html: '<p>Bye</p>', name: 'about/intro' }]])

    await vi.advanceTimersByTimeAsync(500)
    await waitForWrites([
      ['set', 'content/about/intro', '<p>Bye</p>'],
      ['set', 'cache/clean', false],
    ])
  })

  test('a visitor who signs in as owner gets the editor in place of the rendered content', async () => {
    store.commit('content/set', { support: { title: 'Support' } })
    const { container } = render(Content, { props: { name: 'support/title', format: 'oneline' } })

    expect(renderedHtml(container).innerHTML).toBe('Support')

    store.commit('user/setUser', owner)
    const input = await waitForTextbox()

    expect(rootOf(container)).toHaveClass('can-edit')
    expect(renderedHtml(container)).toBeNull()
    expect(input).toHaveValue('Support')
  })

  test('format label edits in a multiline CKEditor rather than an input', async () => {
    store.commit('user/setUser', owner)
    store.commit('content/set', { book: { title: 'Submit a book' } })
    const { container } = render(Content, { props: { name: 'book/title', format: 'label' } })

    const { el, editor } = await waitForEditor()

    expect(rootOf(container).className).toBe('content-component format-label can-edit')
    expect(el.tagName).toBe('DIV')
    expect(editor.getData()).toBe('<p>Submit a book</p>')
  })
})
