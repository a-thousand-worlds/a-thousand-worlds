#!/bin/sh
# Provide gitignored local files from the main checkout in a linked git worktree.
#
# A fresh worktree only contains tracked files, so the app cannot run until the
# local env config and the generated database cache are present. Each entry is
# placed only when it is missing, so worktree-local edits are never clobbered.
#
# COPY_FILES are small and copied, so a worktree can diverge from the main
# checkout without affecting it. LINK_FILES are large generated artifacts and
# are symlinked instead, so they are stored once per machine — note that
# `npm run update:dbcache` then writes new photos straight into the main
# checkout. node_modules is handled separately at the end: symlinked like a
# LINK_FILE, but only once the main checkout's tree is proven to be the one
# this worktree needs.
#
# Wired up as a SessionStart hook in .claude/settings.json.

set -eu

COPY_FILES='.env.local public/dbcache.js'
LINK_FILES='public/img'

common_dir=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
git_dir=$(git rev-parse --path-format=absolute --git-dir 2>/dev/null) || exit 0

# equal paths mean the main checkout, not a linked worktree — nothing to do
if [ "$common_dir" = "$git_dir" ]; then
  exit 0
fi

main_root=$(dirname "$common_dir")
worktree_root=$(git rev-parse --show-toplevel)
if [ ! -d "$main_root" ]; then
  exit 0
fi

placed=''

for f in $COPY_FILES; do
  if [ -e "$main_root/$f" ] && [ ! -e "$worktree_root/$f" ]; then
    mkdir -p "$(dirname "$worktree_root/$f")"
    if cp -R "$main_root/$f" "$worktree_root/$f"; then
      placed="$placed $f"
    fi
  fi
done

for f in $LINK_FILES; do
  # -e follows symlinks, so a dangling link is caught by -L as well
  if [ -e "$main_root/$f" ] && [ ! -e "$worktree_root/$f" ] && [ ! -L "$worktree_root/$f" ]; then
    mkdir -p "$(dirname "$worktree_root/$f")"
    if ln -s "$main_root/$f" "$worktree_root/$f"; then
      placed="$placed $f"
    fi
  fi
done

if [ -n "$placed" ]; then
  echo "Local files from the main checkout placed in this worktree:$placed"
fi

# node_modules: symlink to the main checkout's tree when it is provably the
# tree this worktree needs, otherwise install one of this worktree's own.
#
# Copying is not worth it — a symlink is instant where duplicating node_modules
# costs more than a clean install (cp -Rc 20s, cp -Rl 45s, npm ci 16s with a
# warm cache).
#
# Two conditions gate the symlink, both necessary: the two package-lock.json
# files must agree entry for entry, and the main checkout's *installed* tree
# must still match its own lock file. The second catches drift the lock files
# alone cannot see — a main checkout that pulled a dependency change without
# reinstalling, or an install that was interrupted partway.
#
# The tradeoff that remains is write isolation — `npm install <pkg>` run from a
# worktree follows the symlink and mutates the main checkout's node_modules.
# See docs/worktrees.md.
nm="$worktree_root/node_modules"
nm_main="$main_root/node_modules"

shareable() {
  node -e '
    const fs = require("fs")
    const read = p => JSON.parse(fs.readFileSync(p, "utf8")).packages
    const [wt, main] = process.argv.slice(-2)
    try {
      const want = read(wt + "/package-lock.json")
      const have = read(main + "/package-lock.json")
      const installed = read(main + "/node_modules/.package-lock.json")
      for (const k of new Set([...Object.keys(want), ...Object.keys(have)])) {
        if (JSON.stringify(want[k]) !== JSON.stringify(have[k])) process.exit(1)
      }
      for (const [k, v] of Object.entries(installed)) {
        const b = have[k]
        if (!b || v.version !== b.version || v.integrity !== b.integrity) process.exit(1)
      }
      process.exit(0)
    } catch (e) {
      process.exit(1)
    }
  ' "$worktree_root" "$main_root"
}

if [ -e "$nm" ] || [ -L "$nm" ]; then
  : # already present (or already linked) — leave it alone
elif [ ! -f "$worktree_root/package-lock.json" ]; then
  : # nothing to install or compare
elif [ -d "$nm_main" ] && shareable; then
  ln -s "$nm_main" "$nm"
  echo "Linked node_modules to the main checkout's tree, which matches this worktree's package-lock.json."
elif command -v npm >/dev/null 2>&1; then
  echo "The main checkout's node_modules does not match this worktree's package-lock.json — installing..."
  if (cd "$worktree_root" && npm ci --no-audit --no-fund >/dev/null 2>&1); then
    echo "Installed this worktree's own node_modules with npm ci."
  else
    echo "npm ci failed — run it manually in this worktree."
  fi
fi
