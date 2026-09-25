// @vitest-environment node
// Guards vue.config.js, the one place the webpack build is customized, at the seams where it leans
// on third-party behavior: @vue/cli-service resolving the config (webpack-chain for chainWebpack,
// webpack-merge for configureWebpack), the resolve.fallback polyfills webpack 5 stopped bundling,
// the eslint-webpack-plugin registration, and the vue-svg-loader + vue-loader chain that turns an
// SVG import into a Vue component. Most breakage here fails `npm run build` loudly. The SVG chain
// is the exception, since it can build cleanly and still break every icon at runtime, so it is
// also run end to end: a real webpack compile of an SVG, rendered by Vue.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const Service = require('@vue/cli-service/lib/Service')
const ESLintWebpackPlugin = require('eslint-webpack-plugin')
const { VueLoaderPlugin } = require('vue-loader')
const vueSvgLoader = require('vue-svg-loader')
const webpack = require('webpack')
const { createSSRApp, h } = require('vue')
const { renderToString } = require('vue/server-renderer')
const vueConfig = require('./vue.config.js')

const repoRoot = path.dirname(fileURLToPath(import.meta.url))

/** vue-cli's own test for its svg rule, as String(rule.test) prints it. */
const SVG_RULE_TEST = '/\\.(svg)(\\?.*)?$/'

/** The package each polyfilled Node core module resolves into. */
const FALLBACK_PACKAGES = {
  assert: 'assert',
  http: 'stream-http',
  https: 'https-browserify',
  path: 'path-browserify',
  querystring: 'querystring-es3',
  stream: 'stream-browserify',
  url: 'url',
  util: 'util',
  zlib: 'browserify-zlib',
}

/** The svgo options vue.config.js hands vue-svg-loader. */
const SVG_LOADER_OPTIONS = { svgo: { plugins: [{ removeViewBox: false }] } }

/** An icon shaped like the ones in src/assets/icons: fixed width and height plus a viewBox. */
const FIXTURE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
  '<title>Fixture</title><path d="M0 0h24v24H0z"/></svg>'

/** Runs fn and then puts process.env back exactly as it was, dropping whatever fn added. */
const withRestoredEnv = fn => {
  const saved = { ...process.env }
  try {
    return fn()
  } finally {
    Object.keys(process.env)
      .filter(key => !(key in saved))
      .forEach(key => Reflect.deleteProperty(process.env, key))
    Object.assign(process.env, saved)
  }
}

/**
 * Resolves the webpack config @vue/cli-service builds in the given mode, as `vue-cli-service
 * serve` (development) or `build` (production) would. vue-cli branches on NODE_ENV, which vitest
 * has set to 'test' (a mode in which it drops its splitChunks cache groups), so NODE_ENV is set to
 * the mode for the synchronous resolution. Restoring process.env afterwards also discards what
 * Service.init loaded from the .env files.
 */
const resolveWebpackConfig = mode =>
  withRestoredEnv(() => {
    process.env.NODE_ENV = mode
    const service = new Service(repoRoot)
    service.init(mode)
    return service.resolveWebpackConfig()
  })

/** The part of a resolved file path after its last node_modules directory, with / separators. */
const packageRelativePath = file => {
  const marker = `${path.sep}node_modules${path.sep}`
  return file
    .slice(file.lastIndexOf(marker) + marker.length)
    .split(path.sep)
    .join('/')
}

/** Runs vue-svg-loader on svg the way webpack would, with options as the rule's options. */
const runSvgLoader = (svg, options) =>
  new Promise((resolve, reject) => {
    const loaderContext = {
      async: () => (error, output) => (error ? reject(error) : resolve(output)),
      query: options,
      resourcePath: path.join(repoRoot, 'src/assets/icons/fixture.svg'),
    }
    vueSvgLoader.call(loaderContext, svg)
  })

/**
 * Compiles svg as an imported module with webpack, using the given module rules, and evaluates the
 * bundle to return its default export. The fixture lives in a temporary directory that is removed
 * afterwards. Compiler.compile builds without emitting, so nothing is written anywhere else. Vue
 * stays external so the component shares this file's Vue instance.
 */
