// @vitest-environment node
// Characterizes the read-only Firebase REST client at the seams a dependency upgrade can move:
// - firebase-admin: admin.credential.cert() parsing a real service account key (field checks and
//   node-forge's PEM parse), sharing one credential per key contents process-wide, building a
//   google-auth-library JWT with the database scopes, and turning its credentials into the
//   { access_token, expires_in } that read.js caches.
// - google-auth-library: stubbed only at the protected JWT.prototype.refreshTokenNoCache, the
//   network token request, so OAuth2Client.getAccessToken's token cache and its five-minute
//   eager-refresh threshold run for real, as does everything firebase-admin does above them.
//   gtoken, which refreshTokenNoCache wraps, is not exercised.
// - Node's global fetch contract and WHATWG URL / URLSearchParams encoding of paths and queries.
// The subjects are CommonJS, so they load through a real require rather than Vite's ESM transform.
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { JWT } = require('google-auth-library')
const read = require('./read.js')
const { callTool } = require('./server.js')

const DB = 'https://atw-test.firebaseio.com'
const CLIENT_EMAIL = 'reader@atw-test.iam.gserviceaccount.com'
const PROJECT_ROOT = path.dirname(require.resolve('../../package.json'))
const T0 = Date.UTC(2026, 0, 1)

let privateKey = ''
let tmpDir = ''
let keyCount = 0
let requests = []
let reply = { ok: true, status: 200, body: 'null' }
let minted = []
let mint = null

/** Records every fetch as { url, init } and answers with the current reply. */
const fakeFetch = async (url, init) => {
  requests = [...requests, { url: String(url), init }]
  return { ok: reply.ok, status: reply.status, text: async () => reply.body }
}

/** Sets what the stubbed fetch answers with next. */
const respond = (body, { ok = true, status = 200 } = {}) => {
  reply = { ok, status, body }
}

/** Resolves to the message a promise rejects with, and fails if it resolves instead. The MCP
 * server hands that message to the model verbatim, so tests compare all of it. */
const rejectionMessage = promise =>
  promise.then(
    value => {
      throw new Error(`Expected a rejection, got ${JSON.stringify(value)}`)
    },
    error => error.message,
  )

/** Writes a service account key into its own fresh directory, so neither read.js's token cache
 * (keyed by path) nor require's JSON cache can carry a key over from another test. Each key gets a
 * unique private_key_id as well, because firebase-admin shares one credential, and with it one
 * google-auth-library client and its cached token, per key contents across the whole file. */
const writeKey = (overrides = {}) => {
  keyCount += 1
  const file = path.join(fs.mkdtempSync(path.join(tmpDir, 'key-')), 'serviceAccountKey.json')
  const key = {
    type: 'service_account',
    project_id: 'atw-test',
    private_key_id: `key-${keyCount}`,
    private_key: privateKey,
    client_email: CLIENT_EMAIL,
    ...overrides,
  }
  fs.writeFileSync(file, JSON.stringify(key))
  return file
}

/** Points read.js at a freshly written key and returns its path. */
const useKey = overrides => {
  const file = writeKey(overrides)
  vi.stubEnv('ATW_SERVICE_ACCOUNT_KEY', file)
  return file
}

/** Stands in for the JWT client's network token request: each call mints the next numbered
 * token, valid for an hour. google-auth-library decides when to call it and stores the result on
 * the client, where firebase-admin reads it back. */
async function fakeRefreshTokenNoCache() {
  minted = [...minted, this]
  return {
    res: null,
    tokens: {
      access_token: `token-${minted.length}`,
      expiry_date: Date.now() + 3600000,
      token_type: 'Bearer',
    },
  }
}

beforeAll(() => {
  privateKey = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atw-read-test-'))
})

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

