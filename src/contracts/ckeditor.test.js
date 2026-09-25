/*
 * Contract tests for the rich text editor behind book summaries, person bios and page content.
 *
 * Dependency seams guarded:
 * - @ckeditor/ckeditor5-vue: the default export's install and component, which main.js hands to
 *   app.use; install registering the component as 'Ckeditor', which the templates reach as both
 *   <ckeditor> and <Ckeditor>; the version check that reads window.CKEDITOR_VERSION; the component
 *   mounting the editor on its own root element with modelValue as initialData; the empty
 *   modelValue set on ready and echoed back; the 300 ms leading-edge debounce on
 *   update:modelValue; the modelValue watcher that sets new data but skips its own echo; the
 *   disabled watcher; focus and blur events (PersonEdit's bioFocus/bioBlur); and destroy on
 *   unmount.
 * - @ckeditor/ckeditor5-build-balloon: BalloonEditor.create, defaultConfig (the toolbar users see),
 *   builtinPlugins, FileRepository (which FirebaseUploadAdapter needs), the placeholder config,
 *   the ck-focused/ck-blurred classes PersonEdit polls, and the setData/getData normalization that
 *   shapes stored HTML.
 * - vue: resolveComponent's capitalized fallback, attribute fallthrough onto the editable root
 *   surviving a re-render, @update:model-value and v-model merging on one element (BookEdit,
 *   ReviewSubmissions), and CEditor's v-model and watchers absorbing <ckeditor>'s empty echo and
 *   passing on only the HTML.
 *
 * CEditor's input branch, placeholder, debounce and disabled handling are owned by
 * src/components/CEditor.test.js; here it appears only where <ckeditor>'s emits pass through it.
 * The adapter that uploads images to Firebase is owned by
 * src/util/ckeditorFirebaseUploadAdapter.test.js and is never exercised here; '@/firebase' is
 * mocked only as a safety net.
 */
import { createApp, h, mergeProps, nextTick, reactive, resolveComponent } from 'vue'
import { render, screen } from '@testing-library/vue'
import CKEditor from '@ckeditor/ckeditor5-vue'
import BalloonEditor from '@ckeditor/ckeditor5-build-balloon'
import CEditor from '@/components/CEditor.vue'

// CEditor loads the upload adapter, which imports firebase lazily and only on upload
vi.mock('@/firebase', () => ({ default: {} }))

// jsdom has no ResizeObserver, and the balloon toolbar constructs one
vi.stubGlobal('ResizeObserver', function () {
  return { observe() {}, unobserve() {}, disconnect() {} }
})

/** The toolbar the balloon build shows, from its defaultConfig. */
const TOOLBAR = [
  'undo',
  'redo',
  '|',
  'heading',
  '|',
  'bold',
  'italic',
  '|',
  'link',
  'uploadImage',
  'insertTable',
  'blockQuote',
  'mediaEmbed',
  '|',
  'bulletedList',
  'numberedList',
  'outdent',
  'indent',
]

// the unspied console.error, which readySignal passes each call on to
const consoleError = console.error

let editors = []
let elements = []

/** Creates a balloon editor on a fresh attached div, and tracks both for cleanup. */
const createEditor = async config => {
  const el = document.createElement('div')
  document.body.appendChild(el)
  elements = [...elements, el]
  const editor = await BalloonEditor.create(el, config)
  editors = [...editors, editor]
  return editor
}

/** Returns the editable element CKEditor attached to, which has no accessible name to query by. */
// eslint-disable-next-line testing-library/no-node-access -- found by CKEditor's own class
const editableOf = container => container.querySelector('.ck-editor__editable')

/** Returns an element's first paragraph, which is empty while it shows a placeholder. */
// eslint-disable-next-line testing-library/no-node-access -- an empty <p> has nothing to query by
const firstParagraph = el => el.querySelector('p')

/**
 * Returns a promise of the editor that <ckeditor> passes to 'ready', and the listener to bind. A
 * failed create is caught by ckeditor5-vue, logged with console.error and never followed by
 * 'ready', so the logged error rejects the promise: the test fails naming the cause rather than
 * timing out.
 */
const readySignal = () => {
  let onReady
  let onFailure
  const ready = new Promise((resolve, reject) => {
    onReady = resolve
    onFailure = reject
  })
  vi.spyOn(console, 'error').mockImplementation((...args) => {
    consoleError(...args)
    onFailure(args[0])
  })
  return { ready, onReady }
}

