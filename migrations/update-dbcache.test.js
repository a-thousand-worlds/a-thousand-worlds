// @vitest-environment node
// update-dbcache.js is the CommonJS script `npm run deploy` runs first, to snapshot the live
// database into public/dbcache.js. These tests pin the seams where it leans on other packages:
// its module graph loading under plain Node (chalk 5 through require(esm), sharp's native binding
// through functions/util/image64ToBuffer, axios, promptly), dotenv (undeclared, resolved through
// @vue/cli-service) reading the env file named on the command line, promptly's prompt and password
// calls, and the firebase v8 namespaced API. Firebase is pinned at v8 and faked here as a boundary,
// and promptly is faked because it reads stdin; chalk, sharp, axios and dotenv are the real ones.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
// The same object the subject gets from require('fs'), so a spy here is the one it calls.
const fs = require('fs')

const migrationsDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(migrationsDir, '..')
const subjectPath = path.join(migrationsDir, 'update-dbcache.js')

/** The firebase web config the script should build from the env file below. */
const FIREBASE_CONFIG = {
  apiKey: 'test-api-key',
  authDomain: 'atw-test.firebaseapp.com',
  databaseURL: 'https://atw-test.firebaseio.com',
  projectId: 'atw-test',
  storageBucket: 'atw-test.appspot.com',
  messagingSenderId: '123',
  appId: '1:123:web:abc',
  measurementId: 'G-TEST',
}

/** The env file handed to the script. AUTH_DOMAIN is quoted to pin dotenv's quote stripping, and
 * the measurement id uses the misspelled name the script reads. */
const ENV_FILE = [
  '# Firebase web config for a project that does not exist',
  'VUE_APP_FIREBASE_API_KEY=test-api-key',
  'VUE_APP_FIREBASE_AUTH_DOMAIN="atw-test.firebaseapp.com"',
  'VUE_APP_FIREBASE_DATABASE_URL=https://atw-test.firebaseio.com',
  'VUE_APP_FIREBASE_PROJECT_ID=atw-test',
  'VUE_APP_FIREBASE_STORAGE_BUCKET=atw-test.appspot.com',
  'VUE_APP_FIREBASE_MESSAGING_SENDER_ID=123',
  'VUE_APP_FIREBASE_APP_ID=1:123:web:abc',
  'VUE_APP_FIREBASE_MEASURMENT_ID=G-TEST',
  'ATW_DBCACHE_TEST_PRESET=from-env-file',
  '',
].join('\n')

/** Every variable the env file sets, which the tests clear beforehand and restore afterwards. */
const ENV_KEYS = ENV_FILE.split('\n')
  .filter(line => /^[A-Z_]+=/.test(line))
  .map(line => line.slice(0, line.indexOf('=')))

/** A database with one record per collection, and users covering every role combination. */
const DATA = {
  books: {
    b1: { id: 'b1', title: 'Book One', cover: { url: 'https://covers.example/b1.jpg' } },
  },
  'tags/books': { t1: { tag: 'Picture Book' } },
  'tags/people': { t2: { tag: 'Author' } },
  'tags/bundles': { t3: { tag: 'Starter Bundle' } },
  people: { p1: { name: 'Person One' } },
  users: {
    u1: { roles: { contributor: true } },
    u2: { roles: { owner: true } },
    u3: { roles: { advisor: true } },
    u4: { profile: {} },
    u5: { roles: { contributor: false, owner: false } },
  },
  content: { about: { text: 'About us' } },
}

/** A fake v8 database whose ref(path).once('value', cb) answers from `data`, recording each read. */
const fakeDatabase = data => {
  const db = {
    reads: [],
    ref: dbPath => ({
      once: (event, callback) => {
        db.reads = [...db.reads, { path: dbPath, event }]
        callback({ val: () => data[dbPath] })
      },
    }),
  }
  return db
}

