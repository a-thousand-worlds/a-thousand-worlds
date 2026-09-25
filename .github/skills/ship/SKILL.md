---
name: ship
description: 'Finish a feature branch: run quality gates (lint, build, test), commit, open a PR, squash-merge it automatically once the gates pass, and extract the session's learnings. Use when done with a change and ready to land it on main.'
---

# Ship (finish feature → PR → automatic squash merge)

Take the current feature branch (usually in a worktree), verify it, open a PR, and land it on `main`
as a single squash-merged commit — automatically, without pausing for approval, as soon as the
quality gates in step 1 pass.

## Procedure

### 1. Quality gates (must pass before committing)

Run in order, stop on the first failure, fix, then re-run before proceeding:

```bash
npm run lint && npm run build && npm test
```

- `npm run lint` — eslint over `src`, `functions`, `mcp` and `vue.config.js`. The same command runs in
  `.husky/pre-push`, so a lint failure blocks the push in step 4 anyway; catching it here is cheaper
  than catching it mid-ship.
- `npm run build` — `vue-cli-service build`. Slow, and the gate that catches broken imports and
  template errors in the components no test renders.
- `npm test` — `vitest run`. Use `npm test`, **not** `npm run test:watch`, which stays in watch mode
  and hangs. The suite pins the router, the store, the pages and components that carry the app's
  URLs and data writes, and each third-party package's contract (`src/contracts/`), so a dependency
  bump that changes behavior fails here rather than in production.

**There is no format gate.** Four tracked files deliberately fail `prettier --check`, so a blanket
`prettier --write .` would drag unrelated reformatting into every ship. `AGENTS.md` → Docs names them
and states the rule. Prettier is wired into lint through `eslint-config-prettier`; leave it at that.

**These gates are what the merge waits on, not CI.** `.github/workflows/test.yml` runs lint, tests,
build and a serve-the-dist smoke test on every PR, but step 5 merges without waiting for it — deliberately.
Passing the gates locally is therefore the only signal that gates the merge, which makes running them
non-negotiable: a skipped or ignored failure lands straight on `main`. The one thing CI checks and
these gates do not is that the built `dist` actually serves; if that goes red on `main` after a
merge, fix forward.

### 2. Commit all staged and unstaged changes

Generate a commit message from the diff. Match the repo's history, which is mostly a plain
imperative subject (`BookSubmissionForm: Popup error.`, `Remove hashbang from .husky/pre-push.`)
rather than conventional-commit prefixes.

### 3. Rebase on the latest main

```bash
git fetch origin main && git rebase origin/main
```

If the rebase hits conflicts: resolve them (prefer the branch changes unless clearly wrong),
`git add` the resolved files, `git rebase --continue`, and repeat until it completes. Do not flag an
out-of-date main or conflicts — just silently rebase and resolve.

Run the rebase bare, or under `set -o pipefail`. Piping it (`git rebase origin/main 2>&1 | tail -2 && git push …`)
hides a conflict's exit status, so the `&&` chain carries on and pushes and opens the PR from the
middle of a rebase; both fail with unrelated-looking errors (`could not determine the current branch`)
and the conflict only surfaces afterwards.

### 4. Push the branch and open a PR

```bash
git push -u origin HEAD --force-with-lease
```

The `pre-push` hook runs `npm run lint` again here. It passed in step 1; if it fails now, something
changed after the gates ran — re-run step 1 rather than pushing with `--no-verify`.

Then create the PR with `gh pr create`, using a title that matches the commit subject and a body that
summarizes the overall diff. This repo has no PR template.

### 5. Squash merge automatically

Print the PR URL, then merge immediately. Do **not** ask for approval — the passing gates in step 1
are the approval, and every PR this skill opens is merged.

```bash
gh pr merge <PR#> --squash --subject "<commit subject> (#<PR#>)" --body ""
```

**Run it bare — no pipes, no `;`, no `&&`, no `$(...)`.** Allow rules match a command _prefix_, so
`.claude/settings.json`'s `Bash(gh pr merge:*)` only covers a command that _starts_ with
`gh pr merge`. The moment you wrap it — `gh pr merge --squash | tail -5`, or chain a `gh pr view`
after a `;` — the whole line matches no rule and falls through to the auto-mode classifier, which
denies it. This is the same trap step 6 describes for `git -C * pull`; it applies to every
allowlisted command. Pass `--subject`/`--body` so the merge never stops on an interactive prompt to
edit the squash commit message, and name the PR number explicitly rather than letting `gh` infer it
from the current branch.

Merge unconditionally, without `--auto`. GitHub's auto-merge feature is disabled on this repo
(`allow_auto_merge: false`), so `--auto` errors out — and since the merge does not wait on CI
(step 1), there is nothing for it to wait on anyway.

