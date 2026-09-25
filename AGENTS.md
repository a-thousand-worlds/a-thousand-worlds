# Agent Instructions

## Session titles

The prefix glossary arrives from the `emotive` plugin; these are the parts specific to this repo.

- `📦 ` means `npm run lint && npm run build && npm test` all pass on the branch — the gates the
  `ship` skill runs. They are the only signal a merge waits on; it does not wait on CI.
- `🚀 ` ships to `main`, through a PR that `.github/skills/ship/SKILL.md` squash-merges itself; that
  skill sets the prefix once the merge has landed. `📦 ` holds until then.
- `🚙 ` is what this repo waits on a user for: a Firebase console import, a `gh pr merge` the
  permission classifier denied, a decision about live data.
- `💾 ` is the live Firebase project — one project behind every worktree. `🔍 `, `🔒 ` and `🔓 ` are
  inert here: nothing in this repo takes a lock, and the live-data hazard is `💾 `'s.

**`💾 ` is the one that matters to _other_ sessions.** Work is `💾 ` when it _writes_ state other
sessions share: the live database, hosting, or the main checkout's shared artifacts. Reading never
is, however production the source. `npm run deploy` publishes hosting for everyone and
`firebase database:set|update|push|remove` writes the database directly (`database:get` is a read);
`migrations/import-books.js` writes records outright and `migrations/data/import-data.js` overwrites
the database root and creates auth users; and `update:dbcache` writes the `public/img` every other
worktree reads. The `update:books:*` and `update:images` scripts write nothing live — they read
production into `/tmp/atw/` and leave a rebuilt `books.rebuilded.json` in the repo root, untracked and
misnamed `books.updated.json` in their own output, for someone to import by hand. That import is
`💾 ` from the moment you hand it over until it lands.

Nothing locks any of it. So a fact read early in a turn can be stale by the end of one, and a record
that changes without your having changed it is another session, not a bug. Before writing live data,
list the sessions (`mcp__ccd_session_mgmt__list_sessions`) and look for another carrying `💾 `.

A cloud session never reaches `💾 `. It can _read_ production from the first commit, since
`.env.production` is tracked and carries the database URL, but every write path needs a credential
that is not in git — an owner's password to sign in as one, `functions/serviceAccountKey.json` for the
admin paths, or a `firebase login` to deploy. It ends at `📦 ` or `🚙 `.

## Running the app

`npm start` serves the dev build at http://localhost:8080. A new worktree needs no setup step by
hand: `.claude/hooks/sync-worktree-local-files.sh` places four gitignored things on `SessionStart`,
each only when missing. `.env.local` and `public/dbcache.js` are copied, so a worktree can diverge on
them. `public/img` is symlinked to the main checkout, since the photos are a generated per-machine
artifact that only needs to exist once. `node_modules` is symlinked only when two gates prove the
main checkout's tree is the one this branch needs, and installed with `npm ci` otherwise — so check
which one you got (`ls -ld node_modules`) before assuming, because the install hazard below turns on
it. Do not hand-copy or hand-install any of them; if one is absent, the hook is what to fix.
[`docs/worktrees.md`](docs/worktrees.md) has the gates, and why each file is treated as it is.

Without them the app still boots — the store falls back to reading Firebase live — but the console
says the cache has not been generated, and every cover and portrait 404s.

**Hot reload does not reach the in-app Browser pane.** The dev server hands the client its LAN
address for the HMR socket (`ws://192.168.x.x:8080/ws`), which the sandboxed pane cannot open, so its
console shows a failed WebSocket and edits never hot-reload there. Reload the pane by hand, or
preview in Brave, where it works normally. Not a defect to chase.

**`npm run update:dbcache .env.local` writes through the `public/img` symlink.** Run from a worktree
it rebuilds that worktree's own `public/dbcache.js`, but adds new photos to the _main checkout's_
`public/img`, which every other worktree is reading. That shared write is what makes it `💾 ` work —
not the production read, which on its own never is.

## Dependencies

**When `node_modules` is the symlink, anything that installs writes through it and changes the
_main checkout's_ dependencies.** Establish which you have first, per Running the app above; a
worktree the hook installed for is already safe to install into.

`npm run lint` is what tempts you into it: every passing run prints two staleness notices on stderr,
each with a copy-pasteable install command — `npx update-browserslist-db@latest` and
`npm i baseline-browser-mapping@latest -D` — at exit code 0, so they read like something to fix.
Running either is a dependency change, with everything above attached.

To add or change a dependency on a branch that shares the tree, give the worktree one of its own
first — `rm node_modules && npm ci`, which `sync-worktree-local-files.sh` then leaves alone. Keep the
main checkout on `main` so the two trees keep agreeing — a checkout parked on a feature branch, or
one that pulled a dependency change without reinstalling, silently costs every new worktree a full
install.

**Removing a dependency needs no tree of its own.** Delete the `package.json` line and run
`npm install --package-lock-only`, which rewrites the lockfile and leaves the shared tree alone. The
shared tree still holds the package, though, so a passing build does not prove nothing imports it:
grep `src`, `functions`, `migrations` and `mcp` for it first.

**A package held back from upgrades goes in `.ncurc.js`'s `reject` list**, with a comment saying
why, so a blanket `ncu -u` skips it. `firebase` is the costly one:
[`docs/solutions/tooling-decisions/firebase-sdk-pinned-at-v8.md`](docs/solutions/tooling-decisions/firebase-sdk-pinned-at-v8.md).

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
no credentials at all. `logs`, `users`, `submits` — which holds the three kinds of submission
under `books`, `people` and `bundles` — and the database root need
`functions/serviceAccountKey.json`, which is gitignored; without it those reads fail with a message
saying so and every other path keeps working. The two lists are the server's, not the database's: a
path in neither — `bundles` is the live example — is classified gated, so it fails with that same
message rather than because anything is broken.

