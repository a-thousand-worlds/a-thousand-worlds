const express = require('express')

const OPEN_LIBRARY_SEARCH_URL = 'https://openlibrary.org/search.json'
const OPEN_LIBRARY_COVER_URL = isbn =>
  `https://covers.openlibrary.org/b/isbn/${isbn}.jpg?default=false`
const OPEN_LIBRARY_WORK_EDITION_URL = workKey => `https://openlibrary.org${workKey}/editions.json`
const ISBNDB_API_URL = 'https://api2.isbndb.com'

const getIsbnDbKey = () => {
  if (process.env.ISBNDB_KEY) {
    return process.env.ISBNDB_KEY
  }

  return null
}

const normalizeIsbn = value => (value || '').replace(/[^0-9Xx]/g, '').toUpperCase()

const getOpenLibraryCover = async isbn => {
  const url = OPEN_LIBRARY_COVER_URL(isbn)

  try {
    const response = await fetch(url)
    return response.ok ? url : null
  } catch (error) {
    console.error('OpenLibrary cover GET request failed', error)
    return null
  }
}

const getIsbnDbCover = async isbn => {
  const key = getIsbnDbKey()

  if (!key) {
    console.error('ISBNdb key is not defined.')
    return null
  }

  try {
    const response = await fetch(`${ISBNDB_API_URL}/book/${isbn}`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: key,
      },
    })
    if (!response.ok) {
      console.error('ISBNdb request failed', response.status, response.statusText)
      return null
    }
    const json = await response.json()
    return (
      json?.book?.image || json?.book?.image2 || json?.book?.image3 || json?.book?.image4 || null
    )
  } catch (error) {
    console.error('ISBNdb request failed', error)
    return null
  }
}

const findBookCoverByIsbn = async isbn => {
  const openLibraryCover = await getOpenLibraryCover(isbn)
  if (openLibraryCover) {
    return { isbn, thumbnail: openLibraryCover }
  }

  const isbnDbCover = await getIsbnDbCover(isbn)
  if (isbnDbCover) {
    return { isbn, thumbnail: isbnDbCover }
  }

  return null
}

const findBookCoverByTitleAndAuthor = async (titleKeyword, authorKeyword) => {
  if (
    typeof titleKeyword !== 'string' ||
    !titleKeyword ||
    typeof authorKeyword !== 'string' ||
    !authorKeyword
  ) {
    return null
  }

  const docKeyResponse = await fetch(
    `${OPEN_LIBRARY_SEARCH_URL}?title=${encodeURIComponent(
      titleKeyword,
    )}&author=${encodeURIComponent(authorKeyword)}`,
  )
  if (!docKeyResponse.ok) {
    return null
  }

  const docKeyJson = await docKeyResponse.json()
  const workKey = docKeyJson?.docs?.find(doc => doc?.key)?.key
  if (!workKey) {
    return null
  }

  const editionsResponse = await fetch(OPEN_LIBRARY_WORK_EDITION_URL(workKey))
  if (!editionsResponse.ok) {
    return null
  }

  const editionsJson = await editionsResponse.json()
  const entries = editionsJson?.entries || []
  if (!entries.length) {
    return null
  }

  const entry = entries[0]
  const isbnSet = [
    ...new Set([...(entry?.isbn_13 || []), ...(entry?.isbn_10 || [])].map(normalizeIsbn)),
  ].filter(Boolean)

  return isbnSet.reduce(async (resultPromise, candidate) => {
    const result = await resultPromise
    if (result || !candidate) {
      return result
    }
    return findBookCoverByIsbn(candidate)
  }, Promise.resolve(null))
}

const buildApp = () => {
  const app = express()

  app.get('/', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*')

    const query = req.query || {}
    const isbn = normalizeIsbn(query.isbn)
    const titleKeyword = query.title
    const authorKeyword = query.author

    if (!isbn && (!titleKeyword || !authorKeyword)) {
      res.json(null)
      return
    }

    const result = isbn
      ? await findBookCoverByIsbn(isbn)
      : await findBookCoverByTitleAndAuthor(titleKeyword, authorKeyword)

    res.json(result || null)
  })

  return app
}

module.exports = {
  buildApp,
}
