const functions = require('firebase-functions/v1')
const admin = require('firebase-admin')
const coverImageByISBN = require('../util/coverImageByISBN')
const loadImage = require('../util/loadImage')
const uid = require('uuid').v4
const getDownloadUrl = require('../util/getBucketFileDownloadUrl')

const watchBooks = functions
  .runWith({
    timeoutSeconds: 300,
    memory: '1GB',
  })
  .database.ref('/books/{id}')
  .onCreate(async (snap, context) => {
    const book = snap.val()
    // there is no need to push date to logs, cuz firebase functions logging system does this itself
    console.log('Finding cover for book submission:', book.isbn)
    /**/

    await snap.ref.child('findingCover').set(true)
    let img
    if (book.cover && book.cover.downloadUrl) {
      try {
        img = await loadImage(book.cover.downloadUrl, 400)
      } catch (err) {
        console.error('loadImage error', err)
        img = null
      }
    }
    if (!img) {
      try {
        // scaling cover image for book for maximum width 400px
        img = await coverImageByISBN(book.isbn, 400)
      } catch (err) {
        console.error('image by isbn error', err)
        img = null
      }
    }
    await snap.ref.child('findingCover').remove()

    if (!img) {
      console.log('No cover:', book.isbn)
      return
    }

    console.log('Saving cover to storage:', book.isbn)

    const bucket = admin.storage().bucket()
    const id = uid()
    const fname = `books/${context.params.id}`
    const file = await bucket.file(fname)
    await file.save(img.buffer, {
      metadata: {
        contentType: 'image/png',
        cacheControl: 'public,max-age=31536000',
        metadata: {
          firebaseStorageDownloadTokens: id,
        },
      },
    })
    const url = getDownloadUrl(fname, bucket.name, id)

    await snap.ref.child('cover').set({
      url,
      width: img.width,
      height: img.height,
    })
    console.log('Cover saved:', book.isbn, url)
    /**/
  })

module.exports = watchBooks
