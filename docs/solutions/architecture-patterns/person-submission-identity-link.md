---
title: Store the submission-to-person link as an id, never rederive it
date: 2021-01-27
category: architecture-patterns
module: src/store
problem_type: architecture_pattern
component: data_model
severity: high
root_cause: data_integrity
resolution_type: code_fix
symptoms:
  - A creator who renamed themselves got a second person record on the next approval instead of an update to their existing one
  - The creator form and the dashboard preview stopped finding the logged-in user's own person record
  - Renaming a submission field silently broke the lookup, because the link was a field name rather than a value
applies_when:
  - Linking a record in one Firebase collection to a record in another
  - Approving a submission that may create or update an existing record
  - Tempted to match records on a human-entered name, or to walk an id-of-an-id chain to reach a record
tags:
  - people
  - submissions
  - vuex
  - firebase
  - realtime-database
  - identity
related_components:
  - src/pages
  - src/components
---

# Store the submission-to-person link as an id, never rederive it

## Context

A person submission in the `submits/people` database collection has to resolve to a person record in
the `people` collection. Three
consumers need that link: `approvePerson` in `src/store/submissions/people.js`, the submitter's own
form in `src/pages/PeopleSubmissionForm.vue`, and the dashboard preview in
`src/components/Dashboard/CreatorProfilePreview.vue`.

For a while nothing stored the link. It was rederived on demand, two different ways, and both broke.

**Rederivation 1 — the approved-submission id chain.** Walk `user.profile.submissions`, find the
approved people submission, read its `peopleId`, index `people.data` with that. Three hops of
id-pointing-at-id, and the pointer was carried in a field name. Renaming that field (`peopleId` to
`peopleSubmissionId`) broke every hop at once, and for a while a submission carried *two* id fields
— one for the submission the person came from, one for the person — which the call sites confused
for each other.

**Rederivation 2 — the fuzzy name match.** Give up on the chain and join on the person's name:
`people/findBy(person => almostEqual(person.name, sub.name))`, where `almostEqual`
(`src/util/almostEqual.js`) strips punctuation, diacritics and case. This makes a mutable,
human-entered field the primary key. `13ccdde2` says what that cost: "Since store/submissions/people
was matching the creator to the submission based on name, changing the creator name would break the
connection." A creator who renamed themselves was a different person as far as approval was
concerned, so approval created a duplicate record and orphaned the original.

## Guidance

Store the link as an explicit `personId` and write it to **all three** places the moment approval
establishes it — the submission, the user profile, and the person record's own `id`. Then every
reader looks it up instead of reconstructing it.

Approval writes it back (`src/store/submissions/people.js`):

```js
// onto the submission
const submissionUpdates = {
  ...
  ...(personId ? { personId } : null),
}

// and onto the user profile
if (personId) {
  await context.dispatch('users/save', {
    path: `${sub.createdBy}/profile/personId`,
    value: personId,
  }, { root: true })
}
```

Readers prefer the profile. `PeopleSubmissionForm.vue` reduced its whole lookup to two lines:

```js
const personId = this.$store.state.user.user?.profile.personId
const person = this.$store.state.people.data[personId]
```

`CreatorProfilePreview.vue` reads `profile.personId` first and falls back to the submission's
`personId` only when the profile has none. The form stamps the id back onto each new submission
(`...(this.person?.id ? { personId: this.person?.id } : {})`) so the link survives a round trip
through the submission table.

Resolve the id once, then use that one variable everywhere — the save path, the record's `id`, and
the submission update:

```js
const personId = sub.personId || person?.id || uid()
const personNew = { ...person, ...pick(sub, Object.keys(personSubmission())), id: personId }
```

Before `9719bc8f` this read `personNew.id`, which came from spreading a possibly-null `person`, so
`people/save` could be dispatched with `path: undefined` whenever the lookup missed.

## Why This Matters

A name is data a user edits. A derived link is a join recomputed at read time against whatever the
schema happens to look like then, so it breaks on a rename in either direction: rename the *person*
and the fuzzy match stops matching; rename the *field* and the id chain stops resolving. Both
failures are silent. Nothing throws — the lookup just returns nothing, approval treats a returning
creator as new, and the database grows a duplicate person record that no profile points at. That is
`💾 ` damage in live data, not a test failure someone catches on a branch.

A stored id has none of those failure modes. It survives renames of the person, costs one lookup
instead of three, and makes the link inspectable: you can read `profile.personId` and see the
answer, rather than re-running the derivation to find out what it would have said.

## When to Apply

- Any time a record in one collection has to point at a record in another. Write the id.
- Whenever a join key is a human-entered string. Names, titles and emails are not keys.
- When approval flows may either create a record or update an existing one — resolve the id first,
  then let create-or-update fall out of whether it was already set.

## Watch Out

The fuzzy fallback survives at `src/store/submissions/people.js` and is dead code with a live bug:

```js
const person =
  (sub.personId && context.rootGetters['people/get'](sub.personId)) ||
  context.rootGetters['people/findBy'](person => almostEqual(person.name, name))
```

`name` is unbound in `approvePerson` — not a parameter, not a local, not an import. In the browser it
resolves to the global `window.name`, normally the empty string, so `almostEqual(person.name, '')`
matches only a person whose name normalizes to empty. The branch can never find anyone. It does not
throw (`findBy` in `src/store/modules/collection.js` treats a lone predicate as its optional-first-arg
form, and `get(obj, '')` in `src/util/get-set.js` returns the object), so it fails by returning
nothing. The intent was presumably `sub.name` — but that is the matcher this chain removed, so the
fix is to delete the branch, not to bind it.

The `// TODO: This would be a lot easier if the peopleId was stored in the user profile` above
`personSubmissionId` in the same file is also stale: the personId *is* stored in the profile now.
`personSubmissionId` still walks the old chain, and still feeds `peopleSubmissionId` on the
submission, which is a different id from `personId` and should not be mistaken for it.

## Related

Four commits over two months, each one a partial fix for the same missing stored link:

- `4e193dc1c161` (2021-01-27) — `submissions/people: use existing person if exists`. Replaced the
  approved-submission id chain with the `almostEqual` name match, and split the one id field into
  `peopleSubmissionId` and `personId`. Started writing `profile/personId` on approval.
- `5f3294b0ae0c` (2021-03-09) — `PeopleSubmissionForm: populate form using user.profile.personId`.
  Switched the form off the submission chain and onto the stored profile id; the old derivation is
  still there commented out.
- `13ccdde2ba8b` (2021-03-16) — `Person Approval: fix name change`. The commit that names the
  failure. Made the form stamp `personId` onto the submission and made approval prefer
  `people/get(sub.personId)` over the name match.
- `9719bc8f1b1b` (2021-03-23) — `submissions/people: fix personId`. Resolved one `personId` and used
  it for the save path, the record `id`, and the submission update, instead of a `personNew.id` that
  could be undefined.