/**
 * Renders a bare <ckeditor> the way the SFC templates compile it, through
 * resolveComponent('ckeditor'), with its modelValue bound both ways as v-model does. Returns the
 * reactive bound state, the update:modelValue and destroy listeners, and a promise of the editor.
 */
const renderCkeditor = ({ modelValue = '<p>Start</p>', disabled = false, config, attrs } = {}) => {
  const state = reactive({ modelValue, disabled })
  const onUpdate = vi.fn(value => {
    state.modelValue = value
  })
  const onDestroy = vi.fn()
  const { ready, onReady } = readySignal()
  const Harness = {
    render: () =>
      h(resolveComponent('ckeditor'), {
        ...attrs,
        editor: BalloonEditor,
        config,
        modelValue: state.modelValue,
        disabled: state.disabled,
        'onUpdate:modelValue': onUpdate,
        onReady,
        onDestroy,
      }),
  }
  const result = render(Harness, { global: { plugins: [CKEditor] } })
  return { ...result, state, onUpdate, onDestroy, ready }
}

/**
 * Renders CEditor with the real <ckeditor> registered as Ckeditor behind a pass-through that adds
 * listeners of its own, so a test sees what <ckeditor> emits to CEditor as well as what CEditor
 * emits. Returns the listener on <ckeditor>'s update:modelValue and a promise of the editor.
 */
const renderCEditor = props => {
  const inner = vi.fn()
  const { ready, onReady } = readySignal()
  const Ckeditor = {
    inheritAttrs: false,
    setup:
      (_, { attrs }) =>
      () =>
        h(CKEditor.component, mergeProps(attrs, { 'onUpdate:modelValue': inner, onReady })),
  }
  render(CEditor, { props, global: { components: { Ckeditor } } })
  return { inner, ready }
}

/** Returns the first argument of every call to a listener, which is the value v-model assigns. */
const values = listener => listener.mock.calls.map(args => args[0])

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await Promise.all(editors.map(editor => editor.destroy()))
  elements.forEach(el => el.remove())
  editors = []
  elements = []
})

