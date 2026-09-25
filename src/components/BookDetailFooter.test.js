/**
 * BookDetailFooter: the "FIND BOOK AT" row of outbound links under a book's detail page.
 *
 * Dependency seams guarded:
 * - isbn3: the default-import interop (`import ISBN from 'isbn3'`) and what ISBN.asIsbn10 and
 * ISBN.asIsbn13 return for ISBN-13, hyphenated, ISBN-10, X check digit (upper and lower case),
 * 979-prefixed, ASIN and bad-checksum input. The Amazon link is built from the ISBN-10 and the
 * Bookshop link from the ISBN-13, each falling back to the raw value when isbn3 returns null.
 * - vue 3.5: v-if on the affiliate codes read from process.env in data(), attribute binding on the
 * anchors, and the computed hrefs recomputing when the book prop changes.
 * - @testing-library/jest-dom: toHaveAttribute, toContainElement, toBeInTheDocument.
 *
 * Nothing is mocked; the affiliate codes are stubbed with vi.stubEnv, so .env files do not leak in.
 */
import BookDetailFooter from '@/components/BookDetailFooter.vue'
import { render } from '@testing-library/vue'

const AMAZON_CODE = 'atw-20'
const BOOKSHOP_CODE = '12345'

/** Sets the affiliate codes that data() reads from process.env when the component is created. */
const stubAffiliateCodes = ({ amazon, bookshop, indiebound }) => {
  vi.stubEnv('VUE_APP_AMAZON_AFFILIATE_CODE', amazon)
  vi.stubEnv('VUE_APP_BOOKSHOP_AFFILIATE_CODE', bookshop)
  vi.stubEnv('VUE_APP_INDIEBOUND_AFFILIATE_CODE', indiebound)
}

/** Renders the footer for a book. */
const renderFooter = book => render(BookDetailFooter, { props: { book } })

/** The link whose accessible name is the given button label. */
const link = (screen, label) => screen.getByRole('link', { name: label })

/** Every link's href, in document order. */
const allHrefs = screen => screen.getAllByRole('link').map(a => a.getAttribute('href'))

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('with both affiliate codes set', () => {
  beforeEach(() => {
    stubAffiliateCodes({ amazon: AMAZON_CODE, bookshop: BOOKSHOP_CODE, indiebound: undefined })
  })

  test('renders library, Amazon, Bookshop and Goodreads links in that order', () => {
    const screen = renderFooter({ isbn: '9781250140913', goodreads: '36355234' })

    expect(allHrefs(screen)).toEqual([
      'https://worldcat.org/isbn/9781250140913',
      'https://amzn.com/dp/1250140919?tag=atw-20',
      'https://www.bookshop.org/a/12345/9781250140913',
      'https://www.goodreads.com/book/show/36355234',
    ])
    expect(link(screen, 'LOCAL LIBRARY')).toHaveAttribute(
      'href',
      'https://worldcat.org/isbn/9781250140913',
    )
    expect(link(screen, 'AMAZON')).toHaveAttribute(
      'href',
      'https://amzn.com/dp/1250140919?tag=atw-20',
    )
    expect(link(screen, 'BOOKSHOP')).toHaveAttribute(
      'href',
      'https://www.bookshop.org/a/12345/9781250140913',
    )
    expect(link(screen, 'GOODREADS')).toHaveAttribute(
      'href',
      'https://www.goodreads.com/book/show/36355234',
    )
  })

  test('opens every link in a new tab', () => {
    const screen = renderFooter({ isbn: '9781250140913', goodreads: '36355234' })

    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(4)
    links.forEach(anchor => expect(anchor).toHaveAttribute('target', '_blank'))
  })

  test('wraps each link label in a button, and leaves FIND BOOK AT as a button outside any link', () => {
    const screen = renderFooter({ isbn: '9781250140913', goodreads: '36355234' })

    const label = screen.getByRole('button', { name: 'FIND BOOK AT' })
    screen.getAllByRole('link').forEach(anchor => expect(anchor).not.toContainElement(label))
    ;['LOCAL LIBRARY', 'AMAZON', 'BOOKSHOP', 'GOODREADS'].forEach(name =>
      expect(link(screen, name)).toContainElement(screen.getByRole('button', { name })),
    )
  })

  test('omits the Goodreads link when the book has no goodreads id', () => {
    const screen = renderFooter({ isbn: '9781250140913' })

    expect(screen.queryByRole('link', { name: 'GOODREADS' })).not.toBeInTheDocument()
    expect(allHrefs(screen)).toEqual([
      'https://worldcat.org/isbn/9781250140913',
      'https://amzn.com/dp/1250140919?tag=atw-20',
      'https://www.bookshop.org/a/12345/9781250140913',
    ])
  })

  test.each([
    {
      desc: 'hyphenated ISBN-13 is normalized for Amazon and Bookshop but kept raw for WorldCat',
      isbn: '978-1-250-14091-3',
      library: 'https://worldcat.org/isbn/978-1-250-14091-3',
      amazon: 'https://amzn.com/dp/1250140919?tag=atw-20',
      bookshop: 'https://www.bookshop.org/a/12345/9781250140913',
    },
    {
      desc: 'ISBN-10 is converted to ISBN-13 for Bookshop',
      isbn: '1250140919',
      library: 'https://worldcat.org/isbn/1250140919',
      amazon: 'https://amzn.com/dp/1250140919?tag=atw-20',
      bookshop: 'https://www.bookshop.org/a/12345/9781250140913',
    },
    {
      desc: 'hyphenated ISBN-10 is stripped of hyphens for Amazon and Bookshop',
      isbn: '1-250-14091-9',
      library: 'https://worldcat.org/isbn/1-250-14091-9',
      amazon: 'https://amzn.com/dp/1250140919?tag=atw-20',
      bookshop: 'https://www.bookshop.org/a/12345/9781250140913',
    },
    {
      desc: 'ISBN-10 with an X check digit keeps the X for Amazon',
      isbn: '080442957X',
      library: 'https://worldcat.org/isbn/080442957X',
      amazon: 'https://amzn.com/dp/080442957X?tag=atw-20',
      bookshop: 'https://www.bookshop.org/a/12345/9780804429573',
    },
    {
      desc: 'lowercase x check digit is uppercased for Amazon',
      isbn: '080442957x',
      library: 'https://worldcat.org/isbn/080442957x',
      amazon: 'https://amzn.com/dp/080442957X?tag=atw-20',
      bookshop: 'https://www.bookshop.org/a/12345/9780804429573',
    },
    {
      desc: '979-prefixed ISBN-13 has no ISBN-10 form, so Amazon falls back to the raw value',
      isbn: '9798886450125',
      library: 'https://worldcat.org/isbn/9798886450125',
      amazon: 'https://amzn.com/dp/9798886450125?tag=atw-20',
      bookshop: 'https://www.bookshop.org/a/12345/9798886450125',
    },
    {
      desc: 'Amazon ASIN passes through raw to both links',
      isbn: 'B08XYZ1234',
      library: 'https://worldcat.org/isbn/B08XYZ1234',
      amazon: 'https://amzn.com/dp/B08XYZ1234?tag=atw-20',
      bookshop: 'https://www.bookshop.org/a/12345/B08XYZ1234',
    },
    {
      desc: 'ISBN-10 with a bad checksum falls back to the raw value in both links',
      isbn: '006440055X',
      library: 'https://worldcat.org/isbn/006440055X',
      amazon: 'https://amzn.com/dp/006440055X?tag=atw-20',
      bookshop: 'https://www.bookshop.org/a/12345/006440055X',
    },
  ])('$desc', ({ isbn, library, amazon, bookshop }) => {
    const screen = renderFooter({ isbn })

    expect(allHrefs(screen)).toEqual([library, amazon, bookshop])
  })

  test('recomputes the Amazon and Bookshop links when the book prop changes', async () => {
    const screen = renderFooter({ isbn: '9781250140913' })

    await screen.rerender({ book: { isbn: '080442957X', goodreads: '1' } })

    expect(allHrefs(screen)).toEqual([
      'https://worldcat.org/isbn/080442957X',
      'https://amzn.com/dp/080442957X?tag=atw-20',
      'https://www.bookshop.org/a/12345/9780804429573',
      'https://www.goodreads.com/book/show/1',
    ])
  })
})

