const functions = require('firebase-functions/v1')
const admin = require('firebase-admin')
const coverImageByISBN = require('./util/coverImageByISBN')
const loadImage = require('./util/loadImage')
const uid = require('uuid').v4

const getDownloadUrl = (fileName, bucketName, token) =>
  `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(
    fileName,
  )}?alt=media&token=${token}`

const watchBookSubmissions = functions
  .runWith({
    timeoutSeconds: 300,
    memory: '1GB',
  })
  .database.ref('/submits/books/{id}')
  .onCreate(async (snap, context) => {
    const book = snap.val()
    console.log(new Date(), 'Finding cover for book submission:', book.isbn)

    await snap.ref.child('findingCover').set(true)
    let img
    try {
      if (book.thumbnail) {
        img = await loadImage(book.thumbnail, 400)
      }
      if (!img) {
        img = await coverImageByISBN(book.isbn, 400)
      }
    } finally {
      await snap.ref.child('findingCover').remove()
    }

    if (!img) {
      console.log('No cover:', book.isbn)
      return
    }

    console.log(new Date(), 'Saving cover to storage:', book.isbn)

    const bucket = admin.storage().bucket()
    const id = uid()
    const fname = `submits/${context.params.id}`
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
    console.log(new Date(), 'Cover saved:', book.isbn, url)
  })

module.exports = watchBookSubmissions