describe('@ckeditor/ckeditor5-vue plugin', () => {
  test('the default export has install and component, and the component is named Ckeditor', () => {
    expect(Object.keys(CKEditor)).toEqual(expect.arrayContaining(['install', 'component']))
    expect(typeof CKEditor.install).toBe('function')
    expect(CKEditor.component.name).toBe('Ckeditor')
  })

  test('the component declares the props and events the templates bind', () => {
    const { props, emits } = CKEditor.component

    expect(Object.keys(props)).toEqual(
      expect.arrayContaining(['editor', 'config', 'modelValue', 'tagName', 'disabled']),
    )
    expect(props.modelValue.default).toBe('')
    expect(props.tagName.default).toBe('div')
    expect(props.disabled.default).toBe(false)
    expect(emits).toEqual(
      expect.arrayContaining(['ready', 'update:modelValue', 'input', 'focus', 'blur', 'destroy']),
    )
  })

  test('install registers the component globally under Ckeditor', () => {
    const app = createApp({})

    app.use(CKEditor)

    expect(app.component('Ckeditor')).toBe(CKEditor.component)
  })

  test('<ckeditor> and <Ckeditor> in a template both resolve to the installed component', () => {
    let resolved = []
    const Probe = {
      render: () => {
        resolved = [resolveComponent('ckeditor'), resolveComponent('Ckeditor')]
        return h('span')
      },
    }

    render(Probe, { global: { plugins: [CKEditor] } })

    expect(resolved).toEqual([CKEditor.component, CKEditor.component])
  })

  test('the balloon build sets a CKEDITOR_VERSION the integration accepts without a warning', async () => {
    const warn = vi.spyOn(console, 'warn')
    const { ready } = renderCkeditor()

    await ready

    expect(window.CKEDITOR_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
    expect(Number(window.CKEDITOR_VERSION.split('.')[0])).toBeGreaterThanOrEqual(37)
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('@ckeditor/ckeditor5-build-balloon build', () => {
  test('exposes a static create and the default toolbar, image and table config', () => {
    expect(typeof BalloonEditor.create).toBe('function')
    expect(BalloonEditor.defaultConfig).toEqual({
      toolbar: { items: TOOLBAR },
      image: {
        toolbar: [
          'imageStyle:inline',
          'imageStyle:block',
          'imageStyle:side',
          '|',
          'toggleImageCaption',
          'imageTextAlternative',
        ],
      },
      table: { contentToolbar: ['tableColumn', 'tableRow', 'mergeTableCells'] },
      language: 'en',
    })
  })

  test('builds in the plugins that stored summaries and bios are written with', () => {
    expect(BalloonEditor.builtinPlugins.map(plugin => plugin.pluginName)).toEqual(
      expect.arrayContaining([
        'Essentials',
        'Autoformat',
        'Bold',
        'Italic',
        'BlockQuote',
        'Heading',
        'Image',
        'ImageCaption',
        'ImageStyle',
        'ImageToolbar',
        'ImageUpload',
        'Indent',
        'Link',
        'List',
        'MediaEmbed',
        'Paragraph',
        'PasteFromOffice',
        'Table',
        'TableToolbar',
        'TextTransformation',
      ]),
    )
  })

  test('a created editor loads FileRepository and shows every default toolbar item', async () => {
    const editor = await createEditor()

    expect(editor.plugins.has('FileRepository')).toBe(true)
    expect(editor.config.get('toolbar')).toEqual({ items: TOOLBAR })
    expect(editor.plugins.get('BalloonToolbar').toolbarView.items.length).toBe(TOOLBAR.length)
  })

  test('the placeholder config shows on the empty first paragraph', async () => {
    const editor = await createEditor({ placeholder: 'Enter page content here' })
    const paragraph = firstParagraph(editor.ui.getEditableElement())

    expect(editor.config.get('placeholder')).toBe('Enter page content here')
    expect(editor.getData()).toBe('')
    expect(paragraph).toHaveClass('ck-placeholder')
    expect(paragraph).toHaveAttribute('data-placeholder', 'Enter page content here')
  })
})

describe('balloon build data pipeline', () => {
  let el
  let editor

  // one editor serves every row, since setData replaces the whole document
  beforeAll(async () => {
    el = document.createElement('div')
    document.body.appendChild(el)
    editor = await BalloonEditor.create(el)
  })

  afterAll(async () => {
    await editor.destroy()
    el.remove()
  })

  test.each([
    // the default heading options map h1 to Heading 1 (h2), keep h3/h4, and drop h5/h6 to <p>
    ['<h1>H1</h1><h3>H3</h3><h4>h4</h4>', '<h2>H1</h2><h3>H3</h3><h4>h4</h4>'],
    ['<h2>H2</h2><h5>h5</h5><h6>h6</h6>', '<h2>H2</h2><p>h5</p><p>h6</p>'],
    // blank lines between paragraphs are kept, and an empty one is written back as &nbsp;
    ['<p>One</p><p>&nbsp;</p><p>Two</p>', '<p>One</p><p>&nbsp;</p><p>Two</p>'],
    ['<p>x</p><p></p><p>y</p>', '<p>x</p><p>&nbsp;</p><p>y</p>'],
    ['<p>&nbsp;</p>', ''],
    // whitespace collapses, but non-breaking spaces survive
    ['<p>a  b</p>', '<p>a b</p>'],
    ['<p>a&nbsp;&nbsp;b</p>', '<p>a&nbsp;&nbsp;b</p>'],
    ['<p>Tab\there</p>', '<p>Tab here</p>'],
    // text is re-escaped, and TextTransformation does not run on setData
    ['<p>1/2 -> 3</p>', '<p>1/2 -&gt; 3</p>'],
    ['<p>a &lt; b &gt; c</p>', '<p>a &lt; b &gt; c</p>'],
    ['<p>“Curly” — dash… (c)</p>', '<p>“Curly” — dash… (c)</p>'],
    ['Chrissy Teigen\'s &amp; "friends"', '<p>Chrissy Teigen\'s &amp; "friends"</p>'],
    // block structures from the toolbar
    [
      '<table><tr><td>c</td></tr></table>',
      '<figure class="table"><table><tbody><tr><td>c</td></tr></tbody></table></figure>',
    ],
    ['<ol><li>1</li></ol>', '<ol><li>1</li></ol>'],
    ['<ul><li>a<ul><li>b</li></ul></li></ul>', '<ul><li>a<ul><li>b</li></ul></li></ul>'],
    ['<blockquote><p>q</p></blockquote>', '<blockquote><p>q</p></blockquote>'],
    [
      '<figure class="image"><img src="https://x/y.png"></figure>',
      '<figure class="image"><img src="https://x/y.png"></figure>',
    ],
    [
      '<figure class="image"><img src="https://x/y.png"><figcaption>cap</figcaption></figure>',
      '<figure class="image"><img src="https://x/y.png"><figcaption>cap</figcaption></figure>',
    ],
    ['<img src="https://x/y.png">', '<p><img src="https://x/y.png"></p>'],
    [
      '<oembed url="https://www.youtube.com/watch?v=abc"></oembed>',
      '<figure class="media"><oembed url="https://www.youtube.com/watch?v=abc"></oembed></figure>',
    ],
    ['<p>x<br><br>y</p>', '<p>x<br><br>y</p>'],
    // markup no plugin handles is reduced to its text
    ['<p style="margin-left:40px">x</p>', '<p>x</p>'],
    ['<pre>code</pre>', '<p>code</p>'],
    ['<hr>', ''],
  ])('setData(%j) is read back by getData() as %j', (input, output) => {
    editor.setData(input)

    expect(editor.getData()).toBe(output)
  })
})

describe('<ckeditor> bound with v-model', () => {
  test('mounts on its own root element with modelValue as the data, emitting nothing', async () => {
    const { container, ready, onUpdate } = renderCkeditor({ modelValue: '<p>Start</p>' })

    const editor = await ready
    const editable = editableOf(container)

    // eslint-disable-next-line testing-library/no-node-access -- the harness root is <ckeditor>
    expect(container.firstElementChild).toBe(editable)
    expect(editable.tagName).toBe('DIV')
    expect(editable.ckeditorInstance).toBe(editor)
    expect(editor.getData()).toBe('<p>Start</p>')
    expect(onUpdate).not.toHaveBeenCalled()
  })

  test('an empty modelValue is set into the editor on ready and emitted back as ""', async () => {
    const { ready, onUpdate } = renderCkeditor({ modelValue: '' })

    const editor = await ready

    expect(editor.getData()).toBe('')
    expect(values(onUpdate)).toEqual([''])
  })

  test('editor changes emit on the leading edge, then once 300 ms later, and the echo is not set back', async () => {
    const { ready, onUpdate } = renderCkeditor({ modelValue: '<p>Start</p>' })
    const editor = await ready
    const setData = vi.spyOn(editor.data, 'set')
    // the integration's debounce reads Date.now, which the default toFake includes
    vi.useFakeTimers()

    editor.setData('<p>One</p>')
    editor.setData('<p>Two</p>')
    editor.setData('<p>Three</p>')

    expect(values(onUpdate)).toEqual(['<p>One</p>'])

    vi.advanceTimersByTime(299)

    expect(values(onUpdate)).toEqual(['<p>One</p>'])

    vi.advanceTimersByTime(1)

    expect(values(onUpdate)).toEqual(['<p>One</p>', '<p>Three</p>'])

    await nextTick()
    vi.advanceTimersByTime(1000)

    expect(values(onUpdate)).toEqual(['<p>One</p>', '<p>Three</p>'])
    expect(setData).toHaveBeenCalledTimes(3)
    expect(editor.getData()).toBe('<p>Three</p>')
  })

  test('a new modelValue from the parent is set into the editor', async () => {
    const { ready, state } = renderCkeditor({ modelValue: '<p>Start</p>' })
    const editor = await ready

    state.modelValue = '<p>Parent</p>'
    await nextTick()

    expect(editor.getData()).toBe('<p>Parent</p>')
  })

  test('disabled toggles read-only mode on and off', async () => {
    const { container, ready, state } = renderCkeditor()
    const editor = await ready
    const editable = editableOf(container)

    expect(editor.isReadOnly).toBe(false)

    state.disabled = true
    await nextTick()

    expect(editor.isReadOnly).toBe(true)
    expect(editable).toHaveAttribute('contenteditable', 'false')

    state.disabled = false
    await nextTick()

    expect(editor.isReadOnly).toBe(false)
    expect(editable).toHaveAttribute('contenteditable', 'true')
  })

  test('disabled at mount makes the editor read-only once ready', async () => {
    const { container, ready } = renderCkeditor({ disabled: true })

    const editor = await ready

    expect(editor.isReadOnly).toBe(true)
    expect(editableOf(container)).toHaveAttribute('contenteditable', 'false')
  })

  test('the config prop reaches the editor and is not mutated with initialData', async () => {
    const config = { placeholder: 'No summary' }
    const { ready } = renderCkeditor({ modelValue: '<p>Start</p>', config })

    const editor = await ready

    expect(editor.config.get('placeholder')).toBe('No summary')
    expect(config).toEqual({ placeholder: 'No summary' })
  })

  test('fallthrough class and style land on the editable and survive a re-render', async () => {
    const { container, ready, state } = renderCkeditor({
      attrs: { class: 'person-bio', style: 'padding: 0' },
    })
    await ready
    const editable = editableOf(container)

    expect(editable).toHaveClass('person-bio', 'ck-editor__editable', 'ck-content')
    expect(editable).toHaveStyle({ padding: '0px' })

    state.disabled = true
    await nextTick()

    expect(editable).toHaveClass('person-bio', 'ck-editor__editable', 'ck-content')
  })

  test('focus and blur are emitted, and ck-blurred is set before PersonEdit checks at 10 ms', async () => {
    const onFocus = vi.fn()
    const onBlur = vi.fn()
    const { container, ready } = renderCkeditor({ attrs: { onFocus, onBlur } })
    const editor = await ready
    const editable = editableOf(container)
    vi.useFakeTimers()

    editable.dispatchEvent(new FocusEvent('focus'))

    expect(onFocus).toHaveBeenCalledTimes(1)
    expect(onFocus.mock.calls[0][1]).toBe(editor)
    expect(editable).toHaveClass('ck-focused')
    expect(editable).not.toHaveClass('ck-blurred')

    editable.dispatchEvent(new FocusEvent('blur'))

    expect(onBlur).toHaveBeenCalledTimes(1)
    expect(onBlur.mock.calls[0][1]).toBe(editor)

    vi.advanceTimersByTime(10)

    expect(editable).toHaveClass('ck-blurred')
    expect(editable).not.toHaveClass('ck-focused')
  })

  test('unmounting destroys the editor and emits destroy', async () => {
    const { ready, unmount, onDestroy } = renderCkeditor()
    const editor = await ready

    unmount()

    expect(onDestroy).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(editor.state).toBe('destroyed'))
  })
})

describe('<ckeditor> compiled from a template', () => {
  test('@update:model-value runs before the v-model assignment written after it, as BookEdit relies on', async () => {
    // returns the bound value at call time; BookEdit.updateBook skips a value equal to it
    const onUpdate = vi.fn(function () {
      return this.summary
    })
    const { ready, onReady } = readySignal()
    // the attribute order of BookEdit, ReviewSubmissions/Book and PeopleSubmissionForm
    const Page = {
      data: () => ({ summary: '<p>Start</p>', editor: BalloonEditor }),
      methods: { onUpdate, onReady },
      template: `
        <ckeditor
          @update:model-value="onUpdate($event)"
          v-model="summary"
          :editor="editor"
          @ready="onReady"
        />
        <output>{{ summary }}</output>
      `,
    }
    render(Page, { global: { plugins: [CKEditor] } })
    const editor = await ready

    editor.setData('<p>Edited</p>')
    await nextTick()

    expect(onUpdate.mock.calls).toEqual([['<p>Edited</p>']])
    expect(onUpdate.mock.results[0].value).toBe('<p>Start</p>')
    expect(screen.getByRole('status')).toHaveTextContent('<p>Edited</p>')
  })
})

describe('CEditor passing on what <ckeditor> emits', () => {
  test('an editor change reaches CEditor once and is re-emitted as update:modelValue with the HTML alone', async () => {
    const onUpdate = vi.fn()
    const { inner, ready } = renderCEditor({
      modelValue: '<p>Initial</p>',
      'onUpdate:modelValue': onUpdate,
    })
    const editor = await ready
    vi.useFakeTimers()

    editor.setData('<p>Changed</p>')
    await nextTick()
    vi.advanceTimersByTime(300)
    await nextTick()

    expect(values(inner)).toEqual(['<p>Changed</p>'])
    expect(onUpdate.mock.calls).toEqual([['<p>Changed</p>']])
  })

  test('an empty modelValue does not emit, although <ckeditor> echoes "" on ready', async () => {
    const onUpdate = vi.fn()
    const { inner, ready } = renderCEditor({ 'onUpdate:modelValue': onUpdate })

    const editor = await ready
    await nextTick()

    // the echo is emitted synchronously before 'ready', so it has reached CEditor by now
    expect(values(inner)).toEqual([''])
    expect(editor.getData()).toBe('')
    expect(onUpdate).not.toHaveBeenCalled()
  })
})
