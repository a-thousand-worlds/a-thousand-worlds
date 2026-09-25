/**
 * RecommendedBy, PublicProfileForm and PhotoUpload: the attribution line a contributor gets on each
 * book, the profile form that previews and saves it, and the photo picker inside that form.
 *
 * Dependency seams guarded:
 * - @sindresorhus/slugify: users/saveContributor keys the contributor the admin form creates by the
 * slug of the typed name, punctuation, apostrophes, accents and camel case included.
 * - lodash: sortBy orders the contributor dropdown, and debounce (500ms, leading and trailing
 * edges, the trailing one 500ms after the last call) paces the validator mixin's revalidate.
 * - jsdom: FileReader.readAsDataURL, a click on a checkbox or radio firing change, a click on a
 * submit input submitting its form, and a data: URL surviving as an inline background image.
 * - vue: checkbox v-model with :false-value="null", radio v-model bound to booleans, a watcher that
 * compares the next and previous value, the update:modelValue and save emits, and no Vue warning
 * beyond the one known below (any other fails the test).
 * - @testing-library/jest-dom: toHaveStyle, toHaveTextContent, toBeEmptyDOMElement (which ignores
 * the v-if comment), toHaveClass, toBeChecked, toBeDisabled.
 *
 * Firebase (pinned at v8) is the boundary: firebase/app is replaced with a fake of the namespaced
 * database API that answers once('value') from fixtures and logs every read and write in order.
 * The three profile writes are pinned: a contributor's own update to users/<uid>/profile, an
 * admin's new contributor set at users/<slug>, and an admin's edit updating users/<id>/profile.
 */
import { nextTick } from 'vue'
import { fireEvent, render as vueRender, screen, within } from '@testing-library/vue'
import store from '@/store'
import mixins from '@/mixins/global'
import directives from '@/directives'
// PublicProfileForm and RecommendedBy import each other, and under vitest's ESM the module evaluated
// second sees the other as undefined. PublicProfileForm goes first so its attribution preview gets
// a real RecommendedBy; RecommendedBy's own New/Edit Contributor form is left unresolved.
import PublicProfileForm from '@/components/Dashboard/PublicProfileForm.vue'
import RecommendedBy from '@/components/RecommendedBy.vue'
import PhotoUpload from '@/components/PhotoUpload.vue'

vi.hoisted(() => {
  // the store imports the router, which is created against the current URL
  window.history.replaceState(null, '', '/__test__')
  window.scrollTo = () => {}
})

const fb = vi.hoisted(() => {
  const state = { fixtures: {}, log: [] }

  /** Returns a plain copy of a value, so a later change to a reactive object cannot rewrite it. */
  const copy = value => JSON.parse(JSON.stringify(value))

  /** Returns a fake v8 database reference that answers reads from fixtures and logs each call. */
  const ref = path => ({
    once: (event, callback) => {
      state.log = [...state.log, ['once', path]]
      callback({ val: () => copy(state.fixtures[path] ?? null) })
    },
    set: async value => {
      state.log = [...state.log, ['set', path, copy(value)]]
    },
    update: async value => {
      state.log = [...state.log, ['update', path, copy(value)]]
    },
  })

  return { state, firebase: { initializeApp: () => {}, database: () => ({ ref }) } }
})

vi.mock('firebase/app', () => ({ default: fb.firebase }))
vi.mock('firebase/auth', () => ({}))
vi.mock('firebase/database', () => ({}))
vi.mock('firebase/storage', () => ({}))

/** The store state before any test touches it, restored before each test. */
const pristine = JSON.stringify(store.state)

/** The store actions still in flight, so a test can let its Firebase reads land before it ends. */
let pendingActions = 0
/** The type of each store action dispatched since the last reset, in order. */
let dispatched = []
store.subscribeAction({
  before: action => {
    pendingActions += 1
    dispatched = [...dispatched, action.type]
  },
  after: () => {
    pendingActions -= 1
  },
  error: () => {
    pendingActions -= 1
  },
})

/** Vue warnings seen in the current test, which afterEach requires to be none. */
let vueWarnings = []

/** Records Vue warnings except the known one about RecommendedBy's unresolved contributor form. */
const warnHandler = (message, instance, trace) => {
  if (!message.startsWith('Failed to resolve component: PublicProfileForm')) {
    vueWarnings = [...vueWarnings, `${message}${trace}`]
  }
}

