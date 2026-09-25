/**
 * BookSubmissionForm: the book suggestion flow from typing a title through the cover search,
 * confirmation, duplicate detection, metadata lookup, draft saving and submit.
 *
 * Dependency seams guarded:
 * - isbn3: ISBN.asIsbn10 matches a directory book stored as ISBN-10 or hyphenated ISBN-13
 * against the ISBN-13 a search returns.
 * - uuid (via chronouid): the Title field's label/input id.
 * - lodash debounce/throttle: the 500ms search and metadata debounces, the draft save that lands
 * 1000ms after an edit, and the throttle's leading edge that re-validates on the first keystroke.
 * - dayjs (via metadataByISBN): the year parsed out of publishedDate.
 * - axios (via findBookByKeyword and metadataByISBN): requests go through its default xhr adapter
 * to a fake XMLHttpRequest, pinning the exact GET URLs it opens, its JSON parsing of the response
 * body, and a 500 rejecting as 'Request failed with status code 500', which the page shows in a
 * popup.
 * - vue 3.5: @input falling through BookTitleField to its root element, the bare <template> slot
 * MessageSequence counts as one step, and checkbox v-model on a nested object.
 * - vue-router: the redirect to the thank-you page.
 * - @testing-library/jest-dom: toHaveStyle, toBeDisabled, toHaveValue, toBeVisible, toHaveClass.
 *
 * Firebase is a boundary: store actions that reach it resolve without calling through, and
 * '@/firebase' is replaced so nothing can reach the real SDK.
 */
import BookSubmissionForm from '@/pages/BookSubmissionForm.vue'
import { render } from '@/test-helpers'
import { fireEvent, render as vueRender } from '@testing-library/vue'
import router from '@/router'
import store from '@/store'
import mixins from '@/mixins/global'
import directives from '@/directives'

vi.mock('@/firebase', () => ({
  default: {
    auth: () => {
      throw new Error('Unexpected firebase.auth() in BookSubmissionForm test')
    },
    database: () => {
      throw new Error('Unexpected firebase.database() in BookSubmissionForm test')
    },
  },
}))

const NOW = '2024-05-01T12:00:00.000Z'
const SEARCH_URL = 'https://search.test/find'
const META_URL = 'https://meta.test/isbn'
const TITLE = 'The Bear and the Moon'
const AUTHORS = 'Matthew Burgess'
const ILLUSTRATORS = 'Catia Chien'
const FOUND = { isbn: '9781452171913', thumbnail: 'https://x/thumb.jpg' }
const TAGS = {
  t2: { id: 't2', tag: 'Animals', sortOrder: 11 },
  t1: { id: 't1', tag: 'Picture book', sortOrder: 2 },
}

/** Store actions that write to Firebase; the dispatch spy resolves these without calling through. */
const FIREBASE_ACTIONS = [
  'submissions/books/submit',
  'user/saveBookSubmissionsDraft',
  'user/updateMessageSequence',
  'users/loadOne',
]

/** Every store dispatch in the current test, with its payload cloned at dispatch time. */
let dispatches = []

/** Returns the payload of every dispatch of the given action, as it was when dispatched. */
const dispatchedTo = type => dispatches.filter(d => d.type === type).map(d => d.payload)

/** Every request the fake XMLHttpRequest was opened with in the current test, as 'METHOD url'. */
let requests = []

/** Returns the URLs of the GET requests that start with the given prefix, in the order opened. */
const getsTo = prefix =>
  requests
    .filter(request => request.startsWith(`GET ${prefix}`))
    .map(request => request.slice('GET '.length))

/**
 * Replaces XMLHttpRequest, which axios's default xhr adapter sends through in jsdom as in a browser,
 * with a fake that routes by URL prefix to a search and a metadata responder. A responder's return
 * value (or what its promise resolves to) goes back as a JSON body with status 200; a responder that
 * throws or rejects gets status 500. Any other URL fails when opened. The metadata responder must
 * return data, otherwise metadataByISBN falls back to a live lookup.
 */
