/*
 * Characterizes the user store module (src/store/user.js): authentication, the signed-in user's
 * profile, bookmarks and drafts, and the auth-state subscription that main.js's route gate waits
 * on. Dependency seams guarded:
 *
 * - vue-router: logout pushes { name: 'Login' } through the app's real createWebHistory router,
 *   which must resolve the named route, update currentRoute and window.location, and scroll.
 * - jsdom and vitest: the localStorage global that persists impersonation, navigator.userAgent
 *   saved on signup, history/location behind the router, and Date mocked by setSystemTime alone.
 * - vue: toggleBookmark mutates Vuex state in place, outside any mutation, and a computed over it
 *   must still recompute.
 * - vuex: a namespaced module dispatching root actions (resetAuth, ui/setLastVisited,
 *   users/subscribe, submissions/subscribe), actions resolving to and rejecting with the values
 *   of the promises they return, and a promise resolved from inside a mutation (user/next).
 * - lodash, through the mergeOne-composed collection module that the user module extends.
 *
 * Firebase (pinned at v8) is the one boundary faked, at firebase/app, so the real src/firebase.js
 * and every module's lazy import of it still run.
 */
import { computed, toRaw } from 'vue'
import store from '@/store'
import router from '@/router'

const fb = vi.hoisted(() => {
  const state = { tree: {}, listeners: [] }

  /** Records every write the app makes, as (method, path, JSON copy of the value). */
  const write = vi.fn()
  /** Records every Reference.once read, by path. */
  const read = vi.fn()
  /** Records every Reference.on subscription, as (path, event). */
  const on = vi.fn()

  /** Splits a database path into its keys. */
  const keysOf = path => path.split('/').filter(Boolean)

  /** Returns the value at keys in a plain tree, or undefined when any step is missing. */
  const getIn = (tree, keys) =>
    keys.reduce((node, key) => (node == null ? undefined : node[key]), tree)

  /** Returns a copy of tree with value placed at keys, copying each object along the way. */
  const setIn = (tree, [key, ...rest], value) => ({
    ...tree,
    [key]: rest.length ? setIn(tree?.[key] ?? {}, rest, value) : value,
  })

  /** Deep-copies a JSON value, as Firebase does on every write and every read. */
  const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

  /** Returns a v8 DataSnapshot of the value at path now, whose val() is null when absent. */
  const snapshot = path => {
    const value = getIn(state.tree, keysOf(path))
    return { val: () => clone(value) ?? null }
  }

  /** Synchronously re-delivers to every listener at, above or below path, as a local write does. */
  const notify = path =>
    state.listeners
      .filter(
        listener =>
          listener.path === path ||
          path.startsWith(`${listener.path}/`) ||
          listener.path.startsWith(`${path}/`),
      )
      .forEach(listener => listener.callback(snapshot(listener.path)))

  /** Stores value at path and notifies related listeners: a write from the server's side. */
  const serverSet = (path, value) => {
    state.tree = setIn(state.tree, keysOf(path), clone(value))
    notify(path)
  }

  /**
   * Returns a fake v8 Reference. `on` delivers its initial value on a microtask and `once` on a
   * macrotask. That ordering is what lets the invite fallback's setRoles land after the roles
   * listener's null, as the network fetch behind `once` would in production.
   */
  const ref = path => ({
    set: async value => {
      write('set', path, clone(value))
      serverSet(path, value)
    },
    update: async values => {
      write('update', path, clone(values))
      state.tree = Object.entries(values).reduce(
        (tree, [key, value]) => setIn(tree, keysOf(`${path}/${key}`), clone(value)),
        state.tree,
      )
      notify(path)
    },
    remove: async () => {
      write('remove', path)
      serverSet(path, null)
    },
    once: (event, callback) => {
      read(path)
      setTimeout(() => callback(snapshot(path)), 0)
    },
    on: (event, callback) => {
      on(path, event)
      state.listeners = [...state.listeners, { path, callback }]
      Promise.resolve().then(() => callback(snapshot(path)))
    },
  })

  const auth = {
    currentUser: null,
    signInWithEmailAndPassword: vi.fn(),
    createUserWithEmailAndPassword: vi.fn(),
    sendPasswordResetEmail: vi.fn(),
    signOut: vi.fn(),
    onAuthStateChanged: vi.fn(),
  }

  /** Empties the database, forgets every listener and resets every recorded call. */
  const reset = () => {
    state.tree = {}
    state.listeners = []
    auth.currentUser = null
    ;[write, read, on, ...Object.values(auth).filter(value => vi.isMockFunction(value))].forEach(
      mock => mock.mockReset(),
    )
    auth.sendPasswordResetEmail.mockResolvedValue(undefined)
    auth.signOut.mockResolvedValue(undefined)
  }

  const firebase = {
    initializeApp: () => {},
    auth: () => auth,
    database: () => ({ ref, useEmulator: () => {} }),
  }

  return { auth, firebase, on, read, reset, serverSet, write }
})

