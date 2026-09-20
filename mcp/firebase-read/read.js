/** A read-only REST client for the A Thousand Worlds Firebase Realtime Database.
 *
 * Every request this module issues is an HTTP GET. The Realtime Database REST API mutates data
 * only through PUT, PATCH, POST and DELETE, and no code path here can reach those verbs: the
 * method is a literal in a single function and is never a parameter. That holds even when a
 * gated read attaches a service account token, which carries full admin privileges.
 *
 * docs/firebase-read-mcp.md has the REST behaviour this works around and the designs it rejected.
 */

const fs = require('node:fs')
const path = require('node:path')

/** Top-level paths that firebase.rules.json exposes with ".read": true. */
const PUBLIC_PATHS = ['books', 'cache', 'content', 'invites', 'links', 'people', 'tags']

/** Top-level paths whose ".read" requires an authenticated owner or advisor. */
const GATED_PATHS = ['logs', 'submits', 'users']

const PROJECT_ROOT = path.resolve(__dirname, '..', '..')

/** dotenv-style files searched for the database URL, in precedence order. */
const ENV_FILES = ['.env.production', '.env.local', '.env']

/** Characters Firebase forbids in a key. Excluding "." also makes ".." unaddressable. */
const INVALID_KEY_CHARS = /[.$#[\]]/

/** Reads larger than this are refused rather than truncated, since a truncated JSON response
 * cannot be parsed. The default sits below the size of the whole books table on purpose: a table
 * that large costs more context than it is worth, so the error steers the caller to sample it
 * instead. Raise it with ATW_MAX_RESPONSE_CHARS when a bulk read really is wanted. */
const maxResponseChars = () => Number(process.env.ATW_MAX_RESPONSE_CHARS) || 100000

/** Query parameters that Firebase rejects when combined with shallow. */
const NARROWING_PARAMS = ['orderBy', 'limitToFirst', 'limitToLast', 'startAt', 'endAt', 'equalTo']

/** Reads one variable out of a dotenv-style file, or null when the file or the value is absent. */
const readEnvVar = (file, name) => {
  const filePath = path.join(PROJECT_ROOT, file)
  if (!fs.existsSync(filePath)) return null
  const line = fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .map(text => text.trim())
    .find(text => text.startsWith(`${name}=`))
  const value = line?.slice(name.length + 1).trim()
  return value ? value.replace(/^["']|["']$/g, '') : null
}

/** Resolves the database URL from the environment, falling back to the project's env files. */
const databaseUrl = () => {
  const url =
    process.env.VUE_APP_FIREBASE_DATABASE_URL ||
    ENV_FILES.map(file => readEnvVar(file, 'VUE_APP_FIREBASE_DATABASE_URL')).find(Boolean)
  if (!url) {
    throw new Error(
      `VUE_APP_FIREBASE_DATABASE_URL is not set and none of ${ENV_FILES.join(', ')} define it.`,
    )
  }
  return url.replace(/\/+$/, '')
}

/** Splits a database path into key segments, rejecting anything that is not a plain sequence of
 * Firebase keys. */
const parsePath = input => {
  const segments = String(input ?? '')
    .split('/')
    .filter(segment => segment.length > 0)
  const invalid = segments.find(segment => INVALID_KEY_CHARS.test(segment))
  if (invalid) {
    throw new Error(
      `Invalid path segment "${invalid}". Firebase keys cannot contain . $ # [ or ], so a relative path such as ".." does not address anything.`,
    )
  }
  return segments
}

/** Reports whether a path is world-readable or needs the service account, per
 * firebase.rules.json. The database root is gated: it has no ".read" of its own. */
const accessLevel = segments =>
  segments.length > 0 && PUBLIC_PATHS.includes(segments[0]) ? 'public' : 'gated'

/** Absolute path of the service account key. Overridable so a checkout can keep the key
 * elsewhere, and so the tests can point at a path that does not exist. */
const serviceAccountKeyPath = () =>
  process.env.ATW_SERVICE_ACCOUNT_KEY
    ? path.resolve(PROJECT_ROOT, process.env.ATW_SERVICE_ACCOUNT_KEY)
    : path.join(PROJECT_ROOT, 'functions', 'serviceAccountKey.json')

// Minting a token costs a round trip, so a burst of gated reads shares one.
let tokenCache = null

/** Mints an OAuth access token from the service account key, loading firebase-admin only when a
 * gated path is actually read. */
const accessToken = async () => {
  const keyPath = serviceAccountKeyPath()
  if (tokenCache?.keyPath === keyPath && tokenCache.expiresAt > Date.now()) return tokenCache.token

  if (!fs.existsSync(keyPath)) {
    throw new Error(
      `Reading a gated path needs the service account key, which is not at ${keyPath}. Generate one at Firebase Project → Settings → Service Accounts → Generate new private key and save it to functions/serviceAccountKey.json, or set ATW_SERVICE_ACCOUNT_KEY to its location.`,
    )
  }

  const admin = require('firebase-admin')
  const credential = admin.credential.cert(require(keyPath))
  const { access_token: token, expires_in: expiresIn } = await credential.getAccessToken()
  tokenCache = { keyPath, token, expiresAt: Date.now() + (expiresIn - 60) * 1000 }
  return token
}

/** Issues the only request this module can make: an HTTP GET. */
const requestGet = async (segments, params) => {
  const url = new URL(`${databaseUrl()}/${segments.join('/')}.json`)
  Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .forEach(([key, value]) => url.searchParams.set(key, String(value)))

  const token = accessLevel(segments) === 'gated' ? await accessToken() : null
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : null),
    },
  })

  const body = await response.text()

  if (!response.ok) {
    const detail = (() => {
      try {
        return JSON.parse(body).error
      } catch {
        return body.slice(0, 200)
      }
    })()
    throw new Error(`Firebase returned ${response.status} for /${segments.join('/')}: ${detail}`)
  }

  const max = maxResponseChars()
  if (body.length > max) {
    throw new Error(
      `/${segments.join('/')} is ${body.length} characters, over the ${max} limit. Narrow the read with shallow, a deeper path, or limitToFirst/limitToLast, or raise ATW_MAX_RESPONSE_CHARS.`,
    )
  }

  return JSON.parse(body)
}

