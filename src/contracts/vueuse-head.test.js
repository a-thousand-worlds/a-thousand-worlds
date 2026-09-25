/*
 * Contract tests for @vueuse/head, the document head manager behind every page's <title> and its
 * open graph and twitter meta tags, as driven by vue's reactivity. Dependency seams guarded:
 *
 * - createHead() installed with app.use in src/main.js:58.
 * - App.vue:37-60, the app-level useHead holding the default title and the full set of social meta.
 * - BookDetail.vue:91-101 and PersonDetail.vue:78-88, a page-level useHead whose title, og:title
 *   and twitter:title share one computed that is null until the record loads.
 * - Home.vue:68-76 and People.vue:45-55, a page-level useHead whose computed title and description
 *   follow the active filters, with no image of their own.
 * - Support.vue:43 and Contact.vue:29, a page-level useHead with description meta only.
 *
 * The call shapes are mirrored with inline components rather than imported, since the real pages
 * pull in the store, router, CKEditor and firebase. Each test gets a fresh head. DOM effects are
 * awaited with vi.waitFor rather than a fixed tick, so a change in when the head flushes (0.9 uses
 * nextTick, unhead batches differently) does not fail a test; only a change in the output does.
 * Tags are asserted one by one, never through the 0.9-only <meta name="head:count"> bookkeeping.
 */
/* eslint-disable vue/one-component-per-file -- the file mirrors an app shell and several page shapes */
import { computed, createApp, defineComponent, h, nextTick, ref, shallowRef } from 'vue'
import { render } from '@testing-library/vue'
import { createHead, useHead } from '@vueuse/head'

const appTitle = 'A Thousand Worlds'
const appDescription = 'Colorful Reads X Colorful People'
const supportDescription = `Donate to support BIPOC children's book creators!`

/** A Firebase Storage download URL, whose %2F, ? and & must reach the content attribute as is. */
const coverUrl =
  'https://firebasestorage.googleapis.com/v0/b/a-thousand-worlds.appspot.com/o/books%2Fsulwe.jpg?alt=media&token=4f1c'

/** A person photo URL of the same shape. */
const photoUrl =
  'https://firebasestorage.googleapis.com/v0/b/a-thousand-worlds.appspot.com/o/people%2Fvashti-harrison.jpg?alt=media&token=9d2e'

/** App.vue's default head, built at call time as App.vue's setup does, since it reads window.location. */
const appHead = () => ({
  title: 'A Thousand Worlds',
  meta: [
    // open graph
    { name: 'og:description', content: appDescription },
    { name: 'og:image', content: `${window.location.origin}/social/home.png?fbreset=1` },
    { name: 'og:title', content: appTitle },
    { name: 'og:type', content: 'article' },
    { name: 'og:url', content: window.location.href },

    // twitter
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:description', content: appDescription },
    { name: 'twitter:image', content: `${window.location.origin}/social/home.png` },
    { name: 'twitter:site', content: '@worlds_thousand' },
    { name: 'twitter:title', content: appTitle },
    { name: 'twitter:url', content: window.location.href },

    // facebook
    { name: 'fb:pages', content: '102421671707042' },
    { name: 'article:opinion', content: 'false' },
    { name: 'article:content_tier', content: 'free' },
  ],
})

/**
 * A detail page shaped like BookDetail and PersonDetail: title, og:title and twitter:title share
 * one computed, and every computed is null while the record ref is null (not yet loaded).
 */
const detailPage = (record, { description, image }) =>
  defineComponent({
    name: 'DetailPage',
    setup() {
      const titleComputed = computed(() =>
        record.value ? `${record.value.name} @ A Thousand Worlds` : null,
      )
      const descriptionComputed = computed(() => (record.value ? description(record.value) : null))
      const imageComputed = computed(() => (record.value ? image(record.value) : null))
      useHead({
        title: titleComputed,
        meta: [
          { name: 'og:description', content: descriptionComputed },
          { name: 'og:image', content: imageComputed },
          { name: 'og:title', content: titleComputed },
          { name: 'twitter:description', content: descriptionComputed },
          { name: 'twitter:image', content: imageComputed },
          { name: 'twitter:title', content: titleComputed },
        ],
      })
      return () => h('main', record.value?.name ?? 'Loading')
    },
  })

