/**
 * Characterizes the ui, structuredData and debug store modules at the seams where they lean on
 * third-party packages and framework behavior, so a dependency upgrade that changes behavior fails
 * here first:
 * - vitest fake timers, faking an explicit list so a changed default cannot silently alter
 * coverage, drive the 3s popup autoclose and the lodash debounce that writes structured data.
 * - uuid v4 supplies the random tail of every popup id, through util/chronouid.
 * - lodash debounce coalesces structured-data writes; lodash get/set walk its paths.
 * - jsdom supplies document.head, querySelector, textContent and window.location.origin.
 * - vuex 4 resolves dispatched promises; vue 3 reactivity tracks state keys added later.
 * Nothing here reaches Firebase or the network.
 */
import { nextTick, watch } from 'vue'
import { createStore } from 'vuex'
import debug from '@/store/debug'
import ui from '@/store/ui'

/** The instant every test starts at, and the clock structuredData reads when it is imported. */
const NOW = '2026-01-02T03:04:05.000Z'

/** Hex time prefix chronouid derives from NOW (its "decamillenium" minus the epoch millis). */
const NOW_PREFIX = 'e4dc55ad3df8'

/** Creates a fresh store holding only the ui module, whose state is a factory. */
const uiStore = () => createStore({ modules: { ui } })

