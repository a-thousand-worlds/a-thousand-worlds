/**
 * Characterizes the links in submission emails (renderEmailBook, renderPerson) at the seams where
 * they lean on third-party packages, so a dependency upgrade that changes behavior fails here first:
 * - @sindresorhus/slugify turns book titles and person names into the slugs in emailed links. Sent
 * links sit in inboxes, so a slug that changes under an upgrade orphans them. The real slugify runs
 * through the renderers and is never imported here, so its import shape can change freely.
 * - vue-router must still resolve every emailed link through the real route table to BookDetail,
 * PersonDetail or ReviewSubmissions with the same params.
 * - jsdom supplies window.location.origin, which prefixes every link.
 */
import renderEmailBook from './renderEmailBook'
import renderPerson from './renderPerson'
import router from '@/router'

const origin = window.location.origin

/** Returns every href in an HTML string, in document order. */
const hrefs = html => [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1])

/** Resolves an absolute link through the real router, returning just its name and params. */
const resolveLink = href => {
  const { name, params } = router.resolve(new URL(href).pathname)
  return { name, params }
}

/** Returns how many times needle occurs in html. */
const count = (html, needle) => html.split(needle).length - 1

describe('renderEmailBook', () => {
  const approvedBook = {
    title: "José's Café",
    isbn: '9780316015844',
    authors: 'Ada Lovelace',
    illustrators: 'Björk',
    thumbnail: 'https://img.test/cover.jpg',
    status: 'approved',
  }

  test('an approved book links its title and cover to the book detail page', () => {
    const html = renderEmailBook(approvedBook)
    const detailUrl = `${origin}/book/joses-cafe-9780316015844`

    expect(hrefs(html)).toEqual([detailUrl, detailUrl])
    expect(html).toContain(`<a href="${detailUrl}" target="_blank">José's Café</a>`)
    expect(html).toContain('<b>words by</b> Ada Lovelace')
    expect(html).toContain('<b>illustrated by</b> Björk')
    expect(html).toContain(
      `<p><a href="${detailUrl}" target="_blank"><img src="https://img.test/cover.jpg" width="150" /></a></p>`,
    )
  })

  test('the book detail link resolves to BookDetail with the slug and isbn', () => {
    const [href] = hrefs(renderEmailBook(approvedBook))
    expect(resolveLink(href)).toEqual({
      name: 'BookDetail',
      params: { slug: 'joses-cafe', isbn: '9780316015844' },
    })
  })

  test('a pending book links everything to the book review queue', () => {
    const html = renderEmailBook({ ...approvedBook, status: 'pending' })
    const reviewUrl = `${origin}/admin/review/books`

    expect(hrefs(html)).toEqual([reviewUrl, reviewUrl])
    expect(html).toContain(`<a href="${reviewUrl}" target="_blank">José's Café</a>`)
    expect(html).toContain(
      `<p><a href="${reviewUrl}" target="_blank"><img src="https://img.test/cover.jpg" width="150" /></a></p>`,
    )
  })

  test('the review queue link resolves to ReviewSubmissions for books', () => {
    const [href] = hrefs(renderEmailBook({ ...approvedBook, status: 'pending' }))
    expect(resolveLink(href)).toEqual({ name: 'ReviewSubmissions', params: { type: 'books' } })
  })

  test('a pending book with no illustrators or thumbnail has only the title link', () => {
    const html = renderEmailBook({
      ...approvedBook,
      illustrators: '',
      thumbnail: '',
      status: 'pending',
    })

    expect(hrefs(html)).toEqual([`${origin}/admin/review/books`])
    expect(html).toContain('<b>words by</b> Ada Lovelace')
    expect(html).not.toContain('illustrated by')
    expect(html).not.toContain('<img')
  })

  test('an approved book with no thumbnail has no cover image', () => {
    const html = renderEmailBook({ ...approvedBook, thumbnail: '' })

    expect(hrefs(html)).toEqual([`${origin}/book/joses-cafe-9780316015844`])
    expect(html).not.toContain('<img')
  })

  test.each([
    ['Ada Twist, Scientist', 'ada-twist-scientist'],
    // straight apostrophes are removed before slugify, so possessives stay one word
    ["Harry Potter and the Sorcerer's Stone", 'harry-potter-and-the-sorcerers-stone'],
    // a curly apostrophe is not removed, so slugify turns it into a separator
    ['Don’t Let the Pigeon Drive the Bus!', 'don-t-let-the-pigeon-drive-the-bus'],
    ['Mañana, Iguana', 'manana-iguana'],
    ['Rock & Roll', 'rock-and-roll'],
    ['I ♥ NY', 'i-love-ny'],
    ['Björk', 'bjoerk'],
    ['Ümit Özdağ', 'uemit-oezdag'],
    ['The ABCs of LGBTQ+', 'the-ab-cs-of-lgbtq'],
    ['Straße', 'strasse'],
    ['Łódź', 'lodz'],
    ['Чебурашка', 'cheburashka'],
    ['A.B.C.', 'a-b-c'],
    ['100% Kids', '100-kids'],
    ['ALL CAPS TITLE', 'all-caps-title'],
    ['  Leading and trailing  ', 'leading-and-trailing'],
    ['Catch-22', 'catch-22'],
    ['東京', ''],
  ])('the title %j slugs to %j and round-trips through the router', (title, slug) => {
    const isbn = '9780316015844'
    const [href] = hrefs(renderEmailBook({ ...approvedBook, title, isbn }))

    expect(href).toBe(`${origin}/book/${slug}-${isbn}`)
    expect(resolveLink(href)).toEqual({ name: 'BookDetail', params: { slug, isbn } })
  })

  test.each([
    // the greedy slug keeps its own inner hyphen and digits; only the last segment is the isbn
    ['Catch-22', '9780684833392', '/book/catch-22-9780684833392', 'catch-22'],
    // a title that slugifies to nothing still resolves, with an empty slug
    ['東京', '9781419721373', '/book/-9781419721373', ''],
    // an ISBN-10 check digit X survives as part of the isbn param
    [
      'Where the Wild Things Are',
      '006025492X',
      '/book/where-the-wild-things-are-006025492X',
      'where-the-wild-things-are',
    ],
  ])('%j with isbn %s links to %s', (title, isbn, pathname, slug) => {
    const [href] = hrefs(renderEmailBook({ ...approvedBook, title, isbn }))

    expect(new URL(href).pathname).toBe(pathname)
    expect(resolveLink(href)).toEqual({ name: 'BookDetail', params: { slug, isbn } })
  })
})

