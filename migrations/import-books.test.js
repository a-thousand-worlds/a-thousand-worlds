// @vitest-environment node
// Guards the V1 book importer's dependency seams: the ESM-only uuid 13 consumed from CommonJS
// through require(esm) (`require('uuid').v4`), axios's `.default` CJS interop and its JSON
// response parsing, dotenv (an undeclared transitive) loading the env file named on the command
// line, and the whole require graph (promptly, node-isbn and its nested axios) loading under plain
// Node. The importer is CommonJS, so it is loaded through a real require rather than Vite's ESM
// transform.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const subjectPath = path.join(repoRoot, 'migrations', 'import-books.js')

/** A version 4 UUID in its canonical lowercase form. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

let envDir
let envPath
let subject
let loadLog
let loadEnv

/** Requires the importer with the argv `npm run import:books <envFile>` gives it, capturing what
 * it logs while loading. The last argv entry must not end in `import-books.js`, or the script's
 * usage guard calls process.exit. */
const loadSubject = () => {
  const argv = process.argv
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  process.argv = [process.execPath, subjectPath, envPath]
  try {
    return { exports: require(subjectPath), logged: log.mock.calls.map(args => args.join(' ')) }
  } finally {
    process.argv = argv
    log.mockRestore()
  }
}

/** Serves fixed responses on a loopback port, so axios makes a real HTTP request without
 * leaving the machine. */
