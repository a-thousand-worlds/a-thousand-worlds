// @vitest-environment node
// The server and its client are CommonJS, like the rest of the project's Node scripts, so they are
// loaded through a real require rather than Vite's ESM transform.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js')
const { TOOLS, createServer } = require('./server.js')
const read = require('./read.js')

/** The complete set of tools this server may expose. A new tool fails this list until someone
 * adds it deliberately, which is what keeps a write from being introduced quietly. */
const READ_ONLY_TOOLS = ['get_value', 'list_keys', 'list_paths']

/** Names a caller might reach for to mutate the database. */
const MUTATIONS = [
  { name: 'set', arguments: { path: 'books', value: {} } },
  { name: 'update', arguments: { path: 'books', value: {} } },
  { name: 'push', arguments: { path: 'books', value: {} } },
  { name: 'remove', arguments: { path: 'books' } },
  { name: 'delete', arguments: { path: 'books' } },
  { name: 'write', arguments: { path: 'books', value: {} } },
  { name: 'firebase_set', arguments: { path: 'books', value: {} } },
  { name: 'set_value', arguments: { path: 'books', value: {} } },
]

let requests = []

/** Connects a client to an in-memory instance of the server. */
const connect = async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '1.0.0' }, { capabilities: {} })
  await Promise.all([createServer().connect(serverTransport), client.connect(clientTransport)])
  return client
}

/** Reads the text content of a tool result. */
const textOf = result => result.content.map(entry => entry.text).join('')

beforeEach(() => {
  requests = []
  // No gated read may depend on a key that happens to be present on the machine running the tests.
  vi.stubEnv('ATW_SERVICE_ACCOUNT_KEY', 'mcp/firebase-read/no-such-key.json')
  vi.stubEnv('VUE_APP_FIREBASE_DATABASE_URL', 'https://a-thousand-worlds.firebaseio.com')
  vi.stubGlobal('fetch', async (url, init) => {
    requests = [...requests, { url: new URL(url), init }]
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ 'book-a': true, 'book-b': true }),
    }
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

test('exposes read tools and nothing else', async () => {
  const client = await connect()
  const names = (await client.listTools()).tools.map(tool => tool.name)

  expect(names.toSorted()).toEqual(READ_ONLY_TOOLS)
  expect(names).toEqual(TOOLS.map(tool => tool.name))
  names.forEach(name => {
    expect(name).not.toMatch(/set|update|push|remove|delete|write|create/i)
  })
})

test('rejects every mutation attempt', async () => {
  const client = await connect()

  await Promise.all(
    MUTATIONS.map(async mutation => {
      await expect(client.callTool(mutation)).rejects.toThrow(/Unknown tool/)
    }),
  )

  // A rejected mutation must not have reached the network at all.
  expect(requests).toEqual([])
})

test('reads issue an HTTP GET carrying no body', async () => {
  const client = await connect()

  await client.callTool({ name: 'get_value', arguments: { path: 'books' } })
  await client.callTool({ name: 'list_keys', arguments: { path: 'books' } })
  await client.callTool({ name: 'get_value', arguments: { path: 'books', limitToFirst: 2 } })

  expect(requests).toHaveLength(3)
  requests.forEach(({ init }) => {
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
  })
})

test('neither module names a mutating HTTP method', () => {
  const dir = path.dirname(require.resolve('./read.js'))
  const source = ['read.js', 'server.js']
    .map(file => fs.readFileSync(path.join(dir, file), 'utf8'))
    .join('\n')

  expect(source).not.toMatch(/['"`](PUT|PATCH|POST|DELETE)['"`]/i)
  // The single fetch call site is what makes the method a literal rather than a parameter.
  expect(source.match(/\bfetch\(/g)).toHaveLength(1)
})

test('exports no write function', () => {
  Object.keys(read).forEach(name => {
    expect(name).not.toMatch(/set|update|push|remove|delete|write/i)
  })
})

test('a public path is read without credentials', async () => {
  const client = await connect()
  const result = await client.callTool({ name: 'list_keys', arguments: { path: 'books' } })

  expect(result.isError).toBeFalsy()
  expect(JSON.parse(textOf(result))).toEqual({
    path: 'books',
    count: 2,
    keys: ['book-a', 'book-b'],
  })
  expect(requests[0].init.headers.authorization).toBeUndefined()
  expect(requests[0].url.searchParams.get('shallow')).toBe('true')
})

test('a gated path needs the service account key, and never reaches the network without it', async () => {
  const client = await connect()

  await Promise.all(
    ['users', 'logs', 'submits', ''].map(async gatedPath => {
      const result = await client.callTool({ name: 'get_value', arguments: { path: gatedPath } })
      expect(result.isError).toBe(true)
      expect(textOf(result)).toMatch(/service account key/)
    }),
  )

  expect(requests).toEqual([])
})

test('rejects a path that tries to climb out of its scope', async () => {
  const client = await connect()
  const result = await client.callTool({
    name: 'get_value',
    arguments: { path: 'books/../users' },
  })

  expect(result.isError).toBe(true)
  expect(textOf(result)).toMatch(/Invalid path segment/)
  expect(requests).toEqual([])
  expect(() => read.parsePath('books/../users')).toThrow(/Invalid path segment/)
})

test('refuses an oversized read instead of truncating it', async () => {
  const huge = JSON.stringify({ books: 'x'.repeat(200000) })
  vi.stubGlobal('fetch', async (url, init) => {
    requests = [...requests, { url: new URL(url), init }]
    return { ok: true, status: 200, text: async () => huge }
  })

  const client = await connect()
  const refused = await client.callTool({ name: 'get_value', arguments: { path: 'books' } })
  expect(refused.isError).toBe(true)
  expect(textOf(refused)).toMatch(/over the 100000 limit/)

  // The cap is a default, not a ceiling.
  vi.stubEnv('ATW_MAX_RESPONSE_CHARS', '500000')
  const allowed = await client.callTool({ name: 'get_value', arguments: { path: 'books' } })
  expect(allowed.isError).toBeFalsy()
})

test('classifies paths against firebase.rules.json', () => {
  read.PUBLIC_PATHS.forEach(publicPath => {
    expect(read.accessLevel(read.parsePath(publicPath))).toBe('public')
  })
  read.GATED_PATHS.forEach(gatedPath => {
    expect(read.accessLevel(read.parsePath(gatedPath))).toBe('gated')
  })
  // The database root has no ".read" of its own.
  expect(read.accessLevel(read.parsePath(''))).toBe('gated')
})
