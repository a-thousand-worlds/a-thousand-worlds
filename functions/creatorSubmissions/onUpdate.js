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
  .onUpdate(async (change, context) => {
    const snap = change.after
    const sub = snap.val()

    let cover = sub.photo || null
    if (cover && cover.url && cover.url.startsWith('http')) {
      console.log('photo image is ok, no need to do anything.', sub.name)
      return
    }

    console.log('onUpdate', sub.name)
    // if image is manually uploaded from administration part - we will have only base64 field, wich we need to convert to direct image binary data for upload to storage
    if (cover && cover.base64 && !cover.buffer) {
      cover = await image64ToBuffer(cover.base64, 400)
    }
    if (cover && cover.buffer) {
      console.log('saving cover from buffer to storage')
      const bucket = admin.storage().bucket()
      const uuid = UUID.v4()
      const fname = `submits/people/${context.params.id}`
      const file = await bucket.file(fname)
      await file.save(cover.buffer, {
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
        width: cover.width,
        height: cover.height,
      })
      console.log('Creator submission photo saved:', sub.name)
    } else {
      console.log('creator submission processed without photo image', sub.name)
    }

    // finanly removing key to unblock book for next updates
    // await snap.ref.child('findingCover').remove()
  })

module.exports = watch
