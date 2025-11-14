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

admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath)),
  databaseURL: process.env.VUE_APP_FIREBASE_DATABASE_URL,
})

const syncUsersToAuthentication = async users => {
  const auth = admin.auth()

  if (!users || !Object.keys(users).length) {
    return
  }

  console.log('Authentication sync started.')

  for (const [uid, user] of Object.entries(users)) {
    const email = user?.profile?.email || user?.email

    let userById = null
    let userByEmail = null

    try {
      userById = await auth.getUser(uid)
      userByEmail = await auth.getUserByEmail(email)
    } catch (error) {
      if (error.code !== 'auth/user-not-found') {
        continue
      }
    }

    if (userById || userByEmail) {
      if (userById) {
        console.warn(`Skipped user ${uid}: user UID already exists.`)
      }

      if (userByEmail) {
        console.warn(`Skipped user ${email}: email already exists.`)
      }
      continue
    }

    try {
      const displayName = user?.profile?.name || user?.name || user?.displayName
      const password = user?.profile?.password || user?.password || email

      const createPayload = {
        uid,
        email,
        password,
        displayName,
        disabled: false,
      }

      if (!createPayload.email || !createPayload.password) {
        console.warn(`Skipping user ${email}: invalid data.`)
        continue
      }

      await auth.createUser(createPayload)
      console.log(`Created user ${email}.`)
    } catch (error) {
      console.error(`Failed to sync auth user ${email}: ${error.message}`)
    }
  }

  console.log('Authentication sync complete.')
}

const run = async () => {
  try {
    const rootRef = admin.database().ref('/')
    const existing = (await rootRef.once('value')).val() || {}

    const updates = {}
    Object.entries(payload).forEach(([key, value]) => {
      updates[key] = value
    })

    Object.keys(existing).forEach(key => {
      if (!(key in payload)) {
        updates[key] = null
      }
    })

    if (updates.users && Object.keys(updates.users).length) {
      await syncUsersToAuthentication(updates.users)
    }

    await rootRef.update(updates)
    console.log('Data import complete.')
  } finally {
    await admin.app().delete()
  }
}

run().catch(err => {
  console.error('Unexpected error during import:', err.message)
  process.exit(1)
})
