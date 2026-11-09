// The build stamp: which commit a build was made from, so a deployed site can say what it runs.
// Hosting is deployed by hand from a local checkout, so the stamp also marks a build made from a
// working tree with uncommitted changes. vue.config.js writes it into index.html as <meta> tags and
// emits it as dist/version.json; both can be read with curl, without opening the app.
const { execFileSync } = require('node:child_process')

/** Commit to report when git is missing or the directory is not a repository. */
const UNKNOWN_COMMIT = 'unknown'

/** Name the version.json plugin goes by in webpack's hooks and plugin list. */
const PLUGIN_NAME = 'BuildStampPlugin'

/** Runs git in cwd and returns its trimmed output, or null if git fails or is not installed. */
const git = (args, cwd) => {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

/**
 * Reads the build stamp for the checkout at cwd: the short hash of HEAD, suffixed -dirty when
 * tracked files have uncommitted changes, and the build time as an ISO string. Untracked files do
 * not count, since stray files such as an update script's output sit in the root without reaching
 * the bundle. The commit falls back to 'unknown' rather than failing the build.
 */
const getBuildStamp = ({ cwd = __dirname, date = new Date() } = {}) => {
  const hash = git(['rev-parse', '--short', 'HEAD'], cwd)
  const dirty = hash && git(['status', '--porcelain', '--untracked-files=no'], cwd)
  return {
    commit: hash ? `${hash}${dirty ? '-dirty' : ''}` : UNKNOWN_COMMIT,
    date: date.toISOString(),
  }
}

/** A webpack plugin that emits the stamp as version.json at the root of the build output. */
const createVersionJsonPlugin = stamp => ({
  name: PLUGIN_NAME,
  apply: compiler => {
    const { Compilation, sources } = compiler.webpack
    compiler.hooks.thisCompilation.tap(PLUGIN_NAME, compilation => {
      compilation.hooks.processAssets.tap(
        { name: PLUGIN_NAME, stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL },
        () => {
          compilation.emitAsset(
            'version.json',
            new sources.RawSource(`${JSON.stringify(stamp, null, 2)}\n`),
          )
        },
      )
    })
  },
})

module.exports = { UNKNOWN_COMMIT, createVersionJsonPlugin, getBuildStamp }
