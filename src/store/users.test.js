/**
 * Characterizes the users and invites store modules at the seams where they lean on third-party
 * packages, so a dependency upgrade that changes behavior fails here first:
 * - @sindresorhus/slugify turns a contributor's name into their Firebase key (users/saveContributor).
 * - lodash sortBy orders the contributor dropdown (users/contributorOptions).
 * - axios carries the invite email to the email service (invites/send through util/sendEmail).
 * - jsdom supplies window.location.origin, which becomes the invite's signup link.
 * Firebase (pinned at v8) and the network are the only things faked.
 */
import { createStore } from 'vuex'
import axios from 'axios'
import users from './users'
import invites from './invites'
import content from './content'

const fb = vi.hoisted(() => {
  const state = { values: {}, log: [], currentUser: null }

  /** Returns a fake v8 database reference that logs each read and write in call order. */
  const ref = path => ({
    once: (event, callback) => {
      state.log = [...state.log, ['once', path, event]]
      callback({ val: () => state.values[path] ?? null })
    },
    set: async value => {
      state.log = [...state.log, ['set', path, value]]
    },
  })

  const firebase = {
    initializeApp: () => {},
    auth: () => ({ currentUser: state.currentUser }),
    database: () => ({ ref }),
  }

  return { state, firebase }
})

vi.mock('firebase/app', () => ({ default: fb.firebase }))
vi.mock('firebase/auth', () => ({}))
vi.mock('firebase/database', () => ({}))
vi.mock('firebase/storage', () => ({}))

const store = createStore({ modules: { users, invites, content } })

/** Stands in for the network: axios runs its real request pipeline, then hands the config here. */
const adapter = vi.fn()
const originalAdapter = axios.defaults.adapter

/** Returns the request config that axios handed to the network adapter on its only call. */
const onlyRequest = () => {
  expect(adapter).toHaveBeenCalledTimes(1)
  return adapter.mock.calls[0][0]
}

/** Returns the query parameters of a request url, decoded. */
const params = url => new URL(url).searchParams

/** Loads invite email templates into the content collection, keyed by role. */
const setInviteTemplates = templates =>
  store.commit('content/set', { email: { invite: templates } })

const contributorTemplates = {
  contributor: {
    subject: 'Welcome FIRST_NAME',
    body: '<p>Hi FULL_NAME, join: SIGNUP_LINK</p>',
  },
}

const ada = {
  code: 'happy-blue-otter',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: 'contributor',
}

const usersFixture = {
  u1: { roles: { contributor: true }, profile: { name: 'bell hooks' } },
  u2: { roles: { owner: true }, profile: { firstName: 'Ashley', lastName: 'Bryan' } },
  u3: { roles: { contributor: true }, profile: { name: 'Zetta Elliott' } },
  u4: { roles: { advisor: true }, profile: { name: 'Nope' } },
  u5: { roles: { contributor: true }, profile: { firstName: 'Ann' } },
}

beforeEach(() => {
  fb.state.values = {}
  fb.state.log = []
  fb.state.currentUser = null
  window.dbcache = undefined
  store.commit('users/reset')
  store.commit('content/reset')
  adapter.mockReset()
  adapter.mockImplementation(async config => ({
    data: 'ok',
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  }))
  axios.defaults.adapter = adapter
  vi.stubEnv('VUE_APP_EMAIL_URL', 'https://email.test/send')
})

