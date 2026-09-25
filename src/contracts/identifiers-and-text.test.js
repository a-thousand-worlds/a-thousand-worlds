/**
 * Contract tests for the small packages that turn identifiers and text into what the app compares,
 * links to and stores. isbn3 (asIsbn10, asIsbn13) builds the Amazon and Bookshop links in
 * BookDetailFooter.vue and the duplicate-book check in BookSubmissionForm.vue getBooks. uuid (v4)
 * supplies the random suffix of src/util/chronouid.js, whose formatting chronouid.test.js owns.
 * diacritics (remove) backs almostEqual.js, the search predicates in BooksManager, PeopleManager
 * and BundlesManager, and the match offset HighlightedText.vue slices the displayed value with.
 * email-validator (validate) decides which invite recipients parseRecipient.js accepts.
 * cute-animals (default export) generates the invite codes in src/store/invites.js createAndSend,
 * which become the invites/<code> Firebase key and the ?code= in the signup link.
 * Each test calls the real package, so a failure points at the package rather than at app code.
 * The only stub is Math.random, to make cute-animals deterministic.
 */
import { render } from '@testing-library/vue'
import ISBN from 'isbn3'
import { v4, validate as validateUuid, version as uuidVersion } from 'uuid'
import { remove as diacritics } from 'diacritics'
import { validate as validateEmail } from 'email-validator'
import animal from 'cute-animals'
import * as animalNamespace from 'cute-animals'
import HighlightedText from '@/components/HighlightedText'

/** BookDetailFooter's isbn10 computed: the Amazon id, falling back to the raw value (an ASIN). */
const amazonId = isbn => ISBN.asIsbn10(isbn || '') || isbn

/** BookDetailFooter's isbn13 computed: the Bookshop id, falling back to the raw value. */
const bookshopId = isbn => ISBN.asIsbn13(isbn || '') || isbn

/** The isbn3 clause of BookSubmissionForm getBooks: both ISBNs convert to the same ISBN-10. */
const sameIsbn10 = (a, b) =>
  !!ISBN.asIsbn10(a || '') && ISBN.asIsbn10(a || '') === ISBN.asIsbn10(b || '')

/** The whole BookSubmissionForm getBooks predicate: an exact match, or the same ISBN-10. */
const isDuplicate = (bookIsbn, isbn) => bookIsbn === isbn || sameIsbn10(bookIsbn, isbn)

/** The isMatch method of BooksManager and PeopleManager, which BundlesManager inlines. */
const isMatch = (value, search) =>
  diacritics(value.trim()).toLowerCase().includes(diacritics(search.trim()).toLowerCase())

/** The invite code expression from src/store/invites.js createAndSend. */
const inviteCode = () => animal('adj adj animal').replace(/ /g, '-')

/** Makes Math.random return each of the given values in turn, then the last one forever. */
const randomSequence = values => {
  let i = 0
  vi.spyOn(Math, 'random').mockImplementation(() => values[Math.min(i++, values.length - 1)])
}

/** Renders HighlightedText around a value, as BooksManager does for each searchable field. */
const renderHighlighted = (value, search, field) =>
  render(HighlightedText, { props: { search, field }, slots: { default: value } })

