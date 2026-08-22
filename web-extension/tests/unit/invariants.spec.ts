import { describe, expect, it } from 'vitest'
import { clamp, clampUnit } from '../../src/domain/media/invariants'

describe('media invariants', () => {
  it('clamps values to a valid range', () => {
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(4, 0, 10)).toBe(4)
    expect(clamp(11, 0, 10)).toBe(10)
    expect(clamp(Number.NaN, 0, 10)).toBe(0)
  })

  it('rejects an inverted range', () => {
    expect(() => clamp(1, 10, 0)).toThrow(RangeError)
    expect(clampUnit(2)).toBe(1)
  })
})