describe('with affiliate codes unset', () => {
  beforeEach(() => {
    stubAffiliateCodes({ amazon: undefined, bookshop: undefined, indiebound: undefined })
  })

  test('renders only the library link and the label', () => {
    const screen = renderFooter({ isbn: '9781250140913' })

    expect(allHrefs(screen)).toEqual(['https://worldcat.org/isbn/9781250140913'])
    expect(screen.getByRole('button', { name: 'FIND BOOK AT' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'AMAZON' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'BOOKSHOP' })).not.toBeInTheDocument()
  })

  test('still renders the Goodreads link when the book has a goodreads id', () => {
    const screen = renderFooter({ isbn: '9781250140913', goodreads: '36355234' })

    const links = screen.getAllByRole('link')
    expect(links.map(a => a.getAttribute('href'))).toEqual([
      'https://worldcat.org/isbn/9781250140913',
      'https://www.goodreads.com/book/show/36355234',
    ])
    links.forEach(anchor => expect(anchor).toHaveAttribute('target', '_blank'))
  })

  test('renders only the Amazon link when only the Amazon code is set', () => {
    vi.stubEnv('VUE_APP_AMAZON_AFFILIATE_CODE', AMAZON_CODE)

    const screen = renderFooter({ isbn: '9781250140913' })

    expect(allHrefs(screen)).toEqual([
      'https://worldcat.org/isbn/9781250140913',
      'https://amzn.com/dp/1250140919?tag=atw-20',
    ])
  })

  test('renders only the Bookshop link when only the Bookshop code is set', () => {
    vi.stubEnv('VUE_APP_BOOKSHOP_AFFILIATE_CODE', BOOKSHOP_CODE)

    const screen = renderFooter({ isbn: '9781250140913' })

    expect(allHrefs(screen)).toEqual([
      'https://worldcat.org/isbn/9781250140913',
      'https://www.bookshop.org/a/12345/9781250140913',
    ])
  })

  test('renders no IndieBound link even when its affiliate code is set', () => {
    vi.stubEnv('VUE_APP_INDIEBOUND_AFFILIATE_CODE', 'indie-1')

    const screen = renderFooter({ isbn: '9781250140913' })

    expect(allHrefs(screen)).toEqual(['https://worldcat.org/isbn/9781250140913'])
    expect(screen.queryByText('INDIE BOOKSELLERS')).not.toBeInTheDocument()
  })
})
