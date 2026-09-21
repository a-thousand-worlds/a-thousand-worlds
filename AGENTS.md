# Agent Instructions

## Session titles

A lifecycle prefix on the session title says what a session is doing while it is doing it, so the
sidebar answers "which session is writing to the live database" without opening any of them. The
sidebar already shows a status dot (running / awaiting input / idle) and a branch glyph for worktree
sessions; neither can be set from here — `set_session_title` takes a title string and nothing else.
So a **single leading emoji on the title** is the only lever, and it is spent on what the app cannot
know: where the work stands.

| Prefix | Means                                                                                                            |
| ------ | ---------------------------------------------------------------------------------------------------------------- |
| `🎨 `  | brainstorming or designing with the user — exploring, sketching, deciding what to build                          |
| `⏳ `  | implementing — the weakest of them; every other prefix takes precedence                                          |
| `🔍 `  | auditing against live state — a dry run, or the plan it printed, with a write to follow                          |
| `🔓 `  | about to take that slot — queued or blocked on it — or just released it                                          |
| `🔒 `  | holding a single slot only one session can use at a time                                                         |
| `💾 `  | writing to the live Firebase project right now — a `migrations/` script, `firebase database:*`, `npm run deploy` |
| `📦 `  | done on the branch — gated and shippable without re-running anything                                             |
| `🚀 `  | shipping to `main`, or shipped                                                                                   |
| `🚙 `  | parked: the work is sound and waiting on the user (a decision, a credential, a confirmation click)               |
| `⏲️ `   | waiting on a task scheduled for later — nothing to do until it fires                                             |
| `🪦 `  | dead end — kept for the findings, not to resume                                                                  |
| `📚 `  | extracting learnings into `AGENTS.md`, `README.md` or the skills                                                 |

`🔍 `, `🔒 ` and `🔓 ` are inert here — nothing in this repo takes a lock, and the live-data
hazard is `💾 `'s. They are listed so the vocabulary reads the same in every repo, and are ready
the day a workflow grows into one.

**A design loop is not a park.** `🎨 ` holds through brainstorming and outranks `🚙 ` while it
does: the back-and-forth _is_ the stage, so a park prefix on every turn of it marks the session as
blocked without saying on what. It becomes `🚙 ` once the design is settled and waiting on a
decision, and `⏳ ` when that decision comes.

**Never mention a prefix in the response** — not what it was set to, not that it was already right,
not that it was left alone. It is sidebar state; say nothing about it unless asked.

These are **stages, not flags**: exactly one prefix at a time, and setting a new one replaces
whatever was there. **Every title carries one**, and a prefix comes off only when another takes its
place — a bare title says nothing about the session, and the sidebar cannot tell it apart from a
chat that never had a stage at all. A session with nothing left to do keeps the prefix of the last
stage it reached. The harness names a session, so every session starts without a prefix: putting the
first one on that inherited title is part of the first response, not something to wait for a stage
change to prompt. Only one reads cleanly at sidebar width, and `🚀 ` after `📦 ` is noise — the later
stage implies the earlier.

Set a prefix **optimistically** — when the stage _starts_, not when it succeeds — and correct it if
the stage falls over. A title that only becomes true at the end is blank for the whole stretch the
sidebar is there to describe. `🚀 ` is set by the `ship` skill, which sets it before it runs the
gates and puts it back if the ship does not land, so it stays true on its own. `📚 ` goes on the
moment a `learn` skill is invoked, before anything is read. The rest are set in the response that
enters the stage (`mcp__ccd_session_mgmt__set_session_title`), and nothing reconciles a title against reality: an
abandoned session keeps whatever prefix it had.

**Handing back is itself a stage.** A response that closes on something for the user to do — a
decision, a credential, a click — is a park, and `🚙 ` goes on before that response, since the idle
dot cannot tell "waiting on you" from "given up on". Handing over a change to the live project is
the exception: while the user is importing a rebuilt JSON through the Firebase console, or watching
a deploy, the data is still in flux, so it stays `💾 ` — the warning to other sessions outranks the
one to the user, who is already reading the response — and becomes `🚙 ` once nothing is in flight.

**`💾 ` is the one that matters to _other_ sessions.** Worktrees give each session its own checkout,
but there is one Firebase project behind all of them. The `migrations/` scripts read live data into
`/tmp/atw/` and write the rebuilt file back by hand, so a fact read early in a turn can be stale by
the end of one; `npm run deploy` publishes hosting for everyone; and nothing locks any of it. Before
touching live data, list the sessions (`mcp__ccd_session_mgmt__list_sessions`) and look for another
carrying `💾 `. A record that changes without your having changed it is that, not a bug.

**Ask which session this is before renaming one.** `mcp__ccd_session_mgmt__get_session` with
`"self"` is the only answer, and it changes under a fork: a forked session carries the whole
transcript, the id it read earlier in that transcript, and a different id of its own, so a rename
that reuses the remembered one retitles the session it forked _from_ — often the one still mid-write,
whose title is therefore the one the sidebar most needs to be true. A fork also starts in the
worktree of the session it forked from, and nothing stops a branch being checked out there, which
moves that worktree under the other session's feet; put it back on the branch it was on when the
work is landed.

A cloud session never reaches `💾 `, though not for want of a database URL: `.env.production` is
tracked and fully populated, so a fresh clone can _read_ production from the first commit. What it
cannot do is change anything. Writing needs `functions/serviceAccountKey.json` and deploying needs a
`firebase login`, and both of those live outside git. It ends at `📦 ` or `🚙 `.

This vocabulary came from the sibling `email-filter-builder` and `github-triage` repos, where the
reasoning behind it lives.

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
