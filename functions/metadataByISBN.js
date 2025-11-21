/* Searches for metadata for an ISBN from Google and OpenLibrary.
 * e.g. https://us-central1-a-thousand-worlds.cloudfunctions.net/metadataByISBN?isbn=9781984881489
 */

const functions = require('firebase-functions/v1')
const axios = require('axios').default
const express = require('express')
const isbn = require('node-isbn')

async function getGoodreadsBookIDByISBN(isbn) {
  console.log(`Searching ID for "${isbn}"`)

  try {
    const { data: id } = await axios({
      url: `https://www.goodreads.com/book/isbn_to_id/`,
      method: 'get',
      params: {
        key: functions.config().goodreads.api_key,
        isbn,
      },
      responseType: 'text',
    })
    console.log(`  ID: ${id}`)
    return id
  } catch (err) {
    console.log(`Unable to find ID for ${isbn}.`, err.message)
    return null
  }
}

/** Calls the node-isbn function and returns null if there is an error. */
function _isbn(code, provider) {
  return isbn
    .provider([provider])
    .resolve(code)
    .catch(err => {
      console.log(`Error searching ${provider} for ${code}`, err)
      return null
    })
}

/** Searches for metadata for an ISBN from Google and, if not found, from OpenLibrary. */
async function isbnSearch(isbn) {
  console.log('Searching Google for ' + isbn)
  let book = await _isbn(isbn, 'google')

  if (!book) {
    console.log('Google data not found. Searching OpenLibrary for ' + isbn)
    book = await _isbn(isbn, 'openlibrary')
  }

  if (!book) {
    console.log('OpenLibrary data not found')
    return null
  }

  return {
    ...book,
    isbn,
  }
}

module.exports = () => {
  const app = express()

  app.get('/', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*')
    if (!req.query || !req.query.isbn) {
      res.send(JSON.stringify(null))
      return
    }
    const book = await isbnSearch(req.query.isbn)
    if (!book) {
      res.json(null)
      return
    }

    console.log('Searching Goodreads')
    book.goodreads = await getGoodreadsBookIDByISBN(req.query.isbn)
    console.log(`[${req.query.isbn}] found - ${book.title}`, JSON.stringify(book))
    res.json(book)
  })

  return app
}
