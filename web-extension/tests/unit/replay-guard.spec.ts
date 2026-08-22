import { describe, expect, it } from 'vitest'
import { ReplayGuard } from '../../src/infrastructure/messaging/replay-guard'
import { FakeClock } from '../test-support/fakes'

describe('replay guard', () => {
  it('rejects duplicates, expires entries and isolates scopes', () => {
    const clock = new FakeClock(0)
    const guard = new ReplayGuard(clock, { ttlMs: 10, maxEntries: 2 })

    expect(guard.accept('a', '1')).toBe(true)
    expect(guard.accept('a', '1')).toBe(false)
    expect(guard.accept('b', '1')).toBe(true)
    clock.advance(11)
    expect(guard.accept('a', '1')).toBe(true)
    guard.clearScope('a')
    expect(guard.accept('a', '1')).toBe(true)
  })
})
