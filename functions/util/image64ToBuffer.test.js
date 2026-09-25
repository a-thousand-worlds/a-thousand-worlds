// @vitest-environment node
// Guards the sharp seam: image64ToBuffer decodes a base64 data URL, re-encodes it as PNG and scales
// it down to a maximum width, all through sharp. migrations/update-dbcache.js (run by
// `npm run deploy`) requires it. Node resolves sharp for the subject and for this file starting at
// functions/util/, so wherever functions/node_modules exists (README setup step 3 creates it, with
// the sharp functions/package.json names, ^0.30.7 when this was written) both load that copy. Only
// a checkout without it, such as a fresh clone, CI or a worktree, falls back to the root sharp
// that the root upgrade changes. The first test fails and names both copies when resolution lands
// anywhere but the root, and the rest are then skipped rather than run against the wrong sharp.
// Every fixture is made in memory with the real sharp; nothing here is mocked.
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** Resolves modules the way the repo root does, where the root sharp upgrade lands. */
const rootRequire = createRequire(new URL('../../package.json', import.meta.url))

/** The sharp entry point the subject loads, found without loading it. */
const SUBJECT_SHARP = require.resolve('sharp')

/** The root sharp entry point, the copy this file exists to guard. */
const ROOT_SHARP = rootRequire.resolve('sharp')

/** Opaque red, the default fixture fill. */
const RED = { r: 255, g: 0, b: 0, alpha: 1 }

/** The eight bytes every PNG file starts with. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

let sharp
let image64ToBuffer

/** Builds a solid-colour image with the real sharp and returns it as a base64 data URL. */
const dataUrl = async (width, height, format = 'png', background = RED) => {
  const buffer = await sharp({ create: { width, height, channels: 4, background } })
    [format]()
    .toBuffer()
  return `data:image/${format};base64,${buffer.toString('base64')}`
}

/** Reads the metadata of the image the subject actually produced. */
const metadataOf = result => sharp(result.buffer).metadata()

/** Reads the channel values of the top-left pixel of the produced image. */
const firstPixel = async result => {
  const { data, info } = await sharp(result.buffer).raw().toBuffer({ resolveWithObject: true })
  return [...data.subarray(0, info.channels)]
}

test('loads the root sharp, the copy the upgrade changes', () => {
  expect(
    SUBJECT_SHARP,
    `image64ToBuffer resolves sharp to ${SUBJECT_SHARP}, not the root copy at ${ROOT_SHARP}. ` +
      'functions/node_modules exists here (README setup step 3 installs the sharp that ' +
      'functions/package.json names into it, ^0.30.7 when this was written), so these tests ' +
      'would exercise that copy instead of the one the root upgrade changes. Run this file ' +
      'from a checkout without functions/node_modules: a fresh clone, CI or a worktree.',
  ).toBe(ROOT_SHARP)
})

