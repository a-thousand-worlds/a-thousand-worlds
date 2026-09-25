/**
 * Contract tests for the data utilities the app calls in the shapes its own code uses them, so an
 * upgrade that changes one of them fails here and names the package.
 * - lodash: sortBy with dayjs and string iteratees and reverse (the sort of BooksManager,
 * PeopleManager and BundlesManager, SocialImage and SocialPeople, the creator order of BookDetail
 * and BookEdit, users/contributorOptions); set and get through src/util/get-set.js (collection
 * setOne, structuredData, user/save); pick (submissions/people approve, PeopleSubmissionForm);
 * omit (the BooksManager CSV rows); groupBy (submissions/books submit); capitalize (the role
 * options of ImpersonateHeader and Dashboard/Impersonate); debounce and throttle as Vue
 * options-API methods and watchers (Content and ReviewSubmissions save, validator revalidate,
 * BookSubmissionForm revalidate, the managers' search and sortConfig watchers, structuredData
 * updateHead).
 * - dayjs: the display formats of InvitationTable, the managers, BookEdit and PersonEdit, and how
 * it parses stored dates, including null and undefined.
 * - @json2csv/plainjs: the Parser behind the BooksManager CSV download.
 * - axios: the default instance on its browser (xhr) adapter, as findBookByKeyword,
 * coverImageByISBN, metadataByISBN and sendEmail call it.
 * Every test calls the real package. The only stubs are timers, the clock and XMLHttpRequest.
 */
import { defineComponent, h, nextTick } from 'vue'
import { render } from '@testing-library/vue'
import _ from 'lodash'
import sortBy from 'lodash/sortBy'
import reverse from 'lodash/reverse'
import pick from 'lodash/pick'
import groupBy from 'lodash/groupBy'
import debounce from 'lodash/debounce'
import throttle from 'lodash/throttle'
import dayjs from 'dayjs'
import { Parser } from '@json2csv/plainjs'
import axios from 'axios'
import { get, set } from '@/util/get-set'
import { allowedInvitees } from '@/rights'
import structuredData from '@/store/structuredData'

/** The CSV columns of BooksManager download, in order. */
const bookFields = [
  'isbn',
  'title',
  'authors',
  'illustrators',
  'tags',
  'year',
  'goodreads',
  'publisher',
  'summary',
  'createdAt',
  'createdBy',
  'id',
  'submissionId',
  'cover',
  'thumbnail',
  'reviewedAt',
  'reviewedBy',
  'updatedAt',
  'updatedBy',
  'status',
]

/** The managers' 'submitted' sort: by createdAt instant then titleLower, reversed for 'desc'. */
const sortSubmitted = (books, dir) => {
  const sorted = sortBy(books, [book => dayjs(book.createdAt), 'titleLower'])
  return dir === 'desc' ? reverse(sorted) : sorted
}

/** BooksManager's sortEmptyToEnd: a sort token that puts '' last in either direction. */
const sortEmptyToEnd = (s, dir) => `${dir === 'asc' && s === '' ? 1 : 0}-${s}`

/** Books in shuffled order with the stored createdAt formats found in live data. */
const managerBooks = () => [
  { title: 'D', titleLower: 'd', createdAt: '2021-01-01T00:00:00.000Z' },
  { title: 'E', titleLower: 'e' },
  { title: 'B', titleLower: 'b', createdAt: '2020-12-23T19:27:21-07:00' },
  { title: 'C', titleLower: 'c', createdAt: '2021-01-01T00:00:00.000Z' },
  { title: 'A', titleLower: 'a', createdAt: '2020-12-24T01:00:00.000Z' },
]

/** Pins Date to a local noon, the 'now' that dayjs(undefined) returns. */
const freezeClock = () => vi.setSystemTime(new Date(2026, 8, 24, 12))

/**
 * Renders an options-API component with the debounced and throttled method and watcher shapes the
 * app uses, built fresh so each test gets its own timers. Each method calls the returned spy with
 * `this.label` and its arguments; the debounced `q` watcher calls it with `this`, next and prev.
 */
