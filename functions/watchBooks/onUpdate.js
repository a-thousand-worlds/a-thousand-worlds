const functions = require('firebase-functions/v1')
const admin = require('firebase-admin')
const coverImageByISBN = require('../util/coverImageByISBN')
const loadImage = require('../util/loadImage')
const image64ToBuffer = require('../util/image64ToBuffer')
const uid = require('uuid').v4
const getDownloadUrl = require('../util/getBucketFileDownloadUrl')
const sendEmail = require('../util/sendEmail')

const watchBooks = functions
  .runWith({
    timeoutSeconds: 300,
    memory: '1GB',
  })
  .database.ref('/books/{id}')
  .onUpdate(async (change, context) => {
    const snap = change.after
    const book = snap.val()
    if (book.findingCover === true) {
      console.log('updated on finding cover. no need to do anything here', book.title)
      return
    }

    let cover = book.cover || null
    if (cover && cover.url && cover.url.startsWith('http')) {
      console.log('cover image is ok, no need to do anything.', book.title, book.isbn)
      return
    }

    console.log('onUpdate', book.title)
    const attempts = book.findingCoverAttemps || 0
    if (attempts >= 5) {
      const project = functions.config().project
      // let's send notification email to project admin
      const mail = await sendEmail({
        to: project.admin_email,
        subject: 'Book cover search failure notice',
        body: `<p>Searching cover image for book <b>${book.title}</b> (isbn: ${book.isbn}) failed after 5 attempts.</p>`,
      })
      console.log(
        `Find cover for <${book.isbn}> failed after 5 times. Notification email send to <${project.admin_email}> with id <${mail.messageId}>`,
      )
      return
    }
    await snap.ref.child('findingCover').set(true)
    if (!cover) {
      try {
        cover = await coverImageByISBN(book.isbn, 400)
      } catch (err) {
        console.error('coverImageByISBN error', err)
        cover = null
      }
    }
    if (cover && cover.downloadUrl) {
      try {
        cover = await loadImage(cover.downloadUrl, 400)
      } catch (err) {
        console.error('loadImage error', err)
        cover = null
      }
    }
    // if image is manually uploaded from administration part - we will have only base64 field, wich we need to convert to direct image binary data for upload to storage
    if (cover && cover.base64 && !cover.buffer) {
      cover = await image64ToBuffer(cover.base64, 400)
    }
    if (cover && cover.buffer) {
      console.log('saving cover from buffer to storage')
      const bucket = admin.storage().bucket()
      const id = uid()
      const fname = `books/${context.params.id}`
      const file = await bucket.file(fname)
      await file.save(cover.buffer, {
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
        width: cover.width,
        height: cover.height,
      })
      console.log('Book cover saved:', book.title, book.isbn, url)
    } else {
      await snap.ref.child('findingCoverAttemps').set(attempts + 1)
      await snap.ref.child('findingCover').remove()
      console.log('book processed without cover image', book.title, book.isbn)
    }

    // finanly removing key to unblock book for next updates
    await snap.ref.child('findingCover').remove()
  })

module.exports = watchBooks
