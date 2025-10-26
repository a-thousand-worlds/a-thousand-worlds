const functions = require('firebase-functions/v1')
const admin = require('firebase-admin')

const watch = functions
  .runWith({
    timeoutSeconds: 300,
    memory: '1GB',
  })
  .database.ref('/people/{id}')
  .onDelete(async (snap, context) => {
    const person = snap.val()
    console.log('deleting person photo', person.name)
    const bucket = admin.storage().bucket()
    const fname = `people/${context.params.id}`
    const file = await bucket.file(fname)
    await file.delete()
  })

module.exports = watch