const startServer = () =>
  new Promise(resolve => {
    const server = http.createServer((req, res) => {
      if (req.url === '/books.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify([{ title: 'Julián Is a Mermaid', author: 'Jessica Love' }]))
      } else if (req.url === '/details.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end(JSON.stringify({ 1: { isbn: '0763690457', year: 2018 } }))
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Not Found')
      }
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })

beforeAll(() => {
  envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atw-import-books-'))
  envPath = path.join(envDir, 'import-books.env')
  fs.writeFileSync(
    envPath,
    'ATW_IMPORT_BOOKS_FROM_FILE=loaded\nATW_IMPORT_BOOKS_PRESET=from-file\n',
  )
  vi.stubEnv('ATW_IMPORT_BOOKS_PRESET', 'from-shell')
  const loaded = loadSubject()
  subject = loaded.exports
  loadLog = loaded.logged
  loadEnv = {
    fromFile: process.env.ATW_IMPORT_BOOKS_FROM_FILE,
    preset: process.env.ATW_IMPORT_BOOKS_PRESET,
  }
  vi.unstubAllEnvs()
  Reflect.deleteProperty(process.env, 'ATW_IMPORT_BOOKS_FROM_FILE')
})

afterAll(() => {
  fs.rmSync(envDir, { recursive: true, force: true })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('module graph', () => {
  test('loads under plain Node and prints its usage when no env file is given', () => {
    const result = spawnSync(process.execPath, [subjectPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      input: '',
      timeout: 15000,
    })

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toMatch(/npm run import:books PATH_TO_ENV_FILE/)
  }, 20000)
})

describe('loading', () => {
  test('reads the env file named by the last argument', () => {
    expect(loadEnv.fromFile).toBe('loaded')
    expect(loadLog).toEqual([`using firebase config from <${envPath}>`])
  })

  test('leaves a variable already set in the shell alone', () => {
    expect(loadEnv.preset).toBe('from-shell')
  })

  test('exports its helpers without starting the import', () => {
    expect(Object.keys(subject).toSorted()).toEqual([
      'convertCreator',
      'convertTags',
      'loadJsonUrl',
      'normalizeTag',
    ])
    expect(loadLog).not.toContain('Initializing firebase')
  })
})

describe('normalizeTag', () => {
  test('replaces a hyphen with a space and lowercases', () => {
    expect(subject.normalizeTag('Non-fiction')).toBe('non fiction')
    expect(subject.normalizeTag('Picture Book')).toBe('picture book')
  })

  test('singularizes "transitions"', () => {
    expect(subject.normalizeTag('transitions')).toBe('transition')
  })

  test('turns a missing or empty tag into an empty string', () => {
    expect(subject.normalizeTag(undefined)).toBe('')
    expect(subject.normalizeTag('')).toBe('')
  })
})

describe('convertTags', () => {
  const tags = [
    { id: 't1', tag: 'Non Fiction' },
    { id: 't2', tag: 'Life Transition' },
    { id: 't3', tag: 'Picture Book' },
  ]

  test('maps V1 tag names onto matching V2 tag ids and reports the ones it cannot find', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const converted = subject.convertTags(
      ['Non-fiction', 'life-transitions', 'Unknown', 'Picture Book'],
      tags,
    )

    expect(converted).toEqual({ t1: true, t2: true, t3: true })
    expect(error.mock.calls).toEqual([['Converting tag Unknown failed. Tag not found']])
  })

  test('gives an empty map for a book with no tags', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(subject.convertTags([], tags)).toEqual({})
    expect(error).not.toHaveBeenCalled()
  })
})

describe('convertCreator', () => {
  const owner = { uid: 'owner-1' }

  test('reuses an existing person whose name matches regardless of case', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const jane = { id: 'p1', name: 'Jane Doe' }

    const converted = subject.convertCreator('jane doe', [jane], owner)

    expect(converted).toEqual({ creator: jane, new: [] })
    expect(converted.creator).toBe(jane)
    expect(log).not.toHaveBeenCalled()
  })

  test('prepares a new approved person with a v4 uuid when no name matches', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'))

    const converted = subject.convertCreator('John Roe', [{ id: 'p1', name: 'Jane Doe' }], owner)

    expect(converted.creator).toEqual({
      id: expect.stringMatching(UUID_V4),
      createdAt: '2026-01-02T03:04:05.000Z',
      createdBy: 'owner-1',
      approvedAt: '2026-01-02T03:04:05.000Z',
      approvedBy: 'owner-1',
      updatedAt: '2026-01-02T03:04:05.000Z',
      updatedBy: 'owner-1',
      name: 'John Roe',
      bio: '',
    })
    expect(converted.new).toHaveLength(1)
    expect(converted.new[0]).toBe(converted.creator)
    expect(log.mock.calls).toEqual([['Creator <John Roe> not found in database. Preparing new']])
  })

  test('gives each new person a distinct id', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const first = subject.convertCreator('John Roe', [], owner)
    const second = subject.convertCreator('John Roe', [], owner)

    expect(first.creator.id).toMatch(UUID_V4)
    expect(second.creator.id).toMatch(UUID_V4)
    expect(second.creator.id).not.toBe(first.creator.id)
  })
})

describe('loadJsonUrl', () => {
  let server
  let origin

  beforeAll(async () => {
    server = await startServer()
    origin = `http://127.0.0.1:${server.address().port}`
  })

  afterAll(() => new Promise(resolve => server.close(resolve)))

  beforeEach(() => {
    // A proxy configured on the machine running the tests must not intercept the loopback server.
    vi.stubEnv('npm_config_no_proxy', '*')
    vi.stubEnv('no_proxy', '*')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test('resolves to the parsed body of a JSON response', async () => {
    await expect(subject.loadJsonUrl(`${origin}/books.json`)).resolves.toEqual([
      { title: 'Julián Is a Mermaid', author: 'Jessica Love' },
    ])
  })

  test('parses a JSON body even when it is served as plain text', async () => {
    await expect(subject.loadJsonUrl(`${origin}/details.txt`)).resolves.toEqual({
      1: { isbn: '0763690457', year: 2018 },
    })
  })

  test('rejects with the response when the server answers 404', async () => {
    await expect(subject.loadJsonUrl(`${origin}/missing.json`)).rejects.toMatchObject({
      message: 'Request failed with status code 404',
      response: { status: 404, data: 'Not Found' },
    })
  })
})