describe.skipIf(SUBJECT_SHARP !== ROOT_SHARP)('image64ToBuffer', () => {
  beforeAll(() => {
    sharp = require('sharp')
    image64ToBuffer = require('./image64ToBuffer.js')
  })

  test('returns exactly a buffer, a width and a height', async () => {
    const result = await image64ToBuffer(await dataUrl(800, 600), 400)

    expect(Object.keys(result).toSorted()).toEqual(['buffer', 'height', 'width'])
    expect(Buffer.isBuffer(result.buffer)).toBe(true)
  })

  // The width and height the subject returns are left out on purpose wherever it resized: they
  // are read from the input, not the resized output, so they report the pre-resize size.
  test.each([
    { width: 800, height: 600, outWidth: 400, outHeight: 300 },
    { width: 1000, height: 333, outWidth: 400, outHeight: 133 },
    { width: 401, height: 299, outWidth: 400, outHeight: 298 },
  ])(
    'scales $width x $height to a $outWidth x $outHeight PNG at max width 400',
    async ({ width, height, outWidth, outHeight }) => {
      const result = await image64ToBuffer(await dataUrl(width, height), 400)
      const meta = await metadataOf(result)

      expect(result.buffer.subarray(0, 8)).toEqual(PNG_SIGNATURE)
      expect([meta.format, meta.width, meta.height]).toEqual(['png', outWidth, outHeight])
    },
  )

  test.each([
    { name: 'the width equals the max', width: 400, height: 100, max: 400 },
    { name: 'the image is narrower than the max', width: 300, height: 200, max: 400 },
    { name: 'no max width is given', width: 800, height: 600, max: undefined },
  ])('keeps the original size when $name', async ({ width, height, max }) => {
    const result = await image64ToBuffer(await dataUrl(width, height), max)
    const meta = await metadataOf(result)

    expect({ width: result.width, height: result.height }).toEqual({ width, height })
    expect([meta.format, meta.width, meta.height]).toEqual(['png', width, height])
  })

  test.each(['jpeg', 'webp', 'gif', 'avif'])('converts %s input to a PNG', async format => {
    const result = await image64ToBuffer(await dataUrl(800, 600, format), 400)
    const meta = await metadataOf(result)

    expect(result.buffer.subarray(0, 8)).toEqual(PNG_SIGNATURE)
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 400, 300])
  })

  test('reads the image type from its bytes, not from the data URL MIME type', async () => {
    const png = await dataUrl(10, 10)
    const result = await image64ToBuffer(png.replace('data:image/png', 'data:image/jpeg'))
    const meta = await metadataOf(result)

    expect([meta.format, meta.width, meta.height]).toEqual(['png', 10, 10])
  })

  test('keeps the alpha channel and its exact value through a resize', async () => {
    const translucent = { r: 0, g: 0, b: 255, alpha: 0.5 }
    const result = await image64ToBuffer(await dataUrl(800, 600, 'png', translucent), 400)
    const meta = await metadataOf(result)

    expect(meta.hasAlpha).toBe(true)
    expect(meta.channels).toBe(4)
    expect(await firstPixel(result)).toEqual([0, 0, 255, 128])
  })

  test('keeps an opaque solid colour exact through a resize', async () => {
    const result = await image64ToBuffer(await dataUrl(800, 600), 400)

    expect(await firstPixel(result)).toEqual([255, 0, 0, 255])
  })

  test('gives JPEG input three channels and no alpha', async () => {
    const meta = await metadataOf(await image64ToBuffer(await dataUrl(800, 600, 'jpeg'), 400))

    expect(meta.channels).toBe(3)
    expect(meta.hasAlpha).toBe(false)
  })

  test('drops the EXIF metadata of the input', async () => {
    const jpeg = await sharp({ create: { width: 20, height: 10, channels: 4, background: RED } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'A Thousand Worlds' } })
      .toBuffer()
    const result = await image64ToBuffer(`data:image/jpeg;base64,${jpeg.toString('base64')}`)

    expect(Buffer.isBuffer((await sharp(jpeg).metadata()).exif)).toBe(true)
    expect((await metadataOf(result)).exif).toBe(undefined)
  })

  // A phone photo usually carries an EXIF orientation. Whether the written pixels come out rotated
  // is deliberately not pinned here: today they do not, which looks like a bug. What is pinned
  // holds either way: no orientation tag survives, and the size reported is the size written, so
  // a sharp release that starts auto-orienting the output but not metadata() fails here.
  test('writes an orientation-tagged photo untagged, at the size it reports', async () => {
    const jpeg = await sharp({ create: { width: 600, height: 400, channels: 3, background: RED } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer()
    const result = await image64ToBuffer(`data:image/jpeg;base64,${jpeg.toString('base64')}`)
    const meta = await metadataOf(result)

    expect((await sharp(jpeg).metadata()).orientation).toBe(6)
    expect(meta.orientation).toBe(undefined)
    expect([meta.format, meta.width, meta.height]).toEqual(['png', result.width, result.height])
  })

  test('rejects a bare base64 string, which has no payload after a comma', async () => {
    const png = await dataUrl(10, 10)

    await expect(image64ToBuffer(png.split(',')[1])).rejects.toThrow(/Input Buffer is empty/)
  })

  test('rejects a data URL with an empty payload', async () => {
    await expect(image64ToBuffer('data:image/png;base64,')).rejects.toThrow(/Input Buffer is empty/)
  })

  test('rejects a payload that is not an image', async () => {
    await expect(image64ToBuffer('data:text/plain;base64,aGVsbG8=')).rejects.toThrow(
      /unsupported image format/,
    )
  })
})