/** Lists the ld+json scripts currently in the document. */
const ldJsonScripts = () => document.querySelectorAll('script[type="application/ld+json"]')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date(NOW))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('structuredData', () => {
  let store
  let initial

  beforeAll(async () => {
    // structuredData reads the clock and window.location.origin when it is evaluated, so the fake
    // clock has to be in place before the module is first imported
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date(NOW))
    const { default: structuredData } = await import('@/store/structuredData')
    store = createStore({ modules: { structuredData } })
    initial = JSON.parse(JSON.stringify(store.state.structuredData.data))
  })

  beforeEach(() => {
    // the module's state is a shared object rather than a factory, so put its data back by hand
    store.commit('structuredData/set', { value: JSON.parse(JSON.stringify(initial)) })
  })

  afterEach(() => {
    // the debounced updateHead is a module-level singleton: a timer dropped by useRealTimers would
    // leave lodash holding a stale timer id and swallow every later write, so run it out first
    vi.runAllTimers()
    ldJsonScripts().forEach(script => script.remove())
  })

  test('starts from a NewsArticle stamped with the import-time clock and the page origin', () => {
    expect(initial).toEqual({
      '@context': 'http://schema.org',
      '@type': 'NewsArticle',
      mainEntityOfPage: { '@type': 'WebPage', '@id': 'http://localhost:3000' },
      image: { '@type': 'ImageObject' },
      author: { '@type': 'Person', name: 'A Thousand Worlds' },
      publisher: { '@type': 'Organization', name: 'A Thousand Worlds' },
      datePublished: '2026-01-02T03:04:05.000Z',
    })
  })

  test('writes no ld+json script until the debounce timer runs', async () => {
    expect(ldJsonScripts()).toHaveLength(0)

    await store.dispatch('structuredData/set', { path: 'headline', value: 'Hi' })
    expect(store.state.structuredData.data.headline).toBe('Hi')
    expect(ldJsonScripts()).toHaveLength(0)

    vi.advanceTimersByTime(1)
    const scripts = ldJsonScripts()
    expect(scripts).toHaveLength(1)
    expect(scripts[0].parentNode).toBe(document.head)
    expect(JSON.parse(scripts[0].textContent)).toEqual({ ...initial, headline: 'Hi' })
  })

  test('serializes the data with 2-space indentation', async () => {
    await store.dispatch('structuredData/set', { path: 'headline', value: 'Hi' })
    vi.runAllTimers()

    const text = ldJsonScripts()[0].textContent
    expect(
      text.startsWith('{\n  "@context": "http://schema.org",\n  "@type": "NewsArticle",'),
    ).toBe(true)
    expect(text).toBe(JSON.stringify({ ...initial, headline: 'Hi' }, null, 2))
  })

  test('coalesces several sets in one tick into a single write of the last values', async () => {
    await store.dispatch('structuredData/set', { path: 'headline', value: 'A' })
    await store.dispatch('structuredData/set', { path: 'headline', value: 'B' })
    await store.dispatch('structuredData/set', { path: 'image.url', value: 'https://x/y.png' })

    // one pending debounce timer, and one serialization when it runs: each write is exactly one
    // JSON.stringify, while the script element is reused, so counting appendChild would not do
    expect(vi.getTimerCount()).toBe(1)
    const write = vi.spyOn(JSON, 'stringify')
    vi.runAllTimers()

    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith(store.state.structuredData.data, null, 2)
    const scripts = ldJsonScripts()
    expect(scripts).toHaveLength(1)
    const data = JSON.parse(scripts[0].textContent)
    expect(data.headline).toBe('B')
    expect(data.image).toEqual({ '@type': 'ImageObject', url: 'https://x/y.png' })
  })

  test('merges the sets App.vue makes on startup into one document', async () => {
    // App.vue's created() hook, verbatim but for theme 1: four sets in one synchronous run
    const baseUrl = window.location.origin
    const logo = {
      '@type': 'ImageObject',
      url: `${baseUrl}/logo/logo1.png`,
      width: 2176,
      height: 725,
    }
    await Promise.all([
      store.dispatch('structuredData/set', {
        path: 'description',
        value: 'Colorful Reads X Colorful People',
      }),
      store.dispatch('structuredData/set', {
        path: 'image.url',
        value: `${baseUrl}/social/home.png`,
      }),
      store.dispatch('structuredData/set', { path: 'publisher.logo', value: logo }),
      store.dispatch('structuredData/set', { path: 'headline', value: 'A Thousand Worlds' }),
    ])
    vi.runAllTimers()

    expect(ldJsonScripts()).toHaveLength(1)
    expect(JSON.parse(ldJsonScripts()[0].textContent)).toEqual({
      ...initial,
      description: 'Colorful Reads X Colorful People',
      image: { '@type': 'ImageObject', url: 'http://localhost:3000/social/home.png' },
      publisher: {
        '@type': 'Organization',
        name: 'A Thousand Worlds',
        logo: {
          '@type': 'ImageObject',
          url: 'http://localhost:3000/logo/logo1.png',
          width: 2176,
          height: 725,
        },
      },
      headline: 'A Thousand Worlds',
    })
  })

  test('rewrites the same script element on a later set', async () => {
    await store.dispatch('structuredData/set', { path: 'headline', value: 'First' })
    vi.runAllTimers()
    const script = ldJsonScripts()[0]

    await store.dispatch('structuredData/set', { path: 'headline', value: 'Second' })
    vi.runAllTimers()

    expect(ldJsonScripts()).toHaveLength(1)
    expect(ldJsonScripts()[0]).toBe(script)
    expect(JSON.parse(script.textContent).headline).toBe('Second')
  })

  test('adopts an ld+json script already in the head instead of adding another', async () => {
    const existing = document.createElement('script')
    existing.type = 'application/ld+json'
    existing.textContent = '{}'
    document.head.appendChild(existing)

    await store.dispatch('structuredData/set', { path: 'headline', value: 'Adopted' })
    vi.runAllTimers()

    expect(ldJsonScripts()).toHaveLength(1)
    expect(ldJsonScripts()[0]).toBe(existing)
    expect(JSON.parse(existing.textContent)).toEqual({ ...initial, headline: 'Adopted' })
  })

  test('replaces the whole object when set is given no path', async () => {
    await store.dispatch('structuredData/set', { value: { '@type': 'Book' } })
    expect(store.state.structuredData.data).toEqual({ '@type': 'Book' })

    vi.runAllTimers()
    expect(JSON.parse(ldJsonScripts()[0].textContent)).toEqual({ '@type': 'Book' })
  })

  test('creates missing containers along a set path, with an array for a numeric segment', () => {
    store.commit('structuredData/set', { path: 'about.name', value: 'Picture books' })
    store.commit('structuredData/set', { path: 'sameAs.0', value: 'https://example.com/a' })

    expect(store.state.structuredData.data.about).toEqual({ name: 'Picture books' })
    expect(Array.isArray(store.state.structuredData.data.sameAs)).toBe(true)
    expect(store.state.structuredData.data.sameAs).toEqual(['https://example.com/a'])
  })

  test('refuses a __proto__ set path rather than polluting Object.prototype', () => {
    store.commit('structuredData/set', { path: '__proto__.polluted', value: 'yes' })

    expect({}.polluted).toBeUndefined()
    expect(store.state.structuredData.data).toEqual(initial)
  })

  test('get reads a "/" or "." path, and "/" or no path returns the whole object', () => {
    const get = store.getters['structuredData/get']

    expect(get('publisher/name')).toBe('A Thousand Worlds')
    expect(get('mainEntityOfPage.@id')).toBe('http://localhost:3000')
    expect(get('publisher/missing/deeper')).toBeUndefined()
    expect(get('/')).toBe(store.state.structuredData.data)
    expect(get()).toBe(store.state.structuredData.data)
  })
})

