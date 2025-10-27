const functions = require('firebase-functions/v1')
const admin = require('firebase-admin')
const loadImage = require('../util/loadImage')
const image64ToBuffer = require('../util/image64ToBuffer')
const getDownloadUrl = require('../util/getBucketFileDownloadUrl')
const UUID = require('uuid')

const watch = functions
  .runWith({
    timeoutSeconds: 300,
    memory: '1GB',
  })
  .database.ref('/people/{id}')
  .onCreate(async (snap, context) => {
    const person = snap.val()
    // there is no need to push date to logs, cuz firebase functions logging system does this itself
    console.log('Managing person photo', person.name)
    /**/

    // we wait on record creation photo as base64 (manual) or downloadUrl (from submission)
    // or nothing if created automatically on book submission approval with new creators
    if (!person.photo) {
      console.log('no photo field!')
      return
    }

    let img = null

    if (person.photo.downloadUrl && person.photo.downloadUrl.startsWith('http')) {
      try {
        img = await loadImage(person.photo.downloadUrl, 400)
      } catch (err) {
        console.log('loading image error!', person.photo.downloadUrl, err)
        img = null
      }
    }
    if (!img && person.photo.base64 && person.photo.base64.length) {
      try {
        img = await image64ToBuffer(person.photo.base64, 400)
      } catch (err) {
        console.log('converting image from base64 error!', err)
        img = null
      }
    }

    if (!img || !img.buffer) {
      console.log('No photo for', person.name)
      return
    }

    console.log('Saving photo to storage:', person.name)

    const bucket = admin.storage().bucket()
    const uuid = UUID.v4()
    const fname = `people/${context.params.id}`
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
    console.log('Photo saved:', person.name, url)
  })

module.exports = watch
