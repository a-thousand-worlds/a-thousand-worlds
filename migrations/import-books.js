/** Converts books from A Thousands Worlds V1 */
const fs = require('fs')
const promptly = require('promptly')
const uuid = require('uuid').v4
const axios = require('axios').default
// used to search publisher metadata (not presented at source data)
const isbn = require('node-isbn')

const envFile = process.argv[process.argv.length - 1]

if (envFile.endsWith('import-books.js')) {
  console.log('Ussage: npm run import:books PATH_TO_ENV_FILE')
  process.exit(0)
}

require('dotenv').config({ path: envFile })

console.log(`using firebase config from <${envFile}>`)

/** loading firebase website "collection" and mapping to array */
const loadCollection = (f, path) => {
  return new Promise((resolve, reject) => {
    const db = f.database()
    const ref = db.ref(path)
    ref.once('value', snap => {
      const collection = snap.val()
      resolve(
        Object.keys(collection).map(id => {
          const record = collection[id]
          if (!record.id) record.id = id
          return record
        }),
      )
    })
  })
}

/** loads json data from url */
const loadJsonUrl = async url => {
  const data = await axios.get(url)
  return data.data
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

/** Metadata by isbn functions */
const _isbn = (code, provider) => {
  return (
    isbn
      .provider([provider])
      .resolve(code)
      // eslint-disable-next-line node/handle-callback-err
      .catch(err => {
        console.log(
          `book isbn metadata <${code}> not exists at <${provider}> error! (nothing special - just to know)`,
        )
        return null
      })
  )
}

const isbnSearch = async code => {
  const gBook = await _isbn(code, 'google')
  const oBook = await _isbn(code, 'openlibrary')
  if (!gBook && !oBook) {
    return null
  }
  const info = {
    publisher:
      gBook && gBook.publisher ? gBook.publisher : oBook && oBook.publisher ? oBook.publisher : '',
  }
  return info
}

/** Normalizes 1.0 tags to match 2.0 tags. */
const normalizeTag = tag =>
  tag ? tag.replace('-', ' ').replace('transitions', 'transition').toLowerCase() : ''

/** Converting tags */
const convertTags = (bookTags, tags) => {
  return bookTags
    .map(tagName => {
      const tag = tags.find(
        tg =>
          // Convert "Non-fiction" to "Non fiction" for comparison
          normalizeTag(tg.tag) === normalizeTag(tagName),
      )
      if (!tag) console.error(`Converting tag ${tagName} failed. Tag not found`)
      return tag
    })
    .filter(x => !!x)
    .reduce((accum, tag) => {
      accum[tag.id] = true
      return accum
    }, {})
}

/** Converting creators. */
const convertCreator = (name, creators, creator) => {
  let person = creators.find(p => p.name.toLowerCase() === name.toLowerCase())
  if (person) {
    return {
      creator: person,
      new: [],
    }
  }
  console.log(`Creator <${name}> not found in database. Preparing new`)
  const id = uuid()
  person = {
    id: id,
    createdAt: new Date().toISOString(),
    createdBy: creator.uid,
    approvedAt: new Date().toISOString(),
    approvedBy: creator.uid,
    updatedAt: new Date().toISOString(),
    updatedBy: creator.uid,
    name: name,
    bio: '',
  }
  return {
    creator: person,
    new: [person],
  }
}

/** Converting contributor */
const convertContributor = async (name, contributors) => {
  const contributor = contributors.find(
    user => name && user.profile.name && user.profile.name.toLowerCase() === name.toLowerCase(),
  )
  if (contributor) {
    console.log(`contributor ${name} recognized as userid <${contributor.id}>`)
    return { contributor }
  }
  console.log(
    `contributor <${name}> not recognized!\nSelect existing user to be used as book contributor or use "new" to create new user:`,
  )
  contributors.forEach(user => console.log(`\t${user.profile.name} <${user.profile.email}>`))
  console.log('\tnew - to create new user')
  const newContributor = await promptly.choose(
    "Select contributor's full name or email [new]: ",
    [...contributors.map(u => u.profile.email), ...contributors.map(u => u.profile.name), 'new'],
    { default: 'new' },
  )
  if (newContributor !== 'new') {
    const ret = {
      contributor: contributors.find(
        user => user.profile.email === newContributor || user.profile.name === newContributor,
      ),
    }
    console.log(`set <${ret.contirbutor.profile.name}> as book contributor`)
    return ret
  }
  const id = uuid()
  console.log(`new contributor user <${name}> prepared with id <${id}>`)
  return {
    contributor: {
      id,
      profile: {
        name,
        email: '',
      },
      roles: {
        contributor: true,
      },
    },
    new: true,
  }
}

/** Converting book from source data to new structure */
const convertBook = async (info, creators, tags, contributors, creator) => {
  const id = uuid()
  const bookCreators = {}
  let newCreators = []
  let newContributors = []
  const authors = info.author.split(',').map(author => {
    const converted = convertCreator(author, creators, creator)
    newCreators = [...newCreators, ...converted.new]
    creators = [...creators, ...converted.new]
    return converted.creator
  })
  let illustratorIsSame = false
  const illustrators = info.illustrator
    .split(',')
    .map(illustrator => {
      if (illustrator.toLowerCase() === 'same') {
        illustratorIsSame = true
        return null
      }
      const converted = convertCreator(illustrator, creators, creator)
      newCreators = [...newCreators, ...converted.new]
      creators = [...creators, ...converted.new]
      return converted.creator
    })
    .filter(x => !!x)
  authors.forEach(a => {
    bookCreators[a.id] = 'author'
    if (illustratorIsSame) {
      bookCreators[a.id] = 'author-illustrator'
    }
  })
  illustrators.forEach(a => {
    bookCreators[a.id] = 'illustrator'
  })
  console.log('creators converted')
  const bookTags = convertTags(info.tags, tags)
  console.log('tags converted')
  const cover = {
    downloadUrl: `http://athousandworlds.org/assets/covers/${info.isbn}.jpg`,
  }
  const meta = await isbnSearch(info.isbn)

  const contributor = await convertContributor(info.details.reviewer, contributors, creator)
  if (contributor.new) newContributors = [...newContributors, contributor.contributor]

  const book = {
    id: id,
    createdBy: contributor.contributor.id,
    createdAt: new Date().toISOString(),
    creators: bookCreators,
    goodreads: info.details.goodreads || '',
    isbn: info.isbn ? info.isbn.toString() : '',
    cover: cover,
    publisher: meta.publisher,
    reviewedAt: new Date().toISOString(),
    reviewedBy: creator.uid,
    status: 'approved',
    summary: info.details.text,
    tags: bookTags,
    title: info.title,
    year: info.details.year,
  }

  return { book, newCreators, newContributors }
}

/** Main function */
const go = async () => {
  console.log('Initializing firebase')
  const usr = await promptly.prompt(`Website owner authentication email`)
  const pwd = await promptly.password(`Website owner authentication password for <${usr}>`)
  console.log('Connecting to firebase')
  const firebase = initFirebase()
  let credentials = null
  try {
    credentials = await firebase.auth().signInWithEmailAndPassword(usr, pwd)
  } catch (err) {
    credentials = null
  }
  if (!credentials) {
    console.log('Firebase authentication error. Nothing done. Aborting')
    return
  }
  console.log(`Authorized as ${credentials.user.displayName} - ${credentials.user.uid}>.`)

  console.log('downloading import data')
  const importBooks = await loadJsonUrl('http://athousandworlds.org/2020.json')
  const importDetails = await loadJsonUrl('http://athousandworlds.org/2020-detail.json')
  console.log('loaded books', importBooks.length)

  console.log(`Loading existing data.`)

  const books = await loadCollection(firebase, 'books')
  const tags = await loadCollection(firebase, 'tags/books')
  const creators = await loadCollection(firebase, 'people')
  const users = await loadCollection(firebase, 'users')
  const contributors = users.filter(
    user => user.roles && (user.roles.contributor || user.roles.owner),
  )

  console.log('existing books', books.length)
  console.log('existing tags', tags.length)
  console.log('existing creators', creators.length)
  console.log('existing contributors', contributors.length)

  if (!books || !tags || !creators || !contributors || !importBooks || !importDetails) {
    console.error('Data missing! Aborting')
    process.exit(1)
  }

  const newBooks = importBooks
    .map((eb, i) => {
      const details = importDetails[`${i + 1}`]

      const exByName = books.find(book => eb.title.toLowerCase() === book.title.toLowerCase())
      const exByIsbn = books.find(book => details.isbn === book.isbn)
      const exByIsbn13 = books.find(book => details.isbn13 === book.isbn)

      if (!exByName && !exByIsbn && !exByIsbn13) {
        eb.details = details
        return eb
      }
      return null
    })
    .filter(x => !!x)

  if (!newBooks.length) {
    console.log('There is no new books. Aborting')
    return
  }
  console.log(`\nFound <${newBooks.length}> new books:`)
  newBooks.forEach(book => console.log(`\t${book.title}`))

  let books2create = []
  let creators2create = []
  let contributors2create = []
  let yesAll = false
  // eslint-disable-next-line fp/no-loops
  for (const info of newBooks) {
    console.log(`\nPreparing book <${info.title}>`)
    const { book, newCreators, newContributors } = await convertBook(
      info,
      [...creators, ...creators2create],
      tags,
      [...contributors, ...contributors2create],
      credentials.user,
    )
    let ok = 'yes'
    if (!yesAll) {
      ok = await promptly.choose(
        `Create new book <${book.title}>? [Yes/no/abort/all]`,
        ['yes', 'no', 'abort', 'all'],
        { default: 'yes' },
      )
    }
    if (ok === 'abort') {
      console.log('aborting')
      process.exit(0)
    }
    if (ok === 'no') {
      console.log('skipping')
      continue
    }
    if (ok === 'all') {
      yesAll = true
    }
    books2create = [...books2create, book]
    creators2create = [...creators2create, ...newCreators]
    contributors2create = [...contributors2create, ...newContributors]
  }

  console.log(
    `\nBooks to create: ${books2create.length}\nCreators to create: ${creators2create.length}\nContributors to create: ${contributors2create.length}`,
  )

  const saveOrUpload = await promptly.choose(
    'Upload to firebase or save to files? [upload/save/Abort]',
    ['upload', 'save', 'abort'],
    { default: 'abort' },
  )
  if (saveOrUpload === 'abort') {
    console.log('Aborting. No database changes done')
    return
  }

  if (saveOrUpload === 'save') {
    let savePath = await promptly.prompt('Path to save new json data? [./]', { default: './' })
    if (!savePath.endsWith('/')) savePath += '/'
    fs.writeFileSync(`${savePath}books2create.json`, JSON.stringify(books2create, null, 2))
    fs.writeFileSync(`${savePath}creators2create.json`, JSON.stringify(creators2create, null, 2))
    fs.writeFileSync(
      `${savePath}contributors2create.json`,
      JSON.stringify(contributors2create, null, 2),
    )
    console.log(
      `Files <${savePath}books2create.json>, <${savePath}creators2create.json> and <${savePath}contributors2create.json> saved.`,
    )
    console.log(
      '(No database changes done. To apply changes to database - restart and use "upload" option)',
    )
    return
  }

  // creating contributors users
  // eslint-disable-next-line fp/no-loops
  for (const user of contributors2create) {
    const ref = firebase.database().ref(`users/${user.id}`)
    const data = {
      profile: user.profile,
      roles: user.roles,
    }
    await ref.set(data)
    console.log(`Contributor user <${user.profile.name}> saved [${user.id}]`)
  }

  // creating creators
  // eslint-disable-next-line fp/no-loops
  for (const creator of creators2create) {
    const ref = firebase.database().ref(`people/${creator.id}`)
    await ref.set(creator)
    console.log(`Creator <${creator.name}> saved [${creator.id}]`)
  }

  // creating books
  // eslint-disable-next-line fp/no-loops
  for (const book of books2create) {
    const ref = firebase.database().ref(`books/${book.id}`)
    await ref.set(book)
    console.log(`Book <${book.title}> saved [${book.id}]`)
  }
}

if (require.main === module) {
  go()
    .then(() => {
      console.log('done')
      process.exit(0)
    })
    .catch(err => {
      console.error('error happens on books creations', err)
      process.exit(1)
    })
}

module.exports = { convertCreator, convertTags, loadJsonUrl, normalizeTag }
