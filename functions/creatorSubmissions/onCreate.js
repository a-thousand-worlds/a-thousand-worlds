const functions = require('firebase-functions/v1')
const admin = require('firebase-admin')
const image64ToBuffer = require('../util/image64ToBuffer')
const UUID = require('uuid')
const getDownloadUrl = require('../util/getBucketFileDownloadUrl')

const watch = functions
  .runWith({
    timeoutSeconds: 300,
    memory: '1GB',
  })
  .database.ref('/submits/people/{id}')
  .onCreate(async (snap, context) => {
    const submission = snap.val()
    // nothing to do if there is no uploaded photo
    if (!submission.photo || !submission.photo.base64) {
      return
    }

    let img
    try {
      // scaling image for maximum width 400px
      img = await image64ToBuffer(submission.photo.base64, 400)
    } catch (err) {
      console.log('error happens on converting image from base64', err)
      img = null
    }

    if (!img) {
      console.log('No photo')
      return
    }

    console.log('Saving photo to storage:', submission.name)

    const bucket = admin.storage().bucket()
    const uuid = UUID.v4()
    const fname = `submits/people/${context.params.id}`
    const file = await bucket.file(fname)
    await file.save(img.buffer, {
      metadata: {
        contentType: 'image/png',
        cacheControl: 'public,max-age=31536000',
        metadata: {
          firebaseStorageDownloadTokens: uuid,
        },
      },
    })
    const url = getDownloadUrl(fname, bucket.name, uuid)

    await snap.ref.child('photo').set({
      url,
      width: img.width,
      height: img.height,
    })
    console.log('Photo saved:', submission.name, url)
    /**/
  })

module.exports = watch
