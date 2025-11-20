// import firebase from '@/firebase'
const firebaseImport = () => import(/* webpackChunkName: "firebase" */ '@/firebase')

// eslint-disable-next-line fp/no-class
class ATWUploadAdapter {
  constructor(loader) {
    this.loader = loader
  }

  async upload() {
    const file = await this.loader.file
    return this.firebaseUpload(file)
  }

  firebaseUpload(file) {
    return new Promise((resolve, reject) => {
      firebaseImport().then(firebasem => {
        const firebase = firebasem.default
        const ref = firebase.storage().ref(`content/${file.name}`)
        this.task = ref.put(file)
        this.task.on(
          'state_changed',
          snap => {
            this.loader.uploadTotal = snap.totalBytes
            this.loader.uploaded = snap.bytesTransferred
          },
          err => {
            console.log('error on content file upload', err)
            reject(err)
          },
          () => {
            ref.getDownloadURL().then(url => {
              this.task = null
              resolve({
                default: url,
              })
            })
          },
        )
      })
    })
  }

  abort() {
    if (this.task) {
      this.task.cancel()
    }
  }
}

// must be defined as an old-school function declaration, not an arrow function
// See: https://github.com/ckeditor/ckeditor5/issues/11812#issuecomment-1564993835
const FirebaseUploadAdapter = function (editor) {
  editor.plugins.get('FileRepository').createUploadAdapter = loader => new ATWUploadAdapter(loader)
}

export default FirebaseUploadAdapter
