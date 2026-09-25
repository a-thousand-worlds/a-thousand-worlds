/**
 * Characterizes the book lookup utilities (metadataByISBN, coverImageByISBN, findBookByKeyword,
 * isValidISBN) at the seams where they lean on third-party packages, so a dependency upgrade that
 * changes behavior fails here first:
 * - axios builds each request URL and turns the response body into `data`: JSON is parsed whatever
 * the content type, an empty body stays '' and 'null' becomes null. The real axios runs on its
 * fetch adapter against a stubbed global fetch, so its own response parsing is what is pinned.
 * - dayjs turns a book's free-form publishedDate into the year shown on the submission form.
 * node-isbn (the fallback when the backend finds nothing) is mocked as a network boundary: it bundles
 * its own axios, which the fetch stub does not reach, and it is not part of the upgrade wave.
 */
import axios from 'axios'
import coverImageByISBN from './coverImageByISBN'
import findBookByKeyword from './findBookByKeyword'
import isValidISBN from './isValidISBN'
import metadataByISBN from './metadataByISBN'

const nodeIsbn = vi.hoisted(() => ({
  /** Called with (providers, isbn) for every provider(providers).resolve(isbn, cb). */
  lookup: vi.fn(),
  /** The [err, book] pair the fake hands to the resolve callback. */
  result: [new Error('no books'), null],
}))

vi.mock('node-isbn', () => ({
  default: {
    provider: list => ({
      resolve: (code, cb) => {
        nodeIsbn.lookup(list, code)
        cb(...nodeIsbn.result)
      },
    }),
  },
}))

const ISBN = '9781419721373'
const originalAdapter = axios.defaults.adapter

/** Stubs global fetch with one 200 response of the given body and content type, returning the spy. */
const respondWith = (body, contentType = 'application/json') => {
  const fetch = vi.fn(
    async () => new Response(body, { status: 200, headers: { 'content-type': contentType } }),
  )
  vi.stubGlobal('fetch', fetch)
  return fetch
}

/** Returns the method and URL of every request the fetch spy received. */
const requests = fetch =>
  fetch.mock.calls.map(([input]) => ({ method: input.method, url: input.url }))

beforeAll(() => {
  axios.defaults.adapter = 'fetch'
})

afterAll(() => {
  axios.defaults.adapter = originalAdapter
})

