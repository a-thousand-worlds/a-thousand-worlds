// @vitest-environment node
// Runs build-stamp.js against real git repositories in temporary directories, since what it reads
// is git's own output: a clean checkout, one with uncommitted changes, and a directory that is not
// a repository at all, which must still produce a stamp rather than fail the build.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const webpack = require('webpack')
const { UNKNOWN_COMMIT, createVersionJsonPlugin, getBuildStamp } = require('./build-stamp.js')

const DATE = new Date('2026-11-09T12:00:00.000Z')

/** Runs git in dir as a throwaway identity, so no global git config is needed. */
const git = (dir, ...args) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    cwd: dir,
    encoding: 'utf8',
  }).trim()

let dir

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-stamp-test-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

/** Turns dir into a repository with one commit and returns that commit's short hash. */
const commitFixture = () => {
  git(dir, 'init', '--quiet')
  fs.writeFileSync(path.join(dir, 'file.txt'), 'one\n')
  git(dir, 'add', 'file.txt')
  git(dir, 'commit', '--quiet', '-m', 'fixture')
  return git(dir, 'rev-parse', '--short', 'HEAD')
}

describe('getBuildStamp', () => {
  test('stamps a clean checkout with the short hash of HEAD and the build date', () => {
    const hash = commitFixture()

    expect(getBuildStamp({ cwd: dir, date: DATE })).toEqual({
      commit: hash,
      date: '2026-11-09T12:00:00.000Z',
    })
  })

  test('marks a checkout with uncommitted changes to a tracked file as dirty', () => {
    const hash = commitFixture()
    fs.writeFileSync(path.join(dir, 'file.txt'), 'two\n')

    expect(getBuildStamp({ cwd: dir, date: DATE }).commit).toBe(`${hash}-dirty`)
  })

  test('marks a checkout with staged changes as dirty', () => {
    const hash = commitFixture()
    fs.writeFileSync(path.join(dir, 'new.txt'), 'new\n')
    git(dir, 'add', 'new.txt')

    expect(getBuildStamp({ cwd: dir, date: DATE }).commit).toBe(`${hash}-dirty`)
  })

  test('ignores untracked files', () => {
    const hash = commitFixture()
    fs.writeFileSync(path.join(dir, 'stray.json'), '{}\n')

    expect(getBuildStamp({ cwd: dir, date: DATE }).commit).toBe(hash)
  })

  test('falls back to unknown outside a git repository', () => {
    expect(getBuildStamp({ cwd: dir, date: DATE })).toEqual({
      commit: UNKNOWN_COMMIT,
      date: '2026-11-09T12:00:00.000Z',
    })
  })

  test('falls back to unknown in a repository with no commits yet', () => {
    git(dir, 'init', '--quiet')

    expect(getBuildStamp({ cwd: dir, date: DATE }).commit).toBe(UNKNOWN_COMMIT)
  })
})

describe('createVersionJsonPlugin', () => {
  test('emits the stamp as version.json alongside the bundle', async () => {
    const entry = path.join(dir, 'entry.js')
    fs.writeFileSync(entry, 'export default 1\n')
    const stamp = { commit: 'abc1234-dirty', date: '2026-11-09T12:00:00.000Z' }
    const compiler = webpack({
      mode: 'production',
      context: dir,
      entry,
      output: { path: dir },
      plugins: [createVersionJsonPlugin(stamp)],
    })

    try {
      const compilation = await new Promise((resolve, reject) => {
        compiler.compile((error, result) => (error ? reject(error) : resolve(result)))
      })

      expect(compilation.errors).toEqual([])
      expect(JSON.parse(compilation.assets['version.json'].source().toString())).toEqual(stamp)
    } finally {
      await new Promise(resolve => compiler.close(resolve))
    }
  })
})