const renderTimed = () => {
  const calls = vi.fn()
  let vm = null
  const Component = defineComponent({
    data: () => ({ label: 'c1', q: '' }),
    watch: {
      q: debounce(function (next, prev) {
        calls(this, next, prev)
      }, 200),
    },
    created() {
      vm = this
    },
    methods: {
      save: debounce(function (x) {
        calls(this.label, x)
      }, 500),
      revalidate: debounce(
        function (x) {
          calls(this.label, x)
        },
        500,
        { leading: true },
      ),
      revalidateThrottled: throttle(function (x) {
        calls(this.label, x)
      }, 500),
    },
    render: () => h('div'),
  })
  render(Component)
  return { vm, calls }
}

/** The text of each application/ld+json script in the document head. */
const ldJsonScripts = () =>
  // eslint-disable-next-line testing-library/no-node-access -- the head is outside Testing Library's queries
  [...document.head.querySelectorAll('script[type="application/ld+json"]')].map(
    script => script.textContent,
  )

/** Removes every application/ld+json script from the document head. */
const removeLdJsonScripts = () =>
  // eslint-disable-next-line testing-library/no-node-access -- the head is outside Testing Library's queries
  document.head.querySelectorAll('script[type="application/ld+json"]').forEach(el => el.remove())

/** What the fake XMLHttpRequest answers with, and the requests it has seen. */
const xhr = {
  requests: [],
  reply: { status: 200, body: '', contentType: 'application/json', networkError: false },
}

/** Sets the reply the next fake XMLHttpRequest gives. */
const replyWith = (body, { status = 200, contentType = 'application/json' } = {}) => {
  xhr.reply = { status, body, contentType, networkError: false }
}

/**
 * A stand-in XMLHttpRequest constructor that records what axios's xhr adapter does with it and
 * settles in a microtask from `xhr.reply`. The on* handlers are own properties initialized to null,
 * since axios chooses onloadend by `'onloadend' in request`.
 */
function FakeXHR() {
  const request = {
    onloadend: null,
    onerror: null,
    ontimeout: null,
    onabort: null,
    readyState: 0,
    status: 0,
    statusText: '',
    responseText: '',
    response: '',
    responseURL: '',
    opened: null,
    headers: [],
    sent: undefined,
    open(method, url, async) {
      request.opened = [method, url, async]
    },
    setRequestHeader(name, value) {
      request.headers = [...request.headers, [name, value]]
    },
    getAllResponseHeaders() {
      return `content-type: ${xhr.reply.contentType}\r\n`
    },
    send(body) {
      request.sent = body
      const reply = xhr.reply
      queueMicrotask(() => {
        request.readyState = 4
        if (reply.networkError) {
          request.onerror(new ProgressEvent('error'))
          return
        }
        request.status = reply.status
        request.responseText = reply.body
        request.response = reply.body
        request.onloadend()
      })
    },
    abort() {},
  }
  xhr.requests = [...xhr.requests, request]
  return request
}