/** Mutes RecommendedBy's warning about a profile with no name, passing any other warning through. */
const muteMissingNameWarning = () => {
  const warn = console.warn
  return vi.spyOn(console, 'warn').mockImplementation((...args) => {
    if (args[0] !== 'User profile is missing name') warn(...args)
  })
}

/** Renders a component with props, the real store, global mixins and directives, v-tippy stubbed. */
const renderWith = (component, props) =>
  vueRender(component, {
    props,
    global: {
      config: { warnHandler },
      directives: { ...directives, tippy: () => {} },
      mixins: [mixins],
      plugins: [store],
    },
  })

/** Returns the logged Firebase writes, leaving out reads. */
const writes = () => fb.state.log.filter(([method]) => method !== 'once')

/** Returns the open popups as [text, type] pairs. */
const popups = () => store.state.ui.popups.map(({ text, type }) => [text, type])

/** Returns a 4-byte PNG signature as a file, which reads back as data:image/png;base64,iVBORw==. */
const pngFile = () => new File([new Uint8Array([137, 80, 78, 71])], 'me.png', { type: 'image/png' })

/** Picks a file in the photo picker the way a browser does: files set, then change. */
const choosePhoto = async file => {
  const input = screen.getByLabelText(/PHOTO$/)
  // input.files is read-only, so it is defined on the element, as Testing Library does itself
  // eslint-disable-next-line fp/no-mutating-methods
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  await fireEvent.update(input)
}

/** Returns the photo picker's label as its text lines joined by '|' at each <br>. */
const photoLabel = () =>
  [...screen.getByLabelText(/PHOTO$/).labels[0].childNodes]
    .map(node => (node.nodeName === 'BR' ? '|' : node.textContent))
    .join('')

/** Returns the round photo area whose background shows the photo. */
const photoCircle = () =>
  // eslint-disable-next-line testing-library/no-node-access -- a bare div with no role, text or label
  document.querySelector('.photo-container')

/** Returns the trimmed label text of each checkbox under root whose id starts with prefix. */
const checkboxLabels = (root, prefix) =>
  within(root)
    .getAllByRole('checkbox')
    .filter(checkbox => checkbox.id.startsWith(prefix))
    .map(checkbox => checkbox.labels[0].textContent.trim())

beforeEach(() => {
  // Date is faked with setTimeout so lodash debounce, which reads Date.now, runs on the fake clock.
  // setInterval is faked so the 100ms poller each Content label starts for CEditor, which never
  // loads for a non-owner, is dropped at useRealTimers instead of running for the rest of the file.
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  })
  vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'))
  store.replaceState(JSON.parse(pristine))
  fb.state.fixtures = {}
  fb.state.log = []
  dispatched = []
  vueWarnings = []
})

afterEach(async () => {
  // a read left in flight would land in the next test's log and store
  await vi.waitFor(() => expect(pendingActions).toBe(0))
  // fire every debounce trailing edge and popup autoclose, so no shared debounce is left waiting
  // on a timer that would never run
  vi.advanceTimersByTime(5000)
  vi.useRealTimers()
  vi.restoreAllMocks()
  expect(vueWarnings).toEqual([])
})