const compileSvgModule = async (svg, rules) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vue-config-test-'))
  const entry = path.join(dir, 'icon.svg')
  fs.writeFileSync(entry, svg)
  const compiler = webpack({
    mode: 'production',
    context: repoRoot,
    target: 'web',
    devtool: false,
    cache: false,
    entry,
    externals: { vue: 'commonjs vue' },
    output: { path: dir, library: { type: 'commonjs2' } },
    module: { rules },
    plugins: [new VueLoaderPlugin()],
    optimization: { minimize: false },
  })
  try {
    const compilation = await new Promise((resolve, reject) => {
      compiler.compile((error, result) => (error ? reject(error) : resolve(result)))
    })
    const problems = [...compilation.errors, ...compilation.warnings].map(String)
    if (problems.length > 0) {
      throw new Error(`webpack reported problems compiling the SVG:\n${problems.join('\n')}`)
    }
    const bundle = compilation.assets['main.js'].source().toString()
    const bundleModule = { exports: {} }
    vm.runInThisContext(`(function (module, exports, require) {${bundle}\n})`)(
      bundleModule,
      bundleModule.exports,
      require,
    )
    return bundleModule.exports.default
  } finally {
    await new Promise(resolve => compiler.close(resolve))
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** Server-renders component, with the given attributes from a parent, to an HTML string. */
const renderHtml = (component, attrs = {}) =>
  renderToString(createSSRApp({ render: () => h(component, attrs) }))

describe('vue.config.js', () => {
  test('polyfills exactly the Node core modules the browser bundle needs, and stubs out fs', () => {
    const { fallback } = vueConfig.configureWebpack.resolve

    expect(Object.keys(fallback).toSorted()).toEqual([
      'assert',
      'fs',
      'http',
      'https',
      'path',
      'querystring',
      'stream',
      'url',
      'util',
      'zlib',
    ])
    expect(fallback.fs).toBe(false)
  })

  // Compared by the path inside node_modules, since node_modules is a symlink in a worktree and
  // require.resolve returns the main checkout's real path.
  test.each(Object.entries(FALLBACK_PACKAGES))(
    'resolves the %s fallback to a file in the %s package',
    (core, pkg) => {
      const file = vueConfig.configureWebpack.resolve.fallback[core]

      expect(path.isAbsolute(file)).toBe(true)
      expect(fs.existsSync(file)).toBe(true)
      expect(packageRelativePath(file).split('/')[0]).toBe(pkg)
    },
  )
})

describe.each(['development', 'production'])('resolved by @vue/cli-service in %s', mode => {
  let config

  beforeAll(() => {
    config = resolveWebpackConfig(mode)
  })

  /** The resolved rules whose test prints as the given string. */
  const rulesWithTest = pattern => config.module.rules.filter(rule => String(rule.test) === pattern)

  test('builds in the matching webpack mode', () => {
    expect(config.mode).toBe(mode)
  })

  test('handles .svg files with exactly one rule, stripped of its asset/resource type', () => {
    const svgRules = rulesWithTest(SVG_RULE_TEST)
    const matching = config.module.rules.filter(
      rule => rule.test instanceof RegExp && rule.test.test('src/assets/icons/books.svg'),
    )

    expect(svgRules).toHaveLength(1)
    expect(matching).toEqual(svgRules)
    expect(Object.hasOwn(svgRules[0], 'type')).toBe(false)
  })

  test('runs SVGs through vue-svg-loader then vue-loader, with viewBox preserved', () => {
    expect(rulesWithTest(SVG_RULE_TEST)[0].use).toEqual([
      { loader: 'vue-loader' },
      { loader: 'vue-svg-loader', options: SVG_LOADER_OPTIONS },
    ])
  })

  test('compiles SVGs with the same vue-loader, and plugin, that compile .vue files', () => {
    const vueRule = rulesWithTest('/\\.vue$/').find(rule => rule.use)
    const vueLoaderPlugins = config.plugins.filter(plugin => plugin instanceof VueLoaderPlugin)

    expect(fs.realpathSync(require.resolve('vue-loader'))).toBe(
      fs.realpathSync(vueRule.use[0].loader),
    )
    expect(vueLoaderPlugins).toHaveLength(1)
  })

  test("splits all chunks while keeping vue-cli's vendor and common cache groups", () => {
    const { splitChunks } = config.optimization

    expect(splitChunks.chunks).toBe('all')
    expect(splitChunks.cacheGroups).toMatchObject({
      defaultVendors: { name: 'chunk-vendors', chunks: 'initial' },
      common: { name: 'chunk-common', chunks: 'initial', minChunks: 2 },
    })
  })

  test('merges resolve.fallback through unchanged', () => {
    expect(config.resolve.fallback).toEqual(vueConfig.configureWebpack.resolve.fallback)
  })

  test('lints src with a single ESLintWebpackPlugin that fails the build only on errors', () => {
    const eslintPlugins = config.plugins.filter(plugin => plugin instanceof ESLintWebpackPlugin)

    expect(eslintPlugins).toHaveLength(1)
    expect(eslintPlugins[0].options).toMatchObject({
      context: repoRoot,
      files: ['src/**/*.{js,jsx,ts,vue}'],
      extensions: ['js', 'jsx', 'ts', 'vue'],
      failOnWarning: false,
      failOnError: true,
      // eslint-webpack-plugin's default, which is what makes it read eslint.config.js
      configType: 'flat',
    })
  })
})

describe('an imported SVG', () => {
  let component

  beforeAll(async () => {
    const config = resolveWebpackConfig('production')
    const rules = config.module.rules.filter(rule =>
      ['/\\.vue$/', SVG_RULE_TEST].includes(String(rule.test)),
    )
    component = await compileSvgModule(FIXTURE_SVG, rules)
  })

  test('is optimized by svgo keeping its viewBox, given the configured options', async () => {
    expect(await runSvgLoader(FIXTURE_SVG, SVG_LOADER_OPTIONS)).toBe(
      '<template><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" ' +
        'viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg></template>',
    )
  })

  test('loses its viewBox to svgo without the removeViewBox override', async () => {
    expect(await runSvgLoader(FIXTURE_SVG, {})).toBe(
      '<template><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">' +
        '<path d="M0 0h24v24H0z"/></svg></template>',
    )
  })

  test('compiles to a Vue component that renders the optimized svg', async () => {
    expect(typeof component.render).toBe('function')
    expect(await renderHtml(component)).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
        '<path d="M0 0h24v24H0z"></path></svg>',
    )
  })

  test('takes class and attributes from its parent onto the svg element', async () => {
    expect(await renderHtml(component, { class: 'fill-secondary', width: '100%' })).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="24" viewBox="0 0 24 24" ' +
        'class="fill-secondary"><path d="M0 0h24v24H0z"></path></svg>',
    )
  })
})
