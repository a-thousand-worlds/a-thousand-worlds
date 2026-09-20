# Reading the Realtime Database from an agent session

How `mcp/firebase-read/` reads production, why its read-only guarantee is structural rather than a
promise, and which shapes were rejected on the way.

`README.md` → Database MCP server is the user-facing half: the three tools and their options.
`AGENTS.md` → Reading live data is the rule for when to reach for them. This is the mechanism.

## Why a server rather than a shell command

A session that wants to know what is actually in `books` has to ask production. `curl` against the
database is classified as a production read and stops for approval; `firebase database:get` needs
the Firebase CLI's own login, which a fresh clone does not have. Both put a human in the loop for
what is a plainly safe operation, so the question became how to make "safe" something a tool can be
trusted with unattended — not by convention, but by construction.

## The read-only guarantee

The Realtime Database REST API writes through PUT, PATCH, POST and DELETE, and reads through GET.
The whole guarantee rests on that split: `read.js` has exactly one `fetch` call site, and its method
is the literal `'GET'`, never a parameter and never derived from an argument. There is no function
in the module that takes a method, so no caller — including a future one that means well — can pass
a different verb without editing the call site itself.

This matters most on the gated paths, where the request carries a service account token. That token
carries full admin privileges and **bypasses `firebase.rules.json` entirely**; the rules are not a
second line of defence behind it. What keeps an admin-credentialled request harmless is only that it
is a GET.

`server.test.js` holds that invariant in place from three directions, so a regression fails the suite
rather than shipping: mutation names are rejected as unknown tools and never reach the network, every
read is asserted to be a GET with no body, and neither module may contain a quoted non-GET method.
The tool list is pinned to an explicit allowlist too, so a fourth tool fails the suite until someone
adds it deliberately.

## What the REST API actually does

- **`shallow=true` cannot be combined with `orderBy` or a limit.** The pairing returns HTTP 400,
  `"orderBy not supported for with shallow GET"`. A shallow read always returns every key, in
  lexicographical order — there is no such thing as a shallow sample. `get()` rejects the
  combination up front so the caller gets a sentence instead of a 400.
- **`limitToFirst` / `limitToLast` / `startAt` / `endAt` / `equalTo` require an `orderBy`.** The
  client defaults it to `"$key"` when a narrowing parameter is given without one.
- **Query values are JSON, not strings.** `orderBy`, `startAt`, `endAt` and `equalTo` take a
  JSON-encoded value, so a string needs its quotes (`orderBy="$key"`) and a number must not have
  them. `JSON.stringify` on the way in handles both.
- **An unauthenticated read of a gated path is 401 `Permission denied`**, not an empty result.
- **A missing path is a 200 returning `null`**, not a 404.
- **Firebase keys cannot contain `.`, `$`, `#`, `[` or `]`.** Validating a path against that set
  rejects `..` for free, so traversal is not separately defended against — it is unaddressable.

## Sizing

A read is refused above a character limit rather than truncated, because truncated JSON cannot be
parsed and a half-record is worse than an error naming the fix. The default sits deliberately below
the whole `books` table: a table that size costs more context than it is worth, so the refusal
steers the caller to `list_keys` or a limit. `ATW_MAX_RESPONSE_CHARS` raises it when a bulk read is
genuinely wanted. Re-measure before assuming the current table still fits any particular budget.

## Dead ends

- **`firebase-admin`'s `db.ref(path)` for the gated paths.** The obvious choice, since the package is
  already a dependency and `functions/` uses it. But a `Reference` carries `set`, `update`, `push`
  and `remove` on itself: the write surface would exist in the object graph, one property access
  away, and "read-only" would degrade to "we don't call those". The REST path keeps admin
  credentials without ever materialising a writable handle. `firebase-admin` is still used, but only
  to mint the token — `admin.credential.cert(key).getAccessToken()`, which requests the
  `firebase.database` scope and resolves `{ access_token, expires_in }`.
- **The SDK's high-level `McpServer.registerTool`.** Its `inputSchema` wants a Zod raw shape, which
  means taking Zod as a direct dependency for three tool definitions. The low-level `Server` with
  `setRequestHandler(ListToolsRequestSchema, …)` takes plain JSON Schema and needs nothing else.
- **Letting the 400 from a `shallow` + `orderBy` request surface as-is.** Firebase's message is
  clear, but arriving as a failed request rather than a rejected argument, it reads as a server
  problem. Validating first is a sentence about the caller's options.
- **Loading the service account key at startup.** Then the server is dead in any checkout without
  one, including every fresh clone, even though the majority of reads never need it. The key is
  loaded on the first gated read and not before.

## Techniques that transferred

- **Prove the negative test can fail.** The write-blocking tests are worth only as much as their
  ability to go red, so a `set_value` tool issuing a PUT was injected on purpose; three independent
  tests caught it. A guard that has never been seen failing is a guess.
- **Drive the real server over `InMemoryTransport.createLinkedPair()`.** A real `Client` against a
  real `Server` tests the dispatch and the error semantics that a direct call to the handler map
  would skip — an unknown tool has to come back as a protocol-level rejection, not a result.
- **Stub `globalThis.fetch` and assert on what was requested**, rather than mocking the module. It
  is what makes "every read is a GET" an assertion about behaviour instead of about source text.