/** Runs a request that is expected to reject and returns the error. */
const rejection = async promise => {
  try {
    await promise
  } catch (e) {
    return e
  }
  throw new Error('expected the request to reject')
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('lodash sortBy and reverse', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    freezeClock()
  })

  test('the manager sort orders mixed createdAt formats by instant, then titleLower', () => {
    const titles = sortSubmitted(managerBooks(), 'asc').map(book => book.title)
    expect(titles).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  test('the desc manager view is the asc order reversed, ties included', () => {
    const titles = sortSubmitted(managerBooks(), 'desc').map(book => book.title)
    expect(titles).toEqual(['E', 'D', 'C', 'B', 'A'])
  })

  test('reverse returns the array it was given, reversed in place', () => {
    const sorted = sortBy([{ n: 2 }, { n: 1 }, { n: 3 }], 'n')
    const reversed = reverse(sorted)
    expect(reversed).toBe(sorted)
    expect(sorted.map(x => x.n)).toEqual([3, 2, 1])
  })

  test('sortBy returns a new array and leaves the input untouched', () => {
    const books = managerBooks()
    const sorted = sortBy(books, 'titleLower')
    expect(sorted).not.toBe(books)
    expect(books.map(book => book.title)).toEqual(['D', 'E', 'B', 'C', 'A'])
  })

  test('sortEmptyToEnd tokens put an empty value last in both directions', () => {
    const books = [
      { title: 'X', titleLower: 'x', authors: 'Bea' },
      { title: 'Y', titleLower: 'y', authors: '' },
      { title: 'Z', titleLower: 'z', authors: 'Abe' },
    ]
    /** Sorts by authors token then titleLower, as BooksManager does for the authors column. */
    const sortAuthors = dir => {
      const sorted = sortBy(books, [book => sortEmptyToEnd(book.authors, dir), 'titleLower'])
      return (dir === 'desc' ? reverse(sorted) : sorted).map(book => book.title)
    }
    expect(sortAuthors('asc')).toEqual(['Z', 'X', 'Y'])
    expect(sortAuthors('desc')).toEqual(['X', 'Z', 'Y'])
  })

  test('SocialImage order: reverse(sortBy(list, createdAt)) puts a missing createdAt first', () => {
    const list = [
      { id: 'old', createdAt: '2020-01-02T00:00:00.000Z' },
      { id: 'none' },
      { id: 'new', createdAt: '2021-06-01T00:00:00.000Z' },
      { id: 'mid', createdAt: '2020-11-30T23:59:59.000Z' },
    ]
    expect(sortBy(list, 'createdAt').map(x => x.id)).toEqual(['old', 'mid', 'new', 'none'])
    expect(reverse(sortBy(list, 'createdAt')).map(x => x.id)).toEqual(['none', 'new', 'mid', 'old'])
  })

  test('creator ids sort by role name: author, author-illustrator, illustrator', () => {
    const creators = { p1: 'illustrator', p2: 'author', p3: 'author-illustrator' }
    expect(sortBy(['p1', 'p2', 'p3'], id => creators[id])).toEqual(['p2', 'p3', 'p1'])
  })

  test('sortBy on text compares case-sensitively by code unit', () => {
    const options = ['bob', 'Alice', 'alice (owner)', 'Émile', 'zed'].map(text => ({ text }))
    expect(sortBy(options, 'text').map(option => option.text)).toEqual([
      'Alice',
      'alice (owner)',
      'bob',
      'zed',
      'Émile',
    ])
  })

  test('sortBy is stable for equal keys', () => {
    const people = [
      { id: 1, name: 'Sam' },
      { id: 2, name: 'Ann' },
      { id: 3, name: 'Sam' },
      { id: 4, name: 'Ann' },
    ]
    expect(sortBy(people, 'name').map(person => person.id)).toEqual([2, 4, 1, 3])
  })
})

