# Worktrees

How a linked worktree reaches a runnable state, and what was tried before settling on it.

## What a worktree is missing

A worktree shares only `.git`, so it starts with tracked files alone. Everything gitignored is
absent — `.env.local`, the generated `public/dbcache.js`, `public/img`, and `node_modules` — and
without them the app cannot build or run.

[`.claude/hooks/sync-worktree-local-files.sh`](../.claude/hooks/sync-worktree-local-files.sh)
places all of it at `SessionStart`. It exits immediately in the main checkout, which it recognises
by `--git-common-dir` equalling `--git-dir` — true only there. It never overwrites something the
worktree already has, so worktree-local edits survive a re-run and a resumed session costs nothing.

What it places splits three ways by size and by whether divergence matters. `COPY_FILES` are small
and copied, so a worktree can edit them without touching the main checkout. `LINK_FILES` are large
generated artifacts, symlinked so they are stored once per machine. `node_modules` is the third
case: large enough to want sharing, but only correct to share when the dependency trees agree, so it
gets the gates below.

## Dependencies: borrow the main checkout's tree, or install

`node_modules` is symlinked to the main checkout when that tree is provably the one the worktree
needs, and installed with `npm ci` otherwise. Two gates gate the symlink, both necessary:

1. The two `package-lock.json` files agree entry for entry.
2. The main checkout's *installed* tree still matches its own lock — `node_modules/.package-lock.json`
   compared against `package-lock.json`.

The second gate catches drift the lock files cannot see: a main checkout that pulled a dependency
change without reinstalling, or an install interrupted partway. Without it the first gate would
green-light a tree that is simply wrong.

**The symlink is shared for writes, not just reads.** `npm install <pkg>` run from a worktree
follows it into the main checkout's `node_modules`. This is the standing cost of sharing; the gates
make the tree correct on arrival, not immune to later writes. Both of the hook's messages name which
tree the worktree got, so it is visible at session start.

## Why the tree is never copied

Copying `node_modules` is the intuitive answer and it is the wrong one — every copy strategy costs
more than simply installing. Measured on this repo, 2155 packages, warm npm cache, APFS:

| approach | time |
| --- | --- |
| symlink | 0.3s |
| `npm ci` | 16s |
| `cp -Rc` (APFS clone) | 20s |
| `cp -Rl` (hardlink) | 45s |

Treat these as one machine's sample, not thresholds. What transfers is the ordering: at this package
count, per-file work dominates, so creating 2155 packages' worth of directory entries loses to npm
unpacking them from a warm cache. Hardlinking is slowest of all despite copying no data.

Disk is not a consideration either way — worktrees here are short-lived and get cleaned up.

## Dead ends

- **`cp -Rc` to exploit APFS copy-on-write.** Near-zero extra disk, but 20s — slower than `npm ci`.
  Cheap storage does not make it cheap to create.
- **`cp -Rl` hardlinks, pnpm-style.** 45s, the slowest option measured.
- **Comparing the two `package-lock.json` files byte-wise with `cmp`.** Passes whenever the branches
  agree, including when the main checkout's installed tree has drifted from its own lock — exactly
  the case that produces a worktree running against the wrong dependencies. Hence gate 2.
- **Comparing the worktree's lock against the main checkout's hidden lock directly.** They are not
  comparable: the hidden lock omits the root `""` entry and every optional package npm skipped for
  this platform, so an entry-count or key-set comparison reports a difference that is not one.

## Testing the guard

The guard runs as `node -e` inside the hook. It reads its two arguments with `process.argv.slice(-2)`
rather than `slice(1)` so that the same snippet can be extracted to a file and run against fixtures —
`node -e` and `node script.js` disagree about whether `argv[1]` is the first argument or the script
path.