describe('isbn3', () => {
  test('exports asIsbn10 and asIsbn13 as functions on the default export', () => {
    expect(typeof ISBN).toBe('object')
    expect(typeof ISBN.asIsbn10).toBe('function')
    expect(typeof ISBN.asIsbn13).toBe('function')
    expect(typeof ISBN.parse).toBe('function')
    expect(typeof ISBN.hyphenate).toBe('function')
  })

  test.each([
    // [input, asIsbn10, asIsbn13]
    ['9781250140913', '1250140919', '9781250140913'],
    ['1250140919', '1250140919', '9781250140913'],
    ['978-1-250-14091-3', '1250140919', '9781250140913'],
    ['1-250-14091-9', '1250140919', '9781250140913'],
    ['978-1250140913', '1250140919', '9781250140913'],
    ['978 1 250 14091 3', '1250140919', '9781250140913'],
    ['9780062498533', '0062498533', '9780062498533'],
    ['0062498533', '0062498533', '9780062498533'],
  ])('converts %j to ISBN-10 %j and ISBN-13 %j', (input, isbn10, isbn13) => {
    expect(ISBN.asIsbn10(input)).toBe(isbn10)
    expect(ISBN.asIsbn13(input)).toBe(isbn13)
  })

  test('keeps the leading zero of an ISBN-10 as a string', () => {
    expect(ISBN.asIsbn10('9780062498533')).toBe('0062498533')
  })

  test.each([
    ['080442957x', '080442957X', '9780804429573'],
    ['0-8044-2957-X', '080442957X', '9780804429573'],
    ['9780804429573', '080442957X', '9780804429573'],
  ])('handles the X check digit in %j, uppercasing it', (input, isbn10, isbn13) => {
    expect(ISBN.asIsbn10(input)).toBe(isbn10)
    expect(ISBN.asIsbn13(input)).toBe(isbn13)
  })

  test('has no ISBN-10 for a 979-prefix ISBN-13', () => {
    expect(ISBN.asIsbn10('9791090636071')).toBe(null)
    expect(ISBN.asIsbn13('9791090636071')).toBe('9791090636071')
  })

  test.each([
    ['empty string', ''],
    ['an Amazon ASIN', 'B07ABCDE12'],
    ['an ISBN-13 with a bad checksum', '9781250140914'],
    ['an ISBN-10 with a bad checksum', '1250140910'],
    ['an "ISBN " prefix', 'ISBN 9781250140913'],
    ['an "isbn:" prefix', 'isbn:9781250140913'],
    ['null', null],
    ['undefined', undefined],
  ])('returns null without throwing for %s', (label, input) => {
    expect(ISBN.asIsbn10(input)).toBe(null)
    expect(ISBN.asIsbn13(input)).toBe(null)
  })

  test('tolerates surrounding whitespace', () => {
    expect(ISBN.asIsbn10(' 9781250140913')).toBe('1250140919')
    expect(ISBN.asIsbn10('9781250140913 ')).toBe('1250140919')
    expect(ISBN.asIsbn13(' 1250140919 ')).toBe('9781250140913')
  })

  test('returns unhyphenated values unless asked to hyphenate', () => {
    expect(ISBN.asIsbn10('9781250140913', true)).toBe('1-250-14091-9')
    expect(ISBN.asIsbn13('1250140919', true)).toBe('978-1-250-14091-3')
  })

  describe('BookDetailFooter store ids', () => {
    test.each([
      ['9781250140913', '1250140919'],
      ['1250140919', '1250140919'],
      ['978-1-250-14091-3', '1250140919'],
      // no ISBN-10 exists, so the link uses the raw ISBN-13
      ['9791090636071', '9791090636071'],
      // a contributor entered an Amazon ASIN instead of an ISBN
      ['B07ABCDE12', 'B07ABCDE12'],
      ['', ''],
      [undefined, undefined],
    ])('links Amazon for %j to %j', (isbn, expected) => {
      expect(amazonId(isbn)).toBe(expected)
    })

    test.each([
      ['1250140919', '9781250140913'],
      ['9781250140913', '9781250140913'],
      ['9791090636071', '9791090636071'],
      ['B07ABCDE12', 'B07ABCDE12'],
    ])('links Bookshop for %j to %j', (isbn, expected) => {
      expect(bookshopId(isbn)).toBe(expected)
    })
  })

  describe('BookSubmissionForm duplicate check', () => {
    test('matches the same book entered as an ISBN-13 and a hyphenated ISBN-10', () => {
      expect(sameIsbn10('9780062498533', '0-06-249853-3')).toBe(true)
      expect(isDuplicate('9780062498533', '0-06-249853-3')).toBe(true)
    })

    test('does not match different books', () => {
      expect(sameIsbn10('9781250140913', '9780062498533')).toBe(false)
      expect(isDuplicate('9781250140913', '9780062498533')).toBe(false)
    })

    test('does not match two empty ISBNs through isbn3', () => {
      expect(sameIsbn10('', '')).toBe(false)
      expect(sameIsbn10(undefined, null)).toBe(false)
      expect(sameIsbn10('B07ABCDE12', 'B07ABCDE12')).toBe(false)
    })

    test('matches a 979-prefix ISBN only through exact equality', () => {
      expect(sameIsbn10('9791090636071', '9791090636071')).toBe(false)
      expect(isDuplicate('9791090636071', '9791090636071')).toBe(true)
      expect(isDuplicate('9791090636071', '979-1-09-063607-1')).toBe(false)
    })
  })
})