/** Replaces the CommonJS module `name` resolves to with `exports`, returning its restorer. */
const seedModule = (name, exports) => {
  const id = require.resolve(name)
  const previous = require.cache[id]
  require.cache[id] = { id, filename: id, loaded: true, exports }
  return () => {
    if (previous) {
      require.cache[id] = previous
    } else {
      Reflect.deleteProperty(require.cache, id)
    }
  }
}

/** Fails loudly instead of touching disk: public/img is a symlink into the main checkout. */
const refuseWrite = () => {
  throw new Error('update-dbcache.test.js must never write to disk')
}

const promptly = {
  prompt: vi.fn(async () => 'owner@example.com'),
  password: vi.fn(async () => 'secret'),
}
const signInWithEmailAndPassword = vi.fn()
const firebaseApp = {
  initializeApp: vi.fn(),
  auth: vi.fn(() => ({ signInWithEmailAndPassword })),
  database: vi.fn(),
}

// Runs in its own process, before anything below seeds require.cache, so every dependency is real.
test('loads its whole module graph under plain Node and prints usage without an env file', () => {
  const result = spawnSync(process.execPath, [subjectPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    input: '',
    timeout: 15000,
  })

  // stderr is only the failure message: a require(esm) warning may appear there on success.
  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  expect(result.stdout, result.stderr).toBe('Usage: npm run update:dbcache PATH_TO_ENV_FILE\n')
  expect(result.status, result.stderr).toBe(0)
}, 20000)

