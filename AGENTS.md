# Agent Instructions

## Session titles

The prefix glossary arrives from the `emotive` plugin; these are the parts specific to this repo.

- `📦 ` means `npm run lint && npm run build && npm test` all pass on the branch — the gates the
  `ship` skill runs, and the only signal that gates a merge, which does not wait on CI.
- `🚀 ` ships to `main`, through a PR that `.github/skills/ship/SKILL.md` squash-merges itself; that
  skill sets the prefix as its last step, once the merge has landed. `📦 ` holds until then.
- `🚙 ` is what this repo waits on a user for: a Firebase console import, a `gh pr merge` the
  permission classifier denied, a decision about live data.
- `💾 ` is the live Firebase project — one project behind every worktree. `🔍 `, `🔒 ` and `🔓 ` are
  inert here: nothing in this repo takes a lock, and the live-data hazard is `💾 `'s.

**`💾 ` is the one that matters to _other_ sessions.** The `migrations/` scripts read live data into
`/tmp/atw/` and write the rebuilt file back by hand, so a fact read early in a turn can be stale by
the end of one; `npm run deploy` publishes hosting for everyone; `firebase database:*` writes
directly; and nothing locks any of it. Before touching live data, list the sessions
(`mcp__ccd_session_mgmt__list_sessions`) and look for another carrying `💾 `. A record that changes
without your having changed it is that, not a bug. Handing the user something still in flight —
importing a rebuilt JSON through the Firebase console, watching a deploy — keeps `💾 ` until it
lands.

A cloud session never reaches `💾 `, though not for want of a database URL: `.env.production` is
tracked and fully populated, so a fresh clone can _read_ production from the first commit. What it
cannot do is change anything. Writing needs `functions/serviceAccountKey.json` and deploying needs a
`firebase login`, and both of those live outside git. It ends at `📦 ` or `🚙 `.

## Running the app

`npm start` serves the dev build at http://localhost:8080. A new worktree needs no setup step by
hand.

Everything a worktree needs is gitignored, and `.claude/hooks/sync-worktree-local-files.sh` places
it on `SessionStart`: `.env.local` and `public/dbcache.js` are copied from the main checkout,
`public/img` is symlinked to it — the photos are the bulk of it (~19M today) and are a generated
per-machine artifact, so one copy is enough, while the small two stay copies so a worktree can
diverge — and `node_modules` is symlinked to it as well, whenever the main checkout's tree is
provably the one this branch needs. Each is placed only when missing. Do not hand-copy or
hand-install them; if one is absent, the hook is what to fix.

Without them the app still boots — the store falls back to reading Firebase live — but the console
says the cache has not been generated, and every cover and portrait 404s.

**`npm install <pkg>` from a worktree writes through the `node_modules` symlink**, changing the
_main checkout's_ dependencies — the same hazard as `update:dbcache` below, one layer down. To add
or change a dependency on a branch, give the worktree a tree of its own first,
`rm node_modules && npm ci`, which the hook then leaves alone. Sharing is worth this because a
symlink is instant where duplicating the tree costs more than a clean install; the main checkout
stays on `main` so the two trees keep agreeing, since a checkout parked on a feature branch, or one
that pulled a dependency change without reinstalling, silently costs every new worktree a full
install. `docs/worktrees.md` has the mechanism, the measurements, and the approaches that were tried
and rejected.

**`npm run update:dbcache .env.local` writes through the symlink.** Run from a worktree it rebuilds
that worktree's own `public/dbcache.js`, but adds new photos to the _main checkout's_ `public/img`,
which every other worktree is reading. It reads live Firebase too, so it is `💾 ` work.

**The dev server snapshots `public/` at startup.** A file added there afterwards — a freshly
generated `dbcache.js` — is served as the SPA fallback instead, which arrives as HTML and is refused
as a script. Restart the server; reloading the page will not pick it up.

**Hot reload does not reach the in-app Browser pane.** The dev server hands the client its LAN
address for the HMR socket (`ws://192.168.x.x:8080/ws`), which the sandboxed pane cannot open, so its
console shows a failed WebSocket and edits never hot-reload there. Reload the pane by hand, or
preview in Brave, where it works normally. Not a defect to chase.

## Reading live data

The `atw-firebase` MCP server, registered for the project in `.mcp.json`, is how a session reads the
production Realtime Database: `list_paths` for the shape, `list_keys` for a collection's ids,
`get_value` for a record or a field. Reach for it before `curl`, which the auto-mode classifier stops
as a production read, and before `firebase database:get`, which needs the Firebase CLI's own login.
The MCP tools stop for nothing, because there is nothing to weigh — the server issues HTTP GET and
exposes no `set`, `update`, `push` or `remove`, so a mutation is not something it can be asked for.

**A read through it is not `💾 ` work.** `💾 ` warns other sessions that live state is changing;
these tools change nothing, in the database or on disk. Nothing needs announcing, and no other
session needs checking first.

The world-readable paths — `books`, `cache`, `content`, `invites`, `links`, `people`, `tags` — need
no credentials at all. `logs`, `submits`, `users` and the database root need
`functions/serviceAccountKey.json`, which is gitignored; without it those reads fail with a message
saying so and every other path keeps working.

Do not pull a whole table. A `get_value` over the size limit is refused rather than truncated, since
truncated JSON cannot be parsed — take the ids with `list_keys`, or a few records with `orderBy`
plus `limitToFirst`. `README.md` → Database MCP server has the tools and their options;
`docs/firebase-read-mcp.md` has the REST behaviour behind them and the designs that were rejected.

## Linting

`npm run lint` covers `src`, `functions`, `mcp` and `vue.config.js`, and `.husky/pre-push` runs it
again, so a lint failure blocks the push rather than the commit.

**`fp/no-mutating-methods` rejects `.sort()`.** `src/` works around it with
`// eslint-disable-next-line fp/no-mutating-methods`, which predates the non-mutating array methods.
In Node-side code — `mcp/`, `migrations/`, `functions/` — write `.toSorted()` instead and skip the
comment; it satisfies the rule rather than suppressing it. Leave the existing disables in `src/`
alone rather than churning browser code for it.

## Tests

Vitest defaults to jsdom here, and `src/` is ESM while `mcp/`, `migrations/` and `functions/` are
CommonJS. A test for Node-side code therefore opens with `// @vitest-environment node` and loads its
subject through `createRequire(import.meta.url)` rather than `import`, which keeps Vite's ESM
transform away from a file written for Node's own resolver. `mcp/firebase-read/server.test.js` is
the worked example.

## Documented solutions

`docs/solutions/` holds documented solutions to past problems (bugs, best practices, workflow
patterns), organized by category with YAML frontmatter (`module`, `tags`, `problem_type`). Relevant
when implementing or debugging in an area one of them covers. The longer-form engineering write-ups
stay where they are — [`docs/worktrees.md`](docs/worktrees.md) and
[`docs/firebase-read-mcp.md`](docs/firebase-read-mcp.md) — and `README.md` has the setup, the
Database MCP server reference, and how the dbcache is built and deployed.