describe('uuid', () => {
  const v4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  test('exports v4, validate and version as functions', () => {
    expect(typeof v4).toBe('function')
    expect(typeof validateUuid).toBe('function')
    expect(typeof uuidVersion).toBe('function')
  })

  test('v4 returns a lowercase RFC 4122 version 4 string', () => {
    const id = v4()
    expect(typeof id).toBe('string')
    expect(id).toHaveLength(36)
    expect(id).toMatch(v4Pattern)
    expect(validateUuid(id)).toBe(true)
    expect(uuidVersion(id)).toBe(4)
  })

  test('v4 returns a different value on each call', () => {
    const ids = Array.from({ length: 20 }, () => v4())
    expect(new Set(ids).size).toBe(20)
  })

  test('the first seven characters, the chronouid suffix, are lowercase hex', () => {
    expect(v4().slice(0, 7)).toMatch(/^[0-9a-f]{7}$/)
  })
})

describe('diacritics', () => {
  test('exports remove as a function', () => {
    expect(typeof diacritics).toBe('function')
  })

  test.each([
    ['Zoë Ruiz-Belén', 'Zoe Ruiz-Belen'],
    ['Juana Martínez-Neal', 'Juana Martinez-Neal'],
    ['Matt de la Peña', 'Matt de la Pena'],
    ['Nguyễn', 'Nguyen'],
    ['Łódź', 'Lodz'],
    ['Đorđe', 'Dorde'],
    ['São Paulo', 'Sao Paulo'],
    ['Çelik', 'Celik'],
    ['İstanbul', 'Istanbul'],
  ])('removes the accents from %j', (input, expected) => {
    expect(diacritics(input)).toBe(expected)
  })

  test.each([['鲁迅'], ['Привет'], ['A Thousand Worlds'], ['']])('leaves %j unchanged', input => {
    expect(diacritics(input)).toBe(input)
  })

  test.each([['Zoë'], ['Belén'], ['Martínez'], ['Nguyễn'], ['Matt de la Peña']])(
    'keeps the length of %j, which HighlightedText slices by',
    input => {
      expect(diacritics(input)).toHaveLength(input.length)
    },
  )

  test.each([
    ['Æsop', 'AEsop'],
    ['Straße', 'Strasse'],
    ['Œuvre', 'OEuvre'],
    ['Guðmundsdóttir', 'Gudhmundsdottir'],
    ['Þór', 'Thor'],
  ])('expands %j to %j, changing its length', (input, expected) => {
    expect(diacritics(input)).toBe(expected)
    expect(diacritics(input).length).toBeGreaterThan(input.length)
  })

  test('leaves a decomposed accent (e + combining acute) unchanged', () => {
    const decomposed = 'é'
    expect(decomposed).toHaveLength(2)
    expect(diacritics(decomposed)).toBe(decomposed)
  })

  describe('manager search predicate', () => {
    test.each([
      ['Matt de la Peña', 'pena', true],
      ['Matt de la Peña', ' PEÑA ', true],
      ['Matt de la Pena', 'peña', true],
      [' Zoë Ruiz-Belén ', 'zoe ruiz', true],
      ['Zoë Ruiz-Belén', 'ruiz-belen', true],
      // the hyphen is kept, so a space does not match it
      ['Zoë Ruiz-Belén', 'ruiz belen', false],
      ['Juana Martínez-Neal', 'martinez', true],
      ['Juana Martínez-Neal', 'martin ez', false],
    ])('matches %j against %j: %s', (value, search, expected) => {
      expect(isMatch(value, search)).toBe(expected)
    })
  })

  describe('HighlightedText', () => {
    test('highlights the original accented text for an unaccented search', () => {
      const { getByText } = renderHighlighted('Matt de la Peña', 'pena', 'author')
      expect(getByText('Peña')).toHaveClass('bg-primary')
      expect(getByText('Matt de la')).not.toHaveClass('bg-primary')
    })

    test('highlights unaccented text for an accented search', () => {
      const { getByText } = renderHighlighted('Zoe Ruiz-Belen', 'BELÉN', 'author')
      expect(getByText('Belen')).toHaveClass('bg-primary')
    })

    test('highlights the middle of a value whose accents precede the match', () => {
      const { getByText } = renderHighlighted('Juana Martínez-Neal', 'nez', 'author')
      expect(getByText('nez')).toHaveClass('bg-primary')
    })

    test('renders the value without a highlight when the search does not match', () => {
      const { getByText, queryByText } = renderHighlighted('Zoë Ruiz-Belén', 'ruiz belen', 'author')
      expect(getByText('Zoë Ruiz-Belén')).not.toHaveClass('bg-primary')
      expect(queryByText('Belén')).not.toBeInTheDocument()
    })
  })
})