describe('ui', () => {
  test('starts idle, in covers view, with no dialog and no popups', () => {
    const store = uiStore()

    expect(store.state.ui).toEqual({
      busy: false,
      pageLoading: false,
      bookmarksOpen: false,
      viewMode: 'covers',
      dlgConfirm: null,
      popups: [],
    })
  })

  test('flag mutations set their field to the committed value', () => {
    const store = uiStore()
    store.commit('ui/setBusy', true)
    store.commit('ui/setPageLoading', true)
    store.commit('ui/setBookmarksOpen', true)
    store.commit('ui/setViewMode', 'list')
    store.commit('ui/setLastVisited', 'book-id')

    expect(store.state.ui).toMatchObject({
      busy: true,
      pageLoading: true,
      bookmarksOpen: true,
      viewMode: 'list',
      lastVisited: 'book-id',
    })
  })

  test('popup(text) resolves a time-ordered id and shows an info popup', async () => {
    const store = uiStore()
    const id = await store.dispatch('ui/popup', 'Hello')

    expect(id).toMatch(new RegExp(`^${NOW_PREFIX}-[0-9a-f]{7}$`))
    expect(store.state.ui.popups).toEqual([{ id, text: 'Hello', type: 'info' }])
  })

  test('popup autocloses at exactly 3000ms', async () => {
    const store = uiStore()
    const id = await store.dispatch('ui/popup', 'Hello')

    vi.advanceTimersByTime(2999)
    expect(store.state.ui.popups.map(popup => popup.id)).toEqual([id])

    vi.advanceTimersByTime(1)
    expect(store.state.ui.popups).toEqual([])
  })

  test('popup ids differ within one millisecond and sort newest first', async () => {
    const store = uiStore()
    const first = await store.dispatch('ui/popup', 'One')
    const second = await store.dispatch('ui/popup', 'Two')
    vi.advanceTimersByTime(1000)
    const later = await store.dispatch('ui/popup', 'Three')

    expect(second).not.toBe(first)
    expect(second.slice(0, 13)).toBe(`${NOW_PREFIX}-`)
    expect(later).toMatch(/^e4dc55ad3a10-[0-9a-f]{7}$/)
    expect([first, later].toSorted()).toEqual([later, first])
  })

  test('popup maps the error type to danger and honors autoclose: false', async () => {
    const store = uiStore()
    const id = await store.dispatch('ui/popup', { type: 'error', text: 'Nope', autoclose: false })

    expect(store.state.ui.popups).toEqual([{ id, text: 'Nope', type: 'danger' }])
    vi.advanceTimersByTime(10000)
    expect(store.state.ui.popups).toEqual([{ id, text: 'Nope', type: 'danger' }])
  })

  test('popup passes other types through and autocloses them', async () => {
    const store = uiStore()
    const id = await store.dispatch('ui/popup', { type: 'success', text: 'Saved' })

    expect(store.state.ui.popups).toEqual([{ id, text: 'Saved', type: 'success' }])
    vi.advanceTimersByTime(3000)
    expect(store.state.ui.popups).toEqual([])
  })

  test('popup with no type keeps type undefined and autocloses on autoclose: true', async () => {
    const store = uiStore()
    const id = await store.dispatch('ui/popup', { text: 'Message sent!', autoclose: true })

    // strict, so a type key dropped from the popup would fail rather than compare equal
    expect(store.state.ui.popups).toStrictEqual([{ id, text: 'Message sent!', type: undefined }])
    vi.advanceTimersByTime(3000)
    expect(store.state.ui.popups).toEqual([])
  })

  test('close removes only the popup with that id, in either order', async () => {
    const store = uiStore()
    const first = await store.dispatch('ui/popup', { text: 'First', autoclose: false })
    const second = await store.dispatch('ui/popup', { text: 'Second', autoclose: false })
    const third = await store.dispatch('ui/popup', { text: 'Third', autoclose: false })

    await store.dispatch('ui/close', third)
    expect(store.state.ui.popups.map(popup => popup.text)).toEqual(['First', 'Second'])

    await store.dispatch('ui/close', first)
    expect(store.state.ui.popups).toEqual([{ id: second, text: 'Second', type: undefined }])
  })

  test('an autoclose timer firing after a manual close leaves other popups alone', async () => {
    const store = uiStore()
    const shortLived = await store.dispatch('ui/popup', 'Short')
    const sticky = await store.dispatch('ui/popup', { text: 'Sticky', autoclose: false })

    await store.dispatch('ui/close', shortLived)
    vi.advanceTimersByTime(3000)

    expect(store.state.ui.popups).toEqual([{ id: sticky, text: 'Sticky', type: undefined }])
  })

  test('handleError logs the error and shows its message in a danger popup that stays', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = uiStore()
    const boom = new Error('Boom')

    await store.dispatch('ui/handleError', boom)

    expect(error).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith(boom)
    expect(store.state.ui.popups).toEqual([
      {
        id: expect.stringMatching(new RegExp(`^${NOW_PREFIX}-[0-9a-f]{7}$`)),
        text: 'Boom',
        type: 'danger',
      },
    ])
    vi.advanceTimersByTime(10000)
    expect(store.state.ui.popups.map(popup => popup.text)).toEqual(['Boom'])
  })

  test('handleError shows a string error as the popup text', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = uiStore()

    await store.dispatch('ui/handleError', 'plain text')

    expect(error).toHaveBeenCalledWith('plain text')
    expect(store.state.ui.popups.map(({ text, type }) => ({ text, type }))).toEqual([
      { text: 'plain text', type: 'danger' },
    ])
  })

  test('confirm(text) opens an info dialog and resolves with the committed answer', async () => {
    const store = uiStore()
    const answer = store.dispatch('ui/confirm', 'Delete?')

    expect(store.state.ui.dlgConfirm).toEqual({
      text: 'Delete?',
      type: 'info',
      header: 'Confirmation required',
      resolve: expect.any(Function),
    })

    store.commit('ui/confirm', true)
    await expect(answer).resolves.toBe(true)
    expect(store.state.ui.dlgConfirm).toBeNull()
  })

  test('confirm resolves false when the dialog is cancelled', async () => {
    const store = uiStore()
    const answer = store.dispatch('ui/confirm', 'Delete?')

    store.commit('ui/confirm', false)
    await expect(answer).resolves.toBe(false)
    expect(store.state.ui.dlgConfirm).toBeNull()
  })

  test('confirm passes an object argument through unchanged', async () => {
    const store = uiStore()
    const answer = store.dispatch('ui/confirm', {
      text: 'Remove?',
      type: 'danger',
      header: 'Sure?',
    })

    expect(store.state.ui.dlgConfirm).toEqual({
      text: 'Remove?',
      type: 'danger',
      header: 'Sure?',
      resolve: expect.any(Function),
    })
    store.commit('ui/confirm', true)
    await expect(answer).resolves.toBe(true)
  })

  test('prompt(text) opens an input dialog and resolves with the committed answer', async () => {
    const store = uiStore()
    const answer = store.dispatch('ui/prompt', 'Name?')

    expect(store.state.ui.dlgPrompt).toEqual({
      text: 'Name?',
      type: 'info',
      header: 'Input required',
      resolve: expect.any(Function),
    })

    store.commit('ui/prompt', 'Ada')
    await expect(answer).resolves.toBe('Ada')
    expect(store.state.ui.dlgPrompt).toBeNull()
  })

  test('prompt passes an object argument through unchanged', async () => {
    const store = uiStore()
    const answer = store.dispatch('ui/prompt', { text: 'Tag?', type: 'warning', header: 'New tag' })

    expect(store.state.ui.dlgPrompt).toEqual({
      text: 'Tag?',
      type: 'warning',
      header: 'New tag',
      resolve: expect.any(Function),
    })
    store.commit('ui/prompt', null)
    await expect(answer).resolves.toBeNull()
  })

  test('a watcher sees dlgPrompt appear although it is absent from the initial state', async () => {
    const store = uiStore()
    const onChange = vi.fn()
    const stop = watch(() => store.state.ui.dlgPrompt?.text, onChange)
    expect('dlgPrompt' in store.state.ui).toBe(false)

    const answer = store.dispatch('ui/prompt', 'Name?')
    await nextTick()
    expect(onChange.mock.calls.map(([text]) => text)).toEqual(['Name?'])

    store.commit('ui/prompt', 'Ada')
    await answer
    await nextTick()
    expect(onChange.mock.calls.map(([text]) => text)).toEqual(['Name?', undefined])
    stop()
  })

  test('a watcher sees each popup pushed and closed', async () => {
    const store = uiStore()
    const onChange = vi.fn()
    const stop = watch(() => store.state.ui.popups.map(popup => popup.text), onChange)

    await store.dispatch('ui/popup', 'Hello')
    await nextTick()
    vi.advanceTimersByTime(3000)
    await nextTick()

    expect(onChange.mock.calls.map(([texts]) => texts)).toEqual([['Hello'], []])
    stop()
  })
})

describe('debug', () => {
  beforeEach(() => {
    window.atw = undefined
  })

  afterEach(() => {
    window.atw = undefined
  })

  test('creates window.atw from the first payload', async () => {
    const store = createStore({ modules: { debug } })
    await store.dispatch('debug', { a: 1 })

    expect(window.atw).toEqual({ a: 1 })
  })

  test('merges later payloads into window.atw, overwriting repeated keys', async () => {
    const store = createStore({ modules: { debug } })
    const book = { id: 'b1' }
    await store.dispatch('debug', { a: 1 })
    await store.dispatch('debug', { b: 2 })
    await store.dispatch('debug', { a: 3, book })

    expect(window.atw).toEqual({ a: 3, b: 2, book: { id: 'b1' } })
    expect(window.atw.book).toBe(book)
  })
})
