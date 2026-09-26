# A Thousand Worlds

## Setup

1. `git clone https://github.com/a-thousand-worlds/a-thousand-worlds-2/`
1. `npm install`
1. `cd functions && npm install && cd ..`
1. Add `./node_modules/.bin` to your `PATH` so that running `firebase` will reference your locally installed `firebase-tools`
   - Add to .bash_profile: `export PATH="./node_modules/.bin:$PATH"`
1. Create new project at [firebase.google.com](http://firebase.google.com)
1. Create web app in Firebase project
1. Save Firebase config into `.env.local`
   - App → Firebase SDK snippet → Config
1. Create Realtime Database in Firebase project
1. Enable Firebase Storage
1. Configure CORS policy for storage bucket
   - Copy the storage folder path which appears at the top of the Storage → Files table, e.g. `gs://a-thousand-worlds.appspot.com`
   - Open the [GCP console](console.cloud.google.com) and start a cloud terminal session by clicking the >\_ icon button in the top navbar.
   - Click the "Open Editor" button with the pencil icon.
   - Create `cors.json` with the contents of `firebase.storage.cors.json`.
   - Click the "Open Terminal" button and run `gsutil cors set cors.json gs://a-thousand-worlds.appspot.com`. Use the storage folder path you copied in the first step above.
1. Enable Email/Password authentication
   - Authentication → Sign-in method
1. Add `firebase.rules.json` to Realtime Database access rules and publish
   - Realtime Database → Rules
1. `firebase login`
1. Set active Firebase app: `firebase use --add`
1. Generate service account key
   - Firebase Project -> Settings -> Service Accounts -> Generate new private key
   - Save to `/functions/serviceAccountKey.json`
1. No setup is needed for the read-only database MCP server — it is registered in `.mcp.json` and
   reads the public paths without credentials. See [Database MCP server](#database-mcp-server).
1. Add Goodreads API key for firebase function
   - `firebase functions:config:set goodreads.api_key="YOUR_API_KEY"`
1. Add ISBNdb API key to `/functions/.env`. You can define API key later on Firebase functions details -> Variables, and redeploy `searchBookCover` function later.
1. Deploy Firebase functions: `firebase deploy --only functions`
1. Add Request URL from Firebase Functions dashboard to `VUE_APP_SEARCH_BOOK_COVER_URL` in .env.local
   - https://console.firebase.google.com/u/0/project/PROJECT_NAME/functions/list
1. Set administrator email functions config:
   - `firebase functions:config:set project.admin_email="ADMIN_EMAIL"`
1. Set allowed email recipients (optional):
   - Allows unauthorized users to send emails to site owners/admin
   - Defaults to config.project.admin_email
   - `firebase functions:config:set project.allowed_email_recipients.0="EMAIL"`
1. Copy firebase config for local emulator:
   - `firebase functions:config:get > functions/.runtimeconfig.json`
1. Navigate to `FUNCTIONS_URL/buildCache` to build `public/dbcache.js`.
   - Get full endpoint URL at Firebase Functions dashboard (same baseUrl as `VUE_APP_SEARCH_BOOK_COVER_URL`)
   - File `dbcache.js` and book covers generated automatically at Firebase hosting—no redeployment required.
1. After creating a user via the UI, you can promote them to owner by signing up as a regular user and then manually setting `roles: { owner: true }` in the `/users` entry.
1. To fill your Firebase Realtime Database, choose one of the following:
   - Go to your Firebase Console → Realtime Database.
   - Open the Data tab.
   - Click Import JSON and select your file.

   or
   - run `npm run import:data PATH_TO_JSON_FILE` (your JSON file may include `"users"` with defined email/password for login; if password is not defined, it will be set to the email)

## Development

Start the server and navigate to: http://localhost:8080

```sh
npm start
```

_\*The server must be restarted if `.env` changes_

Run Firebase functions with the local emulator to enable book search API:

```sh
# pull remote config down to be used by emulator
firebase functions:config:get > functions/.runtimeconfig.json

# build and run emulators
npm run build
firebase emulators:start
```

## Database MCP server

`mcp/firebase-read/` is an MCP server that gives agent sessions read-only access to the Realtime
Database, so they can query live data directly instead of shelling out to `curl` or
`firebase database:get`. It is registered for the project in `.mcp.json` and needs no setup: run
`npm install` and it starts on demand.

It exposes three tools, and only these three:

| Tool         | Does                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `list_paths` | Lists the top-level paths and whether each one is public or gated. No network call.                                                  |
| `list_keys`  | Lists the child keys at a path without downloading their values.                                                                     |
| `get_value`  | Reads the value at a path, optionally narrowed by `shallow`, `orderBy`, `limitToFirst`/`limitToLast` or `startAt`/`endAt`/`equalTo`. |

**It cannot write.** There is no `set`, `update`, `push` or `remove` tool, and the client
underneath issues nothing but HTTP GET — the method is a literal at a single call site, never a
parameter, so the Realtime Database's write verbs (PUT, PATCH, POST, DELETE) are unreachable even
when an admin token is attached. `mcp/firebase-read/server.test.js` asserts this: mutation attempts
are rejected as unknown tools, every read is a GET, and neither module names a mutating method.

### Paths

The paths `firebase.rules.json` marks `".read": true` — `books`, `cache`, `content`, `invites`,
`links`, `people`, `tags` — are read anonymously, with no credentials loaded.

`logs`, `submits`, `users` and the database root are gated. Reading one mints an access token from
`functions/serviceAccountKey.json` (the same key the Firebase functions use), which is loaded lazily
— only on a call that actually needs it. Without that key a gated read fails with a message saying
so; the public paths keep working. Set `ATW_SERVICE_ACCOUNT_KEY` to use a key from another location.

### Sampling

A read over 100,000 characters is refused rather than truncated, since truncated JSON cannot be
parsed. Sample a large collection instead:

- `list_keys` with path `books` for the ids and the count
- `get_value` with path `books` and `shallow: true` for the same thing as a raw map
- `get_value` with path `books`, `orderBy: "$key"` and `limitToFirst: 5` for a handful of records
- `get_value` with path `books/<id>/title` for one field

`shallow` cannot be combined with `orderBy` or a limit — Firebase returns every key, in
lexicographical order. Raise the size limit with `ATW_MAX_RESPONSE_CHARS` if a bulk read is really
wanted.

The database URL comes from `VUE_APP_FIREBASE_DATABASE_URL`, read from the environment or, failing
that, from `.env.production`, `.env.local` or `.env` — so the server follows whichever database the
rest of the project is pointed at.

## Database caching

A static cache of the database is stored at `/public/dbcache.js` for performance.

### Local

To update your local dbcache with the latest books in production:

```sh
npm run update:dbcache .env.local
```

- Enter email and password for your ATW account **(not Firebase)**.
- The env file you pass determines which Firebase database and storage the local cache is built from. To fix a bad production cache, do not deploy a local one — clear `cache/clean` (or set it to false) in the database and hit the `buildCache` function endpoint.
- Book covers are also cached from Firebase Storage to Firebase Hosting (because Hosting is faster).
- The script downloads books covers to `/public/img`, and saves the database cache to `/public/dbcache.js`
  - It is best not to deploy the local cache to production with `firebase deploy`. Instead, use the production instructions below.

### Production

- Cache rebuilds daily by Firebase pubsub (cron) at 00:00 New York timezone.
  - To configure automatic schedule and timezone, update `functions/index.js` file (line 75) and redeploy Firebase functions (`firebase deploy --only functions`)
  - The local cache cannot not updated automatically because firebase emulators to not have cron functionality.
- The website uses `cache/clean` in Firebase to check if cache rebuilding is not required.
  - To manually rebuild the cache, clear the flag in the Firebase console and hit the `buildCache` Firebase function endpoint.
  - `update:dbcache` ignores `cache/clean`
- buildCache http entrypoint and cron pubsub function
  - To use rebuild cache on Firebase Hosting websites manually there is `FUNCTIONS_URL/buildCache` entrypoint with available query param `host`.
  - Default value for `host` param is `'all'` but it applies Firebase Website `SITE_ID` value if there are many websites use same Firebase Database and functions.
  - Default automatic cache updatating function updates all websites. To configure this behavior - update `functions/buildCacheCron.js` (line 5). For separate autoupdatess of multiple websites, duplicate `functions/buildCacheCron.js` and update `function/buildCacheCron*.js` and `functions/index.js`.

### Deploy

Make sure that local cache files are correct or not deployed.

```sh
npm run deploy
```

### Email

The website needs a properly configured and authorized email server to send emails to users on invite, book submission, etc.

1. Create and configure mailgun account
1. Update DNS sending (TXT) and optionally receiving (MX) records
1. Generate sending SMTP credentials for domain
   - Maingun dashboard -> Sending -> Domain settings -> SMTP credentials
   - For `postmater@DOMAIN` click `Reset password` -> on appeared popup click `Copy` button -> temporary save password for later use
   - Or generate new SMTP user and use this user later replacing postmaster@DOMAIN
1. Set firebase function configuration to send emails:
   - `firebase functions:config:set mailgun.user="postmaster@DOMAIN" mailgun.password="POSTMASTER_PASSWORD" mailgun.sender="sender-email@DOMAIN"` (sender email can be any at your domain, for example: bot@DOMAIN)

## Customize Vue configuration

See [Configuration Reference](https://cli.vuejs.org/config/)