describe('lodash set and get through @/util/get-set', () => {
  test('set creates missing objects along a dotted path and returns the same root', () => {
    const data = {}
    const result = set(data, 'image.url', 'https://x')
    expect(result).toBe(data)
    expect(data).toEqual({ image: { url: 'https://x' } })
  })

  test('set accepts a chronouid key containing a hyphen as a single object key', () => {
    const state = { data: {} }
    set(state, 'data.e4fa3bb3fc84-af48df5', { id: 1 })
    expect(state).toEqual({ data: { 'e4fa3bb3fc84-af48df5': { id: 1 } } })
    expect(Array.isArray(state.data)).toBe(false)
  })

  test('set creates an array for a numeric path segment', () => {
    const data = {}
    set(data, 'a.0.b', 1)
    expect(data).toEqual({ a: [{ b: 1 }] })
    expect(Array.isArray(data.a)).toBe(true)
  })

  test('set mutates an existing nested object in place rather than copying it', () => {
    const profile = { name: 'Old', submissions: {} }
    const user = { uid: 'u1', profile }
    const userNew = { ...user }
    set(userNew, 'profile.name', 'New')
    expect(userNew.profile).toBe(profile)
    expect(profile).toEqual({ name: 'New', submissions: {} })
  })

  test('get reads slash and dot paths, including array indexes', () => {
    const o = { a: { b: [{ c: 5 }] } }
    expect(get(o, 'a/b/0/c')).toBe(5)
    expect(get(o, 'a.b[0].c')).toBe(5)
    expect(get(o, 'a.b.0.c')).toBe(5)
  })

  test('get returns the whole object for an empty or root path and undefined for a missing one', () => {
    const o = { a: 1 }
    expect(get(o, '/')).toBe(o)
    expect(get(o, '')).toBe(o)
    expect(get(o, undefined)).toBe(o)
    expect(get(o, 'x/y')).toBeUndefined()
    expect(get(undefined, 'x/y')).toBeUndefined()
  })

  test('the structuredData set mutation and get getter round-trip a path', () => {
    const state = { data: { image: { '@type': 'ImageObject' } } }
    structuredData.mutations.set(state, { path: 'image.url', value: 'https://x/cover.png' })
    expect(state.data).toEqual({ image: { '@type': 'ImageObject', url: 'https://x/cover.png' } })
    expect(structuredData.getters.get(state)('image/url')).toBe('https://x/cover.png')
    expect(structuredData.getters.get(state)('/')).toBe(state.data)
  })
})

describe('lodash pick, omit, groupBy and capitalize', () => {
  test('pick copies only the listed keys that exist', () => {
    expect(pick({ name: 'n', bio: 'b', extra: 1 }, ['name', 'bio', 'photo'])).toEqual({
      name: 'n',
      bio: 'b',
    })
  })

  test('pick keeps a key whose value is undefined, and returns {} for an undefined source', () => {
    expect(pick({ name: undefined, bio: 'b' }, ['name', 'photo'])).toEqual({ name: undefined })
    expect(Object.keys(pick({ name: undefined, bio: 'b' }, ['name', 'photo']))).toEqual(['name'])
    expect(pick(undefined, ['name', 'bio'])).toEqual({})
  })

  test('pick copies nested objects by reference', () => {
    const identities = { bipoc: true }
    const picked = pick({ identities }, ['identities'])
    expect(picked.identities).toBe(identities)
  })

  test('omit drops the named key and leaves the source untouched', () => {
    const book = { a: 1, creators: {} }
    expect(_.omit(book, 'creators')).toEqual({ a: 1 })
    expect(book).toEqual({ a: 1, creators: {} })
  })

  test('groupBy keys by the stringified value, with an absent value under "undefined"', () => {
    const subs = [
      { id: 1, createdBy: 'u1' },
      { id: 2, createdBy: 'u2' },
      { id: 3 },
      { id: 4, createdBy: 'u1' },
    ]
    const groups = groupBy(subs, 'createdBy')
    expect(Object.keys(groups)).toEqual(['u1', 'u2', 'undefined'])
    expect(groups.u1.map(sub => sub.id)).toEqual([1, 4])
    expect(groups.u2.map(sub => sub.id)).toEqual([2])
    expect(groups.undefined.map(sub => sub.id)).toEqual([3])
    expect(Object.entries(groups).map(([key]) => typeof key)).toEqual([
      'string',
      'string',
      'string',
    ])
  })

  test('capitalize uppercases the first letter and lowercases the rest', () => {
    expect(_.capitalize('owner')).toBe('Owner')
    expect(_.capitalize('ADVISOR')).toBe('Advisor')
    expect(_.capitalize('author-illustrator')).toBe('Author-illustrator')
    expect(_.capitalize('')).toBe('')
  })

  test('the impersonation role options are the invitee roles except owner, capitalized', () => {
    const roleOptions = Object.keys(allowedInvitees)
      .filter(role => role !== 'owner')
      .map(role => ({ id: role, text: _.capitalize(role) }))
    expect(roleOptions).toEqual([
      { id: 'user', text: 'User' },
      { id: 'contributor', text: 'Contributor' },
      { id: 'creator', text: 'Creator' },
      { id: 'advisor', text: 'Advisor' },
    ])
  })
})

