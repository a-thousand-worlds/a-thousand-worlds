const functions = require('firebase-functions/v1')
const admin = require('firebase-admin')
const loadImage = require('../util/loadImage')
const image64ToBuffer = require('../util/image64ToBuffer')
const UUID = require('uuid')
const getDownloadUrl = require('../util/getBucketFileDownloadUrl')

const watch = functions
  .runWith({
    timeoutSeconds: 300,
    memory: '1GB',
  })
  .database.ref('/people/{id}')
  .onUpdate(async (change, context) => {
    const snap = change.after
    const person = snap.val()

    const photo = person.photo || null
    if (!photo) {
      console.log('photo net exists')
      return
    }

    if (photo && photo.url && photo.url.startsWith('http')) {
      console.log('person photo is ok, no need to do anything.', person.name)
      return
    }

    console.log('onUpdate', person.name)
    let img = null
    if (photo.downloadUrl && photo.downloadUrl.startsWith('http')) {
      try {
        img = await loadImage(photo.downloadUrl, 400)
      } catch (err) {
        console.error('loadImage error', err)
        img = null
      }
    }
    // if image is manually uploaded from administration part - we will have only base64 field, wich we need to convert to direct image binary data for upload to storage
    if (!img && photo.base64) {
      try {
        img = await image64ToBuffer(photo.base64, 400)
      } catch (err) {
        console.error('converting image error', err)
        img = null
      }
    }
    if (!img || !img.buffer) {
      console.log('photo not found')
      return
    }

    console.log('saving cover from buffer to storage')
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
    console.log('Person photo updated', person.name, url)
  })

module.exports = watch
