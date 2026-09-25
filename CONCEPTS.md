# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with
project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and
ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or
catch-all.

## Catalog

### Book

A published title in the collection, keyed by a generated id that the record also carries as a field
of its own. That id is what other records use to point at a Book.

Its ISBN is a field rather than the identity, with two jobs that matter. A book's public URL
addresses it by ISBN, matched by exact string equality, so a malformed one yields no book rather than
the wrong book; and a share link stores the ISBNs of the books it carries. Both mean code starting
from an ISBN has to translate it to an id before it can refer to anything. That URL also carries a
readable form of the title, which is decorative — it can be absent or wrong without changing which
book is served.

### Bundle

A named set of Books chosen and described by one person, its curator — a user account, not a Person
record. The selection itself is the content and it is credited to the curator, which is what makes a
Bundle an editorial act rather than a way of grouping books that already have something in common.

Bundles are the least finished part of the model, and more so than they look: the pages exist, but
the actions behind submitting, saving and approving one are dispatched under names nothing defines,
or under the wrong namespace. Bundles are also absent from the cache, and the database rules grant
no read on them at all, so no client credential reaches a bundle record. Assume nothing here works
until you have checked it.

### Person

An author or illustrator a Book is attributed to, held as a record in its own right rather than as a
name on a book.

This entity goes by "creator" in much of the project — not only in the interface, but in a Book's
stored map of attributions and in the functions that handle Person submissions — so treating the word
as an interface-only habit will mislead you. Prefer Person when naming the entity in new work, and
leave the existing names where they are.

A Person's identity is a stored id, never their name. Names are entered by hand and change, and this
project has more than once rediscovered that matching on one breaks. Two places still match on a name
deliberately: a Person's public page is addressed by the slugified name, since that is the only
public address a Person has, and approving a Book reuses an existing Person by fuzzy name match. Both are
known costs, not precedents.

### dbcache

A generated snapshot of five collections — books, people, tags, content, and a contributors list
nothing currently reads — published alongside the site so the first paint does not wait on the
database. It does not cover every collection. Live subscriptions replace it once they arrive, so a
stale one is what a visitor sees before that, and what they keep seeing with no connection, rather
than what the site permanently serves.

## Contribution

### Roles

What a user may do is a set of named roles rather than a rank: owner, advisor, contributor, creator,
and a bare user who can only invite. Owners and advisors review submissions, and an advisor writes a
published record by approving one; the interface reserves editing a collection directly to the owner,
though the database rules let an advisor write one too, so the restraint is the app's rather than
enforced. Contributors and advisors propose Books and Bundles. Creators propose and maintain one Person, their own — which
is why a Person submission comes from a creator rather than a contributor, and why "creator" names
both this role and the entity it maintains.

### Submission

A record proposed by a signed-in user who holds the right to propose that kind, and held apart from
the published catalog until an owner or advisor rules on it. Submissions come in three kinds —
proposing a Book, a Person, or a Bundle — and each kind sits under its own key in one gated
collection, readable only to its author and to the owners and advisors who review it.

A Submission stays editable while it waits, and the reviewer is who edits it: fields are corrected in
review before approval, so what gets published is not necessarily what was sent.

### Approval

An owner or advisor accepting a Submission, which creates or updates the published record it proposed
and links the two. Approval is the moment identity is decided, and the two settled kinds decide it
differently. Approving a Person reuses the id already on the submission when there is one, so the
same contributor's later submission updates the record the earlier one created rather than producing
a second, and that id is written onto the submitter's own profile as well as onto the record. Approving
a Book mints a new record each time and links it to its submission from both sides.

## Flagged ambiguities

- "Person" and "creator" name one entity under two words, in stored data as much as in the
  interface. Prefer Person in new work. The user role also called creator is a separate concept that
  keeps its name, though the two meet in the id Approval writes onto the submitter's profile.
- "Contributor" is both an ordinary word for whoever submitted something and the name of one role,
  and the two come apart: a Person submission comes from a creator, so its submitter is not a
  contributor in the role sense.
- Older Person Submissions carry a second id, `peopleSubmissionId`, beside `personId`, the link to
  the published record — and call sites have confused the two. Approval no longer writes it and only
  commented-out code reads it, though old records still carry it. Only `personId` identifies the
  record. A computed of the same name, holding a submission key rather than that field, survives in
  the creator dashboard, which is the confusion itself rather than a use of it.