describe('RecommendedBy', () => {
  const jane = {
    profile: {
      firstName: 'Jane',
      lastName: 'Doe',
      affiliations: {
        selectedEngagementCategories: {
          educator: true,
          librarian: true,
          reader: null,
          bogus: true,
        },
        otherEngagementCategory: ' Storyteller ',
        organization: 'Brooklyn Public Library',
        organizationLink: 'bklynlibrary.org',
        website: '@janedoe',
      },
    },
    roles: { contributor: true },
  }

  /** Renders the attribution line for a contributor fixture and waits for it to load. */
  const renderContributor = async user => {
    fb.state.fixtures = { 'users/c1': user }
    const result = renderWith(RecommendedBy, { modelValue: 'c1' })
    await vi.waitFor(() => expect(store.state.users.loaded).toBe(true))
    return result
  }

  test('reads the contributor once and renders name, engagements in key order, and organization', async () => {
    const { container } = await renderContributor(jane)

    expect(fb.state.log).toEqual([['once', 'users/c1']])
    expect(container).toHaveTextContent(
      /^–Recommended ByJane Doe, Educator, Librarian, Storyteller, Brooklyn Public Library$/,
    )
    expect(screen.getByText('–Recommended By')).toHaveClass('is-uppercase')
    expect(screen.getByText(', Educator, Librarian, Storyteller').tagName).toBe('SPAN')
    expect(screen.getByRole('link', { name: 'Jane Doe' })).toHaveAttribute(
      'href',
      'https://twitter.com/janedoe',
    )
    expect(screen.getByRole('link', { name: 'Jane Doe' })).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: ', Brooklyn Public Library' })).toHaveAttribute(
      'href',
      'https://bklynlibrary.org',
    )
  })

  test.each([
    ['janedoe.com', 'https://janedoe.com'],
    ['http://x.org', 'http://x.org'],
    ['https://secure.example/me', 'https://secure.example/me'],
    ['@jane_doe', 'https://twitter.com/jane_doe'],
  ])('links the name for website %j to %j', async (website, href) => {
    await renderContributor({ profile: { name: 'Jane Doe', affiliations: { website } } })

    expect(screen.getByRole('link', { name: 'Jane Doe' })).toHaveAttribute('href', href)
  })

  test('without a website the name is a plain span, and an unlinked organization is italic', async () => {
    const { container } = await renderContributor({
      profile: { name: 'Jane Doe', affiliations: { organization: 'Org' } },
    })

    expect(screen.queryAllByRole('link')).toEqual([])
    expect(screen.getByText('Jane Doe').tagName).toBe('SPAN')
    expect(screen.getByText(', Org').tagName).toBe('I')
    expect(container).toHaveTextContent(/^–Recommended ByJane Doe, Org$/)
  })

  test.each([
    [{ name: 'Pen Name', firstName: 'Jane', lastName: 'Doe' }, 'Pen Name'],
    [{ firstName: 'Ann' }, 'Ann'],
  ])('names profile %j as %j', async (profile, name) => {
    const { container } = await renderContributor({ profile })

    expect(container).toHaveTextContent(new RegExp(`^–Recommended By${name}$`))
  })

  test('renders nothing until an unknown contributor loads, then renders them as anonymous', async () => {
    const warn = muteMissingNameWarning()
    const { container } = renderWith(RecommendedBy, { modelValue: 'ghost' })

    expect(container).toBeEmptyDOMElement()

    await vi.waitFor(() => expect(container).toHaveTextContent(/^–Recommended Byanonymous$/))
    expect(fb.state.log).toEqual([['once', 'users/ghost']])
    expect(warn).toHaveBeenCalledWith('User profile is missing name', { id: 'ghost' })
  })

  test("the logged-in user's own id uses the store profile with the preview's affiliations on top", () => {
    store.commit('user/setUser', {
      uid: 'c1',
      profile: {
        name: 'Self Name',
        affiliations: { organization: 'Old Org', website: 'old.example' },
      },
    })
    const { container } = renderWith(RecommendedBy, {
      modelValue: 'c1',
      preview: {
        affiliations: {
          selectedEngagementCategories: { editor: true },
          organization: 'Acme Books',
        },
      },
    })

    expect(container).toHaveTextContent(/^–Recommended BySelf Name, Editor, Acme Books$/)
    expect(screen.queryAllByRole('link')).toEqual([])
    expect(screen.getByText(', Acme Books').tagName).toBe('I')
  })

  describe('edit mode', () => {
    const users = {
      u2: { profile: { name: 'Zed' }, roles: { contributor: true } },
      u3: { profile: { firstName: 'Amy', lastName: 'Lee' }, roles: { owner: true } },
      u4: { profile: { name: 'Reader' }, roles: {} },
    }

    /** Renders RecommendedBy in edit mode over the seeded users. */
    const renderEdit = props => {
      fb.state.fixtures = { 'users/u2': users.u2 }
      store.commit('users/set', JSON.parse(JSON.stringify(users)))
      return renderWith(RecommendedBy, { edit: true, modelValue: null, ...props })
    }

    /** Returns the dropdown menu's queries. */
    const menu = () => within(screen.getByRole('menu'))

    /** Returns the trimmed text of each dropdown item, in order. */
    const options = () =>
      // eslint-disable-next-line testing-library/no-node-access -- the items are anchors with no href, so they have no role to query by
      [...screen.getByRole('menu').querySelectorAll('.dropdown-item')].map(item =>
        item.textContent.trim(),
      )

    /** Returns the element that opens and closes as the dropdown. */
    const dropdown = () =>
      // eslint-disable-next-line testing-library/no-node-access -- the dropdown wrapper has no role, text or label
      document.querySelector('.dropdown')

    test('lists contributors and owners sorted by name, without other users', () => {
      renderEdit()

      expect(options()).toEqual(['New Contributor', 'None', 'Amy Lee (owner)', 'Zed'])
    })

    test('the label toggles the dropdown and a click elsewhere closes it', async () => {
      renderEdit()

      expect(dropdown()).not.toHaveClass('is-active')
      await fireEvent.click(screen.getByText('–Recommended By'))
      expect(dropdown()).toHaveClass('is-active')
      await fireEvent.click(document.body)
      expect(dropdown()).not.toHaveClass('is-active')
    })

    test('choosing a contributor emits their id and closes the dropdown, and None emits null', async () => {
      const { emitted } = renderEdit()

      await fireEvent.click(screen.getByText('–Recommended By'))
      await fireEvent.click(menu().getByText('Zed'))
      expect(dropdown()).not.toHaveClass('is-active')
      await fireEvent.click(menu().getByText('None'))

      expect(emitted()['update:modelValue']).toEqual([['u2'], [null]])
    })

    test('with no contributor chosen the name reads None, in italics', () => {
      renderEdit()

      expect(screen.getByText('None', { selector: 'span' })).toHaveStyle({ fontStyle: 'italic' })
    })

    test('Edit Contributor appears only once a contributor is chosen, and marks them active', async () => {
      renderEdit({ modelValue: 'u2' })
      await vi.waitFor(() => expect(fb.state.log).toEqual([['once', 'users/u2']]))

      expect(options()).toEqual([
        'New Contributor',
        'Edit Contributor',
        'None',
        'Amy Lee (owner)',
        'Zed',
      ])
      expect(menu().getByText('Zed')).toHaveClass('is-active')
      expect(menu().getByText('Amy Lee (owner)')).not.toHaveClass('is-active')
      expect(screen.getAllByText('Zed').map(element => element.tagName)).toEqual(['A', 'SPAN'])
    })

    test.each([
      [null, ['Amy Lee (owner)', 'Zed']],
      ['u2', ['Edit Contributor', 'Amy Lee (owner)', 'Zed']],
    ])(
      'existingContributorsOnly with modelValue %j hides New Contributor and None',
      async (modelValue, expected) => {
        renderEdit({ modelValue, existingContributorsOnly: true })
        await vi.waitFor(() => expect(fb.state.log).toHaveLength(1))

        expect(options()).toEqual(expected)
      },
    )
  })
})