describe('required with an env file', () => {
  const savedArgv = process.argv
  let savedEnv = {}
  let restoreModules = []
  let tmpDir
  let envPath
  let requireTimeInfo
  let requireTimeLog
  let subject

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atw-update-dbcache-'))
    envPath = path.join(tmpDir, '.env.test')
    fs.writeFileSync(envPath, ENV_FILE)

    // dotenv never overrides a variable that is already set, so start from a clean slate, except
    // for one variable set beforehand to show exactly that.
    savedEnv = Object.fromEntries(
      Object.keys(process.env)
        .filter(key => key.startsWith('VUE_APP_FIREBASE_') || ENV_KEYS.includes(key))
        .map(key => [key, process.env[key]]),
    )
    Object.keys(savedEnv).forEach(key => Reflect.deleteProperty(process.env, key))
    process.env.ATW_DBCACHE_TEST_PRESET = 'from-shell'

    // The script takes its env file from the last argument, which under vitest is the worker entry.
    process.argv = [process.execPath, subjectPath, envPath]

    restoreModules = [
      seedModule('promptly', promptly),
      seedModule('firebase/app', firebaseApp),
      seedModule('firebase/auth', {}),
      seedModule('firebase/database', {}),
    ]

    vi.spyOn(fs, 'writeFileSync').mockImplementation(refuseWrite)
    vi.spyOn(fs, 'mkdirSync').mockImplementation(refuseWrite)
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    subject = require(subjectPath)
    requireTimeInfo = console.info.mock.calls.map(call => [...call])
    requireTimeLog = console.log.mock.calls.map(call => [...call])
  })

  afterAll(() => {
    vi.restoreAllMocks()
    restoreModules.forEach(restore => restore())
    Reflect.deleteProperty(require.cache, subjectPath)
    process.argv = savedArgv
    ENV_KEYS.forEach(key => Reflect.deleteProperty(process.env, key))
    Object.entries(savedEnv).forEach(([key, value]) => {
      process.env[key] = value
    })
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('at require time', () => {
    test('logs the env file it was given, and nothing else', () => {
      expect(requireTimeInfo).toEqual([[`using firebase config from <${envPath}>`]])
      expect(requireTimeLog).toEqual([])
    })

    test('loads the env file into process.env through dotenv, stripping quotes', () => {
      expect(process.env.VUE_APP_FIREBASE_API_KEY).toBe('test-api-key')
      expect(process.env.VUE_APP_FIREBASE_AUTH_DOMAIN).toBe('atw-test.firebaseapp.com')
      expect(process.env.VUE_APP_FIREBASE_APP_ID).toBe('1:123:web:abc')
      expect(process.env.VUE_APP_FIREBASE_MEASURMENT_ID).toBe('G-TEST')
    })

    test('keeps a variable already set in the environment over the env file', () => {
      expect(process.env.ATW_DBCACHE_TEST_PRESET).toBe('from-shell')
    })
  })

  describe('cacheDatabase', () => {
    test('reads each collection once, in order, with a value listener', async () => {
      const db = fakeDatabase(DATA)

      await subject.cacheDatabase(db)

      expect(db.reads).toEqual([
        { path: 'books', event: 'value' },
        { path: 'tags/books', event: 'value' },
        { path: 'tags/people', event: 'value' },
        { path: 'tags/bundles', event: 'value' },
        { path: 'people', event: 'value' },
        { path: 'users', event: 'value' },
        { path: 'content', event: 'value' },
      ])
    })

    test('builds the cache from the collections, keeping only contributors and owners', async () => {
      const cache = await subject.cacheDatabase(fakeDatabase(DATA))

      expect(cache).toStrictEqual({
        books: DATA.books,
        people: DATA.people,
        tags: {
          books: DATA['tags/books'],
          people: DATA['tags/people'],
          bundles: DATA['tags/bundles'],
        },
        contributors: [{ roles: { contributor: true } }, { roles: { owner: true } }],
        content: DATA.content,
      })
      expect(Object.keys(cache)).toEqual(['books', 'people', 'tags', 'contributors', 'content'])
      expect(Object.keys(cache.tags)).toEqual(['books', 'people', 'bundles'])
    })
  })

  describe('go when sign-in is rejected', () => {
    let result

    beforeEach(async () => {
      signInWithEmailAndPassword.mockRejectedValue(new Error('auth/wrong-password'))
      result = await subject.go()
    })

    test('asks for the owner email, then the password for that email', () => {
      expect(promptly.prompt).toHaveBeenCalledTimes(1)
      expect(promptly.prompt).toHaveBeenCalledWith('Website owner authentication email')
      expect(promptly.password).toHaveBeenCalledTimes(1)
      expect(promptly.password).toHaveBeenCalledWith(
        'Website owner authentication password for <owner@example.com>',
      )
    })

    test('initializes firebase once with the config from the env file', () => {
      expect(firebaseApp.initializeApp).toHaveBeenCalledTimes(1)
      expect(firebaseApp.initializeApp).toHaveBeenCalledWith(FIREBASE_CONFIG)
    })

    test('prompts before initializing firebase, and initializes before signing in', () => {
      const order = [
        promptly.prompt,
        promptly.password,
        firebaseApp.initializeApp,
        signInWithEmailAndPassword,
      ].map(mock => mock.mock.invocationCallOrder[0])

      expect(order).toEqual(order.toSorted((a, b) => a - b))
    })

    test('signs in with the prompted email and password', () => {
      expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(1)
      expect(signInWithEmailAndPassword).toHaveBeenCalledWith('owner@example.com', 'secret')
    })

    test('aborts without reading the database or writing anything', () => {
      expect(result).toBeUndefined()
      expect(console.info.mock.calls).toEqual([
        ['Initializing firebase'],
        ['Connecting to firebase'],
        ['Firebase authentication error. Nothing done. Aborting'],
      ])
      expect(console.error).not.toHaveBeenCalled()
      expect(firebaseApp.database).not.toHaveBeenCalled()
      expect(fs.writeFileSync).not.toHaveBeenCalled()
      expect(fs.mkdirSync).not.toHaveBeenCalled()
    })
  })

  // The successful sign-in path throws 'chalk.cyan is not a function' today (chalk 5 is ESM-only,
  // so require returns its module namespace). Once that is fixed, pin cover.cache, contributor
  // photo urls and the dbcache.js contents here, with fs still refusing writes.
  test.todo('go after a successful sign-in caches covers and contributor photos into dbcache.js')
})
