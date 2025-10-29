const fs = require('fs')
const path = require('path')
const dotenv = require('dotenv')
const admin = require('firebase-admin')

const fileArg = process.argv[process.argv.length - 1]
if (!fileArg || process.argv.length <= 2) {
  console.error('File path is required.')
  process.exit(1)
}

const filePath = path.resolve(process.cwd(), fileArg)
const envPath = path.resolve(process.cwd(), '.env.local')
const serviceAccountPath = path.resolve(process.cwd(), 'functions/serviceAccountKey.json')

if (path.extname(filePath).toLowerCase() !== '.json') {
  console.error('File must have a .json extension')
  process.exit(1)
}

if (!fs.existsSync(filePath)) {
  console.error(`JSON file not found at ${filePath}`)
  process.exit(1)
}

if (!fs.existsSync(serviceAccountPath)) {
  console.error(`Service account key not found at ${serviceAccountPath}`)
  process.exit(1)
}

dotenv.config({ path: envPath })

let payload
try {
  const fileContents = fs.readFileSync(filePath, 'utf8')
  payload = JSON.parse(fileContents)
} catch (error) {
  console.error(`File is invalid. Failed to parse JSON from ${filePath}: ${error.message}`)
  process.exit(1)
}

// skip users from import, so it leaves existing users untouched
const { users, ...payloadWithoutUsers } = payload
if (users) {
  console.log('Skipping import of "users". Existing users will remain untouched.')
}

admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath)),
  databaseURL: process.env.VUE_APP_FIREBASE_DATABASE_URL,
})

const run = async () => {
  try {
    const rootRef = admin.database().ref('/')
    const existing = (await rootRef.once('value')).val() || {}

    const updates = {}
    Object.entries(payloadWithoutUsers).forEach(([key, value]) => {
      updates[key] = value
    })

    Object.keys(existing).forEach(key => {
      if (key !== 'users' && !(key in payloadWithoutUsers)) {
        updates[key] = null
      }
    })

    await rootRef.update(updates)
    console.log('Data import complete!')
  } finally {
    await admin.app().delete()
  }
}

run().catch(err => {
  console.error('Unexpected error during import:', err.message)
  process.exit(1)
})