vi.mock('firebase/app', () => ({ default: fb.firebase }))
vi.mock('firebase/auth', () => ({}))
vi.mock('firebase/database', () => ({}))
vi.mock('firebase/storage', () => ({}))

// the same module id router.js lazily imports as './pages/Login.vue', so logout's push resolves
// without compiling the real page
vi.mock('@/pages/Login.vue', () => ({ default: { render: () => null } }))

const NOW = '2024-01-01T00:00:00.000Z'

/** Returns a fresh signed-in user, since toggleBookmark and the draft actions mutate it in place. */
const ada = (profile = {}) => ({
  uid: 'u1',
  email: 'ada@example.test',
  roles: { authorized: true, contributor: true },
  profile: {
    email: 'ada@example.test',
    name: 'Ada',
    bundles: [],
    bookmarks: {},
    submissions: {},
    draftBooks: [],
    draftBundles: [],
    ...profile,
  },
})

/** The profile every signed-in user starts from, with the given fields laid over it. */
const defaultProfile = fields => ({
  name: '',
  bundles: [],
  bookmarks: {},
  submissions: {},
  draftBooks: [],
  draftBundles: [],
  ...fields,
})

/** Lets pending promise chains, the `once` macrotask and the profile listener's setTimeout run. */
const settle = () => new Promise(resolve => setTimeout(resolve, 10))

/** Starts user/subscribe and returns the auth-state callback it registers once Firebase loads. */
const authListener = async () => {
  store.dispatch('user/subscribe')
  await vi.waitFor(() => expect(fb.auth.onAuthStateChanged).toHaveBeenCalledTimes(1))
  return fb.auth.onAuthStateChanged.mock.calls[0][0]
}

/** Returns the paths of every Reference.on subscription so far, in call order. */
const listenedPaths = () => fb.on.mock.calls.map(([path]) => path)

/** Records the type of every mutation committed until the returned stop function is called. */
const recordCommits = () => {
  const types = vi.fn()
  const stop = store.subscribe(mutation => types(mutation.type))
  return { types: () => types.mock.calls.map(([type]) => type), stop }
}

beforeAll(async () => {
  // load src/firebase.js once, so each lazy import after this resolves within a few microtasks
  await import('@/firebase')
})

beforeEach(() => {
  vi.setSystemTime(new Date(NOW))
  vi.stubGlobal('scrollTo', vi.fn())
  fb.reset()
  localStorage.clear()
  store.commit('user/impersonate', null)
  store.commit('user/setUser', ada())
  store.commit('users/reset')
  store.dispatch('submissions/reset')
})