**If the classifier denies the merge, the allow rule is almost certainly present and fine — check the
command shape first.** A denial is silent about its own cause, and the overwhelmingly common cause is
a compound command, not a missing rule. Re-run it bare before concluding anything else.

**If a bare `gh pr merge` is still denied**, then hand it over: print the PR URL and give the user
this command, which is self-contained and never prompts for a commit message:

```bash
gh pr merge <PR#> --repo a-thousand-worlds/a-thousand-worlds --squash --subject "<commit subject> (#<PR#>)" --body ""
```

The only reason to stop before merging is a gate that never passed. If step 1 still fails after your
fixes, leave the PR open, say plainly which gate is red, and do not merge.

Do **not** pass `--delete-branch`: it tries to check out `main` locally, which fails here because the
main checkout holds some other branch. This repo also has "automatically delete head branches"
_disabled_ (`delete_branch_on_merge: false`), so unlike its sibling repos nothing removes the remote
branch on its own. Delete it after the merge, bare:

```bash
git push origin --delete <branch>
```

**Even without `--delete-branch`, `gh pr merge` may still print a checkout error** (something like
failing to switch this checkout back to `main`). That's just `gh`'s local post-merge cleanup step
attempting to move the current worktree back to `main` — it always fails the same way, for the same
reason, and it's harmless: the merge on GitHub has already completed by that point. Don't treat it as
a failure or retry the merge because of it.

**Confirm the result with two bare git commands, one per call** — `git fetch origin main`, then
`git log --oneline origin/main -1`. The squash commit appearing on `origin/main` is the proof.
`gh pr view <PR#> --json state,mergedAt` is _not_ allowlisted (`.claude/settings.json` grants
`Bash(gh pr merge:*)` and nothing else) and the classifier denies it as a Merge Without Review, so
reaching for it after a successful merge produces a denial that reads like the merge failed.
Chaining the two git commands with `&&` is denied as well: the compound-command trap above is not
limited to allowlisted commands, and a chain of two individually-harmless read-only commands still
matches no rule.

**If the merge fails because `main` advanced in the meantime** (e.g. another worktree's PR landed
first): go back to step 3, rebase on the new `origin/main`, force-push with `--force-with-lease`, and
retry the merge. Repeat until it succeeds — nothing is merged or lost in the failed attempts.

### 6. Post-merge

- Read the main worktree path from `git worktree list` (it is the first entry), then substitute that
  literal path into the next two commands. Do **not** wrap them in one `MAIN=$(...) && ...` compound,
  and do not pipe or chain them: `.claude/settings.json` allowlists `git -C * pull` and
  `npm install --prefix *`, but allow rules match a command _prefix_, so anything that is not a bare
  invocation of the allowlisted command matches no rule and gets denied by the permission classifier.
  (Piping to `tail` to trim output is the usual way this happens.)
- The same `git worktree list` entry shows which branch the main checkout has out, and here it is
  routinely _not_ `main` — it sits on whatever `pr/NN` branch was last reviewed. If it is not `main`,
  `git -C … pull` would update that branch's upstream instead: skip the pull and the install, run
  `git fetch origin main` here so every worktree's `origin/main` is current, and say so in the summary.
- Update the main worktree: `git -C /abs/path/to/main pull`.
- Sync its dependencies: `npm install --prefix /abs/path/to/main`.

### 7. Extract the learnings

Invoke the `learn` skill. A shipped change is the moment its lessons are worth writing down: the
branch is landed, nothing is pending, and whatever the session learned about the app, the tree or
the workflow is still in context — an hour later it is in nobody's. This is not optional and the
user does not have to ask for it; it is the last stage of shipping.

Skip it only when `learn` or `learn-organize` is what invoked this ship — their own procedures end
in one, and landing those learnings is that ship's whole job. Otherwise the two call each other
forever.

`learn` puts `📚 ` on the title. Step 8 replaces it once this ship is done.

If `learn` finds nothing worth recording, that is a normal outcome — say so in one line and move on.

### 8. Prefix the session title with 🚀

The merge landed, so set it now and not before: read the session's title
(`mcp__ccd_session_mgmt__get_session` with `"self"`) and set it back with a `🚀 ` prefix
(`mcp__ccd_session_mgmt__set_session_title`), replacing whatever prefix is there rather than stacking
— `📦 ` from the gated branch, or the `📚 ` step 7 left. It stays until another stage replaces it;
never clear it to leave a bare title. A ship that never landed never set it, so there is nothing to
put back and nothing to correct. Do not report this step. See `AGENTS.md` → Session titles.

### 9. Print the completion message

Print `🚀 Shipped` as the last line of the response, after the learn report.