Do not pull a whole table. A `get_value` over the size limit is refused rather than truncated, since
truncated JSON cannot be parsed — take the ids with `list_keys`, or a few records with `orderBy`
plus `limitToFirst`. `README.md` → Database MCP server has the tools and their options;
[`docs/firebase-read-mcp.md`](docs/firebase-read-mcp.md) has the REST behaviour behind them and the
designs that were rejected.

## Linting

`npm run lint` covers `src`, `functions`, `mcp` and `vue.config.js`, and `.husky/pre-push` runs it
again, so a lint failure blocks the push rather than the commit.

**The hook reads no refs, so every push lints — a branch deletion included.**
`git push origin --delete <branch>` runs the full pass over whatever worktree it is run from, so
tidying up after a merge prints a lint run that reads like a failure and is not. It also means a red
lint in that worktree blocks deleting a branch whose contents already landed; `--no-verify` is the
right escape there, since a delete carries no commits to lint — unlike a push of work, where the
ship skill's rule against it holds.

**`fp/no-mutating-methods` rejects `.sort()`.** `src/` works around it with
`// eslint-disable-next-line fp/no-mutating-methods`, which predates the non-mutating array methods.
In Node-side code — `mcp/`, `migrations/`, `functions/` — write `.toSorted()` instead and skip the
comment; it satisfies the rule rather than suppressing it. `migrations/` is outside the lint scope
above and does not pass eslint today, so nothing there enforces this for you. Leave the existing
disables in `src/` alone rather than churning browser code for it.

## Vue components

**A `this.x` naming nothing the component declares evaluates to `undefined`, silently.** Vue warns
about one only when it is read during render, and only in development, so a read in a method, a
watcher, or a computed that nothing renders — a local of another function, a field since renamed —
raises nothing and fails as an empty lookup. `vue/no-undef-properties` catches it. It is left out of
the config rather than disabled, because it cannot see properties that mixins such as
`@/mixins/validator` supply and flags dozens of those. Run it as an audit, and expect to read past
four kinds of false positive: mixin-supplied properties, `this` inside a non-arrow callback (where it
is deliberately not the component), state returned through a local variable rather than a literal, and
nested paths on declared data. What survives that is worth fixing:

```bash
npx eslint src --rule '{"vue/no-undef-properties":"error"}'
```

## Tests

Vitest defaults to jsdom here, and `src/` is ESM while `mcp/`, `migrations/` and `functions/` are
CommonJS. A test for Node-side code therefore opens with `// @vitest-environment node` and loads its
subject through `createRequire(import.meta.url)` rather than `import`, which keeps Vite's ESM
transform away from a file written for Node's own resolver. `mcp/firebase-read/server.test.js` is
the worked example.

A component that only reads `$store.state` is easier to test against a plain object passed as
`global.mocks.$store`, with `router-link` and route-bound children stubbed, than through
`@/test-helpers`, which mounts the real store and leaves you to seed it through its actions.
`src/components/Dashboard/CreatorProfilePreview.test.js` is the worked example.

**The suite characterizes behavior as it is, so a deliberate change updates its tests in the same
commit.** It exists to catch dependency upgrades: `src/contracts/<package>.test.js` pins the API
surface the app uses from each third-party package, so an upgrade that breaks one fails there
first, and a new package or a new call shape adds its case to that file. A contract that fails
after an upgrade means the package changed under the app: adapt the call sites and re-pin the
contract in that upgrade's own commit, or hold the package back in `.ncurc.js`.

**Firebase is the one boundary faked, and the fake goes on `firebase/app`, not `@/firebase`, when
the code under test can import it twice at once.** Store modules reach Firebase through a lazy
`import('@/firebase')`, and on vitest 2 a factory mock of that path serves the _real_ module to the
second of two concurrent dynamic imports — so a flow that dispatches two loads together talks to the
live SDK. Mock `firebase/app` with a fake of the v8 namespaced API and stub `firebase/auth`,
`firebase/database` and `firebase/storage` as empty modules; `src/store/submissions/people.test.js`
is the worked example.

**A Node script is only testable if requiring it does not run it.** `migrations/update-dbcache.js`
and `import-books.js` start their main function under `require.main === module` and export their
helpers; a new script takes the same shape.

## Docs

`docs/solutions/` holds documented solutions to past problems (bugs, best practices, workflow
patterns), organized by category with YAML frontmatter (`module`, `tags`, `problem_type`). Relevant
when implementing or debugging in an area one of them covers.
[`CONCEPTS.md`](CONCEPTS.md) holds the shared domain vocabulary — the entities, processes and status
concepts that mean something specific here — and is worth reading when orienting to the codebase.
`README.md` is the setup guide and the reference for the Database MCP server and the dbcache.

**No gate covers markdown, and four tracked files are deliberately left unformatted.**
`README.md`, `docs/worktrees.md`, `public/index.html` and `src/assets/style/main.scss` fail
`prettier --check` and stay that way, so a blanket `prettier --write .` cannot drag their
reformatting into an unrelated diff. Everything else is clean, including every file under
`docs/solutions/`. Write a new doc clean — `_emphasis_` rather than `*emphasis*`, table columns
padded to the widest cell — and format by naming the file, never the tree.

**The claim validator `ce-compound` runs reads fenced code as prose.** A Vuex snippet such as
`rootGetters['people/get'](id)` inside a fence parses as a markdown link, and the doc is flagged for
a relative target that does not resolve. The flag is wrong, not the doc; this store quotes that
idiom often enough to meet it again.