describe('lodash debounce and throttle as Vue methods and watchers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  test('a debounced method runs once, 500 ms after the last call, bound to the instance', () => {
    const { vm, calls } = renderTimed()
    vm.save('a')
    vm.save('b')
    vi.advanceTimersByTime(499)
    expect(calls).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(calls.mock.calls).toEqual([['c1', 'b']])
    vi.advanceTimersByTime(1000)
    expect(calls).toHaveBeenCalledTimes(1)
  })

  test('a leading debounce runs the first call at once and a second one 500 ms after it', () => {
    const { vm, calls } = renderTimed()
    vm.revalidate('a')
    expect(calls.mock.calls).toEqual([['c1', 'a']])
    vi.advanceTimersByTime(100)
    vm.revalidate('b')
    vi.advanceTimersByTime(499)
    expect(calls).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(calls.mock.calls).toEqual([
      ['c1', 'a'],
      ['c1', 'b'],
    ])
  })

  test('a leading debounce called once does not run again on the trailing edge', () => {
    const { vm, calls } = renderTimed()
    vm.revalidate('a')
    vi.advanceTimersByTime(2000)
    expect(calls.mock.calls).toEqual([['c1', 'a']])
  })

  test('a throttled method runs at once, then once at 500 ms with the last arguments', () => {
    const { vm, calls } = renderTimed()
    vm.revalidateThrottled(0)
    vi.advanceTimersByTime(100)
    vm.revalidateThrottled(100)
    vi.advanceTimersByTime(100)
    vm.revalidateThrottled(200)
    expect(calls.mock.calls).toEqual([['c1', 0]])
    vi.advanceTimersByTime(299)
    expect(calls).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(calls.mock.calls).toEqual([
      ['c1', 0],
      ['c1', 200],
    ])
    vi.advanceTimersByTime(1000)
    expect(calls).toHaveBeenCalledTimes(2)
  })

  test('a debounced watcher runs once with the last (next, prev), bound to the instance', async () => {
    const { vm, calls } = renderTimed()
    vm.q = 'a'
    await nextTick()
    vm.q = 'ab'
    await nextTick()
    vm.q = 'abc'
    await nextTick()
    vi.advanceTimersByTime(199)
    expect(calls).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(calls).toHaveBeenCalledTimes(1)
    const [self, next, prev] = calls.mock.calls[0]
    expect(self).toBe(vm)
    expect([next, prev]).toEqual(['abc', 'ab'])
  })

  test('debounce(fn, 0) collapses synchronous calls into one call with the last arguments', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 0)
    debounced(1)
    debounced(2)
    debounced(3)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(0)
    expect(fn.mock.calls).toEqual([[3]])
  })

  test('structuredData updateHead writes one ld+json script from the last call', () => {
    removeLdJsonScripts()
    structuredData.actions.updateHead({ state: { data: { n: 1 } } })
    structuredData.actions.updateHead({ state: { data: { n: 2 } } })
    structuredData.actions.updateHead({ state: { data: { n: 3, name: 'Hair Love' } } })
    expect(ldJsonScripts()).toEqual([])
    vi.advanceTimersByTime(0)
    const scripts = ldJsonScripts()
    expect(scripts).toHaveLength(1)
    expect(JSON.parse(scripts[0])).toEqual({ n: 3, name: 'Hair Love' })
    removeLdJsonScripts()
  })
})

