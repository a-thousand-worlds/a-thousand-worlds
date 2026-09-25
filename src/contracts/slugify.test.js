/*
 * Contract tests for @sindresorhus/slugify, the package that turns titles, names and tag names into
 * the slugs the app routes on and stores. Dependency seams guarded:
 *
 * - book slugs, slugify(title.replace(/'/g, '')), in BookDetailLink.vue and renderEmailBook.js.
 * - person slugs, slugify(name), for the /person/:name route (PersonDetailLink, renderPerson), the
 *   route-param lookups in PersonDetail, PersonEdit and CreatorsWidget, and the users/<slug>
 *   Firebase key written by users/saveContributor.
 * - tag slugs, slugify(tag.tag), in the ?filters= query written by Tag.goToFilter and
 *   filterable/updateUrl and matched back by filterable/setFiltersFromUrl.
 *
 * A slug that changes breaks every shared link and orphans every users/<slug> record, so each row
 * pins an exact output. These call the real package directly, with no store, router or mocks, so a
 * failure here points at the package rather than at app code. Titles and names marked "live" come
 * from the production directory by way of the local dbcache snapshot, and the tag names were read
 * from live tags/books and tags/people on 2026-09-24.
 */
import slugify from '@sindresorhus/slugify'

/** The app's book-slug expression, from BookDetailLink.vue:26 and renderEmailBook.js:5. */
const bookSlug = title => slugify(title.replace(/'/g, ''))

/** The shape of every non-empty slug: lowercase ASCII words joined by single hyphens. */
const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** U+2019, built from its code point so no editor can normalize it to a straight quote. */
const curlyApostrophe = String.fromCodePoint(0x2019)

/** Book titles and the slug the app builds from them with bookSlug. */
const bookSlugs = [
  // the example in the src/router.js comment
  ['My Mommy Medicine', 'my-mommy-medicine'],
  ["Don't Touch My Hair!", 'dont-touch-my-hair'],
  ["Kamala and Maya's Big Idea", 'kamala-and-mayas-big-idea'],
  ["Where's Rodney?", 'wheres-rodney'],
  ["¡Vamos! Let's Go to the Market", 'vamos-lets-go-to-the-market'],
  ['Fry Bread: A Native American Family Story', 'fry-bread-a-native-american-family-story'],
  ['Thank You, Omu!', 'thank-you-omu'],
  ['1, 2, 3 ¡Ya!', '1-2-3-ya'],
  ['Me & Mama', 'me-and-mama'],
  ['100% Me', '100-me'],
  ['Emoji 🎉 Party', 'emoji-party'],
  // live
  ["Mufaro's Beautiful Daughters", 'mufaros-beautiful-daughters'],
  ['Chirri & Chirra, Under the Sea', 'chirri-and-chirra-under-the-sea'],
  ['Red, Yellow, Blue (and a Dash of White, Too!)', 'red-yellow-blue-and-a-dash-of-white-too'],
  ['I AM AN AMERICAN: The Wong Kim Ark Story', 'i-am-an-american-the-wong-kim-ark-story'],
  ['The 1619 Project: Born on the water', 'the-1619-project-born-on-the-water'],
  ['Lucía the Luchadora', 'lucia-the-luchadora'],
  // live: stripping the apostrophe leaves "YAll", which decamelize splits back apart
  ["Boogie Boogie, Y'All", 'boogie-boogie-y-all'],
]

/** Person names and their slug: the route param, the lookup key, and the users/<slug> key. */
const personSlugs = [
  ['Juana Martínez-Neal', 'juana-martinez-neal'],
  ['Matt de la Peña', 'matt-de-la-pena'],
  ['Rafael López', 'rafael-lopez'],
  ['Mélina Mangal', 'melina-mangal'],
  ['Mượn Thị Văn', 'muon-thi-van'],
  ['Mahogany L. Browne', 'mahogany-l-browne'],
  ['A.J. Jones', 'a-j-jones'],
  ['S. K. Ali', 's-k-ali'],
  ["O'Neal", 'o-neal'],
  ['Zoë Ruiz-Belén', 'zoe-ruiz-belen'],
  ['Björk Guðmundsdóttir', 'bjoerk-gudmundsdottir'],
  ['Müller', 'mueller'],
  ['Straße', 'strasse'],
  ['Łódź', 'lodz'],
  ['Đorđe', 'dorde'],
  ['ÆØÅ', 'aeoa'],
  ['Привет', 'privet'],
  ['Lu Xun 鲁迅', 'lu-xun'],
  ['  Leading and trailing  ', 'leading-and-trailing'],
  // live
  ['LeUyen Pham', 'le-uyen-pham'],
  ["Lupita Nyong'o", 'lupita-nyong-o'],
  ["Gaby D'Alessandro", 'gaby-d-alessandro'],
  ['Minh Lê', 'minh-le'],
  ['Edouard Duval-Carrié', 'edouard-duval-carrie'],
  ['Pam Muñoz Ryan', 'pam-munoz-ryan'],
  ['Yamile Saied Méndez', 'yamile-saied-mendez'],
  ['Xelena González', 'xelena-gonzalez'],
  ['Estelí Meza', 'esteli-meza'],
]

/** Tag names from live tags/books and tags/people, plus a people special filter, and their slug. */
const tagSlugs = [
  ['Picture book', 'picture-book'],
  ['Fantasy/Fable', 'fantasy-fable'],
  ['LGBTQIA+', 'lgbtqia'],
  // stored with the trailing space
  ['Trans ', 'trans'],
  ['Arab/Middle Eastern/North African', 'arab-middle-eastern-north-african'],
  ['Native Hawaiian/Pacific Islander', 'native-hawaiian-pacific-islander'],
  ['Grief/loss/transition', 'grief-loss-transition'],
  ['Socio-emotional', 'socio-emotional'],
  ['Gender Non-Conforming', 'gender-non-conforming'],
  ['Biracial/Multiracial', 'biracial-multiracial'],
  // the creatorTitles text behind the people special filter with id 'author-illustrator'
  ['Author/Illustrator', 'author-illustrator'],
]

/** Symbol, separator and casing rules, independent of any one record. */
const ruleSlugs = [
  // the three built-in replacements
  ['Rock & Roll', 'rock-and-roll'],
  ['I ♥ NY', 'i-love-ny'],
  ['🦄', 'unicorn'],
  // decamelize is on by default
  ['ABCs of Black History', 'ab-cs-of-black-history'],
  ['CamelCaseTitle', 'camel-case-title'],
  ['HTMLParser', 'html-parser'],
  ['BOOKS2Read', 'books-2-read'],
  // runs of separators collapse, and leading or trailing ones are trimmed
  ['--a--b--', 'a-b'],
  ['_leading_underscore', 'leading-underscore'],
  ['a_b', 'a-b'],
  ['x.y', 'x-y'],
  ['a\\b', 'a-b'],
  ['C++', 'c'],
]

/** Inputs with nothing slugify keeps. */
const emptyInputs = ['', '!!!', '鲁迅', '🎉']

/** The slug function each call site uses, by the name the invariant cases carry. */
const slugFunctions = { bookSlug, slugify }

/** Every input above, paired with the function the app runs it through, for the output invariants. */
const outputCases = [
  ...bookSlugs.map(([title]) => ['bookSlug', title]),
  ...[...personSlugs, ...tagSlugs, ...ruleSlugs].map(([input]) => ['slugify', input]),
]

/** Every distinct slug the tables pin, standing in for slugs already out in links and keys. */
const pinnedSlugs = [
  ...new Set([...bookSlugs, ...personSlugs, ...tagSlugs, ...ruleSlugs].map(([, slug]) => slug)),
]

describe('import shape', () => {
  test('the default import is the slugify function', () => {
    expect(typeof slugify).toBe('function')
  })

  test('a one-argument call, as every call site makes, uses "-", lowercase and decamelize', () => {
    const input = 'CamelCase Title'
    expect(slugify(input)).toBe('camel-case-title')
    expect(slugify(input)).toBe(
      slugify(input, { separator: '-', lowercase: true, decamelize: true }),
    )
  })

  test('a non-string throws a TypeError, which a person record without a name would hit', () => {
    expect(() => slugify(undefined)).toThrow(TypeError)
    expect(() => slugify(null)).toThrow(TypeError)
  })
})

describe('book slugs', () => {
  test.each(bookSlugs)('bookSlug(%j) is %j', (title, slug) => {
    expect(bookSlug(title)).toBe(slug)
  })

  test('the app strips straight apostrophes because slugify alone turns them into a hyphen', () => {
    expect(slugify("Don't Touch My Hair!")).toBe('don-t-touch-my-hair')
    expect(bookSlug("Don't Touch My Hair!")).toBe('dont-touch-my-hair')
  })

  test('a curly apostrophe is not stripped, so it becomes a hyphen', () => {
    expect(bookSlug(`Mama${curlyApostrophe}s Nightingale`)).toBe('mama-s-nightingale')
  })
})

describe('person slugs', () => {
  test.each(personSlugs)('slugify(%j) is %j', (name, slug) => {
    expect(slugify(name)).toBe(slug)
  })

  test('person slugs keep an apostrophe as a hyphen where book slugs drop it', () => {
    expect(slugify("Lupita Nyong'o")).toBe('lupita-nyong-o')
    expect(bookSlug("Lupita Nyong'o")).toBe('lupita-nyongo')
  })

  test('before a capital, decamelize splits a stripped apostrophe back into a hyphen', () => {
    // "O'Neal" becomes "ONeal" in a book slug, which decamelize reads as "O Neal"
    expect(slugify("O'Neal")).toBe('o-neal')
    expect(bookSlug("O'Neal")).toBe('o-neal')
  })
})

describe('tag slugs', () => {
  test.each(tagSlugs)('slugify(%j) is %j', (tag, slug) => {
    expect(slugify(tag)).toBe(slug)
  })
})

describe('symbol, separator and casing rules', () => {
  test.each(ruleSlugs)('slugify(%j) is %j', (input, slug) => {
    expect(slugify(input)).toBe(slug)
  })
})

describe('inputs that slugify to an empty string', () => {
  test.each(emptyInputs)('slugify(%j) is "", and so is its book slug', input => {
    expect(slugify(input)).toBe('')
    expect(bookSlug(input)).toBe('')
  })
})

describe('invariants over every slug the tables produce', () => {
  test.each(outputCases)(
    '%s(%j) is lowercase ASCII words joined by single hyphens',
    (fn, input) => {
      const slug = slugFunctions[fn](input)
      // Each soft check names the app constraint it protects, so an output that changes in an upgrade
      // reports every constraint it now breaks, not only the first.
      expect.soft(slug, 'a "," or "/" splits a filters query in filterable').not.toMatch(/[,/]/)
      expect
        .soft(slug, 'Firebase refuses ".", "#", "$", "[", "]" and "/" in a users/<slug> key')
        .not.toMatch(/[.#$[\]/]/)
      expect
        .soft(encodeURIComponent(slug), 'a route param or query value needs it unencoded')
        .toBe(slug)
      expect(slug).toMatch(slugPattern)
    },
  )
})

describe('stability of the pinned slugs', () => {
  test.each(pinnedSlugs)('slugify(%j) returns it unchanged', slug => {
    // Idempotence is a slugify property, not an app contract: no call site slugifies a value that is
    // already a slug. It is kept as a stability signal, since an old slug that a new slugify changes
    // means the package now treats its own earlier output differently.
    expect(slugify(slug)).toBe(slug)
  })
})
