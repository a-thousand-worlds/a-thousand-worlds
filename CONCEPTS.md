# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with
project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and
ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or
catch-all.

## Catalog

### Book

A published title in the collection, identified by its ISBN rather than by a generated key. The
ISBN is the value every other record and every book URL carries to refer to it, and it is matched
by exact string equality, so a malformed one yields no book rather than the wrong book.

A book's URL also carries a readable form of its title. That part is decorative — it can be absent
or wrong without changing which book is served.

### Person

An author or illustrator a Book is attributed to, held as a record in its own right rather than as
a name on a book.
_Avoid:_ creator

The interface says "creator" and the data says "person" for the same thing; both appear in code.
A Person's identity is a stored id, never their name — names are entered by hand and change, and
matching on one is a rediscovered mistake rather than an available shortcut.

### dbcache

A generated snapshot of the whole database, published alongside the site so the app can read the
catalog without querying live. It is rebuilt on a schedule and on demand; a stale one is a
correctness problem for readers, not just a performance one, because it is what the site actually
serves.

## Contribution

### Submission

A record proposed by a contributor and held apart from the published catalog until an owner rules
on it. Submissions come in two kinds — one proposing a Book, one proposing a Person — and each
lives in its own gated collection, readable only to its author and to owners.

A Submission is editable while it waits, so nothing derived from its contents can be treated as
stable: the fields a reviewer sees are not necessarily the fields the contributor first sent.

### Approval

The act of an owner accepting a Submission, which creates or updates the published record it
proposed and links the two permanently. Approval is the moment identity is decided: the link
between a Submission, the record it became, and the contributor's own profile is written then, as
a stored id in all three places.

Approving the same contributor's later Submission must update the record the earlier one created
rather than produce a second.

## Flagged ambiguities

- "Person" and "creator" have been used interchangeably for the same entity — the data model says
  person, the interface says creator. They are one concept, not two.
- A Submission carries two different ids that have been confused at call sites: the link to the
  published record it became, and a pointer to an earlier Submission the same contributor made.
  Only the first identifies the record.