describe('email-validator', () => {
  test.each([
    'luke@rebelalliance.org',
    'a.b+c@sub.example.co.uk',
    'first.last@example.com',
    'a@b.co',
    // a 64-character local part is the longest accepted
    `${'a'.repeat(64)}@example.com`,
  ])('accepts %j', email => {
    expect(validateEmail(email)).toBe(true)
  })

  test.each([
    ['no @', 'no-at-sign'],
    ['two @', 'two@@example.com'],
    ['a trailing dot', 'trailing@example.'],
    ['a space', 'space in@example.com'],
    ['no TLD', 'x@y'],
    ['a one-letter TLD', 'a@b.c'],
    ['a quoted local part', '"quoted"@example.com'],
    ['a non-ASCII local part', 'ünïcode@example.com'],
    ['a leading dot', '.leading@example.com'],
    ['consecutive dots', 'dou..ble@example.com'],
    ['a hyphen starting the domain', 'a@-example.com'],
    ['a 65-character local part', `${'a'.repeat(65)}@example.com`],
    ['a bracketed address', '<luke@rebelalliance.org>'],
    ['empty string', ''],
  ])('rejects %s', (label, email) => {
    expect(validateEmail(email)).toBe(false)
  })

  test('returns false rather than throwing for null and undefined', () => {
    expect(validateEmail(null)).toBe(false)
    expect(validateEmail(undefined)).toBe(false)
  })
})

describe('cute-animals', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('the default import is callable, and the namespace exposes it as default', () => {
    expect(typeof animal).toBe('function')
    expect(typeof animalNamespace.default).toBe('function')
    expect(animalNamespace.default).toBe(animal)
  })

  test('picks the first adjective and animal when Math.random returns 0', () => {
    randomSequence([0])
    expect(animal('adj adj animal')).toBe('adorable adorable aardvark')
  })

  test('picks the last adjective and animal when Math.random is just below 1', () => {
    randomSequence([0.9999])
    expect(animal('adj adj animal')).toBe('zany zany zebra')
  })

  test('draws one Math.random value per word, in order', () => {
    randomSequence([0, 0.5, 0.36574074074074076])
    expect(animal('adj adj animal')).toBe('adorable graceful great blue heron')
    expect(Math.random).toHaveBeenCalledTimes(3)
  })

  test('turns a multi-word animal into an invite code longer than three words', () => {
    randomSequence([0, 0.5, 0.36574074074074076])
    expect(inviteCode()).toBe('adorable-graceful-great-blue-heron')
  })

  test('builds invite codes from lowercase letters and hyphens only', () => {
    // sweep each slot across [0, 1) finely enough to reach every corpus entry
    const steps = Array.from({ length: 1000 }, (_, i) => i / 1000)
    const codes = steps.map(r => {
      randomSequence([r, 1 - r - 0.0005, r])
      const code = inviteCode()
      vi.restoreAllMocks()
      return code
    })
    const invalid = codes.filter(code => !/^[a-z]+(-[a-z]+){2,}$/.test(code))
    expect(invalid).toEqual([])
  })
})