describe('renderPerson', () => {
  const bjork = {
    name: 'Björk Guðmundsdóttir',
    title: 'Author',
    photo: { url: 'https://img.test/u.jpg', downloadUrl: 'https://img.test/d.jpg' },
  }

  test('an approved person links their name and photo to the person detail page', () => {
    const html = renderPerson(bjork, { status: 'approved' })
    const detailUrl = `${origin}/person/bjoerk-gudmundsdottir`

    expect(hrefs(html)).toEqual([detailUrl, detailUrl])
    expect(html).toContain('Author<br>')
    expect(html).toContain(
      `<p><a href="${detailUrl}" target="_blank"><img src="https://img.test/d.jpg" width="150" /></a></p>`,
    )
  })

  test('the person detail link resolves to PersonDetail with the slugged name', () => {
    const [href] = hrefs(renderPerson(bjork, { status: 'approved' }))
    expect(resolveLink(href)).toEqual({
      name: 'PersonDetail',
      params: { name: 'bjoerk-gudmundsdottir' },
    })
  })

  test('a photo given as a plain URL string is used as the image source', () => {
    const html = renderPerson(
      { name: 'Yuyi Morales', photo: 'https://img.test/yuyi.jpg' },
      { status: 'approved' },
    )
    const detailUrl = `${origin}/person/yuyi-morales`

    expect(html).toContain(
      `<p><a href="${detailUrl}" target="_blank"><img src="https://img.test/yuyi.jpg" width="150" /></a></p>`,
    )
  })

  test('a pending person with no photo or title links only to the people review queue', () => {
    const html = renderPerson({ name: 'Yuyi Morales' }, { status: 'pending' })
    const reviewUrl = `${origin}/admin/review/people`

    expect(hrefs(html)).toEqual([reviewUrl])
    expect(html).not.toContain('<img')
    // the only <br> is the one after the name; there is no title line
    expect(count(html, '<br>')).toBe(1)
    expect(resolveLink(reviewUrl)).toEqual({
      name: 'ReviewSubmissions',
      params: { type: 'people' },
    })
  })

  test('a pending person with a photo links the photo to the people review queue too', () => {
    const html = renderPerson(bjork, { status: 'pending' })
    const reviewUrl = `${origin}/admin/review/people`

    expect(hrefs(html)).toEqual([reviewUrl, reviewUrl])
    expect(count(html, '<br>')).toBe(2)
    expect(html).toContain(
      `<p><a href="${reviewUrl}" target="_blank"><img src="https://img.test/d.jpg" width="150" /></a></p>`,
    )
  })

  test.each([
    ['Yuyi Morales', 'yuyi-morales'],
    // unlike book titles, a person's apostrophe is not removed first, so it becomes a hyphen
    ["John O'Brien", 'john-o-brien'],
    ['Lê Minh Khuê', 'le-minh-khue'],
    ['Björk Guðmundsdóttir', 'bjoerk-gudmundsdottir'],
    ['Ana & Bo', 'ana-and-bo'],
  ])('the name %j slugs to %j and round-trips through the router', (name, slug) => {
    const [href] = hrefs(renderPerson({ name }, { status: 'approved' }))

    expect(href).toBe(`${origin}/person/${slug}`)
    expect(resolveLink(href)).toEqual({ name: 'PersonDetail', params: { name: slug } })
  })
})
