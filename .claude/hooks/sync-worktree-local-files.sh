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
# checkout.
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