/** A BookDetail-shaped page for a book ref of { name, cover }. */
const bookPage = book =>
  detailPage(book, {
    description: ({ name }) => `Read ${name} by Vashti Harrison at A Thousand Worlds`,
    image: ({ cover }) => cover || null,
  })

/** A PersonDetail-shaped page for a person ref of { name, photo }. */
const personPage = person =>
  detailPage(person, {
    description: ({ name }) => `Read books by ${name} at A Thousand Worlds`,
    image: ({ photo }) => photo || null,
  })

/**
 * A listing page shaped like Home and People: the title and description follow a filter phrase
 * ref, and fall back to the app's own strings when no filter is active. It sets no image.
 */
const filterPage = phrase =>
  defineComponent({
    name: 'FilterPage',
    setup() {
      const descriptionComputed = computed(() =>
        phrase.value ? `Read ${phrase.value} at A Thousand Worlds` : appDescription,
      )
      const titleComputed = computed(() =>
        phrase.value ? `${phrase.value} @ A Thousand Worlds` : 'A Thousand Worlds',
      )
      useHead({
        title: titleComputed,
        meta: [
          { name: 'og:description', content: descriptionComputed },
          { name: 'og:title', content: titleComputed },
          { name: 'twitter:description', content: descriptionComputed },
          { name: 'twitter:title', content: titleComputed },
        ],
      })
      return () => h('main', 'Books')
    },
  })

/** A static page shaped like Support and Contact: description meta only, no title. */
const SupportPage = defineComponent({
  name: 'SupportPage',
  setup() {
    useHead({
      meta: [
        { name: 'og:description', content: supportDescription },
        { name: 'twitter:description', content: supportDescription },
      ],
    })
    return () => h('main', 'Support')
  },
})

/**
 * Renders an App.vue-shaped shell holding the default head, with a fresh createHead(), and the
 * given page beneath it where the router-view would be. Returns the ref holding the page: set it
 * to another page to navigate, or to null to unmount the page.
 */
const renderApp = initialPage => {
  const page = shallowRef(initialPage)
  const App = defineComponent({
    name: 'App',
    setup() {
      useHead(appHead())
      return () => h('div', page.value ? [h(page.value)] : [])
    },
  })
  render(App, { global: { plugins: [createHead()] } })
  return page
}

/** Gets the content attribute of every <meta name="..."> in the head, in document order. */
const metaContents = name =>
  // eslint-disable-next-line testing-library/no-node-access -- the head is outside Testing Library's queries
  [...document.head.querySelectorAll(`meta[name="${name}"]`)].map(el => el.getAttribute('content'))

/** Counts the head elements matching a selector. */
const countInHead = selector =>
  // eslint-disable-next-line testing-library/no-node-access -- the head is outside Testing Library's queries
  document.head.querySelectorAll(selector).length

/** Waits until the head reflects a title, the one signal every update in these tests carries. */
const waitForTitle = title => vi.waitFor(() => expect(document.title).toBe(title))

/**
 * Flushes a Vue tick and a macrotask, so the head update scheduled by the previous test's unmount
 * (Testing Library's automatic cleanup) has landed before the head is emptied.
 */