beforeEach(() => {
  requests = []
  minted = []
  respond('null')
  // The trailing slash pins that databaseUrl() strips it before building request URLs.
  vi.stubEnv('VUE_APP_FIREBASE_DATABASE_URL', `${DB}/`)
  vi.stubEnv('ATW_SERVICE_ACCOUNT_KEY', path.join(tmpDir, 'no-such-key.json'))
  vi.stubEnv('ATW_MAX_RESPONSE_CHARS', '')
  vi.stubGlobal('fetch', fakeFetch)
  mint = vi.spyOn(JWT.prototype, 'refreshTokenNoCache').mockImplementation(fakeRefreshTokenNoCache)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('gated reads through firebase-admin', () => {
  test('firebase-admin resolves the same google-auth-library this file stubs', () => {
    // If firebase-admin ever nests its own copy, the stub stops intercepting and a gated read
    // would attempt a real token request. This names the cause before the other tests fail.
    const fromAdmin = require.resolve('google-auth-library', {
      paths: [path.dirname(require.resolve('firebase-admin'))],
    })
    expect(fromAdmin).toBe(require.resolve('google-auth-library'))
  })

  test('a gated read sends a bearer token minted from the service account key', async () => {
    useKey()
    respond('{"name":"Reader"}')

    await expect(read.get('users/u1/profile')).resolves.toEqual({ name: 'Reader' })

    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe(`${DB}/users/u1/profile.json`)
    expect(requests[0].init.method).toBe('GET')
    expect(requests[0].init.headers).toEqual({
      accept: 'application/json',
      authorization: 'Bearer token-1',
    })

    // firebase-admin built a JWT client from the key file, scoped for the database REST API.
    expect(mint).toHaveBeenCalledTimes(1)
    expect(minted[0]).toBeInstanceOf(JWT)
    expect(minted[0].email).toBe(CLIENT_EMAIL)
    expect(minted[0].key).toBe(privateKey)
    expect(minted[0].keyId).toBe(`key-${keyCount}`)
    expect(minted[0].scopes).toEqual(
      expect.arrayContaining([
        'https://www.googleapis.com/auth/firebase.database',
        'https://www.googleapis.com/auth/userinfo.email',
      ]),
    )
  })

  test('a burst of gated reads shares one token, including a read of the database root', async () => {
    useKey()
    respond('{"u1":true,"u2":true}')

    await expect(read.keys('users')).resolves.toEqual(['u1', 'u2'])
    await read.get('submits')
    await read.get('')

    expect(mint).toHaveBeenCalledTimes(1)
    expect(requests.map(({ url }) => url)).toEqual([
      `${DB}/users.json?shallow=true`,
      `${DB}/submits.json`,
      `${DB}/.json`,
    ])
    requests.forEach(({ init }) => {
      expect(init.headers.authorization).toBe('Bearer token-1')
    })
  })

  test('a public read carries no authorization and mints nothing', async () => {
    useKey()
    respond('{"b1":{"title":"A Book"}}')

    await expect(read.get('books')).resolves.toEqual({ b1: { title: 'A Book' } })

    expect(requests[0].url).toBe(`${DB}/books.json`)
    expect(requests[0].init.headers).toEqual({ accept: 'application/json' })
    expect(mint).not.toHaveBeenCalled()
  })

  test('a cached token is reused until 60 seconds before it expires', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    useKey()

    await read.get('users')
    // firebase-admin reports expires_in = floor((expiry_date - now) / 1000) = 3600, and read.js
    // caches the token until now + (3600 - 60) seconds. When it asks again, google-auth-library's
    // client refreshes too, because the token is inside its five-minute eager-refresh window.
    vi.setSystemTime(T0 + 3_539_999)
    await read.get('users')
    vi.setSystemTime(T0 + 3_540_000)
    await read.get('users')

    expect(mint).toHaveBeenCalledTimes(2)
    expect(requests.map(({ init }) => init.headers.authorization)).toEqual([
      'Bearer token-1',
      'Bearer token-1',
      'Bearer token-2',
    ])
  })

  test('switching to a key file for another account mints a token from the new key', async () => {
    useKey()
    await read.get('logs')
    useKey({ client_email: 'other-reader@atw-test.iam.gserviceaccount.com' })
    await read.get('logs')

    expect(mint).toHaveBeenCalledTimes(2)
    expect(minted[1]).not.toBe(minted[0])
    expect(minted.map(client => client.email)).toEqual([
      CLIENT_EMAIL,
      'other-reader@atw-test.iam.gserviceaccount.com',
    ])
    expect(requests.map(({ init }) => init.headers.authorization)).toEqual([
      'Bearer token-1',
      'Bearer token-2',
    ])
  })

  test('identical key contents at a new path share one firebase-admin credential and its token, until the eager-refresh window', async () => {
    // read.js keys its cache by path, so each new path asks firebase-admin again. firebase-admin
    // hands back the credential it already built for those contents, and google-auth-library
    // answers from that client's token until five minutes before it expires.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    const asked = vi.spyOn(JWT.prototype, 'getAccessToken')
    const shared = { private_key_id: 'shared-key' }

    useKey(shared)
    await read.get('logs')
    vi.setSystemTime(T0 + 3_299_999)
    useKey(shared)
    await read.get('logs')
    vi.setSystemTime(T0 + 3_300_000)
    useKey(shared)
    await read.get('logs')

    expect(asked).toHaveBeenCalledTimes(3)
    expect(mint).toHaveBeenCalledTimes(2)
    expect(minted[1]).toBe(minted[0])
    expect(requests.map(({ init }) => init.headers.authorization)).toEqual([
      'Bearer token-1',
      'Bearer token-1',
      'Bearer token-2',
    ])
  })

  test('a key file without private_key is rejected by firebase-admin before any request', async () => {
    useKey({ private_key: undefined })

    await expect(rejectionMessage(read.get('users'))).resolves.toBe(
      'Service account object must contain a string "private_key" property.',
    )
    expect(mint).not.toHaveBeenCalled()
    expect(requests).toEqual([])
  })

  test('a private_key that is not a PEM is rejected by node-forge before any request', async () => {
    useKey({ private_key: 'not a pem' })

    await expect(rejectionMessage(read.get('users'))).resolves.toBe(
      'Failed to parse private key: Error: Invalid PEM formatted message.',
    )
    expect(mint).not.toHaveBeenCalled()
    expect(requests).toEqual([])
  })

  test('a missing key file names where it looked and requests no token before failing', async () => {
    const missing = path.join(tmpDir, 'no-such-key.json')

    await expect(rejectionMessage(read.get('logs'))).resolves.toBe(
      `Reading a gated path needs the service account key, which is not at ${missing}. Generate one at Firebase Project → Settings → Service Accounts → Generate new private key and save it to functions/serviceAccountKey.json, or set ATW_SERVICE_ACCOUNT_KEY to its location.`,
    )
    expect(mint).not.toHaveBeenCalled()
    expect(requests).toEqual([])
  })
})

describe('query encoding', () => {
  /** Reads books with the given options and returns the one URL fetched. */
  const urlFor = async options => {
    await read.get('books', options)
    expect(requests).toHaveLength(1)
    return requests[0].url
  }

  test('string query values are JSON-quoted and percent-encoded', async () => {
    await expect(urlFor({ orderBy: 'isbn', equalTo: '9781984881489' })).resolves.toBe(
      `${DB}/books.json?orderBy=%22isbn%22&equalTo=%229781984881489%22`,
    )
  })

  test('numeric ranges are sent bare, in a fixed parameter order', async () => {
    await expect(urlFor({ orderBy: 'year', startAt: 2000, endAt: 2010 })).resolves.toBe(
      `${DB}/books.json?orderBy=%22year%22&startAt=2000&endAt=2010`,
    )
  })

  test('limits come before equalTo regardless of the order the options were given', async () => {
    await expect(urlFor({ orderBy: 'approved', equalTo: true, limitToLast: 3 })).resolves.toBe(
      `${DB}/books.json?orderBy=%22approved%22&limitToLast=3&equalTo=true`,
    )
  })

  test('reserved and non-ASCII characters in a value are escaped rather than splitting the query', async () => {
    await expect(urlFor({ orderBy: 'title', equalTo: 'Ñandú&co=1' })).resolves.toBe(
      `${DB}/books.json?orderBy=%22title%22&equalTo=%22%C3%91and%C3%BA%26co%3D1%22`,
    )
  })

  test('a space in a query value is form-encoded as +, unlike the %20 it becomes in a path', async () => {
    await expect(urlFor({ orderBy: 'title', equalTo: 'a b' })).resolves.toBe(
      `${DB}/books.json?orderBy=%22title%22&equalTo=%22a+b%22`,
    )
  })

  test('a range without an ordering orders by $key', async () => {
    await expect(urlFor({ startAt: 'm' })).resolves.toBe(
      `${DB}/books.json?orderBy=%22%24key%22&startAt=%22m%22`,
    )
  })

  test('a zero limit still counts as narrowing and orders by $key', async () => {
    await expect(urlFor({ limitToFirst: 0 })).resolves.toBe(
      `${DB}/books.json?orderBy=%22%24key%22&limitToFirst=0`,
    )
  })

  test('shallow false is omitted and does not block a limit', async () => {
    await expect(urlFor({ shallow: false, limitToFirst: 1 })).resolves.toBe(
      `${DB}/books.json?orderBy=%22%24key%22&limitToFirst=1`,
    )
  })

  test('shallow combined with narrowing is refused before any request', async () => {
    await expect(
      rejectionMessage(read.get('books', { shallow: true, orderBy: '$key', limitToFirst: 1 })),
    ).resolves.toBe(
      'shallow cannot be combined with orderBy, limitToFirst. A shallow read always returns every key, in lexicographical order.',
    )
    expect(requests).toEqual([])
  })
})

describe('path handling', () => {
  test('empty segments and leading or trailing slashes are dropped, with no query string', async () => {
    await read.get('/books//abc/')

    expect(requests.map(({ url }) => url)).toEqual([`${DB}/books/abc.json`])
  })

  test('spaces and non-ASCII characters in a path segment are percent-encoded', async () => {
    await read.get('people/Ñandú x')

    expect(requests.map(({ url }) => url)).toEqual([`${DB}/people/%C3%91and%C3%BA%20x.json`])
  })

  test.each(['a.b', '$x'])(
    'a segment containing a forbidden key character (%s) is refused',
    async segment => {
      await expect(rejectionMessage(read.get(`books/${segment}`))).resolves.toBe(
        `Invalid path segment "${segment}". Firebase keys cannot contain . $ # [ or ], so a relative path such as ".." does not address anything.`,
      )
      expect(requests).toEqual([])
    },
  )
})

describe('responses', () => {
  test('a JSON error body is reduced to its error field', async () => {
    respond('{"error":"Permission denied"}', { ok: false, status: 401 })

    await expect(rejectionMessage(read.get('books'))).resolves.toBe(
      'Firebase returned 401 for /books: Permission denied',
    )
  })

  test('a non-JSON error body is quoted up to 200 characters', async () => {
    const body = `<html>${'x'.repeat(300)}`
    respond(body, { ok: false, status: 500 })

    const message = await rejectionMessage(read.get('books'))
    expect(message).toBe(`Firebase returned 500 for /books: ${body.slice(0, 200)}`)
    expect(message).toHaveLength(234)
  })

  test('a non-numeric size cap falls back to 100000 characters, inclusive', async () => {
    vi.stubEnv('ATW_MAX_RESPONSE_CHARS', 'abc')
    respond(JSON.stringify('x'.repeat(99998)))

    await expect(read.get('books')).resolves.toBe('x'.repeat(99998))

    respond(JSON.stringify('x'.repeat(99999)))
    await expect(rejectionMessage(read.get('books'))).resolves.toBe(
      '/books is 100001 characters, over the 100000 limit. Narrow the read with shallow, a deeper path, or limitToFirst/limitToLast, or raise ATW_MAX_RESPONSE_CHARS.',
    )
  })

  test('a numeric size cap replaces the default', async () => {
    vi.stubEnv('ATW_MAX_RESPONSE_CHARS', '10')
    respond('"12345678"')

    await expect(read.get('books')).resolves.toBe('12345678')

    respond('"123456789"')
    await expect(rejectionMessage(read.get('books/b1'))).resolves.toBe(
      '/books/b1 is 11 characters, over the 10 limit. Narrow the read with shallow, a deeper path, or limitToFirst/limitToLast, or raise ATW_MAX_RESPONSE_CHARS.',
    )
  })
})

describe('keys', () => {
  test('a missing collection has no keys', async () => {
    respond('null')

    await expect(read.keys('books')).resolves.toEqual([])
    expect(requests.map(({ url }) => url)).toEqual([`${DB}/books.json?shallow=true`])
  })

  test('a scalar value is refused as not a collection, naming the normalised path', async () => {
    respond('"A Book"')

    await expect(rejectionMessage(read.keys('/books//abc/title/'))).resolves.toBe(
      '/books/abc/title holds a single value, not a collection.',
    )
    expect(requests.map(({ url }) => url)).toEqual([`${DB}/books/abc/title.json?shallow=true`])
  })

  test('keys are sorted by UTF-16 code unit, not numerically or case-insensitively', async () => {
    respond(JSON.stringify({ b: true, a: true, B: true, 10: true, 9: true }))

    await expect(read.keys('books')).resolves.toEqual(['10', '9', 'B', 'a', 'b'])
  })
})

describe('list_paths', () => {
  test('reports a missing key without touching the network', async () => {
    const missing = path.join(tmpDir, 'no-such-key.json')

    await expect(callTool('list_paths')).resolves.toEqual({
      databaseUrl: DB,
      public: ['books', 'cache', 'content', 'invites', 'links', 'people', 'tags'],
      gated: ['logs', 'submits', 'users'],
      serviceAccountKey: `missing (${missing}); gated paths cannot be read`,
    })
    expect(requests).toEqual([])
    expect(mint).not.toHaveBeenCalled()
  })

  test('a relative key path resolves against the project root, not the working directory', async () => {
    // Vitest runs from the project root, so move the working directory away from it: a key path
    // resolved against cwd would then point into the temp directory instead.
    vi.spyOn(process, 'cwd').mockReturnValue(os.tmpdir())
    vi.stubEnv('ATW_SERVICE_ACCOUNT_KEY', 'mcp/firebase-read/no-such-key.json')

    const { serviceAccountKey } = await callTool('list_paths')
    expect(serviceAccountKey).toBe(
      `missing (${path.join(PROJECT_ROOT, 'mcp', 'firebase-read', 'no-such-key.json')}); gated paths cannot be read`,
    )
  })

  test('reports the key path when the key exists, still without a request', async () => {
    const keyPath = useKey()

    const { serviceAccountKey } = await callTool('list_paths')
    expect(serviceAccountKey).toBe(keyPath)
    expect(requests).toEqual([])
    expect(mint).not.toHaveBeenCalled()
  })
})