afterEach(() => {
  axios.defaults.adapter = originalAdapter
  window.dbcache = undefined
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('users/saveContributor', () => {
  test('checks the slug path is free, writes a login-less contributor there, then dirties the cache', async () => {
    await expect(
      store.dispatch('users/saveContributor', { name: 'Matt de la Peña', bio: 'x' }),
    ).resolves.toBe('matt-de-la-pena')

    expect(fb.state.log).toEqual([
      ['once', 'users/matt-de-la-pena', 'value'],
      [
        'set',
        'users/matt-de-la-pena',
        {
          profile: { name: 'Matt de la Peña', bio: 'x', noLogin: true },
          roles: { contributor: true },
        },
      ],
      ['set', 'cache/clean', false],
    ])
  })

  test.each([
    ['María José Muñoz', 'maria-jose-munoz'],
    ['DeShanna Neal', 'de-shanna-neal'],
    ["Jean-Luc O'Neil", 'jean-luc-o-neil'],
    ['Ibram X. Kendi', 'ibram-x-kendi'],
    ['Søren Østergaard', 'soren-ostergaard'],
    ['Jacqueline Woodson ', 'jacqueline-woodson'],
    ['Black & Brown', 'black-and-brown'],
    ['CJ McDonald', 'cj-mc-donald'],
    ['Zoë', 'zoe'],
  ])('keys the contributor %j as users/%s', async (name, uid) => {
    await expect(store.dispatch('users/saveContributor', { name })).resolves.toBe(uid)

    expect(fb.state.log.map(([op, path]) => [op, path])).toEqual([
      ['once', `users/${uid}`],
      ['set', `users/${uid}`],
      ['set', 'cache/clean'],
    ])
    expect(fb.state.log[1][2].profile.name).toBe(name)
  })

  test('refuses to overwrite a user already stored at the slug path', async () => {
    const existing = {
      profile: { name: 'bell hooks', noLogin: true },
      roles: { contributor: true },
    }
    fb.state.values['users/bell-hooks'] = existing
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      store.dispatch('users/saveContributor', { name: 'bell hooks', bio: 'x' }),
    ).rejects.toThrow("User 'bell hooks' already exists")

    expect(consoleError).toHaveBeenCalledWith('User exists:', existing)
    expect(fb.state.log).toEqual([['once', 'users/bell-hooks', 'value']])
  })

  test('requires a name before touching firebase', async () => {
    await expect(store.dispatch('users/saveContributor', { bio: 'x' })).rejects.toThrow(
      'User name required',
    )

    expect(fb.state.log).toEqual([])
  })
})

describe('users/contributorOptions', () => {
  test('lists contributors and owners by display name in code-unit order, excluding advisors', () => {
    store.commit('users/set', usersFixture)

    const options = store.getters['users/contributorOptions']

    expect(options.map(({ id, text }) => [id, text])).toEqual([
      ['u5', 'Ann'],
      ['u2', 'Ashley Bryan (owner)'],
      ['u3', 'Zetta Elliott'],
      ['u1', 'bell hooks'],
    ])
    expect(options[1]).toEqual({
      id: 'u2',
      roles: { owner: true },
      profile: { firstName: 'Ashley', lastName: 'Bryan' },
      text: 'Ashley Bryan (owner)',
    })
  })

  test('keeps users with the same display name in collection order', () => {
    store.commit('users/set', {
      zed: { roles: { contributor: true }, profile: { name: 'Sam Lee' } },
      amy: { roles: { contributor: true }, profile: { name: 'Sam Lee' } },
      bob: { roles: { contributor: true }, profile: { name: 'Pat Kim' } },
    })

    expect(store.getters['users/contributorOptions'].map(({ id }) => id)).toEqual([
      'bob',
      'zed',
      'amy',
    ])
  })

  test('is empty until the users collection is loaded, even with users seeded from the dbcache', async () => {
    expect(store.getters['users/contributorOptions']).toEqual([])

    window.dbcache = { users: usersFixture }
    store.commit('users/reset')
    expect(store.state.users.data).toEqual(usersFixture)
    expect(store.getters['users/contributorOptions']).toEqual([])

    fb.state.values.users = usersFixture
    await store.dispatch('users/load')

    expect(fb.state.log).toEqual([['once', 'users', 'value']])
    expect(store.getters['users/contributorOptions'].map(({ id }) => id)).toEqual([
      'u5',
      'u2',
      'u3',
      'u1',
    ])
  })
})

describe('invites/send', () => {
  test('fills the role templates and requests the email service with them', async () => {
    setInviteTemplates(contributorTemplates)

    const response = await store.dispatch('invites/send', ada)

    expect(response.status).toBe(200)
    expect(response.data).toBe('ok')
    const request = onlyRequest()
    expect(request.method).toBe('get')
    expect(request.url).toMatch(/^https:\/\/email\.test\/send\?to=ada@example\.com&/)
    expect(params(request.url).get('subject')).toBe('Welcome Ada')
    const body = params(request.url).get('body')
    expect(body).toMatch(/^<html>/)
    expect(body).toContain(
      "<p>Hi Ada Lovelace, join: <a href='http://localhost:3000/signup?code=happy-blue-otter'>http://localhost:3000/signup?code=happy-blue-otter</a></p>",
    )
    expect(body.trimEnd()).toMatch(/<\/html>$/)
  })

  test('fills LAST_NAME with the recipient last name', async () => {
    setInviteTemplates({
      contributor: { subject: 'Hello FIRST_NAME LAST_NAME', body: '<p>LAST_NAME</p>' },
    })

    await store.dispatch('invites/send', ada)

    const { url } = onlyRequest()
    expect(params(url).get('subject')).toBe('Hello Ada Lovelace')
    expect(params(url).get('body')).toContain('<p>Lovelace</p>')
  })

  test('sends an empty bearer token when nobody is signed in', async () => {
    setInviteTemplates(contributorTemplates)

    await store.dispatch('invites/send', ada)

    expect(onlyRequest().headers.Authorization).toBe('Bearer ')
  })

  test("sends the signed-in user's id token as the bearer token", async () => {
    const getIdToken = vi.fn(async () => 'tok-1')
    fb.state.currentUser = { getIdToken }
    setInviteTemplates(contributorTemplates)

    await store.dispatch('invites/send', ada)

    expect(getIdToken).toHaveBeenCalledTimes(1)
    expect(onlyRequest().headers.Authorization).toBe('Bearer tok-1')
  })

  test('greets a recipient with no first name as "friend"', async () => {
    setInviteTemplates(contributorTemplates)

    await store.dispatch('invites/send', { ...ada, firstName: undefined })

    const { url } = onlyRequest()
    expect(params(url).get('subject')).toBe('Welcome friend')
    expect(params(url).get('body')).toContain('Hi friend, join:')
  })

  test('refuses a role with no subject template, before any request', async () => {
    setInviteTemplates(contributorTemplates)

    await expect(async () =>
      store.dispatch('invites/send', { ...ada, role: 'advisor' }),
    ).rejects.toThrow('No email subject found for "advisor"')

    expect(adapter).not.toHaveBeenCalled()
  })

  test('refuses a role with a subject but no body template, before any request', async () => {
    setInviteTemplates({ ...contributorTemplates, advisor: { subject: 'Welcome FIRST_NAME' } })

    await expect(async () =>
      store.dispatch('invites/send', { ...ada, role: 'advisor' }),
    ).rejects.toThrow('No email template found for "advisor"')

    expect(adapter).not.toHaveBeenCalled()
  })

  test('refuses to send when the email service url is not configured', async () => {
    vi.stubEnv('VUE_APP_EMAIL_URL', '')
    setInviteTemplates(contributorTemplates)

    await expect(store.dispatch('invites/send', ada)).rejects.toThrow(
      'Email service url not configured',
    )

    expect(adapter).not.toHaveBeenCalled()
  })

  test.each([
    [
      'Network Error',
      'Network Error. Is the email Firebase function running? https://email.test/send',
    ],
    [
      'Request failed with status code 500',
      'Error sending email: Request failed with status code 500',
    ],
  ])('reports a request that fails with %j as %j', async (cause, message) => {
    const failure = new Error(cause)
    adapter.mockImplementation(async () => {
      throw failure
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    setInviteTemplates(contributorTemplates)

    await expect(store.dispatch('invites/send', ada)).rejects.toThrow(message)

    expect(consoleError).toHaveBeenCalledWith(failure)
  })
})
