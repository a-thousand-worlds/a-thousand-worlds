// @vitest-environment node
// Guards the axios and sharp seams behind every cover and portrait the functions store: loadImage
// fetches a URL with axios as an arraybuffer, re-encodes the body as PNG with sharp, scales it down
// to a maximum width, and returns { url, buffer, base64, width, height }, or null when the request
// fails. Nothing is stubbed: a loopback HTTP server stands in for the cover hosts, so axios's real
// Node adapter (redirects, arraybuffer to Buffer, status settling, error shape) and the real sharp
// both run. No error is constructed here, so the file makes no assumption about which axios it
// meets; the assertions hold for functions/package.json's axios 0.21 as for the root's 1.x.
//
// It runs only against the root node_modules. loadImage and this file resolve axios and sharp from
// functions/util/, so a functions/node_modules — present in a checkout where someone ran
// `npm install` in functions/, absent in CI and in worktrees — wins over the root tree. The suite
// is skipped with a warning naming the resolved paths then, rather than failing on whatever that
// install holds (a sharp built for another platform will not even load).
import fs from 'node:fs'
import http from 'node:http'
import { createRequire } from 'node:module'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Where `name` resolves from functions/util/, as loadImage resolves it, or null if it does not. */
const resolveDep = name => {
  try {
    return require.resolve(name)
  } catch {
    return null
  }
}

const rootModules = fs.realpathSync(path.join(repoRoot, 'node_modules')) + path.sep
const foreignDeps = ['axios', 'sharp']
  .map(name => ({ name, resolved: resolveDep(name) }))
  .filter(({ resolved }) => !resolved?.startsWith(rootModules))
const skipReason = foreignDeps.length
  ? 'loadImage.test.js skipped: it runs only against the root node_modules, but ' +
    foreignDeps.map(({ name, resolved }) => `${name} resolves to ${resolved}`).join(' and ') +
    ' (a functions/node_modules takes precedence over the root tree).'
  : ''
if (skipReason) {
  console.warn(skipReason)
}

let sharp
let loadImage
let server
let origin
let closedPort
let requests = []
let consoleError

/** Builds a solid-colour image in memory with the real sharp, encoded in the given format. */
const image = (width, height, format) =>
  sharp({ create: { width, height, channels: 3, background: { r: 51, g: 102, b: 153 } } })
    [format]()
    .toBuffer()

/** Builds the routes the loopback server answers, keyed by path. */
const buildRoutes = async () => ({
  '/cover.webp': { status: 200, type: 'image/webp', body: await image(800, 600, 'webp') },
  '/portrait.jpg': { status: 200, type: 'image/jpeg', body: await image(600, 900, 'jpeg') },
  '/small.png': { status: 200, type: 'image/png', body: await image(300, 200, 'png') },
  '/tall.png': { status: 200, type: 'image/png', body: await image(300, 2000, 'png') },
  '/moved': { status: 302, location: '/cover.webp', body: Buffer.alloc(0) },
  '/empty': { status: 200, type: 'image/png', body: Buffer.alloc(0) },
  '/page.html': { status: 200, type: 'text/html', body: Buffer.from('<html>not found</html>') },
})

/** Serves the routes on a loopback port, recording each request as "METHOD path". */
const startServer = routes =>
  new Promise(resolve => {
    const listener = http.createServer((req, res) => {
      requests = [...requests, `${req.method} ${req.url}`]
      const route = routes[req.url] || { status: 404, type: 'text/plain', body: 'Not Found' }
      res.writeHead(route.status, {
        ...(route.type ? { 'Content-Type': route.type } : {}),
        ...(route.location ? { Location: route.location } : {}),
        'Content-Length': Buffer.byteLength(route.body),
      })
      res.end(route.body)
    })
    listener.listen(0, '127.0.0.1', () => resolve(listener))
  })

/** Finds a loopback port with nothing listening on it, so a connection to it is refused. */
const findClosedPort = () =>
  new Promise(resolve => {
    const probe = net.createServer()
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })

/** Reads the format and dimensions of the image loadImage actually produced. */
const metadataOf = async buffer => {
  const { format, width, height } = await sharp(buffer).metadata()
  return { format, width, height }
}