afterEach(async () => {
  // drain the timers and listener deliveries a test may have left in flight
  await settle()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('mutations', () => {
  test('impersonate stores the role in state and in localStorage', () => {
    store.commit('user/impersonate', 'contributor')

    expect(store.state.user.impersonate).toBe('contributor')
    expect(localStorage.getItem('impersonate')).toBe('contributor')
  })

  test('impersonate(null) clears the role from state and removes it from localStorage', () => {
    store.commit('user/impersonate', 'contributor')
    store.commit('user/impersonate', null)

    expect(store.state.user.impersonate).toBeNull()
    expect(localStorage.getItem('impersonate')).toBeNull()
  })

  test('setUser restores an impersonated role from localStorage when none is set', () => {
    localStorage.setItem('impersonate', 'advisor')

    store.commit('user/setUser', { uid: 'u1' })

    expect(store.state.user.impersonate).toBe('advisor')
    expect(store.state.user.user).toEqual({ uid: 'u1' })
  })

  test('setUser keeps an impersonated role already in state over the one in localStorage', () => {
    store.commit('user/impersonate', 'creator')
    localStorage.setItem('impersonate', 'advisor')

    store.commit('user/setUser', { uid: 'u1' })

    expect(store.state.user.impersonate).toBe('creator')
  })

  test('setUser(null) does not read localStorage, so impersonate stays null', () => {
    localStorage.setItem('impersonate', 'advisor')

    store.commit('user/setUser', null)

    expect(store.state.user.user).toBeNull()
    expect(store.state.user.impersonate).toBeNull()
  })

  test('setRoles always adds authorized: true, unless the roles say otherwise', () => {
    store.commit('user/setRoles', { owner: true })
    expect(store.state.user.user.roles).toEqual({ authorized: true, owner: true })

    store.commit('user/setRoles', null)
    expect(store.state.user.user.roles).toEqual({ authorized: true })

    store.commit('user/setRoles', { authorized: false })
    expect(store.state.user.user.roles).toEqual({ authorized: false })
  })

  test('setRoles and setProfile do nothing when no user is signed in', () => {
    store.commit('user/setUser', null)

    expect(() => store.commit('user/setRoles', { owner: true })).not.toThrow()
    expect(() => store.commit('user/setProfile', { name: 'Nobody' })).not.toThrow()
    expect(store.state.user.user).toBeNull()
  })
})

describe('user/next', () => {
  test('stays pending until the next setUser, then resolves with that user', async () => {
    const resolved = vi.fn()
    const next = store.dispatch('user/next').then(resolved)

    await settle()
    expect(resolved).not.toHaveBeenCalled()

    store.commit('user/setUser', { uid: 'u9', email: 'u9@example.test' })
    await next

    expect(resolved).toHaveBeenCalledTimes(1)
    expect(resolved).toHaveBeenCalledWith({ uid: 'u9', email: 'u9@example.test' })
    expect(resolved.mock.calls[0][0]).toBe(store.state.user.user)
    expect(store.state.user.nextPromise).toBeNull()
  })

  test('a later setUser does not re-resolve it', async () => {
    const resolved = vi.fn()
    const next = store.dispatch('user/next').then(resolved)

    store.commit('user/setUser', { uid: 'first' })
    store.commit('user/setUser', { uid: 'second' })
    await next
    await settle()

    expect(resolved).toHaveBeenCalledTimes(1)
    expect(resolved).toHaveBeenCalledWith({ uid: 'first' })
    expect(store.state.user.nextPromise).toBeNull()
  })

  test('setUser(null) resolves a pending next with null', async () => {
    const next = store.dispatch('user/next')

    store.commit('user/setUser', null)

    await expect(next).resolves.toBeNull()
  })
})

describe('user/login', () => {
  test('signs in with the email and password and resolves to the credential itself', async () => {
    const credential = { user: { uid: 'u1', email: 'ada@example.test' } }
    fb.auth.signInWithEmailAndPassword.mockResolvedValue(credential)

    const result = await store.dispatch('user/login', {
      email: 'ada@example.test',
      password: 'pw',
    })

    expect(fb.auth.signInWithEmailAndPassword).toHaveBeenCalledTimes(1)
    expect(fb.auth.signInWithEmailAndPassword).toHaveBeenCalledWith('ada@example.test', 'pw')
    expect(result).toBe(credential)
  })

  test('rejects with the error Firebase rejects with', async () => {
    const error = { code: 'auth/wrong-password' }
    fb.auth.signInWithEmailAndPassword.mockRejectedValue(error)

    await expect(
      store.dispatch('user/login', { email: 'ada@example.test', password: 'nope' }),
    ).rejects.toBe(error)
  })
})

describe('user/passwordReset', () => {
  test('sends one password reset email to the address', async () => {
    await store.dispatch('user/passwordReset', 'ada@example.test')

    expect(fb.auth.sendPasswordResetEmail).toHaveBeenCalledTimes(1)
    expect(fb.auth.sendPasswordResetEmail).toHaveBeenCalledWith('ada@example.test')
  })
})

describe('user/updateEmail', () => {
  test("changes the signed-in account's email when it differs", async () => {
    const updateEmail = vi.fn().mockResolvedValue(undefined)
    fb.auth.currentUser = { email: 'old@example.test', updateEmail }

    await store.dispatch('user/updateEmail', 'new@example.test')

    expect(updateEmail).toHaveBeenCalledTimes(1)
    expect(updateEmail).toHaveBeenCalledWith('new@example.test')
  })

  test('leaves the account alone when the email is unchanged', async () => {
    const updateEmail = vi.fn().mockResolvedValue(undefined)
    fb.auth.currentUser = { email: 'same@example.test', updateEmail }

    await store.dispatch('user/updateEmail', 'same@example.test')

    expect(updateEmail).not.toHaveBeenCalled()
  })
})

describe('user/signup', () => {
  const authUser = { uid: 'new1', email: 'new@example.test' }

  /** Signs up Nia with the given invite fields, the account creation resolving to authUser. */
  const signup = fields => {
    fb.auth.createUserWithEmailAndPassword.mockResolvedValue({ user: authUser })
    return store.dispatch('user/signup', {
      email: 'new@example.test',
      name: 'Nia New',
      password: 'hunter22',
      ...fields,
    })
  }

  beforeEach(() => {
    store.commit('user/setUser', null)
  })

  test('creates the account, saves a BIPOC invite code and status, and signs the user in', async () => {
    const result = await signup({ bipoc: true, code: 'INV-BIPOC' })

    const profile = {
      name: 'Nia New',
      email: 'new@example.test',
      userAgent: navigator.userAgent,
      code: 'INV-BIPOC',
      bipoc: true,
    }
    expect(fb.auth.createUserWithEmailAndPassword).toHaveBeenCalledTimes(1)
    expect(fb.auth.createUserWithEmailAndPassword).toHaveBeenCalledWith(
      'new@example.test',
      'hunter22',
    )
    expect(fb.write.mock.calls).toEqual([['set', 'users/new1/profile', profile]])
    expect(store.state.user.user).toEqual({
      roles: {},
      uid: 'new1',
      email: 'new@example.test',
      profile,
    })
    expect(result).toBe(authUser)
  })

  test('saves a non-BIPOC invite code as codeNonBipoc, never as code', async () => {
    await signup({ bipoc: false, code: 'INV2' })

    const [[, , profile]] = fb.write.mock.calls
    expect(profile).toEqual({
      name: 'Nia New',
      email: 'new@example.test',
      userAgent: navigator.userAgent,
      codeNonBipoc: 'INV2',
      bipoc: false,
    })
    expect(profile).not.toHaveProperty('code')
  })

  test('saves the code as code and no bipoc key when BIPOC status is omitted', async () => {
    await signup({ code: 'INV3' })

    const [[, , profile]] = fb.write.mock.calls
    expect(profile).toEqual({
      name: 'Nia New',
      email: 'new@example.test',
      userAgent: navigator.userAgent,
      code: 'INV3',
    })
    expect(profile).not.toHaveProperty('bipoc')
  })

  test('saves only name, email and user agent without a code or BIPOC status', async () => {
    await signup({ bipoc: null })

    expect(fb.write.mock.calls).toEqual([
      [
        'set',
        'users/new1/profile',
        { name: 'Nia New', email: 'new@example.test', userAgent: navigator.userAgent },
      ],
    ])
  })

  test('writes nothing and leaves the user signed out when account creation fails', async () => {
    const error = { code: 'auth/email-already-in-use' }
    fb.auth.createUserWithEmailAndPassword.mockRejectedValue(error)

    await expect(
      store.dispatch('user/signup', {
        bipoc: true,
        code: 'INV-BIPOC',
        email: 'new@example.test',
        name: 'Nia New',
        password: 'hunter22',
      }),
    ).rejects.toBe(error)

    expect(fb.write).not.toHaveBeenCalled()
    expect(store.state.user.user).toBeNull()
  })
})

describe('profile writes', () => {
  test('saveProfile sets the whole profile and holds the saved object itself in state', async () => {
    const profile = { name: 'Ada Lovelace', email: 'ada@example.test', bookmarks: {} }

    await store.dispatch('user/saveProfile', profile)

    expect(fb.write.mock.calls).toEqual([['set', 'users/u1/profile', profile]])
    expect(store.state.user.user.profile).toEqual(profile)
    expect(toRaw(store.state.user.user.profile)).toBe(profile)
  })

  test('updateProfile updates only the given keys and merges them into state', async () => {
    await store.dispatch('user/updateProfile', {
      name: 'Ada B',
      website: 'https://ada.example.test',
    })

    expect(fb.write.mock.calls).toEqual([
      ['update', 'users/u1/profile', { name: 'Ada B', website: 'https://ada.example.test' }],
    ])
    expect(store.state.user.user.profile).toEqual({
      ...ada().profile,
      name: 'Ada B',
      website: 'https://ada.example.test',
    })
  })

  test('updateMessageSequence writes one multi-path key and merges it one level deep', async () => {
    store.commit(
      'user/setUser',
      ada({ messageSequence: { welcome: { step: 1 }, tips: { seen: true } } }),
    )

    await store.dispatch('user/updateMessageSequence', {
      name: 'welcome',
      key: 'dismissed',
      value: true,
    })

    expect(fb.write.mock.calls).toEqual([
      ['update', 'users/u1/profile/messageSequence', { 'welcome/dismissed': true }],
    ])
    expect(store.state.user.user.profile).toEqual({
      ...ada().profile,
      messageSequence: { welcome: { step: 1, dismissed: true }, tips: { seen: true } },
    })
  })

  test('updateMessageSequence starts a sequence when the profile has none', async () => {
    await store.dispatch('user/updateMessageSequence', {
      name: 'welcome',
      key: 'dismissed',
      value: true,
    })

    expect(store.state.user.user.profile.messageSequence).toEqual({
      welcome: { dismissed: true },
    })
  })

  test('saveBookSubmissionsDraft saves the whole profile with the book drafts', async () => {
    await store.dispatch('user/saveBookSubmissionsDraft', [{ title: 'Draft A' }])

    expect(fb.write.mock.calls).toEqual([
      ['set', 'users/u1/profile', { ...ada().profile, draftBooks: [{ title: 'Draft A' }] }],
    ])
    expect(store.state.user.user.profile.draftBooks).toEqual([{ title: 'Draft A' }])
  })

  test('savePersonSubmissionDraft saves the whole profile with the person draft', async () => {
    await store.dispatch('user/savePersonSubmissionDraft', { name: 'Draft P' })

    expect(fb.write.mock.calls).toEqual([
      ['set', 'users/u1/profile', { ...ada().profile, draftPerson: { name: 'Draft P' } }],
    ])
    expect(store.state.user.user.profile.draftPerson).toEqual({ name: 'Draft P' })
  })
})

describe('bookmarks', () => {
  test('toggleBookmark adds a bookmark, then removes it, saving the whole profile each time', async () => {
    await store.dispatch('user/toggleBookmark', { id: 'b1', type: 'book' })
    await store.dispatch('user/toggleBookmark', { id: 'b1', type: 'book' })

    expect(fb.write.mock.calls).toEqual([
      ['set', 'users/u1/profile', { ...ada().profile, bookmarks: { b1: 'book' } }],
      ['set', 'users/u1/profile', { ...ada().profile, bookmarks: {} }],
    ])
    expect(store.state.user.user.profile.bookmarks).toEqual({})
  })

  test('toggleBookmark removes only the toggled bookmark', async () => {
    store.commit('user/setUser', ada({ bookmarks: { b1: 'book', p1: 'person' } }))

    await store.dispatch('user/toggleBookmark', { id: 'b1', type: 'book' })

    expect(fb.write.mock.calls).toEqual([
      ['set', 'users/u1/profile', { ...ada().profile, bookmarks: { p1: 'person' } }],
    ])
    expect(store.state.user.user.profile.bookmarks).toEqual({ p1: 'person' })
  })

  test('clearBookmarks saves the whole profile with no bookmarks', async () => {
    store.commit('user/setUser', ada({ bookmarks: { b1: 'book', p1: 'person' } }))

    await store.dispatch('user/clearBookmarks')

    expect(fb.write.mock.calls).toEqual([
      ['set', 'users/u1/profile', { ...ada().profile, bookmarks: {} }],
    ])
    expect(store.state.user.user.profile.bookmarks).toEqual({})
  })

  test('a computed over a bookmark updates from the in-place state change, before any commit', async () => {
    const b1 = computed(() => store.state.user.user.profile.bookmarks.b1)
    expect(b1.value).toBeUndefined()
    const commits = recordCommits()

    const toggled = store.dispatch('user/toggleBookmark', { id: 'b1', type: 'book' })

    expect(b1.value).toBe('book')
    expect(commits.types()).toEqual([])

    await toggled
    commits.stop()

    expect(commits.types()).toEqual(['user/setProfile'])
    expect(b1.value).toBe('book')
  })
})

describe('user/logout', () => {
  test('signs out, clears admin data and impersonation, stamps lastVisited and routes to Login', async () => {
    store.commit('user/impersonate', 'advisor')
    store.commit('users/set', { u1: ada() })
    store.commit('submissions/books/set', { s1: { title: 'Book' } })
    store.commit('submissions/bundles/set', { s2: { name: 'Bundle' } })
    store.commit('submissions/people/set', { s3: { name: 'Person' } })

    await store.dispatch('user/logout')

    expect(fb.auth.signOut).toHaveBeenCalledTimes(1)
    expect(fb.auth.signOut).toHaveBeenCalledWith()
    ;[
      store.state.users,
      store.state.submissions.books,
      store.state.submissions.bundles,
      store.state.submissions.people,
    ].forEach(collection => {
      expect(collection.data).toEqual({})
      expect(collection.loaded).toBe(false)
    })
    expect(store.state.user.impersonate).toBeNull()
    expect(localStorage.getItem('impersonate')).toBeNull()
    expect(store.state.ui.lastVisited).toEqual(new Date(NOW))

    // logout does not await the push, so wait for the navigation to land
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/login'))
    expect(router.currentRoute.value.name).toBe('Login')
    expect(window.location.pathname).toBe('/login')
    await vi.waitFor(() => expect(window.scrollTo).toHaveBeenCalledTimes(1))
  })
})

describe('user/subscribe', () => {
  beforeEach(() => {
    store.commit('user/setUser', null)
  })

  test('registers exactly one auth state listener', async () => {
    await authListener()
    await settle()

    expect(fb.auth.onAuthStateChanged).toHaveBeenCalledTimes(1)
    expect(fb.auth.onAuthStateChanged).toHaveBeenCalledWith(expect.any(Function))
  })

  test('an owner is loaded from the database, then subscribed to users and submissions', async () => {
    fb.serverSet('users/owner1', {
      profile: { name: 'Olivia Owner', email: 'olivia@example.test' },
      roles: { owner: true },
    })
    const onAuth = await authListener()

    onAuth({ uid: 'owner1', email: 'olivia@example.test' })

    expect(listenedPaths()).toEqual(['users/owner1', 'users/owner1/profile', 'users/owner1/roles'])
    await vi.waitFor(() => expect(store.state.user.user?.uid).toBe('owner1'))
    expect(store.state.user.user).toEqual({
      uid: 'owner1',
      email: 'olivia@example.test',
      roles: { authorized: true, owner: true },
      profile: defaultProfile({ email: 'olivia@example.test', name: 'Olivia Owner' }),
    })

    // the profile listener subscribes admin data from a setTimeout
    await vi.waitFor(() => expect(fb.on).toHaveBeenCalledTimes(7))
    expect(listenedPaths().toSorted()).toEqual([
      'submits/books',
      'submits/bundles',
      'submits/people',
      'users',
      'users/owner1',
      'users/owner1/profile',
      'users/owner1/roles',
    ])
    await vi.waitFor(() => expect(store.state.users.loaded).toBe(true))
    expect(store.state.users.data).toEqual({
      owner1: {
        profile: { name: 'Olivia Owner', email: 'olivia@example.test' },
        roles: { owner: true },
      },
    })
  })

  test('a contributor is never subscribed to users or submissions', async () => {
    fb.serverSet('users/c1', {
      profile: { name: 'Cora', email: 'cora@example.test' },
      roles: { contributor: true },
    })
    const onAuth = await authListener()

    onAuth({ uid: 'c1', email: 'cora@example.test' })
    await settle()

    expect(store.state.user.user.roles).toEqual({ authorized: true, contributor: true })
    expect(listenedPaths()).toEqual(['users/c1', 'users/c1/profile', 'users/c1/roles'])
  })

  test('an owner impersonating a contributor is never subscribed to users or submissions', async () => {
    localStorage.setItem('impersonate', 'contributor')
    fb.serverSet('users/owner1', {
      profile: { name: 'Olivia Owner', email: 'olivia@example.test' },
      roles: { owner: true },
    })
    const onAuth = await authListener()

    onAuth({ uid: 'owner1', email: 'olivia@example.test' })
    await settle()

    expect(store.state.user.impersonate).toBe('contributor')
    expect(store.state.user.user.roles).toEqual({ authorized: true, owner: true })
    expect(listenedPaths()).toEqual(['users/owner1', 'users/owner1/profile', 'users/owner1/roles'])
  })

  test('a user with no database record gets the default profile and bare authorization', async () => {
    const onAuth = await authListener()

    onAuth({ uid: 'u2', email: 'u2@example.test' })
    await settle()

    expect(store.state.user.user).toEqual({
      uid: 'u2',
      email: 'u2@example.test',
      roles: { authorized: true },
      profile: defaultProfile({ email: 'u2@example.test' }),
    })
    expect(fb.read).not.toHaveBeenCalled()
  })

  test('a new user without roles yet takes their role from the invite code in their profile', async () => {
    fb.serverSet('users/n1', {
      profile: { name: 'Nia New', email: 'nia@example.test', code: 'INV1' },
    })
    fb.serverSet('invites/INV1', { role: 'contributor' })
    const onAuth = await authListener()

    onAuth({ uid: 'n1', email: 'nia@example.test' })

    await vi.waitFor(() =>
      expect(store.state.user.user?.roles).toEqual({ authorized: true, contributor: true }),
    )
    await settle()
    expect(fb.read).toHaveBeenCalledTimes(1)
    expect(fb.read).toHaveBeenCalledWith('invites/INV1')
    expect(store.state.user.user.roles).toEqual({ authorized: true, contributor: true })
    expect(store.state.user.user.profile).toEqual(
      defaultProfile({ name: 'Nia New', email: 'nia@example.test', code: 'INV1' }),
    )
  })

  test('a user whose record has roles never reads the invite', async () => {
    fb.serverSet('users/n1', {
      profile: { name: 'Nia New', email: 'nia@example.test', code: 'INV1' },
      roles: { creator: true },
    })
    fb.serverSet('invites/INV1', { role: 'contributor' })
    const onAuth = await authListener()

    onAuth({ uid: 'n1', email: 'nia@example.test' })
    await settle()

    expect(fb.read).not.toHaveBeenCalled()
    expect(store.state.user.user.roles).toEqual({ authorized: true, creator: true })
  })

  test('a live profile change reaches state with the default keys kept', async () => {
    fb.serverSet('users/u1', {
      profile: { name: 'Ada', email: 'ada@example.test' },
      roles: { contributor: true },
    })
    const onAuth = await authListener()
    onAuth({ uid: 'u1', email: 'ada@example.test' })
    await settle()

    fb.serverSet('users/u1/profile/name', 'Ada B')

    expect(store.state.user.user.profile).toEqual(
      defaultProfile({ name: 'Ada B', email: 'ada@example.test' }),
    )
    expect(store.state.user.user.roles).toEqual({ authorized: true, contributor: true })
  })

  test('signing out sets the user to null and resolves a pending user/next with null', async () => {
    store.commit('user/setUser', ada())
    const onAuth = await authListener()
    const next = store.dispatch('user/next')

    onAuth(null)

    expect(store.state.user.user).toBeNull()
    await expect(next).resolves.toBeNull()
  })

  test('user/next dispatched before sign-in resolves with the roles from the database', async () => {
    fb.serverSet('users/c1', {
      profile: { name: 'Cora', email: 'cora@example.test' },
      roles: { contributor: true },
    })
    const next = store.dispatch('user/next')
    const onAuth = await authListener()

    onAuth({ uid: 'c1', email: 'cora@example.test' })
    const user = await next

    expect(user.uid).toBe('c1')
    expect(user.roles).toEqual({ authorized: true, contributor: true })
  })
})