describe('PublicProfileForm', () => {
  const peopleTags = {
    g: { id: 'g', tag: 'Gender', sortOrder: 3, showOnContributorForm: true },
    w: { id: 'w', tag: 'Woman', parent: 'g', sortOrder: 4, showOnContributorForm: true },
    m: { id: 'm', tag: 'Man', parent: 'g', sortOrder: 5 },
    x: { id: 'x', tag: 'Unlisted', sortOrder: 2 },
    a: { id: 'a', tag: 'Asian American', sortOrder: 1, showOnContributorForm: true },
    b: { id: 'b', tag: 'Black', sortOrder: 0, showOnContributorForm: true },
  }

  const PREVIEW_LABEL = "Here's how your name will appear on each book you recommend:"

  /** Logs in a user and seeds the people tags, which the form needs a 'Gender' tag among. */
  const login = user => {
    store.commit('tags/people/set', JSON.parse(JSON.stringify(peopleTags)))
    store.commit('user/setUser', user)
  }

  /** Returns a non-admin contributor named Jane Doe with the given affiliations. */
  const contributor = (affiliations = {}) => ({
    uid: 'u1',
    roles: { authorized: true, contributor: true },
    profile: { name: 'Jane Doe', affiliations },
  })

  /** Returns the form field that holds the given label text. */
  const fieldOf = text =>
    // eslint-disable-next-line testing-library/no-node-access -- form fields are bare divs with no role, and most labels have no for
    screen.getByText(text).closest('.field')

  /** Returns the text input in the field that holds the given label text. */
  const inputUnder = text => within(fieldOf(text)).getByRole('textbox')

  /** Returns the Save input. */
  const saveButton = () => screen.getByDisplayValue('Save')

  /** Returns the error messages listed under the form, in order. */
  const errorMessages = () =>
    screen.queryAllByText(/ is required$/, { selector: 'p' }).map(p => p.textContent.trim())

  /** Asserts that no save was dispatched, once anything dispatched has had time to reach Firebase. */
  const expectNothingSaved = async () => {
    // every save awaits a dynamic import of firebase before it writes, so its write lands late
    await vi.waitFor(() => expect(pendingActions).toBe(0))
    expect(dispatched).toEqual([])
    expect(writes()).toEqual([])
  }

  /** Asserts the attribution preview reads exactly the given line after its label. */
  const expectPreview = line =>
    expect(fieldOf(PREVIEW_LABEL)).toHaveTextContent(
      new RegExp(`^${PREVIEW_LABEL}${line.replace(/[.()]/g, '\\$&')}$`),
    )

  /** Returns the empty-profile write the form makes for Jane Doe, with overrides. */
  const savedProfile = ({ affiliations, ...rest } = {}) => ({
    affiliations: {
      organization: '',
      organizationLink: '',
      otherEngagementCategory: '',
      website: null,
      selectedEngagementCategories: {},
      ...affiliations,
    },
    identities: {},
    name: 'Jane Doe',
    otherIdentity: null,
    photo: null,
    ...rest,
  })

  describe('as a contributor', () => {
    /** Logs in a contributor and renders the welcome form. */
    const renderContributorForm = affiliations => {
      login(contributor(affiliations))
      return renderWith(PublicProfileForm, { welcome: true })
    }

    test('offers the non-professional engagements, identity tags, and gender subtags', () => {
      renderContributorForm()

      expect(checkboxLabels(document.body, 'engagement-')).toEqual([
        'Reviewer/Critic',
        'Librarian',
        'Educator',
        'Reader',
        'Parent/Caregiver',
        'Other',
      ])
      expect(checkboxLabels(fieldOf('Identity'), 'tag-')).toEqual([
        'Black',
        'Asian American',
        'Other',
      ])
      expect(checkboxLabels(fieldOf('Gender'), 'tag-')).toEqual(['Woman'])
      expect(screen.getByText('Minimum size: 800x800px')).not.toHaveClass('has-text-danger')
      expectPreview('–Recommended ByJane Doe')
    })

    test('an empty submit lists what is required, in order, disables Save, and saves nothing', async () => {
      renderContributorForm()
      dispatched = []

      await fireEvent.click(saveButton())

      expect(errorMessages()).toEqual([
        'How you engage with books is required',
        'Your website is required',
        'Identity is required',
      ])
      expect(screen.getByText('Identity')).toHaveClass('has-text-danger')
      expect(saveButton()).toBeDisabled()
      await expectNothingSaved()
    })

    test('after a failed submit, a change revalidates at once, then once 500ms after the last change', async () => {
      renderContributorForm()
      await fireEvent.click(saveButton())
      // an hour past any earlier revalidate, since one debounce is shared by every form instance
      vi.setSystemTime(new Date('2026-01-01T13:00:00.000Z'))

      await fireEvent.click(screen.getByLabelText('Librarian'))
      expect(errorMessages()).toEqual(['Your website is required', 'Identity is required'])

      vi.advanceTimersByTime(300)
      await fireEvent.click(screen.getByLabelText('Asian American'))

      // a throttle would revalidate here, 500ms after the leading call
      vi.advanceTimersByTime(200)
      await nextTick()
      expect(errorMessages()).toEqual(['Your website is required', 'Identity is required'])

      vi.advanceTimersByTime(299)
      await nextTick()
      expect(errorMessages()).toEqual(['Your website is required', 'Identity is required'])

      // the debounce revalidates 500ms after the second change
      vi.advanceTimersByTime(1)
      await nextTick()
      expect(errorMessages()).toEqual(['Your website is required'])
    })

    test('previews and saves the filled profile as an update to the user record', async () => {
      const { emitted } = renderContributorForm()

      await fireEvent.update(inputUnder('Your website or social media URL'), 'janedoe.com')
      await fireEvent.click(screen.getByLabelText('Librarian'))
      await fireEvent.click(screen.getByLabelText('Asian American'))

      expectPreview('–Recommended ByJane Doe, Librarian')
      expect(screen.getByRole('link', { name: 'Jane Doe' })).toHaveAttribute(
        'href',
        'https://janedoe.com',
      )

      dispatched = []
      await fireEvent.click(saveButton())
      const expected = savedProfile({
        affiliations: { website: 'janedoe.com', selectedEngagementCategories: { librarian: true } },
        identities: { a: true },
      })
      await vi.waitFor(() => expect(writes()).toHaveLength(1))
      expect(writes()).toEqual([['update', 'users/u1/profile', expected]])
      await vi.waitFor(() => expect(popups()).toEqual([['Profile saved', 'success']]))
      expect(dispatched).toEqual(['user/updateProfile', 'ui/popup'])

      const [[saved]] = emitted().save
      await expect(saved).resolves.toEqual(expected)
    })

    test('an unchecked identity saves as null, and a chosen photo saves as base64', async () => {
      renderContributorForm()

      await fireEvent.update(inputUnder('Your website or social media URL'), '@jane')
      await fireEvent.click(screen.getByLabelText('Educator'))
      await fireEvent.click(screen.getByLabelText('Asian American'))
      await fireEvent.click(screen.getByLabelText('Asian American'))
      await fireEvent.click(screen.getByLabelText('Woman'))
      await choosePhoto(pngFile())
      await vi.waitFor(() => expect(photoLabel()).toBe('CHANGE|PHOTO'))

      await fireEvent.click(saveButton())
      await vi.waitFor(() => expect(writes()).toHaveLength(1))

      expect(writes()).toEqual([
        [
          'update',
          'users/u1/profile',
          savedProfile({
            affiliations: { website: '@jane', selectedEngagementCategories: { educator: true } },
            identities: { a: null, w: true },
            photo: { base64: 'data:image/png;base64,iVBORw==', url: null },
          }),
        ],
      ])
    })

    test('Yes switches to the professional titles and asks for the organization', async () => {
      renderContributorForm()

      await fireEvent.click(screen.getByLabelText('Yes'))

      expect(screen.getByLabelText('Yes')).toBeChecked()
      expect(checkboxLabels(document.body, 'engagement-')).toEqual([
        'Editor',
        'Publisher',
        'Publicist',
        'Agent',
        'Art Director',
        'Designer',
        'Other',
      ])
      expect(inputUnder('Organization name')).toHaveValue('')
      expect(inputUnder('Link to organization')).toHaveValue('')
    })

    test('answering No first keeps a checked engagement', async () => {
      renderContributorForm()

      await fireEvent.click(screen.getByLabelText('Librarian'))
      await fireEvent.click(screen.getByLabelText('No'))

      expect(screen.getByLabelText('No')).toBeChecked()
      expect(screen.getByLabelText('Librarian')).toBeChecked()
      expectPreview('–Recommended ByJane Doe, Librarian')
    })

    test('switching Yes then No clears the engagements chosen before', async () => {
      renderContributorForm()

      await fireEvent.click(screen.getByLabelText('Librarian'))
      // the first answer (from null) keeps the selection, though Librarian is no longer offered
      await fireEvent.click(screen.getByLabelText('Yes'))
      expectPreview('–Recommended ByJane Doe, Librarian')

      // changing the answer (Yes to No) is what clears it
      await fireEvent.click(screen.getByLabelText('No'))

      expect(screen.getByLabelText('Librarian')).not.toBeChecked()
      expectPreview('–Recommended ByJane Doe')
    })

    test('a saved organization starts the form on Yes with its title checked', () => {
      renderContributorForm({
        organization: 'Acme Books',
        selectedEngagementCategories: { editor: true },
      })

      expect(screen.getByLabelText('Yes')).toBeChecked()
      expect(screen.getByLabelText('No')).not.toBeChecked()
      expect(screen.getByLabelText('Editor')).toBeChecked()
      expect(inputUnder('Organization name')).toHaveValue('Acme Books')
      expectPreview('–Recommended ByJane Doe, Editor, Acme Books')
    })
  })

  /**
   * Logs in an advisor with an empty profile, so a new contributor starts blank, and renders the
   * admin form with the given props. The attribution preview shows the advisor, whose missing name
   * warning is muted.
   */
  const renderAdminForm = async props => {
    muteMissingNameWarning()
    login({ uid: 'adm', roles: { authorized: true, advisor: true }, profile: {} })
    const result = renderWith(PublicProfileForm, { admin: true, ...props })
    // the attribution preview loads the advisor's own record once on creation
    await vi.waitFor(() => expect(fb.state.log).toEqual([['once', 'users/adm']]))
    fb.state.log = []
    dispatched = []
    return result
  }

  describe('as an admin adding a contributor', () => {
    test('requires a name and an engagement but not a website, and hides identities', async () => {
      await renderAdminForm()

      await fireEvent.click(saveButton())

      expect(errorMessages()).toEqual(['Name is required', 'How you engage with books is required'])
      expect(saveButton()).toBeDisabled()
      expect(screen.queryByText('Identity')).not.toBeInTheDocument()
      expect(screen.queryByText('Minimum size: 800x800px')).not.toBeInTheDocument()
      await expectNothingSaved()
    })

    test('saves a login-less contributor keyed by the slug of the name, then dirties the cache', async () => {
      const { emitted } = await renderAdminForm()

      await fireEvent.update(inputUnder('Name'), "Dr. Jane O'Brien")
      await fireEvent.click(screen.getByLabelText('Educator'))
      await fireEvent.click(saveButton())

      const profile = savedProfile({
        affiliations: { selectedEngagementCategories: { educator: true } },
        name: "Dr. Jane O'Brien",
      })
      await vi.waitFor(() => expect(fb.state.log).toHaveLength(3))
      expect(fb.state.log).toEqual([
        ['once', 'users/dr-jane-o-brien'],
        [
          'set',
          'users/dr-jane-o-brien',
          { profile: { ...profile, noLogin: true }, roles: { contributor: true } },
        ],
        ['set', 'cache/clean', false],
      ])

      const [[saved]] = emitted().save
      await expect(saved).resolves.toEqual({ ...profile, id: 'dr-jane-o-brien' })
      await vi.waitFor(() => expect(popups()).toEqual([['Contributor saved', 'success']]))
      expect(dispatched).toEqual(['users/saveContributor', 'ui/popup'])
    })

    test.each([
      ['LeUyen Pham', 'le-uyen-pham'],
      ['Matt de la Peña', 'matt-de-la-pena'],
      ['  Yuyi  Morales ', 'yuyi-morales'],
    ])('keys the contributor %j as %j', async (name, id) => {
      const { emitted } = await renderAdminForm()

      await fireEvent.update(inputUnder('Name'), name)
      await fireEvent.click(screen.getByLabelText('Reader'))
      await fireEvent.click(saveButton())

      const [[saved]] = emitted().save
      await expect(saved).resolves.toMatchObject({ id })
      expect(fb.state.log.map(([method, path]) => [method, path])).toEqual([
        ['once', `users/${id}`],
        ['set', `users/${id}`],
        ['set', 'cache/clean'],
      ])
    })
  })

  describe('as an admin editing a contributor', () => {
    const roe = {
      id: 'jane-roe',
      name: 'Jane Roe',
      noLogin: true,
      affiliations: {
        organization: 'Acme Books',
        organizationLink: 'acme.example',
        selectedEngagementCategories: { editor: true },
      },
      identities: { b: true },
      photo: { base64: null, url: 'https://img.example/roe.jpg' },
    }

    test('prefills the form from the contributor, answering Yes for their organization', async () => {
      await renderAdminForm({ contributor: JSON.parse(JSON.stringify(roe)) })

      expect(inputUnder('Name')).toHaveValue('Jane Roe')
      expect(inputUnder('Your website or social media URL')).toHaveValue('')
      expect(screen.getByLabelText('Yes')).toBeChecked()
      expect(screen.getByLabelText('Editor')).toBeChecked()
      expect(inputUnder('Organization name')).toHaveValue('Acme Books')
      expect(inputUnder('Link to organization')).toHaveValue('acme.example')
      expect(photoLabel()).toBe('CHANGE|PHOTO')
      expect(photoCircle()).toHaveStyle({ backgroundImage: 'url(https://img.example/roe.jpg)' })
    })

    test('saves the edit as an update to their profile, then dirties the cache', async () => {
      const { emitted } = await renderAdminForm({ contributor: JSON.parse(JSON.stringify(roe)) })

      await fireEvent.update(inputUnder('Your website or social media URL'), 'roe.example')
      await fireEvent.click(saveButton())

      const expected = savedProfile({
        affiliations: {
          organization: 'Acme Books',
          organizationLink: 'acme.example',
          website: 'roe.example',
          selectedEngagementCategories: { editor: true },
        },
        identities: { b: true },
        name: 'Jane Roe',
        photo: { base64: null, url: 'https://img.example/roe.jpg' },
      })
      await vi.waitFor(() => expect(fb.state.log).toHaveLength(2))
      expect(fb.state.log).toEqual([
        ['update', 'users/jane-roe/profile', expected],
        ['set', 'cache/clean', false],
      ])
      await vi.waitFor(() => expect(popups()).toEqual([['Contributor saved', 'success']]))
      expect(dispatched).toEqual(['users/update', 'ui/popup'])

      // users/update resolves to nothing, so the saved profile comes back with no id
      const [[saved]] = emitted().save
      await expect(saved).resolves.toStrictEqual({ ...expected, id: undefined })
    })
  })
})