const stubServer = ({ search = () => FOUND, meta = () => ({ title: 'Unrelated' }) } = {}) => {
  /** The fake request. onloadend starts null, as on a real XMLHttpRequest, so axios listens on it. */
  function FakeXHR() {
    Object.assign(this, {
      onloadend: null,
      readyState: 0,
      status: 0,
      statusText: '',
      responseText: '',
    })
  }

  Object.assign(FakeXHR.prototype, {
    open(method, url) {
      requests = [...requests, `${method} ${url}`]
      this.url = url
      this.respond = url.startsWith(`${SEARCH_URL}?`)
        ? search
        : url.startsWith(`${META_URL}?`)
          ? meta
          : null
      if (!this.respond) throw new Error(`Unexpected ${method} ${url}`)
    },
    setRequestHeader() {},
    getAllResponseHeaders() {
      return 'content-type: application/json\r\n'
    },
    send() {
      new Promise(resolve => resolve(this.respond(this.url))).then(
        body => this.finish(200, 'OK', JSON.stringify(body)),
        () => this.finish(500, 'Internal Server Error', ''),
      )
    },
    finish(status, statusText, responseText) {
      Object.assign(this, { readyState: 4, status, statusText, responseText })
      this.onloadend()
    },
    abort() {},
  })

  vi.stubGlobal('XMLHttpRequest', FakeXHR)
}

/** Logs in a user with the given roles and profile. */
const login = (roles, profile = {}) =>
  store.commit('user/setUser', { uid: roles.owner ? 'u1' : 'u2', roles, profile })

/**
 * Renders the form with the real store and router, then lets 100ms pass before the test types.
 * Vue ignores a bubbled event stamped no later than its listener was attached, so with a frozen
 * clock the first keystroke in Title would never reach the @input that falls through BookTitleField.
 */
const mountForm = async () => {
  const view = vueRender(BookSubmissionForm, {
    global: {
      plugins: [store, router],
      mixins: [mixins],
      directives: { ...directives, tippy: () => {} },
      // owners can edit Content, which lazily loads CKEditor and would race the test; out of scope here
      stubs: { CEditor: true },
    },
  })
  await vi.advanceTimersByTimeAsync(100)
  return view
}

/** Returns the input labelled by the given label text (substring match). */
const field = (view, label) => view.getByLabelText(label, { exact: false })

/** Replaces a field's value and fires input, as typing does. */
const typeInto = (view, label, value) => fireEvent.update(field(view, label), value)

/** Types title, authors and illustrators, then waits out the 500ms search debounce. */
const fillBook = async (
  view,
  { title = TITLE, authors = AUTHORS, illustrators = ILLUSTRATORS } = {},
) => {
  await typeInto(view, 'Title', title)
  await typeInto(view, 'Author(s)', authors)
  await typeInto(view, 'Illustrator(s)', illustrators)
  await vi.advanceTimersByTimeAsync(500)
}

/** Returns the text of each validation error paragraph, in document order. */
const errorMessages = view =>
  view.queryAllByText(/ (is|are) required/).map(p => p.textContent.trim())

afterEach(() => {
  // the debounces and the throttle are created once when the component module loads and are shared
  // by every instance, so a call left pending by one test would swallow the next test's calls
  const { saveDraft, metadataInputsChangedDebounced, updateMetadataDebounced, revalidate } =
    BookSubmissionForm.methods
  ;[saveDraft, metadataInputsChangedDebounced, updateMetadataDebounced, revalidate].forEach(f =>
    f.cancel(),
  )
  vi.useRealTimers()
})

test('render BookSubmissionForm', async () => {
  const component = render(BookSubmissionForm)
  await fireEvent.update(component.getByLabelText('Title', { exact: false }), 'bear')
  await fireEvent.update(component.getByLabelText('Author(s)', { exact: false }), 'm')
  expect(await component).toBeTruthy()
})