/** Reads the value at a path. */
const get = async (dbPath, options = {}) => {
  const segments = parsePath(dbPath)
  const narrowing = NARROWING_PARAMS.filter(name => options[name] !== undefined)

  if (options.shallow && narrowing.length > 0) {
    throw new Error(
      `shallow cannot be combined with ${narrowing.join(', ')}. A shallow read always returns every key, in lexicographical order.`,
    )
  }

  // Firebase requires an ordering before it will apply a limit or a range.
  const orderBy = options.orderBy ?? (narrowing.length > 0 ? '$key' : undefined)

  return requestGet(segments, {
    shallow: options.shallow ? 'true' : undefined,
    orderBy: orderBy === undefined ? undefined : JSON.stringify(orderBy),
    limitToFirst: options.limitToFirst,
    limitToLast: options.limitToLast,
    startAt: options.startAt === undefined ? undefined : JSON.stringify(options.startAt),
    endAt: options.endAt === undefined ? undefined : JSON.stringify(options.endAt),
    equalTo: options.equalTo === undefined ? undefined : JSON.stringify(options.equalTo),
  })
}

/** Lists the child keys at a path without downloading their values. */
const keys = async dbPath => {
  const value = await get(dbPath, { shallow: true })
  if (value === null) return []
  if (typeof value !== 'object') {
    throw new Error(`/${parsePath(dbPath).join('/')} holds a single value, not a collection.`)
  }
  return Object.keys(value).toSorted()
}

module.exports = {
  GATED_PATHS,
  PUBLIC_PATHS,
  accessLevel,
  databaseUrl,
  get,
  keys,
  parsePath,
  serviceAccountKeyPath,
}