describe.skipIf(skipReason)('loadImage', () => {
  beforeAll(async () => {
    sharp = require('sharp')
    loadImage = require('./loadImage.js')
    server = await startServer(await buildRoutes())
    origin = `http://127.0.0.1:${server.address().port}`
    closedPort = await findClosedPort()
  })

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve))
  })

  beforeEach(() => {
    requests = []
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('requests the URL exactly once, as a GET', async () => {
    await loadImage(`${origin}/cover.webp`, 400)

    expect(requests).toEqual(['GET /cover.webp'])
  })

  test('returns exactly url, buffer, base64, width and height', async () => {
    const url = `${origin}/cover.webp`

    const result = await loadImage(url, 400)

    expect(Object.keys(result).toSorted()).toEqual(['base64', 'buffer', 'height', 'url', 'width'])
    expect(result.url).toBe(url)
    expect(Buffer.isBuffer(result.buffer)).toBe(true)
  })

  test('re-encodes a WebP body as PNG and scales it to the maximum width, keeping the aspect', async () => {
    // result.width and result.height are deliberately unpinned after a resize: they hold the input's
    // 800x600, not the 400x300 of the buffer, and the triggers store them (a suspected bug).
    const result = await loadImage(`${origin}/cover.webp`, 400)

    expect(await metadataOf(result.buffer)).toEqual({ format: 'png', width: 400, height: 300 })
  })

  test('scales a portrait cover by its width alone', async () => {
    const result = await loadImage(`${origin}/portrait.jpg`, 400)

    expect(await metadataOf(result.buffer)).toEqual({ format: 'png', width: 400, height: 600 })
  })

  test('follows a redirect to the image, and returns the URL it was given', async () => {
    const url = `${origin}/moved`

    const result = await loadImage(url, 400)

    expect(requests).toEqual(['GET /moved', 'GET /cover.webp'])
    expect(result.url).toBe(url)
    expect(await metadataOf(result.buffer)).toEqual({ format: 'png', width: 400, height: 300 })
  })

  test('base64 is a PNG data URL of exactly the returned buffer', async () => {
    const result = await loadImage(`${origin}/cover.webp`, 400)

    expect(result.base64).toBe('data:image/png;base64,' + result.buffer.toString('base64'))
    expect(result.base64).toMatch(/^data:image\/png;base64,iVBORw0KGgo/)
  })

  test('leaves an image no wider than the maximum at its own size', async () => {
    const result = await loadImage(`${origin}/small.png`, 400)

    expect(result.width).toBe(300)
    expect(result.height).toBe(200)
    expect(await metadataOf(result.buffer)).toEqual({ format: 'png', width: 300, height: 200 })
  })

  test('caps only the width, so a tall narrow image is not scaled', async () => {
    const result = await loadImage(`${origin}/tall.png`, 400)

    expect(result.width).toBe(300)
    expect(result.height).toBe(2000)
    expect(await metadataOf(result.buffer)).toEqual({ format: 'png', width: 300, height: 2000 })
  })

  test('does not scale at all when no maximum width is given', async () => {
    const result = await loadImage(`${origin}/cover.webp`)

    expect(result.width).toBe(800)
    expect(result.height).toBe(600)
    expect(await metadataOf(result.buffer)).toEqual({ format: 'png', width: 800, height: 600 })
  })

  test('resolves null and logs the AxiosError when the server answers 404', async () => {
    const result = await loadImage(`${origin}/missing.webp`, 400)

    expect(result).toBeNull()
    expect(requests).toEqual(['GET /missing.webp'])
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalledWith(
      expect.objectContaining({
        isAxiosError: true,
        message: 'Request failed with status code 404',
        response: expect.objectContaining({ status: 404 }),
      }),
      'loadImage error',
    )
  })

  test('resolves null and logs the AxiosError when the connection is refused', async () => {
    const result = await loadImage(`http://127.0.0.1:${closedPort}/cover.webp`, 400)

    expect(result).toBeNull()
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalledWith(
      expect.objectContaining({ isAxiosError: true, code: 'ECONNREFUSED' }),
      'loadImage error',
    )
  })

  test('rejects rather than resolving null when a 200 body is empty', async () => {
    // The `!res.data` guard never fires: axios hands over an empty Buffer, which is truthy, and
    // sharp refuses it. If an empty body ever arrived falsy, loadImage would resolve null instead.
    await expect(loadImage(`${origin}/empty`, 400)).rejects.toThrow(/Input Buffer is empty/)
    expect(consoleError).not.toHaveBeenCalled()
  })

  test('rejects rather than resolving null when a 200 body is not an image', async () => {
    // Only the request is guarded; sharp's decode error propagates. watchBooks and watchPeople catch
    // it around their own call, while watchBookSubmissions has only a try/finally.
    await expect(loadImage(`${origin}/page.html`, 400)).rejects.toThrow(/unsupported image format/)
    expect(consoleError).not.toHaveBeenCalled()
  })
})
