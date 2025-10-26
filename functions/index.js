const functions = require('firebase-functions/v1')
const coverImageByISBN = require('./coverImageByISBNServer')
const email = require('./email')
const metadataByISBN = require('./metadataByISBN')
const amazonSearchBook = require('./amazonSearchBook')

const watchBookSubmissions = require('./watchBookSubmissions')

const watchCreatorsSubmissionCreate = require('./creatorSubmissions/onCreate')
const watchCreatorsSubmissionUpdate = require('./creatorSubmissions/onUpdate')
const watchCreatorsSubmissionDelete = require('./creatorSubmissions/onDelete')

const watchBooksCreate = require('./watchBooks/onCreate')
const watchBooksUpdate = require('./watchBooks/onUpdate')
const watchBooksDelete = require('./watchBooks/onDelete')

const watchPeopleCreate = require('./watchPeople/onCreate')
const watchPeopleUpdate = require('./watchPeople/onUpdate')
const watchPeopleDelete = require('./watchPeople/onDelete')

const watchUsers = require('./watchUsers')

const buildCacheCron = require('./buildCacheCron')

/** HTTP Services */

exports.coverImageByISBN = functions.https.onRequest(coverImageByISBN())
exports.email = functions.https.onRequest(email())
exports.metadataByISBN = functions.https.onRequest(metadataByISBN())

// increase function memory since we are doing image processing
// https://firebase.google.com/docs/functions/manage-functions#set_timeout_and_memory_allocation
exports.amazonSearchBook = functions
  .runWith({
    timeoutSeconds: 300,
    memory: '1GB',
  })
  .https.onRequest(amazonSearchBook())

/** Watch functions */

exports.watchBookSubmissions = watchBookSubmissions

exports.watchBooksCreate = watchBooksCreate
exports.watchBooksUpdate = watchBooksUpdate
exports.watchBooksDelete = watchBooksDelete

exports.watchPeopleCreate = watchPeopleCreate
exports.watchPeopleUpdate = watchPeopleUpdate
exports.watchPeopleDelete = watchPeopleDelete

exports.watchCreatorsSubmissionCreate = watchCreatorsSubmissionCreate
exports.watchCreatorsSubmissionUpdate = watchCreatorsSubmissionUpdate
exports.watchCreatorsSubmissionDelete = watchCreatorsSubmissionDelete

exports.watchUsers = watchUsers

/* Cache functions */
/**/
// use for manual update
const buildCache = require('./buildCache')
exports.buildCache = functions
  .runWith({
    timeoutSeconds: 300,
    memory: '1GB',
  })
  .https.onRequest(buildCache())
/**/

exports.buildCacheCron = functions
  .runWith({
    timeoutSeconds: 300,
    memory: '1GB',
  })
  .pubsub.schedule('0 0 * * *')
  .timeZone('America/New_York')
  .onRun(buildCacheCron)