describe('dayjs', () => {
  test('formats a local date as InvitationTable does', () => {
    expect(dayjs('2021-03-05T09:07:00').format('MMMM DD, YYYY')).toBe('March 05, 2021')
  })

  test('formats a local date as the managers and BookEdit do', () => {
    expect(dayjs('2021-03-05T09:07:00').format('M/D/YYYY hh:mm')).toBe('3/5/2021 09:07')
  })

  test('formats a local date as BookEdit and PersonEdit do', () => {
    expect(dayjs('2021-03-05T09:07:00').format('M/D/YYYY')).toBe('3/5/2021')
    expect(dayjs('2021-12-25T00:00:00').format('M/D/YYYY')).toBe('12/25/2021')
  })

  test('parses a stored offset or Z timestamp as an absolute instant', () => {
    expect(dayjs('2020-12-23T19:27:21-07:00').valueOf()).toBe(Date.UTC(2020, 11, 24, 2, 27, 21))
    expect(dayjs('2021-03-05T09:07:00.000Z').valueOf()).toBe(Date.UTC(2021, 2, 5, 9, 7))
  })

  test('parses a timezone-free string as local time', () => {
    expect(dayjs('2021-03-05T09:07:00').valueOf()).toBe(new Date(2021, 2, 5, 9, 7).valueOf())
  })

  test('dayjs objects compare by instant with < and >', () => {
    const earlier = dayjs('2020-12-24T01:00:00.000Z')
    const later = dayjs('2020-12-23T19:27:21-07:00')
    expect(earlier < later).toBe(true)
    expect(later > earlier).toBe(true)
    expect(+later - +earlier).toBe(87 * 60 * 1000 + 21 * 1000)
  })

  test('null and unparseable strings are invalid and format as "Invalid Date"', () => {
    expect(dayjs(null).isValid()).toBe(false)
    expect(dayjs(null).format('M/D/YYYY')).toBe('Invalid Date')
    expect(dayjs('not a date').isValid()).toBe(false)
    expect(dayjs('not a date').format('MMMM DD, YYYY')).toBe('Invalid Date')
  })

  test('undefined is the current time, so a record missing createdAt shows today', () => {
    vi.useFakeTimers()
    freezeClock()
    expect(dayjs(undefined).isValid()).toBe(true)
    expect(dayjs(undefined).format('M/D/YYYY')).toBe('9/24/2026')
    expect(dayjs(undefined).valueOf()).toBe(new Date(2026, 8, 24, 12).valueOf())
  })
})

describe('@json2csv/plainjs', () => {
  test('Parser quotes text, leaves numbers bare, stringifies objects and keeps only the fields', () => {
    const rows = [
      {
        isbn: '9781250140913',
        title: 'My Mommy Medicine',
        authors: 'Chrissy Teigen, Jane Doe',
        illustrators: 'Juana Martinez-Neal',
        tags: 'Picture book, Fantasy/Fable',
        year: 2020,
        summary: '<p>Line "one"</p>\n<p>two</p>',
        createdAt: '2021-03-05T09:07:00.000Z',
        id: 'b1',
        cover: { url: 'https://x/y.png', width: 100 },
        status: 'approved',
        titleLower: 'my mommy medicine',
      },
      {
        isbn: '0062498533',
        title: "Don't Touch My Hair!",
        year: null,
        goodreads: undefined,
        publisher: 'Little, Brown',
      },
    ]
    const csv = new Parser({ fields: bookFields }).parse(rows)
    const header = bookFields.map(field => `"${field}"`).join(',')
    expect(csv).toBe(
      [
        header,
        '"9781250140913","My Mommy Medicine","Chrissy Teigen, Jane Doe","Juana Martinez-Neal",' +
          '"Picture book, Fantasy/Fable",2020,,,"<p>Line ""one""</p>\n<p>two</p>",' +
          '"2021-03-05T09:07:00.000Z",,"b1",,"{""url"":""https://x/y.png"",""width"":100}",' +
          ',,,,,"approved"',
        '"0062498533","Don\'t Touch My Hair!",,,,,,"Little, Brown",,,,,,,,,,,,',
      ].join('\n'),
    )
  })

  test('an empty list gives the header only', () => {
    expect(new Parser({ fields: ['a', 'b'] }).parse([])).toBe('"a","b"')
  })

  test('formula-like strings pass through unescaped; false is bare and "" is quoted', () => {
    const csv = new Parser({ fields: ['a', 'b'] }).parse([
      { a: '=SUM(1)', b: 0 },
      { a: false, b: '' },
    ])
    expect(csv).toBe('"a","b"\n"=SUM(1)",0\nfalse,""')
  })

  test('without fields, the columns are the union of keys in first-seen order', () => {
    const csv = new Parser().parse([
      { a: 1, b: 2 },
      { a: 3, c: 4 },
    ])
    expect(csv).toBe('"a","b","c"\n1,2,\n3,,4')
  })
})