describe('PhotoUpload', () => {
  const dataUrl = 'data:image/png;base64,iVBORw=='

  test('empty: invites an upload and states the minimum size without warning', () => {
    renderWith(PhotoUpload, { modelValue: null })

    expect(photoLabel()).toBe('UPLOAD|PHOTO')
    expect(photoCircle()).toHaveClass('bg-secondary')
    expect(photoCircle()).toHaveStyle({ backgroundImage: 'none' })
    expect(screen.getByText('Remove photo')).toHaveClass('is-invisible')
    expect(screen.getByText('Minimum size: 800x800px')).not.toHaveClass('has-text-danger')
  })

  test('reads a chosen file as a data URL and emits it as base64 with no url', async () => {
    const { emitted } = renderWith(PhotoUpload, { modelValue: null })

    await choosePhoto(pngFile())

    await vi.waitFor(() => expect(emitted()['update:modelValue']).toHaveLength(1))
    expect(emitted()['update:modelValue']).toEqual([[{ base64: dataUrl, url: null }]])
  })

  test('a photo under 750px wide shows as the background and flags the minimum size', () => {
    renderWith(PhotoUpload, { modelValue: { base64: dataUrl, url: null, width: 700 } })

    expect(photoLabel()).toBe('CHANGE|PHOTO')
    expect(photoCircle()).toHaveClass('has-photo')
    expect(photoCircle()).not.toHaveClass('bg-secondary')
    expect(photoCircle()).toHaveStyle({ backgroundImage: `url(${dataUrl})` })
    expect(screen.getByText('Remove photo')).not.toHaveClass('is-invisible')
    expect(screen.getByText('Minimum size: 800x800px')).toHaveClass('has-text-danger')
  })

  test.each([
    [{ base64: dataUrl, url: null, width: 800 }, `url(${dataUrl})`],
    [{ base64: null, url: 'https://img.example/p.jpg' }, 'url(https://img.example/p.jpg)'],
    ['https://img.example/q.jpg', 'url(https://img.example/q.jpg)'],
  ])('photo %j shows as %s with no size note', (modelValue, backgroundImage) => {
    renderWith(PhotoUpload, { modelValue })

    expect(photoCircle()).toHaveStyle({ backgroundImage })
    expect(screen.queryByText('Minimum size: 800x800px')).not.toBeInTheDocument()
  })

  test('Remove photo emits null', async () => {
    const { emitted } = renderWith(PhotoUpload, { modelValue: { base64: dataUrl, width: 900 } })

    await fireEvent.click(screen.getByText('Remove photo'))

    expect(emitted()['update:modelValue']).toEqual([[null]])
  })

  test('noMinimumSize hides the size note and keeps the remove link', () => {
    renderWith(PhotoUpload, { modelValue: { base64: dataUrl, width: 10 }, noMinimumSize: true })

    expect(screen.queryByText('Minimum size: 800x800px')).not.toBeInTheDocument()
    expect(screen.getByText('Remove photo')).not.toHaveClass('is-invisible')
  })

  test('noremove hides both the remove link and the size note', () => {
    renderWith(PhotoUpload, { modelValue: { base64: dataUrl, width: 10 }, noremove: true })

    expect(photoLabel()).toBe('CHANGE|PHOTO')
    expect(photoCircle()).toHaveStyle({ backgroundImage: `url(${dataUrl})` })
    expect(screen.queryByText('Remove photo')).not.toBeInTheDocument()
    expect(screen.queryByText('Minimum size: 800x800px')).not.toBeInTheDocument()
  })
})
