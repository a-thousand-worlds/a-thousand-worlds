// https://github.com/raineorshine/npm-check-updates
module.exports = {
  reject: [
    // v2+ requires pure ESM
    '@sindresorhus/slugify',
    'sass-loader',
    // v9+ drops the namespaced API that src/ and migrations/ are written against
    // See docs/solutions/tooling-decisions/firebase-sdk-pinned-at-v8.md
    'firebase',
  ],
}