describe('axios on the browser (xhr) adapter', () => {
  beforeEach(() => {
    xhr.requests = []
    replyWith('')
    vi.stubGlobal('XMLHttpRequest', FakeXHR)
  })

  test('the default adapter list puts xhr first and the only common header is Accept', () => {
    expect(axios.defaults.adapter).toEqual(['xhr', 'http', 'fetch'])
    expect(axios.getAdapter(axios.defaults.adapter).adapterName).toBe('xhr')
    expect({ ...axios.defaults.headers.common }).toEqual({
      Accept: 'application/json, text/plain, */*',
    })
  })

  test('a GET opens the exact URL asynchronously, sends only Accept, and parses JSON', async () => {
    const url = 'https://search.example.test/find?keyword=Hair%20Love'
    replyWith('{"title":"Sulwe"}')
    const res = await axios.get(url)
    expect(xhr.requests).toHaveLength(1)
    const [request] = xhr.requests
    expect(request.opened).toEqual(['GET', url, true])
    expect(request.headers).toEqual([['Accept', 'application/json, text/plain, */*']])
    expect(request.sent).toBeNull()
    expect(res.status).toBe(200)
    expect(res.data).toEqual({ title: 'Sulwe' })
    expect(res.request).toBe(request)
  })

  test('an Authorization header of "Bearer " is sent untrimmed', async () => {
    replyWith('{}')
    await axios.get('https://mail.example.test/send?to=a', {
      headers: { Authorization: 'Bearer ' },
    })
    expect(xhr.requests[0].headers).toEqual([
      ['Accept', 'application/json, text/plain, */*'],
      ['Authorization', 'Bearer '],
    ])
  })

  test.each([
    ['an empty body', '', 'application/json', ''],
    ['"null"', 'null', 'application/json', null],
    ['plain text', 'OK', 'text/plain', 'OK'],
    ['malformed JSON', '{bad json', 'application/json', '{bad json'],
    ['a JSON array in text/plain', '[1,2]', 'text/plain', [1, 2]],
  ])('the response data for %s', async (label, body, contentType, expected) => {
    replyWith(body, { contentType })
    const res = await axios.get('https://covers.example.test/?isbn=9781419721373')
    expect(res.data).toEqual(expected)
  })

  test('a 500 rejects with ERR_BAD_RESPONSE and the parsed body on e.response', async () => {
    replyWith('{"error":"boom"}', { status: 500 })
    const e = await rejection(axios.get('https://metadata.example.test/?isbn=1'))
    expect(axios.isAxiosError(e)).toBe(true)
    expect(e.message).toBe('Request failed with status code 500')
    expect(e.code).toBe('ERR_BAD_RESPONSE')
    expect(e.response.status).toBe(500)
    expect(e.response.data).toEqual({ error: 'boom' })
  })

  test('a 404 rejects with ERR_BAD_REQUEST', async () => {
    replyWith('Not Found', { status: 404, contentType: 'text/plain' })
    const e = await rejection(axios.get('https://metadata.example.test/?isbn=1'))
    expect(e.message).toBe('Request failed with status code 404')
    expect(e.code).toBe('ERR_BAD_REQUEST')
    expect(e.response.data).toBe('Not Found')
  })

  test('a network error rejects with the "Network Error" message sendEmail matches on', async () => {
    xhr.reply = { ...xhr.reply, networkError: true }
    const e = await rejection(axios.get('https://mail.example.test/send?to=a'))
    expect(axios.isAxiosError(e)).toBe(true)
    expect(e.message).toBe('Network Error')
    expect(e.code).toBe('ERR_NETWORK')
    expect(e.response).toBeUndefined()
    expect(/^Network Error/i.test(e.message)).toBe(true)
  })
})
