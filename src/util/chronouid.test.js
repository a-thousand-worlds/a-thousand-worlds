/**
 * Characterizes util/chronouid, the id every submission, tag log entry and popup is keyed by, at
 * the seams where it leans on third-party packages and runtime behavior, so a dependency upgrade
 * that changes an id fails here first:
 * - uuid v4 supplies the 7-character random suffix. uuid is ESM-only ("type": "module") and
 * exports { node: dist-node, default: dist }, so vitest resolves the node build (node:crypto
 * randomUUID) while webpack ships dist/ (globalThis.crypto.randomUUID); both must yield lowercase
 * hex in the first 7 characters. The suffix is not seeded, so only its format and distinctness are
 * asserted.
 * - vitest fake timers, faking Date explicitly so a changed default cannot silently alter coverage,
 * drive the Date.now() fallback that every call site in src relies on.
 * - Number#toString(16) renders the time prefix, whose fixed width keeps ids sorting newest-first.
 * Nothing here is mocked.
 */
import chronouid from '@/util/chronouid'

/** The instant the frozen-clock tests run at. */
const NOW = '2026-09-24T00:00:00Z'

/** Hex time prefix chronouid derives from NOW ("decamillenium" minus the epoch millis). */
const NOW_PREFIX = 'e4d701a08a80'

/** Matches a whole chronouid: 12 hex digits of time, a dash, 7 lowercase hex digits of uuid. */
const ID_PATTERN = /^[0-9a-f]{12}-[0-9a-f]{7}$/

/** Returns the time prefix of an id, the part that decides its sort position. */
const prefix = id => id.slice(0, 12)

afterEach(() => {
  vi.useRealTimers()
})

describe('with a date argument', () => {
  test('renders the time as 12 hex digits, a dash and a 7-digit hex suffix, 20 characters long', () => {
    const id = chronouid(new Date(NOW))
    expect(id).toMatch(/^e4d701a08a80-[0-9a-f]{7}$/)
    expect(id).toHaveLength(20)
  })

  test.each([
    ['1970-01-01T00:00:00Z', 'e677d256ca80-'],
    ['2021-01-01T00:00:00Z', 'e50117185a80-'],
    ['2024-01-01T00:00:00Z', 'e4eb1004d680-'],
    ['2026-09-24T00:00:00Z', 'e4d701a08a80-'],
    ['2026-09-24T00:00:00.001Z', 'e4d701a08a7f-'],
  ])('%s gets the fixed time prefix %s', (iso, expected) => {
    const id = chronouid(new Date(iso))
    expect(id.slice(0, 13)).toBe(expected)
    expect(id).toMatch(ID_PATTERN)
    expect(id).toHaveLength(20)
  })

  test('ignores the system clock when a date is given', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2021-01-01T00:00:00Z'))
    expect(prefix(chronouid(new Date(NOW)))).toBe(NOW_PREFIX)
  })
})

describe('without a date argument', () => {
  test('reads the time from Date.now()', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(NOW))
    const id = chronouid()
    expect(id.slice(0, 13)).toBe(`${NOW_PREFIX}-`)
    expect(id).toMatch(ID_PATTERN)
  })

  test('counts down by one per elapsed millisecond', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(NOW))
    expect(prefix(chronouid())).toBe('e4d701a08a80')
    vi.advanceTimersByTime(1)
    expect(prefix(chronouid())).toBe('e4d701a08a7f')
    vi.advanceTimersByTime(1000)
    expect(prefix(chronouid())).toBe('e4d701a08697')
  })
})

describe('sort order', () => {
  test('ids sort newest-first lexicographically', () => {
    const ids = [
      chronouid(new Date('2021-01-01T00:00:00Z')),
      chronouid(new Date('2026-09-24T00:00:00Z')),
      chronouid(new Date('2024-01-01T00:00:00Z')),
    ]
    expect(ids.toSorted().map(prefix)).toEqual(['e4d701a08a80', 'e4eb1004d680', 'e50117185a80'])
  })

  test('an id made one millisecond later sorts before the earlier one', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(NOW))
    const earlier = chronouid()
    vi.advanceTimersByTime(1)
    const later = chronouid()
    expect([earlier, later].toSorted()).toEqual([later, earlier])
  })
})

describe('uuid suffix', () => {
  test('ids made at the same instant share the time prefix and differ in their uuid suffix', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(NOW))
    const ids = Array.from({ length: 20 }, () => chronouid())
    ids.forEach(id => {
      expect(id.slice(0, 13)).toBe(`${NOW_PREFIX}-`)
      expect(id.slice(13)).toMatch(/^[0-9a-f]{7}$/)
    })
    expect(new Set(ids).size).toBe(20)
  })
})
