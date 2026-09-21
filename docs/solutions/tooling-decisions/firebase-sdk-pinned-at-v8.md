---
title: The firebase client SDK is pinned at v8; exclude it from blanket dependency upgrades
date: 2025-12-07
category: tooling-decisions
module: firebase
problem_type: tooling_decision
component: tooling
severity: high
related_components:
  - frontend
  - authentication
  - database
applies_when:
  - Running a blanket dependency upgrade across package.json
  - Any PR proposes bumping firebase on its own
  - Adding a new Firebase call site in src/
tags:
  - firebase
  - realtime-database
  - firebase-storage
  - auth
  - dependency-upgrade
  - build
---

# The firebase client SDK is pinned at v8; exclude it from blanket dependency upgrades

## Context

`package.json` pins `"firebase": "^8.8.0"` while almost everything around it is current
(`vue` 3.5, `webpack` 5.103, `eslint` 9, `firebase-tools` 14, `firebase-admin` 13). The pin
reads like neglect, so it invites exactly the fix that has already been tried and undone:
PR #23 swept it to `^12.6.0` along with the rest of the dependency list, and PR #24 put it
back to `^8.8.0` on its own two weeks later, touching nothing else.

The pin is deliberate. It is a consequence of how `src/` talks to Firebase, and nothing in
`package.json` says so.

## Guidance

Leave `firebase` out of any upgrade that is not itself a v9+ modular migration. When a
blanket upgrade or a bot PR includes it, split that one line back out rather than taking
the whole set.

The whole browser client goes through the v8 namespaced (compat) API. `src/firebase.js` is
the single entry point:

```js
import firebase from 'firebase/app'
import 'firebase/auth'
import 'firebase/database'
import 'firebase/storage'

firebase.initializeApp(firebaseConfig)

export default firebase
```

Both halves of that are v8 shapes. `firebase/app` stopped having a namespaced default
export in v9, and the bare side-effect subpath imports (`import 'firebase/auth'`) that
attach `auth`, `database` and `storage` onto it stopped existing at the same time. Every
consumer then calls through the accessors that idiom produces — 27 `firebase.auth()`
/ `firebase.database()` / `firebase.storage()` call sites, concentrated in
`src/store/user.js` and `src/store/modules/collection.js` and spread across
`src/store/books.js`, `src/store/invites.js`, `src/store/links.js`,
`src/store/modules/managed.js`, `src/util/sendEmail.js`, `src/util/setCacheRequired.js`
and `src/util/ckeditorFirebaseUploadAdapter.js`.

**No consumer imports `@/firebase` statically.** In every one of those files the static
import is commented out and the default export is reached through a lazy, chunk-split
import, so a v9 rewrite has to preserve the deliberate `firebase` webpack chunk as well
as change the syntax:

```js
// import firebase from '@/firebase'
const firebaseImport = () => import(/* webpackChunkName: "firebase" */ '@/firebase')
const firebasem = await firebaseImport()
const firebase = firebasem.default
```

So moving off v8 is a code migration, not a version bump. It has two honest shapes:

- **Compat shim.** Repoint the imports at `firebase/compat/app` and `firebase/compat/auth`
  and friends. Every call site keeps working, and the codebase is left on a deprecated
  compatibility layer.
- **Modular rewrite.** Rewrite `src/firebase.js` to export the individual service
  instances, and convert all ~30 call sites from `firebase.database().ref(path)` to
  `ref(getDatabase(), path)`. This is the real migration and the only one that ends
  anywhere good.

Either one is its own piece of work with its own test pass. Neither belongs inside a PR
whose subject is "Upgrade main dependencies".

## Why This Matters

This pin is load-bearing for auth, the Realtime Database and Storage at once, which is to
say for the entire app. A bump that compiles is not evidence of anything here; the failure
surfaces wherever a `firebase.*()` accessor is first reached at runtime.

It has already cost one round trip: merged in #23, reverted in #24 two weeks later. That
is the recurrence this note is meant to stop, and it is the recurrence a bot PR will
propose again on its own schedule.

**The pin is load-bearing outside `src/` too.** Three Node-side scripts initialize the
same v8 client SDK with the same two v8 shapes — `migrations/update-dbcache.js`,
`migrations/import-books.js` and `migrations/import-db.js`, each doing
`require('firebase/app')` plus the bare `firebase/auth` and `firebase/database` subpath
requires. `update-dbcache.js` is what `npm run update:dbcache` runs, and `npm run deploy`
runs it in turn, so a v9 bump breaks the dbcache rebuild as silently as it breaks the app.

Note what is _not_ pinned. The separate Node-side Firebase packages carry no compat
constraint: `firebase-admin` (`^13.6.0`, used by `functions/`, already current and
untouched by #23) and `firebase-tools`, which #23 moved from `^14.0.0` to `^14.26.0` and
which stayed there. The constraint belongs to the `firebase` package alone.

## When to Apply

- Before merging any multi-dependency upgrade — check whether `firebase` is in the diff.
- When a PR bumps `firebase` on its own.
- When writing a new Firebase call site: follow the existing lazy-`firebaseImport()` plus
  `firebase.database()` idiom above rather than v9 modular syntax, which will not resolve
  against the installed version.
- When touching `migrations/`, which loads the same v8 client SDK directly.

## Examples

The revert that establishes the pin, PR #24 — one line, nothing else in the diff:

```diff
-    "firebase": "^12.6.0",
+    "firebase": "^8.8.0",
```

Everything else PR #23 raised stayed raised. Only this line came back.

## Related

- PR #23 (`d0197d3`, 2025-11-24) — "Upgrade main dependencies". Swept `firebase` from
  `^8.8.0` to `^12.6.0` alongside ~40 other packages.
- PR #24 (`2e3e18c`, 2025-12-07) — "Revert firebase version". Reverted that one line and
  nothing else, two weeks later.
- `src/firebase.js` — the single v8 entry point the pin exists to protect.
- `AGENTS.md` → Reading live data — the read-only MCP path for production, unaffected by
  the client SDK version.
