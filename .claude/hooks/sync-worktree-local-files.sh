#!/bin/sh
# Copy gitignored local files from the main checkout into a linked git worktree.
#
# A fresh worktree only contains tracked files, so the app cannot run until the
# local env config and the generated database cache are present. Each entry is
# copied only when it is missing, so worktree-local edits are never clobbered.
#
# Wired up as a SessionStart hook in .claude/settings.json.

set -eu

FILES='.env.local public/dbcache.js public/img'

common_dir=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
git_dir=$(git rev-parse --path-format=absolute --git-dir 2>/dev/null) || exit 0

# equal paths mean the main checkout, not a linked worktree — nothing to copy
if [ "$common_dir" = "$git_dir" ]; then
  exit 0
fi

main_root=$(dirname "$common_dir")
worktree_root=$(git rev-parse --show-toplevel)
if [ ! -d "$main_root" ]; then
  exit 0
fi

copied=''
for f in $FILES; do
  if [ -e "$main_root/$f" ] && [ ! -e "$worktree_root/$f" ]; then
    mkdir -p "$(dirname "$worktree_root/$f")"
    if cp -R "$main_root/$f" "$worktree_root/$f"; then
      copied="$copied $f"
    fi
  fi
done

if [ -n "$copied" ]; then
  echo "Copied gitignored local files from the main checkout into this worktree:$copied"
fi
