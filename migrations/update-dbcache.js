/** Before deploying a new release to Firebase from a local machine, we need to regenerate dbcache.js from the database and add missing photos, otherwise the old photos will overwrite what is on the hosted website. */

const promptly = require('promptly')
const axios = require('axios')
const chalk = require('chalk')
const crypto = require('crypto')
const fs = require('fs')

const image64ToBuffer = require('../functions/util/image64ToBuffer')

const envFile = process.argv[process.argv.length - 1]

if (envFile.endsWith('update-dbcache.js')) {
  console.info('Usage: npm run update:dbcache PATH_TO_ENV_FILE')
  process.exit(0)
}

require('dotenv').config({ path: envFile })
console.info(`using firebase config from <${envFile}>`)

/** loading firebase website "collection" */
const loadCollection = (db, path) => {
  return new Promise((resolve, reject) => {
    const ref = db.ref(path)
    ref.once('value', snap => {
      const collection = snap.val()
      resolve(collection)
    })
  })
}

/** load required database collection and collect them into cached structure */
const cacheDatabase = async db => {
  const books = await loadCollection(db, 'books')
  const tagsBooks = await loadCollection(db, 'tags/books')
  const tagsPeople = await loadCollection(db, 'tags/people')
  const tagsBundles = await loadCollection(db, 'tags/bundles')
  const people = await loadCollection(db, 'people')
  const users = await loadCollection(db, 'users')
  const contributors = Object.values(users).filter(
    user => user.roles && (user.roles.contributor || user.roles.owner),
  )
  const content = await loadCollection(db, 'content')

  return {
    books,
    people,
    tags: {
      books: tagsBooks,
      people: tagsPeople,
      bundles: tagsBundles,
    },
    contributors,
    content,
  }
}

/** Firebase initialization */
const initFirebase = () => {
  const firebase = require('firebase/app')
  require('firebase/auth')
  require('firebase/database')
  const firebaseConfig = {
    apiKey: process.env.VUE_APP_FIREBASE_API_KEY,
    authDomain: process.env.VUE_APP_FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.VUE_APP_FIREBASE_DATABASE_URL,
    projectId: process.env.VUE_APP_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VUE_APP_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VUE_APP_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VUE_APP_FIREBASE_APP_ID,
    measurementId: process.env.VUE_APP_FIREBASE_MEASURMENT_ID,
  }
  firebase.initializeApp(firebaseConfig)
  return firebase
}

/** Main function */
const go = async () => {
  console.info('Initializing firebase')
  const usr = await promptly.prompt(`Website owner authentication email`)
  const pwd = await promptly.password(`Website owner authentication password for <${usr}>`)
  console.info('Connecting to firebase')
  const firebase = initFirebase()
  let credentials = null
  try {
    credentials = await firebase.auth().signInWithEmailAndPassword(usr, pwd)
  } catch (err) {
    credentials = null
  }
  if (!credentials) {
    console.info('Firebase authentication error. Nothing done. Aborting')
    return
  }
  console.info(
    `Authorized as <${
      credentials.user.displayName ? chalk.cyan(credentials.user.displayName) + ' - ' : ''
    }${chalk.cyan(credentials.user.uid)}>.`,
  )

  const db = await cacheDatabase(firebase.database())
  db.cacheDate = new Date()

  // collect books covers to cache
  const cacheBooks = Object.values(db.books)
    .map(book => {
      if (!book || !book.cover || !book.cover.url) return null
      return book
    })
    .filter(x => !!x)

  // get base64 user photos from the database
  // they will be uploaded and the url will be added to the cache
  const usersPhotos = db.contributors
    .map((user, i) => {
      const photo = user.profile.photo
      if (!photo || !photo.base64 || (photo.url && photo.url.startsWith('http'))) return null
      // base photo file name on user email cuz we loosed users ids on previous step
      const key = crypto.createHash('sha256').update(user.profile.email).digest('hex')
      return {
        i,
        key,
        name: user.profile.name,
        base64: photo.base64,
      }
    })
    .filter(x => !!x)

  // create images directory if not exists
  if (!fs.existsSync('./public/img')) {
    fs.mkdirSync('./public/img')
  }

  // set cover.cache to the relative book cover url
  // download book covers that do not exist and save locally
  await Promise.all(
    cacheBooks.map(async book => {
      // updating cached db cuz we need calculate later hash of file with cached urls
      const cacheUrl = `/img/${book.id}.png`
      const localPath = `./public/img/${book.id}.png`
      db.books[book.id].cover.cache = cacheUrl
      if (fs.existsSync(localPath)) {
        console.info(
          `${chalk.green('Book cover exists')} ${book.title} (id: ${chalk.cyan(book.id)})`,
        )
      } else {
        console.info(
          `${chalk.red('Book cover does not exist')}. Downloading book cover ${
            book.title
          } (id: <${chalk.cyan(book.id)})`,
        )
        const response = await axios.get(book.cover.url, { responseType: 'arraybuffer' })
        fs.writeFileSync(localPath, Buffer.from(response.data))
      }
    }),
  )

  // replace the base64 data url contributor photos with hosted urls
  // gzip and add to newFiles, hashMap, pathMap, and hashNames for uploading
  await Promise.all(
    usersPhotos.map(async userPhoto => {
      const buff = await image64ToBuffer(userPhoto.base64, 400)
      const cacheUrl = `/img/${userPhoto.key}.png`
      const localPath = `./public/img/${userPhoto.key}.png`
      console.log(`Saving user photo for ${userPhoto.name} <${cacheUrl}>`)
      // eslint-disable-next-line fp/no-delete
      delete db.contributors[userPhoto.i].profile.photo.base64
      db.contributors[userPhoto.i].profile.photo.url = cacheUrl
      db.contributors[userPhoto.i].profile.photo.width = buff.width
      db.contributors[userPhoto.i].profile.photo.height = buff.height
      fs.writeFileSync(localPath, Buffer.from(buff.buffer))
    }),
  ).catch(err => {
    console.error('Updating users photos error!', err)
  })

  const dbCacheJs = `window.dbcache = ${JSON.stringify(db, null, 2)}`
  fs.writeFileSync('./public/dbcache.js', dbCacheJs)
}

/** run main function */
if (require.main === module) {
  go()
    .then(() => {
      console.info('done')
      process.exit(0)
    })
    .catch(err => {
      console.error('error happens on books creations', err)
      process.exit(1)
    })
}

module.exports = { cacheDatabase, go }