beforeEach(() => {
  vi.stubEnv('VUE_APP_METADATA_BY_ISBN_URL', 'https://meta.example.test/metadataByISBN')
  vi.stubEnv('VUE_APP_COVER_IMAGE_BY_ISBN_URL', 'https://cover.example.test/coverImageByISBN')
  vi.stubEnv('VUE_APP_AMAZON_SEARCH_BOOK_URL', 'https://search.example.test/searchBook')
  nodeIsbn.lookup.mockClear()
  nodeIsbn.result = [new Error('no books'), null]
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('metadataByISBN', () => {
  test('requests the backend with the isbn as a query parameter', async () => {
    const fetch = respondWith(JSON.stringify({ isbn: ISBN, publishedDate: '2016' }))
    await metadataByISBN(ISBN)
    expect(requests(fetch)).toEqual([
      { method: 'GET', url: 'https://meta.example.test/metadataByISBN?isbn=9781419721373' },
    ])
  })

  test('maps the backend book onto the submission form fields', async () => {
    respondWith(
      JSON.stringify({
        isbn: ISBN,
        title: 'Ada Twist, Scientist',
        authors: ['Andrea Beaty'],
        illustrators: ['David Roberts'],
        publisher: 'Abrams',
        description: '<p>A scientist.</p>',
        publishedDate: '2016-09-06',
        goodreads: 'https://www.goodreads.com/book/show/1',
      }),
    )
    expect(await metadataByISBN(ISBN)).toEqual({
      authors: ['Andrea Beaty'],
      goodreads: 'https://www.goodreads.com/book/show/1',
      illustrators: ['David Roberts'],
      isbn: ISBN,
      publisher: 'Abrams',
      summary: '<p>A scientist.</p>',
      title: 'Ada Twist, Scientist',
      year: 2016,
    })
    expect(nodeIsbn.lookup.mock.calls).toEqual([])
  })

  test.each([
    ['2016', 2016],
    ['2016-09', 2016],
    ['2016-09-06', 2016],
    ['September 6, 2016', 2016],
    ['unknown', ''],
    ['', ''],
  ])('reads the year of publishedDate %j as %j', async (publishedDate, year) => {
    respondWith(JSON.stringify({ isbn: ISBN, publishedDate }))
    expect((await metadataByISBN(ISBN)).year).toBe(year)
  })

  test.each(['2017-01-01', '2017-01', '2017'])(
    'reads date-only publishedDate %j in local time, so New Year keeps its year west of UTC',
    async publishedDate => {
      // Native Date parses 'YYYY-MM-DD' and 'YYYY-MM' as UTC midnight, which is still the previous
      // year in Los Angeles; dayjs parses them as local dates.
      vi.stubEnv('TZ', 'America/Los_Angeles')
      respondWith(JSON.stringify({ isbn: ISBN, publishedDate }))
      expect((await metadataByISBN(ISBN)).year).toBe(2017)
    },
  )

  test('fills every missing field of a sparse book with an empty value', async () => {
    respondWith(JSON.stringify({ isbn: ISBN, publishedDate: 'unknown' }))
    expect(await metadataByISBN(ISBN)).toEqual({
      authors: [],
      goodreads: '',
      illustrators: [],
      isbn: ISBN,
      publisher: '',
      summary: '',
      title: '',
      year: '',
    })
  })

  test.each([
    ['an empty body', ''],
    ['a JSON null body', 'null'],
  ])('falls back to node-isbn on Google when the backend returns %s', async (_, body) => {
    respondWith(body)
    nodeIsbn.result = [null, { isbn: ISBN, title: 'G', publishedDate: '2016' }]
    expect(await metadataByISBN(ISBN)).toEqual({
      authors: [],
      goodreads: '',
      illustrators: [],
      isbn: ISBN,
      publisher: '',
      summary: '',
      title: 'G',
      year: 2016,
    })
    expect(nodeIsbn.lookup.mock.calls).toEqual([[['google'], ISBN]])
  })

  test('falls back on a JSON null body even when it is not served as JSON', async () => {
    // The backend answers a request without an isbn with res.send(JSON.stringify(null)), which
    // Express serves as text/html; axios still parses it to null.
    respondWith('null', 'text/html; charset=utf-8')
    nodeIsbn.result = [null, { isbn: ISBN, title: 'G', publishedDate: '2016' }]
    expect((await metadataByISBN(ISBN)).title).toBe('G')
    expect(nodeIsbn.lookup.mock.calls).toEqual([[['google'], ISBN]])
  })

  test('resolves null when neither the backend nor node-isbn finds the book', async () => {
    respondWith('null')
    nodeIsbn.result = [new Error('no books'), null]
    expect(await metadataByISBN(ISBN)).toBeNull()
    expect(nodeIsbn.lookup.mock.calls).toEqual([[['google'], ISBN]])
  })
})

describe('coverImageByISBN', () => {
  test('requests the backend with the isbn and returns a JSON body as parsed', async () => {
    const fetch = respondWith(JSON.stringify({ url: 'https://img.test/c.jpg', width: 300 }))
    expect(await coverImageByISBN(ISBN)).toEqual({ url: 'https://img.test/c.jpg', width: 300 })
    expect(requests(fetch)).toEqual([
      { method: 'GET', url: 'https://cover.example.test/coverImageByISBN?isbn=9781419721373' },
    ])
  })

  test('returns a text/plain body as the raw string', async () => {
    respondWith('https://img.test/c.jpg', 'text/plain')
    expect(await coverImageByISBN(ISBN)).toBe('https://img.test/c.jpg')
  })

  test('parses a JSON body even when it is served as text/html', async () => {
    respondWith(JSON.stringify({ url: 'https://img.test/c.jpg' }), 'text/html; charset=utf-8')
    expect(await coverImageByISBN(ISBN)).toEqual({ url: 'https://img.test/c.jpg' })
  })

  test.each([
    ['an empty body', ''],
    ['a JSON null body', 'null'],
  ])('returns null for %s', async (_, body) => {
    respondWith(body)
    expect(await coverImageByISBN(ISBN)).toBeNull()
  })
})

describe('findBookByKeyword', () => {
  test('requests the search backend with the keyword URI-encoded', async () => {
    const results = [
      { isbn: ISBN, title: 'Ada Twist, Scientist', thumbnail: 'https://img.test/t.jpg' },
    ]
    const fetch = respondWith(JSON.stringify(results))
    expect(await findBookByKeyword('Ada Twist, Scientist by Andrea Beaty')).toEqual(results)
    expect(requests(fetch)).toEqual([
      {
        method: 'GET',
        url: 'https://search.example.test/searchBook?keyword=Ada%20Twist%2C%20Scientist%20by%20Andrea%20Beaty',
      },
    ])
  })

  test('sends accented characters and ampersands percent-encoded as UTF-8', async () => {
    const fetch = respondWith('[]')
    expect(await findBookByKeyword('José & the Café')).toEqual([])
    expect(requests(fetch)).toEqual([
      {
        method: 'GET',
        url: 'https://search.example.test/searchBook?keyword=Jos%C3%A9%20%26%20the%20Caf%C3%A9',
      },
    ])
  })

  test.each([
    ['an empty string', ''],
    ['undefined', undefined],
    ['a number', 42],
  ])('returns null for %s without making a request', async (_, keyword) => {
    const fetch = respondWith('[]')
    expect(await findBookByKeyword(keyword)).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('isValidISBN', () => {
  test.each([
    ['1419721372', true],
    ['9781419721373', true],
    ['978-1-4197-2137-3', false],
    [9781419721373, false],
    ['', false],
    [undefined, false],
  ])('%j is %j', (isbn, valid) => {
    expect(isValidISBN(isbn)).toBe(valid)
  })
})