describe('BookSubmissionForm', () => {
  beforeEach(async () => {
    // never vi.runAllTimers: LogarithmicProgressBar and Content start intervals that are never cleared
    vi.useFakeTimers()
    // before render, since createdAt and the Title id are taken from the clock in data()
    vi.setSystemTime(new Date(NOW))
    vi.stubEnv('VUE_APP_AMAZON_SEARCH_BOOK_URL', SEARCH_URL)
    vi.stubEnv('VUE_APP_METADATA_BY_ISBN_URL', META_URL)
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})

    requests = []
    dispatches = []
    const dispatch = store.dispatch
    vi.spyOn(store, 'dispatch').mockImplementation((type, payload, options) => {
      // clone, since the component keeps mutating the submissions it dispatched
      dispatches = [
        ...dispatches,
        { type, payload: payload === undefined ? undefined : JSON.parse(JSON.stringify(payload)) },
      ]
      return FIREBASE_ACTIONS.includes(type)
        ? Promise.resolve()
        : dispatch.call(store, type, payload, options)
    })

    store.commit('user/setUser', null)
    store.commit('ui/setBusy', false)
    store.state.ui.popups.forEach(popup => store.commit('ui/closePopup', popup.id))
    store.commit('tags/books/set', TAGS)
    store.commit('books/set', {})
    await router.push('/suggest/book')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  describe('help', () => {
    test('shows a single Getting Started step with an Okay button', async () => {
      const view = await mountForm()

      expect(view.getByText('Getting Started')).toBeVisible()
      expect(view.getByRole('button', { name: 'Okay' })).toBeInTheDocument()
      expect(view.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
    })

    test('Okay completes the sequence, persists step and completion, and hides the help', async () => {
      const view = await mountForm()

      await fireEvent.click(view.getByRole('button', { name: 'Okay' }))

      expect(dispatchedTo('user/updateMessageSequence')).toEqual([
        { name: 'bookSubmissionForm', key: 'step', value: 1 },
        { name: 'bookSubmissionForm', key: 'completed', value: true },
      ])
      expect(view.getByText('Getting Started')).not.toBeVisible()
    })
  })

  test('labels the Title input with a chronouid id taken from the clock', async () => {
    const view = await mountForm()

    // (253402304400000 - Date.parse(NOW)).toString(16), then the first 7 characters of a uuid v4
    expect(field(view, 'Title').id).toMatch(/^e4e89e502c80-[0-9a-f]{7}$/)
  })

  describe('cover search', () => {
    test.each([
      ['illustrators', { title: TITLE, authors: AUTHORS }],
      ['authors', { title: TITLE, illustrators: ILLUSTRATORS }],
      ['title', { authors: AUTHORS, illustrators: ILLUSTRATORS }],
    ])('does not search while %s is empty', async (_, values) => {
      stubServer()
      const view = await mountForm()

      await fillBook(view, { title: '', authors: '', illustrators: '', ...values })
      await vi.advanceTimersByTimeAsync(1000)

      expect(requests).toEqual([])
      expect(view.queryByRole('loading')).not.toBeInTheDocument()
      expect(view.queryByAltText('thumbnail')).not.toBeInTheDocument()
    })

    test('searches by title and author 500ms after the last edit, leaving illustrators out', async () => {
      stubServer()
      const view = await mountForm()

      await typeInto(view, 'Title', TITLE)
      await typeInto(view, 'Author(s)', AUTHORS)
      await vi.advanceTimersByTimeAsync(600)
      expect(requests).toEqual([])

      await typeInto(view, 'Illustrator(s)', ILLUSTRATORS)
      await vi.advanceTimersByTimeAsync(499)
      expect(requests).toEqual([])

      await vi.advanceTimersByTimeAsync(1)
      expect(requests).toEqual([
        `GET ${SEARCH_URL}?keyword=The%20Bear%20and%20the%20Moon%20by%20Matthew%20Burgess`,
      ])
    })

    test.each([
      'Matthew Burgess and Catia Chien',
      'Matthew Burgess, Catia Chien',
      'Matthew Burgess & Catia Chien',
    ])('joins each parsed author name with a space in the keyword: %s', async authors => {
      stubServer()
      const view = await mountForm()

      await fillBook(view, { title: `  ${TITLE} `, authors })

      expect(getsTo(SEARCH_URL)).toEqual([
        `${SEARCH_URL}?keyword=The%20Bear%20and%20the%20Moon%20by%20Matthew%20Burgess%20Catia%20Chien`,
      ])
    })

    test('shows the loader while the search is in flight', async () => {
      let respond
      stubServer({ search: () => new Promise(resolve => (respond = resolve)) })
      const view = await mountForm()

      await fillBook(view)
      expect(view.getByRole('loading')).toBeInTheDocument()
      expect(view.queryByText('Is this the correct book?')).not.toBeInTheDocument()

      respond(FOUND)
      await vi.advanceTimersByTimeAsync(0)
      expect(view.queryByRole('loading')).not.toBeInTheDocument()
      expect(view.getByText('Is this the correct book?')).toBeInTheDocument()
    })

    test('asks to confirm a found book next to its visible thumbnail', async () => {
      stubServer()
      const view = await mountForm()

      await fillBook(view)

      expect(view.getByText('Is this the correct book?')).toBeInTheDocument()
      expect(view.getByRole('button', { name: 'Yes' })).toBeInTheDocument()
      expect(view.getByRole('button', { name: 'No' })).toBeInTheDocument()
      const thumbnail = view.getByAltText('thumbnail')
      expect(thumbnail).toHaveAttribute('src', FOUND.thumbnail)
      expect(thumbnail).not.toHaveStyle({ visibility: 'hidden' })
    })

    test('says the book was not found and asks for the ISBN when the search returns nothing', async () => {
      stubServer({ search: () => null })
      const view = await mountForm()

      await fillBook(view)

      expect(view.getByText("Hmmm... we couldn't find that book.")).toBeInTheDocument()
      expect(view.getByText('please enter the ISBN:')).toBeInTheDocument()
      expect(view.queryByText('Okay, please enter the ISBN:')).not.toBeInTheDocument()
      expect(view.queryByText('Is this the correct book?')).not.toBeInTheDocument()
    })

    test('surfaces a search that fails with a 500 as a danger popup and falls back to not found', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      stubServer({
        search: () => {
          throw new Error('server down')
        },
      })
      const view = await mountForm()

      await fillBook(view)

      expect(consoleError.mock.calls).toEqual([
        [
          expect.objectContaining({
            name: 'AxiosError',
            code: 'ERR_BAD_RESPONSE',
            message: 'Request failed with status code 500',
            response: expect.objectContaining({ status: 500 }),
          }),
        ],
      ])
      expect(store.state.ui.popups).toEqual([
        {
          id: expect.any(String),
          text: 'Error searching for book: Request failed with status code 500',
          type: 'danger',
        },
      ])
      expect(view.getByText("Hmmm... we couldn't find that book.")).toBeInTheDocument()
    })

    test('clearing the title drops the suggested book', async () => {
      stubServer()
      const view = await mountForm()
      await fillBook(view)
      expect(view.getByAltText('thumbnail')).toBeInTheDocument()

      await typeInto(view, 'Title', '')
      await vi.advanceTimersByTimeAsync(500)

      expect(view.queryByAltText('thumbnail')).not.toBeInTheDocument()
      expect(view.queryByText('Is this the correct book?')).not.toBeInTheDocument()
      expect(view.queryByRole('loading')).not.toBeInTheDocument()
    })
  })

  describe('confirming the book', () => {
    test('Yes thanks the user and looks up metadata for the ISBN 500ms later', async () => {
      stubServer({ meta: () => ({ title: 'THE BEAR AND THE MOON' }) })
      const view = await mountForm()
      await fillBook(view)

      await fireEvent.click(view.getByRole('button', { name: 'Yes' }))
      expect(view.getByText('Great - Thanks!')).toBeInTheDocument()
      // Yes is @click.prevent, so the click does not also submit the enclosing form
      expect(errorMessages(view)).toEqual([])
      expect(view.queryByText('Is this the correct book?')).not.toBeInTheDocument()

      await vi.advanceTimersByTimeAsync(499)
      expect(getsTo(META_URL)).toEqual([])

      await vi.advanceTimersByTimeAsync(1)
      expect(getsTo(META_URL)).toEqual([`${META_URL}?isbn=9781452171913`])
      // a title that differs only in case adopts the metadata's capitalization
      expect(field(view, 'Title')).toHaveValue('THE BEAR AND THE MOON')
    })

    test('keeps the typed title when the metadata title differs by more than case', async () => {
      stubServer({ meta: () => ({ title: 'The Bear and the Moon (Hardcover)' }) })
      const view = await mountForm()
      await fillBook(view)

      await fireEvent.click(view.getByRole('button', { name: 'Yes' }))
      await vi.advanceTimersByTimeAsync(500)

      expect(getsTo(META_URL)).toEqual([`${META_URL}?isbn=9781452171913`])
      expect(field(view, 'Title')).toHaveValue(TITLE)
    })

    test('No hides the thumbnail and asks for the ISBN, with Search disabled until one is typed', async () => {
      stubServer()
      const view = await mountForm()
      await fillBook(view)

      await fireEvent.click(view.getByRole('button', { name: 'No' }))

      expect(view.getByText('Okay, please enter the ISBN:')).toBeInTheDocument()
      // No is @click.prevent, so the click does not also submit the enclosing form
      expect(errorMessages(view)).toEqual([])
      expect(view.getByAltText('thumbnail')).toHaveStyle({ visibility: 'hidden' })
      expect(field(view, 'please enter the ISBN:')).toHaveValue('')
      expect(view.getByRole('button', { name: 'Search' })).toBeDisabled()
    })

    test('a manual ISBN search offers "No, try again" and "No, but keep anyway"', async () => {
      stubServer({
        search: url =>
          url.endsWith('=1452171912') ? { ...FOUND, thumbnail: 'https://x/2.jpg' } : FOUND,
      })
      const view = await mountForm()
      await fillBook(view)
      await fireEvent.click(view.getByRole('button', { name: 'No' }))

      await typeInto(view, 'please enter the ISBN:', '1452171912')
      // Search lacks .prevent and type="button", so this click also submits the form (suspected bug,
      // reported rather than pinned): assertions here hold whether or not it does
      await fireEvent.click(view.getByRole('button', { name: 'Search' }))
      await vi.advanceTimersByTimeAsync(0)

      expect(getsTo(SEARCH_URL)).toEqual([
        `${SEARCH_URL}?keyword=The%20Bear%20and%20the%20Moon%20by%20Matthew%20Burgess`,
        `${SEARCH_URL}?keyword=1452171912`,
      ])
      expect(view.getByText('Is this the correct book?')).toBeInTheDocument()
      expect(view.queryByText('Okay, please enter the ISBN:')).not.toBeInTheDocument()
      expect(view.getByRole('button', { name: 'Yes' })).toBeInTheDocument()
      expect(view.getByRole('button', { name: 'No, try again' })).toBeInTheDocument()
      const thumbnail = view.getByAltText('thumbnail')
      expect(thumbnail).toHaveAttribute('src', 'https://x/2.jpg')
      expect(thumbnail).not.toHaveStyle({ visibility: 'hidden' })

      await fireEvent.click(view.getByRole('button', { name: 'No, but keep anyway' }))
      expect(view.getByText('Got it - Thanks!')).toBeInTheDocument()
    })

    test('a manual ISBN that is neither 10 nor 13 characters is not searched', async () => {
      stubServer()
      const view = await mountForm()
      await fillBook(view)
      await fireEvent.click(view.getByRole('button', { name: 'No' }))

      await typeInto(view, 'please enter the ISBN:', '12345')
      // this click also submits the form (suspected bug, see the test above); not pinned
      await fireEvent.click(view.getByRole('button', { name: 'Search' }))
      await vi.advanceTimersByTimeAsync(500)

      // only the title search from before No
      expect(requests).toEqual([
        `GET ${SEARCH_URL}?keyword=The%20Bear%20and%20the%20Moon%20by%20Matthew%20Burgess`,
      ])
      expect(view.queryByText('Is this the correct book?')).not.toBeInTheDocument()
      expect(view.getByText('Okay, please enter the ISBN:')).toBeInTheDocument()
    })
  })

  describe('duplicate detection', () => {
    test.each(['1452171912', '978-1-4521-7191-3', '9781452171913'])(
      'Yes on a book already in the directory as %s says so and locks the form',
      async isbn => {
        store.commit('books/set', { b1: { id: 'b1', isbn, title: TITLE } })
        stubServer()
        const view = await mountForm()
        await fillBook(view)

        await fireEvent.click(view.getByRole('button', { name: 'Yes' }))

        expect(
          view.getByText('Great minds think alike. This book is already in our directory.'),
        ).toBeInTheDocument()
        expect(view.getByRole('button', { name: 'Clear Info' })).toBeInTheDocument()
        expect(view.queryByText('Great - Thanks!')).not.toBeInTheDocument()
        expect(field(view, 'Title')).toBeDisabled()
        expect(field(view, 'Author(s)')).toBeDisabled()
        expect(field(view, 'Illustrator(s)')).toBeDisabled()
        expect(view.queryByLabelText('Picture book')).not.toBeInTheDocument()
      },
    )

    test('a searched ISBN-10 matches a directory book stored as ISBN-13', async () => {
      store.commit('books/set', { b1: { id: 'b1', isbn: '9781452171913', title: TITLE } })
      stubServer({ search: () => ({ ...FOUND, isbn: '1452171912' }) })
      const view = await mountForm()
      await fillBook(view)

      await fireEvent.click(view.getByRole('button', { name: 'Yes' }))

      expect(
        view.getByText('Great minds think alike. This book is already in our directory.'),
      ).toBeInTheDocument()
    })

    test.each([
      ['a different ISBN', '9780062060624'],
      ['no ISBN', undefined],
    ])('a directory book with %s is not a duplicate', async (_, isbn) => {
      store.commit('books/set', { b1: { id: 'b1', isbn, title: 'Other' } })
      stubServer()
      const view = await mountForm()
      await fillBook(view)

      await fireEvent.click(view.getByRole('button', { name: 'Yes' }))

      expect(view.getByText('Great - Thanks!')).toBeInTheDocument()
      expect(view.queryByText(/Great minds think alike/)).not.toBeInTheDocument()
      expect(field(view, 'Title')).toBeEnabled()
    })

    test('Clear Info empties and unlocks the form', async () => {
      store.commit('books/set', { b1: { id: 'b1', isbn: '1452171912', title: TITLE } })
      stubServer()
      const view = await mountForm()
      await fillBook(view)
      await fireEvent.click(view.getByRole('button', { name: 'Yes' }))

      // Clear Info lacks .prevent and type="button", so this click also submits the form and lists
      // every missing field (suspected bug, reported rather than pinned); not asserted either way
      await fireEvent.click(view.getByRole('button', { name: 'Clear Info' }))

      expect(field(view, 'Title')).toHaveValue('')
      expect(field(view, 'Title')).toBeEnabled()
      expect(field(view, 'Author(s)')).toHaveValue('')
      expect(field(view, 'Illustrator(s)')).toHaveValue('')
      expect(view.queryByText(/Great minds think alike/)).not.toBeInTheDocument()
      expect(view.getByLabelText('Picture book')).toBeInTheDocument()
    })
  })

  describe('validation', () => {
    test('submitting an empty form lists every missing field in order and does not submit', async () => {
      const view = await mountForm()

      await fireEvent.click(view.getByRole('button', { name: 'Submit for review' }))

      expect(errorMessages(view)).toEqual([
        'Title is required',
        'Author is required',
        'Illustrator is required (or "same")',
        'ISBN is required',
        'Tags are required',
      ])
      expect(view.getByText('Title')).toHaveClass('has-text-danger')
      expect(field(view, 'Title')).toHaveClass('input', 'is-danger')
      expect(dispatchedTo('submissions/books/submit')).toEqual([])
    })

    test('once errors show, an edit re-validates on the leading edge of the throttle', async () => {
      stubServer()
      const view = await mountForm()
      await fireEvent.click(view.getByRole('button', { name: 'Submit for review' }))

      await typeInto(view, 'Title', TITLE)

      expect(errorMessages(view)).toEqual([
        'Author is required',
        'Illustrator is required (or "same")',
        'ISBN is required',
        'Tags are required',
      ])
      expect(field(view, 'Title')).not.toHaveClass('is-danger')
    })

    test('with two books, messages after the title name the book they belong to', async () => {
      const view = await mountForm()
      await typeInto(view, 'Title', TITLE)
      await fireEvent.click(view.getByRole('button', { name: 'Add another book' }))

      await fireEvent.click(view.getByRole('button', { name: 'Submit for review' }))

      expect(errorMessages(view)).toEqual([
        'Author is required for "The Bear and the Moon"',
        'Illustrator is required (or "same") for "The Bear and the Moon"',
        'ISBN is required for "The Bear and the Moon"',
        'Tags are required for "The Bear and the Moon"',
        'Title is required',
        'Author is required for ""',
        'Illustrator is required (or "same") for ""',
        'ISBN is required for ""',
        'Tags are required for ""',
      ])
    })

    test('counts the books ready to submit once a title is entered and nothing is invalid', async () => {
      const view = await mountForm()
      expect(view.queryByText(/ready to submit/)).not.toBeInTheDocument()

      await typeInto(view, 'Title', TITLE)
      expect(view.getByText('You have 1 book ready to submit.')).toBeInTheDocument()

      await fireEvent.click(view.getByRole('button', { name: 'Add another book' }))
      expect(view.getAllByRole('button', { name: 'Delete' })).toHaveLength(2)
      expect(view.getByText('You have 2 books ready to submit.')).toBeInTheDocument()
    })
  })

  describe('submit', () => {
    /** Fills a found, confirmed book tagged as a picture book, then lets the metadata lookup settle. */
    const fillConfirmedBook = async view => {
      await fillBook(view)
      await fireEvent.click(view.getByRole('button', { name: 'Yes' }))
      await fireEvent.click(view.getByLabelText('Picture book'))
      await vi.advanceTimersByTimeAsync(1000)
    }

    const submitted = {
      title: TITLE,
      authors: AUTHORS,
      illustrators: ILLUSTRATORS,
      isbn: '9781452171913',
      tags: { t1: true },
      thumbnail: FOUND.thumbnail,
      confirmed: true,
      attempts: 1,
      createdAt: NOW,
    }

    test('a reviewer submission is dispatched as typed and redirects to the thank-you page', async () => {
      login({ advisor: true })
      stubServer({ meta: () => ({ title: 'The Bear and the Moon (Hardcover)' }) })
      const view = await mountForm()
      await fillConfirmedBook(view)

      await fireEvent.click(view.getByRole('button', { name: 'Submit for review' }))
      // the thank-you route is a lazy import that Vite transforms on first use, which a cold runner can
      // take longer than waitFor's default 1000ms to do
      await vi.waitFor(
        () => expect(router.currentRoute.value.fullPath).toBe('/suggest/book/thankyou'),
        { timeout: 5000 },
      )

      const payloads = dispatchedTo('submissions/books/submit')
      expect(payloads).toEqual([[expect.objectContaining(submitted)]])
      expect(payloads[0][0]).not.toHaveProperty('createdBy')
      expect(router.currentRoute.value.name).toBe('SubmissionThankYou')
      expect(router.currentRoute.value.params).toEqual({ type: 'book' })
      expect(store.state.ui.busy).toBe(false)
      expect(errorMessages(view)).toEqual([])
    })

    test('an owner adds the book directly, credited to themselves, and gets a fresh form', async () => {
      login({ owner: true })
      stubServer({ meta: () => ({ title: 'The Bear and the Moon (Hardcover)' }) })
      const view = await mountForm()
      expect(view.getByRole('button', { name: 'Add to Directory' })).toBeInTheDocument()
      expect(view.queryByRole('button', { name: 'Submit for review' })).not.toBeInTheDocument()
      await fillConfirmedBook(view)
      dispatches = []

      await fireEvent.click(view.getByRole('button', { name: 'Add to Directory' }))
      await vi.advanceTimersByTimeAsync(0)

      expect(dispatchedTo('submissions/books/submit')).toEqual([
        [expect.objectContaining({ ...submitted, createdBy: 'u1' })],
      ])
      expect(store.state.ui.popups).toEqual([
        { id: expect.any(String), text: 'Book added to directory!', type: 'info' },
      ])
      expect(dispatchedTo('user/saveBookSubmissionsDraft')).toEqual([[]])
      expect(field(view, 'Title')).toHaveValue('')
      expect(router.currentRoute.value.fullPath).toBe('/suggest/book')
      expect(store.state.ui.busy).toBe(false)
    })
  })

  describe('drafts', () => {
    test('restores a draft without an ISBN as unconfirmed, without its thumbnail', async () => {
      login(
        { advisor: true },
        {
          draftBooks: [
            {
              title: 'Draft Title',
              authors: 'A',
              illustrators: 'B',
              isbn: '',
              thumbnail: 't.jpg',
              confirmed: true,
              attempts: 1,
              tags: {},
            },
          ],
        },
      )
      const view = await mountForm()

      expect(field(view, 'Title')).toHaveValue('Draft Title')
      expect(field(view, 'Author(s)')).toHaveValue('A')
      expect(field(view, 'Illustrator(s)')).toHaveValue('B')
      const thumbnail = view.getByAltText('thumbnail')
      expect(thumbnail).not.toHaveAttribute('src')
      expect(thumbnail).toHaveStyle({ visibility: 'hidden' })
      expect(view.getByText('please enter the ISBN:')).toBeInTheDocument()
      expect(view.queryByText("Hmmm... we couldn't find that book.")).not.toBeInTheDocument()
      expect(view.queryByText('Great - Thanks!')).not.toBeInTheDocument()
    })

    test('restores a draft with an ISBN as it was saved', async () => {
      login(
        { advisor: true },
        {
          draftBooks: [
            {
              title: 'Draft Title',
              authors: 'A',
              illustrators: 'B',
              isbn: '9781452171913',
              thumbnail: 't.jpg',
              confirmed: true,
              attempts: 1,
              tags: { t2: true },
            },
          ],
        },
      )
      const view = await mountForm()

      const thumbnail = view.getByAltText('thumbnail')
      expect(thumbnail).toHaveAttribute('src', 't.jpg')
      expect(thumbnail).not.toHaveStyle({ visibility: 'hidden' })
      expect(view.getByText('Great - Thanks!')).toBeInTheDocument()
      expect(view.getByLabelText('Animals')).toBeChecked()
      expect(view.getByLabelText('Picture book')).not.toBeChecked()
    })

    test('saves the draft 1000ms after an edit and shows Draft Saved for 3000ms', async () => {
      login({ advisor: true })
      stubServer()
      const view = await mountForm()

      await typeInto(view, 'Title', TITLE)
      await vi.advanceTimersByTimeAsync(999)
      expect(dispatchedTo('user/saveBookSubmissionsDraft')).toEqual([])

      await vi.advanceTimersByTimeAsync(1)
      expect(dispatchedTo('user/saveBookSubmissionsDraft')).toEqual([
        [
          {
            attempts: 0,
            authors: '',
            confirmed: null,
            createdAt: NOW,
            illustrators: '',
            isbn: null,
            lastSearch: null,
            loadingMetadata: false,
            publisher: '',
            summary: '',
            tags: {},
            thumbnail: '',
            title: TITLE,
            year: '',
          },
        ],
      ])
      expect(view.getByRole('button', { name: 'Draft Saved' })).toBeInTheDocument()

      await vi.advanceTimersByTimeAsync(2999)
      expect(view.getByRole('button', { name: 'Draft Saved' })).toBeInTheDocument()

      await vi.advanceTimersByTimeAsync(1)
      expect(view.queryByRole('button', { name: 'Draft Saved' })).not.toBeInTheDocument()
    })

    test('does not save a draft when nobody is logged in', async () => {
      stubServer()
      const view = await mountForm()

      await typeInto(view, 'Title', TITLE)
      await vi.advanceTimersByTimeAsync(2000)

      expect(dispatchedTo('user/saveBookSubmissionsDraft')).toEqual([])
      expect(view.queryByRole('button', { name: 'Draft Saved' })).not.toBeInTheDocument()
    })

    test.each([
      ['2020-03-03', 2020],
      ['2020-03', 2020],
      ['2020', 2020],
      ['March 3, 2020', 2020],
      ['not a date', ''],
    ])(
      'the saved draft carries metadata, with publishedDate %j as year %j',
      async (publishedDate, year) => {
        login({ advisor: true })
        stubServer({
          meta: () => ({
            title: 'THE BEAR AND THE MOON',
            description: 'A bear befriends the moon.',
            goodreads: 'https://www.goodreads.com/book/show/1',
            publisher: 'Chronicle Books',
            publishedDate,
          }),
        })
        const view = await mountForm()
        await fillBook(view)
        await fireEvent.click(view.getByRole('button', { name: 'Yes' }))
        await vi.advanceTimersByTimeAsync(500)

        await fireEvent.click(view.getByLabelText('Picture book'))
        await vi.advanceTimersByTimeAsync(1000)

        expect(dispatchedTo('user/saveBookSubmissionsDraft').at(-1)).toEqual([
          expect.objectContaining({
            title: 'THE BEAR AND THE MOON',
            summary: 'A bear befriends the moon.',
            goodreads: 'https://www.goodreads.com/book/show/1',
            publisher: 'Chronicle Books',
            year,
            tags: { t1: true },
          }),
        ])
      },
    )
  })
})
