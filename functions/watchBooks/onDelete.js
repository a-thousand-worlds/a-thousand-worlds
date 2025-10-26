const functions = require('firebase-functions/v1')
const admin = require('firebase-admin')

const watchBooks = functions
  .runWith({
    timeoutSeconds: 300,
    memory: '1GB',
  })
  .database.ref('/books/{id}')
  .onDelete(async (snap, context) => {
    const book = snap.val()
    console.log('deleting books cover', book.title, book.isbn)
    const bucket = admin.storage().bucket()
    const fname = `books/${context.params.id}`
    const file = await bucket.file(fname)
    await file.delete()
  })

module.exports = watchBooks
