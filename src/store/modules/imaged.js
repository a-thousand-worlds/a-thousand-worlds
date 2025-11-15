/** Imaged collection elements use `field` field for element related image, stored at Firestore */
import managed from '@/store/modules/managed'
import mergeOne from '@/util/mergeOne'
// import firebase from '@/firebase'
const firebaseImport = () => import(/* webpackChunkName: "firebase" */ '@/firebase')
// import Jimp from 'jimp'

const importJimp = () => import('jimp' /* webpackChunkName: "jimp" */)

const module = (name, field) =>
  mergeOne(managed(name), {
    actions: {
      async saveWithImage(state, { path, value }) {
        if (!path) throw new Error('path required')
        if (typeof value !== 'object') throw new Error('value should be object')
        const firebasem = await firebaseImport()
        const firebase = firebasem.default
        const image = value[field]
        const Jimp = await importJimp()
        if (image?.downloadUrl?.length) {
          const img = await Jimp.read(image.downloadUrl)
          const buff = await img.getBufferAsync(Jimp.MIME_PNG)
          const ref = await firebase.storage().ref(`${name}/${path}`)
          await ref.put(buff, { contentType: 'image/png', cacheControl: 'public,max-age=31536000' })
          const url = await ref.getDownloadURL()
          value[field] = {
            url,
            width: img.bitmap.width,
            height: img.bitmap.height,
          }
        }
        if (image?.base64?.length) {
          const img = await Jimp.read(image.base64)
          const buff = await img.getBufferAsync(Jimp.MIME_PNG)
          const ref = await firebase.storage().ref(`${name}/${path}`)
          await ref.put(buff, { contentType: 'image/png', cacheControl: 'public,max-age=31536000' })
          const url = await ref.getDownloadURL()
          value[field] = {
            url,
            width: img.bitmap.width,
            height: img.bitmap.height,
          }
        }
        await state.dispatch('save', { path, value })
      },
      /** removes element and related image from firestore */
      async removeWithImage(state, path) {
        if (!path) throw new Error('path required')
        await state.dispatch(`remove`, path)
        const firebasem = await firebaseImport()
        const firebase = firebasem.default
        const ref = await firebase.storage().ref(`${name}/${path}`)
        await ref.delete()
      },
    },
  })

export default module