const settle = async () => {
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

/** Empties the head's <title> and <meta> tags and the title, so no test's tags leak into the next. */
const resetHead = () => {
  document.title = ''
  // eslint-disable-next-line testing-library/no-node-access -- the head is outside Testing Library's queries
  document.head.querySelectorAll('title, meta').forEach(el => el.remove())
}

beforeEach(async () => {
  await settle()
  resetHead()
})

describe('exports', () => {
  test('createHead returns a plugin that app.use accepts, and useHead is a function', () => {
    expect(typeof createHead).toBe('function')
    expect(typeof useHead).toBe('function')

    const head = createHead()
    expect(typeof head.install).toBe('function')

    // main.js chains .use(createHead()).use(store)..., so use must hand back the app
    const app = createApp({ render: () => null })
    expect(app.use(head)).toBe(app)
  })
})

describe('app-level head (App.vue)', () => {
  test('sets the document title and every default meta tag by name', async () => {
    renderApp(null)
    await waitForTitle(appTitle)

    expect(metaContents('og:description')).toEqual([appDescription])
    expect(metaContents('og:image')).toEqual([
      `${window.location.origin}/social/home.png?fbreset=1`,
    ])
    expect(metaContents('og:title')).toEqual([appTitle])
    expect(metaContents('og:type')).toEqual(['article'])
    expect(metaContents('og:url')).toEqual([window.location.href])
    expect(metaContents('twitter:card')).toEqual(['summary_large_image'])
    expect(metaContents('twitter:description')).toEqual([appDescription])
    expect(metaContents('twitter:image')).toEqual([`${window.location.origin}/social/home.png`])
    expect(metaContents('twitter:site')).toEqual(['@worlds_thousand'])
    expect(metaContents('twitter:title')).toEqual([appTitle])
    expect(metaContents('twitter:url')).toEqual([window.location.href])
    expect(metaContents('fb:pages')).toEqual(['102421671707042'])
    expect(metaContents('article:opinion')).toEqual(['false'])
    expect(metaContents('article:content_tier')).toEqual(['free'])
  })

  test('renders og: tags with the name attribute, never as property', async () => {
    renderApp(null)
    await waitForTitle(appTitle)

    expect(countInHead('meta[name="og:title"]')).toBe(1)
    expect(countInHead('meta[property="og:title"]')).toBe(0)
    expect(countInHead('meta[property]')).toBe(0)
  })

  test('keeps the static tags from public/index.html and reuses its single <title>', async () => {
    // public/index.html ships a <title> and a theme-color meta before the app mounts
    const staticTitle = document.createElement('title')
    staticTitle.textContent = 'A Thousand Worlds'
    const themeColor = document.createElement('meta')
    themeColor.setAttribute('name', 'theme-color')
    themeColor.setAttribute('content', '#ffffff')
    document.head.append(staticTitle, themeColor)

    const book = ref({ name: 'Sulwe', cover: coverUrl })
    const page = renderApp(bookPage(book))
    await waitForTitle('Sulwe @ A Thousand Worlds')

    expect(countInHead('title')).toBe(1)
    expect(metaContents('theme-color')).toEqual(['#ffffff'])

    page.value = null
    await waitForTitle(appTitle)

    expect(countInHead('title')).toBe(1)
    expect(metaContents('theme-color')).toEqual(['#ffffff'])
  })
})

describe('detail page head (BookDetail, PersonDetail)', () => {
  test('the page title and meta override the app defaults, deduped by name', async () => {
    const book = ref({ name: 'Sulwe', cover: coverUrl })
    renderApp(bookPage(book))
    await waitForTitle('Sulwe @ A Thousand Worlds')

    expect(metaContents('og:title')).toEqual(['Sulwe @ A Thousand Worlds'])
    expect(metaContents('twitter:title')).toEqual(['Sulwe @ A Thousand Worlds'])
    expect(metaContents('og:description')).toEqual([
      'Read Sulwe by Vashti Harrison at A Thousand Worlds',
    ])
    expect(metaContents('twitter:description')).toEqual([
      'Read Sulwe by Vashti Harrison at A Thousand Worlds',
    ])
    expect(metaContents('og:image')).toEqual([coverUrl])
    expect(metaContents('twitter:image')).toEqual([coverUrl])

    // tags only the app declares are untouched
    expect(metaContents('og:type')).toEqual(['article'])
    expect(metaContents('twitter:card')).toEqual(['summary_large_image'])
    expect(metaContents('og:url')).toEqual([window.location.href])
  })

  test('the title and meta follow the computed when the record changes', async () => {
    const book = ref({ name: 'Sulwe', cover: coverUrl })
    renderApp(bookPage(book))
    await waitForTitle('Sulwe @ A Thousand Worlds')

    book.value = { name: 'Hair Love', cover: '' }
    await waitForTitle('Hair Love @ A Thousand Worlds')

    expect(metaContents('og:title')).toEqual(['Hair Love @ A Thousand Worlds'])
    expect(metaContents('twitter:title')).toEqual(['Hair Love @ A Thousand Worlds'])
    expect(metaContents('og:description')).toEqual([
      'Read Hair Love by Vashti Harrison at A Thousand Worlds',
    ])
  })

  test('a null title falls back to the app title until the record loads', async () => {
    const book = ref(null)
    renderApp(bookPage(book))
    await waitForTitle(appTitle)

    book.value = { name: 'Sulwe', cover: coverUrl }
    await waitForTitle('Sulwe @ A Thousand Worlds')

    expect(metaContents('og:title')).toEqual(['Sulwe @ A Thousand Worlds'])
    expect(metaContents('og:image')).toEqual([coverUrl])
  })

  test('unmounting the page restores the app title and meta', async () => {
    const book = ref({ name: 'Sulwe', cover: coverUrl })
    const page = renderApp(bookPage(book))
    await waitForTitle('Sulwe @ A Thousand Worlds')

    page.value = null
    await waitForTitle(appTitle)

    expect(metaContents('og:title')).toEqual([appTitle])
    expect(metaContents('twitter:title')).toEqual([appTitle])
    expect(metaContents('og:description')).toEqual([appDescription])
    expect(metaContents('twitter:description')).toEqual([appDescription])
    expect(metaContents('og:image')).toEqual([
      `${window.location.origin}/social/home.png?fbreset=1`,
    ])
    expect(metaContents('twitter:image')).toEqual([`${window.location.origin}/social/home.png`])
  })

  test('navigating from one detail page to another leaves only the new page tags', async () => {
    const book = ref({ name: 'Sulwe', cover: coverUrl })
    const person = ref({ name: 'Vashti Harrison', photo: photoUrl })
    const page = renderApp(bookPage(book))
    await waitForTitle('Sulwe @ A Thousand Worlds')

    page.value = personPage(person)
    await waitForTitle('Vashti Harrison @ A Thousand Worlds')

    expect(metaContents('og:title')).toEqual(['Vashti Harrison @ A Thousand Worlds'])
    expect(metaContents('og:description')).toEqual([
      'Read books by Vashti Harrison at A Thousand Worlds',
    ])
    expect(metaContents('og:image')).toEqual([photoUrl])
    expect(metaContents('twitter:image')).toEqual([photoUrl])
  })
})

describe('filter page head (Home, People)', () => {
  test('the title and description follow the filter, and the app image stays', async () => {
    const phrase = ref(null)
    renderApp(filterPage(phrase))
    await waitForTitle(appTitle)
    expect(metaContents('og:description')).toEqual([appDescription])

    phrase.value = 'Black Joy'
    await waitForTitle('Black Joy @ A Thousand Worlds')

    expect(metaContents('og:title')).toEqual(['Black Joy @ A Thousand Worlds'])
    expect(metaContents('twitter:title')).toEqual(['Black Joy @ A Thousand Worlds'])
    expect(metaContents('og:description')).toEqual(['Read Black Joy at A Thousand Worlds'])
    expect(metaContents('twitter:description')).toEqual(['Read Black Joy at A Thousand Worlds'])
    // Home sets no image, so the app's collage stays
    expect(metaContents('og:image')).toEqual([
      `${window.location.origin}/social/home.png?fbreset=1`,
    ])

    phrase.value = null
    await waitForTitle(appTitle)
    expect(metaContents('og:title')).toEqual([appTitle])
    expect(metaContents('og:description')).toEqual([appDescription])
  })
})

describe('static page head (Support, Contact)', () => {
  test('description-only meta overrides both descriptions while the app title stays', async () => {
    renderApp(SupportPage)
    await vi.waitFor(() => expect(metaContents('og:description')).toEqual([supportDescription]))

    expect(metaContents('twitter:description')).toEqual([supportDescription])
    expect(document.title).toBe(appTitle)
    expect(metaContents('og:title')).toEqual([appTitle])
  })

  test('navigating from a detail page to a static page drops the detail title', async () => {
    const book = ref({ name: 'Sulwe', cover: coverUrl })
    const page = renderApp(bookPage(book))
    await waitForTitle('Sulwe @ A Thousand Worlds')

    page.value = SupportPage
    await waitForTitle(appTitle)

    expect(metaContents('og:title')).toEqual([appTitle])
    expect(metaContents('og:description')).toEqual([supportDescription])
    expect(metaContents('og:image')).toEqual([
      `${window.location.origin}/social/home.png?fbreset=1`,
    ])
  })
})
