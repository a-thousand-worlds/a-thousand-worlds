---
title: Puppeteer in functions/ must launch @sparticuz/chromium, and Amazon needs stealth plus a real-browser fingerprint
date: 2025-11-18
category: runtime-errors
module: functions
problem_type: runtime_error
component: service_layer
symptoms:
  - Amazon search pages load in the deployed function but contain no result items
  - A puppeteer launch that works locally fails in the deployed function with no browser to execute
root_cause: incomplete_setup
resolution_type: code_fix
severity: high
framework_version: node 20
tags: [puppeteer, chromium, firebase-functions, functions, web-scraping, amazon, books]
---

# Puppeteer in functions/ must launch @sparticuz/chromium, and Amazon needs stealth plus a real-browser fingerprint

## Problem

`functions/` scrapes Amazon with headless Chrome to find a book's ISBN
(`amazonSearchBook`) and its cover image (`util/coverImageByISBN`). Two separate
things break that, and the repo has been bitten by each of them four years apart.
One of the two call sites is still broken today.

## Symptoms

- **Bot detection.** A default `puppeteer.launch()` reaches Amazon, but the page
  it gets back has no `div.s-result-item` entries to parse, so the scrape returns
  `null` for a book that exists. This is what `028b840` was written against
  ("puppeteer stealth extra plugin to pass amazon detecion").
- **No browser to launch.** After PR #18 swapped the `puppeteer` dependency for
  `puppeteer-core`, any launch that does not pass an `executablePath` has no
  Chromium to start in the deployed runtime.

## What Didn't Work

- **Plain `puppeteer`.** `028b840` replaced `require('puppeteer')` with
  `puppeteer-extra` + `puppeteer-extra-plugin-stealth` in both
  `functions/amazonSearchBook.js` and `functions/util/coverImageByISBN.js`.
- **Stealth on its own.** PR #18 kept stealth and still had to add a desktop
  user agent, a 1280x720 viewport and `accept-language: en-US,en;q=0.9` before
  the search worked — the comment it left says "mimic a real browser to avoid
  Amazon bot detection".
- **Shipping the browser inside the dependency.** PR #18 dropped `puppeteer`
  (which bundles Chromium) for `puppeteer-core` plus `@sparticuz/chromium`, the
  Chromium build packaged for serverless runtimes.

## Solution

`functions/amazonSearchBook.js` is the reference shape. Take both halves from it:

```js
const chromium = require('@sparticuz/chromium')

// required lazily so the stealth plugin's module graph stays out of cold start
let puppeteer = null
const getPuppeteer = () => {
  if (!puppeteer) {
    puppeteer = require('puppeteer-extra')
    puppeteer.use(require('puppeteer-extra-plugin-stealth')())
  }
  return puppeteer
}

const browser = await getPuppeteer().launch({
  args: [...chromium.args, '--no-sandbox'],
  executablePath: await chromium.executablePath(),
  headless: chromium.headless,
})

const page = await browser.newPage()
await page.setUserAgent(
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
)
await page.setViewport({ width: 1280, height: 720 })
await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' })
```

## Why This Works

`functions/package.json` lists `puppeteer-core`, not `puppeteer`, so no Chromium
is installed with the dependency tree. `puppeteer-extra` does not change that: its
`requireVanillaPuppeteer()` tries `require('puppeteer')` first and falls back to
`require('puppeteer-core')` — and `functions/package-lock.json` has no `puppeteer`
entry at all, so the fallback is the only branch that can be taken. Every
`puppeteer-extra` launch in `functions/` is therefore
a `puppeteer-core` launch underneath and has nothing to execute unless
`executablePath` names a binary. `@sparticuz/chromium` supplies that binary along
with the `args` and `headless` settings its build needs to start inside the
Cloud Functions sandbox.

The stealth plugin and the fingerprint calls solve a different problem — Amazon
serving a resultless page to something it recognizes as automation — which is why
neither half substitutes for the other.

## Prevention

- **Every `launch()` under `functions/` passes `executablePath: await
chromium.executablePath()` and spreads `chromium.args`.** A launch without it
  will pass review and pass locally (a developer machine often has a Chrome that
  `puppeteer-core` can be pointed at) and only fail once deployed.
- **`functions/util/coverImageByISBN.js` still violates this.** Its `scrape()`
  calls `puppeteer.launch({ defaultViewport, args: ['--no-sandbox'] })` with no
  `executablePath` — the pre-#18 shape, left behind because #18 only touched
  `functions/amazonSearchBook.js`. That file is reachable from the `coverImageByISBN` HTTP
  function and from the `watchBooks` create/update triggers and
  `watchBookSubmissions`, so cover lookup for a newly added book runs it. Fixing
  it means the launch options above plus the `runWith` below; the stealth plugin
  it already has.
- **A browser launch also needs `.runWith({ timeoutSeconds: 300, memory: '1GB' })`
  at its export.** Every other launching entry point has it — `amazonSearchBook`
  (`functions/index.js`, commented "increase function memory since we are doing image
  processing"), the `watchBooks` triggers, `watchBookSubmissions`. The exception is
  `exports.coverImageByISBN`, which is a bare `functions.https.onRequest(...)`, so the
  HTTP path launches Chromium at the 256MB/60s default while the trigger paths into the
  same file are provisioned. That is the second half of fixing the call site above.
- **A dependency swap under `functions/` is a call-site audit.** Grepping
  `functions` for `puppeteer` finds two call sites; #18 changed one.
- **`test/amazonSearchBook.sh` is how a launch is proven to work.** It runs the
  function against `firebase emulators:start --only functions` and asserts on a known
  result. It is not part of `npm test` (which is `vitest run` over `src/` and `mcp/`), so
  it has to be run by hand — and there is no equivalent for `coverImageByISBN`.

## Related Issues

- PR #18 — "Fix and optimise amazonSearchBook firebase function" (2025-11-18):
  `puppeteer` to `puppeteer-core` + `@sparticuz/chromium`, lazy stealth require,
  UA / viewport / `accept-language`.
- `028b840` — "puppeteer stealth extra plugin to pass amazon detecion"
  (2021-03-10): the first time Amazon bot detection broke both scrapers; added
  `puppeteer-extra` and the stealth plugin to `functions/amazonSearchBook.js` and
  `functions/util/coverImageByISBN.js`.
