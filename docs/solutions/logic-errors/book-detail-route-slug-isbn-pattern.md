---
title: Keep the strict BookDetail slug-isbn path and add an alias for the slugless form
date: 2021-01-11
category: logic-errors
module: routing
problem_type: logic_error
component: frontend
symptoms:
  - "After collapsing the two BookDetail patterns into one, a hard refresh of /book/<slug>-<isbn> no longer resolves the book"
  - "The break survives casual testing: clicking a book link still works, because that navigation never parses the URL"
  - "A slugless /book/<isbn> URL does not match the strict '/book/:slug(.+)?-:isbn' pattern"
root_cause: logic_error
resolution_type: code_fix
severity: high
framework_version: "vue-router 4.0.0-rc.2"
tags: [vue, vue-router, routing, books, url-slug, spa-refresh]
---

# Keep the strict BookDetail slug-isbn path and add an alias for the slugless form

## Problem

`BookDetail` in `src/router.js` is reached two ways: `/book/my-mommy-medicine-9781250140913`, and the slugless `/book/9781250140913` for a book whose title slugifies to nothing. Serving both from a single loosened pattern looks like the obvious cleanup and breaks the page.

The attempt (`5815f74`) replaced `path: '/book/:slug(.+)?-:isbn'` with `path: '/book/:slug(.*?)?:isbn'` — one optional, non-greedy slug group, no `-` delimiter — and made `BookDetailLink` append the `-` to the slug itself. It was reverted 35 minutes later (`a8101f1`), the revert message recording that it "broke the isbn matcher when refreshing a page."

## Symptoms

- On a full page load of a book URL, `$route.params.isbn` comes out wrong, so `src/pages/BookDetail.vue` — which selects with `book => book.isbn === this.$route.params.isbn`, an exact match — finds no book.
- Navigating to the same book by clicking a link still works, so the regression does not show up unless you reload the page or open the link cold.

## What Didn't Work

- `path: '/book/:slug(.*?)?:isbn'` — the collapsed pattern. With the `-` gone there is no delimiter between the two groups, so nothing pins where a lazy, optional slug ends and the isbn begins; the path cannot be split back into its two params reliably.
- Pushing the delimiter into the link component (`slug: slug ? slug + '-' : ''`) fixes only the generating direction. It cannot help the parsing direction, which is the one that breaks.

## Solution

Leave the strict pattern alone and serve the slugless form from a second route entry. `fea1dfd` added an alias, and both lines are still in `src/router.js` today:

```js
// e.g. http://localhost:8080/book/my-mommy-medicine-9781250140913
// slug: my-mommy-medicine
// isbn: 9781250140913
path: '/book/:slug(.+)?-:isbn',
// slug is expected to be omitted, but is included in the pattern to stifle a vue-router warning
alias: '/book/:slug?/:isbn(.*)',
```

`BookDetailLink` went back to the plain `slug: slugify(this.book.title.replace(/'/g, ''))` and has stayed there. The alias declares `:slug?` only because vue-router warns when an alias does not carry the same params as its path; the slug is expected to be absent on that form.

## Why This Works

A route pattern runs in two directions, and only one of them is exercised by clicking around the app. `BookDetailLink` navigates by named route — `{ name: 'BookDetail', params: { isbn, slug } }` — so vue-router builds the URL from the params it was handed and the component receives those params directly. Parsing a URL back into params happens on a full page load: a refresh, a pasted link, a shared link. That asymmetry is why a bad pattern passes a click-through test and fails in production on exactly the URLs people share.

The `-` in `'/book/:slug(.+)?-:isbn'` is what makes the parse unambiguous, so it has to stay literal in the pattern rather than move into the slug value. A second entry is the cheap way to add a shape the strict pattern cannot express.

## Prevention

- Test a route pattern change by reloading the URL in the browser, not by clicking to it. A click-through only proves the generating direction.
- When a route needs to accept two URL shapes, add an `alias` (or a second route) instead of loosening the one pattern into optional non-greedy groups.
- Keep a literal delimiter between adjacent path params. Two variable-width groups with nothing between them have no single correct split.

## Related Issues

- `5815f74` — "Router: fix detail page empty slug." The collapsed pattern.
- `a8101f1` — "Revert 'Router: fix detail page empty slug.'" Same day, 35 minutes later, for breaking the isbn matcher on refresh.
- `fea1dfd` — "router: make slug truly optional in book route." The alias, four days later; the shape that survived.
