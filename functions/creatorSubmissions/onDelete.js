const functions = require('firebase-functions/v1')
const admin = require('firebase-admin')

const watchBooks = functions
  .runWith({
    timeoutSeconds: 300,
    memory: '1GB',
  })
  .database.ref('/submits/people/{id}')
  .onDelete(async (snap, context) => {
    const sub = snap.val()
    console.log('deleting creator submission photo', sub.name)
    const bucket = admin.storage().bucket()
    const fname = `submits/people/${context.params.id}`
    const file = await bucket.file(fname)
    await file.delete()
  })

module.exports = watchBooks
