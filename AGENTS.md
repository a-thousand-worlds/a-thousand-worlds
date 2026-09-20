# Agent Instructions

## Session titles

A lifecycle prefix on the session title says what a session is doing while it is doing it, so the
sidebar answers "which session is writing to the live database" without opening any of them. The
sidebar already shows a status dot (running / awaiting input / idle) and a branch glyph for worktree
sessions; neither can be set from here — `set_session_title` takes a title string and nothing else.
So a **single leading emoji on the title** is the only lever, and it is spent on what the app cannot
know: where the work stands.

| Prefix | Means                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------- |
| `⏳ `  | implementing — the weakest of them; every other prefix takes precedence                                        |
| `💾 `  | writing to the live Firebase project right now — a `migrations/` script, `firebase database:*`, `npm run deploy` |
| `📦 `  | done on the branch — gated and shippable without re-running anything                                           |
| `🚀 `  | shipping to `main`, or shipped                                                                                 |
| `🚙 `  | parked: the work is sound and waiting on the user (a decision, a credential, a confirmation click)             |
| `🪦 `  | dead end — kept for the findings, not to resume                                                                |
| `📚 `  | extracting learnings into `AGENTS.md`, `README.md` or the skills                                               |

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
moment a `learn` skill is invoked, before anything is read. The rest are set by hand
(`mcp__ccd_session_mgmt__set_session_title`), and nothing reconciles a title against reality: an
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

A cloud session never reaches `💾 `. The Firebase credentials live in `.env` and `.env.production`,
which are outside git, so a fresh clone can reach neither the database nor a deploy. It ends at
`📦 ` or `🚙 `.

This vocabulary came from the sibling `email-filter-builder` and `github-triage` repos, where the
reasoning behind it lives.

## Running the app

`npm start` serves the dev build at http://localhost:8080. In a new worktree, `npm install` first —
that is the one setup step left by hand.

Everything else a worktree needs is gitignored, and `.claude/hooks/sync-worktree-local-files.sh`
places it on `SessionStart`: `.env.local` and `public/dbcache.js` are copied from the main checkout,
and `public/img` is symlinked to it — the photos are the bulk of it (~19M today) and are a generated
per-machine artifact, so one copy is enough, while the small two stay copies so a worktree can
diverge. Each is placed only when missing. Do not hand-copy them; if one is absent, the hook is what
to fix.

Without them the app still boots — the store falls back to reading Firebase live — but the console
says the cache has not been generated, and every cover and portrait 404s.

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
