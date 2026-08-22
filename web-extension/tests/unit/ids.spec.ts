import { describe, expect, it } from 'vitest'
import { createRequestId, createSessionId, createSessionNonce } from '../../src/shared/ids'

describe('session IDs', () => {
  it('creates non-empty unique identifiers', () => {
    const ids = new Set(
      Array.from({ length: 100 }, (_, index) =>
        index % 2 === 0 ? createSessionId() : createRequestId()
      )
    )
    expect(ids.size).toBe(100)
    expect([...ids].every((id) => id.length >= 16)).toBe(true)
  })

  it('creates 256-bit session nonces', () => {
    expect(createSessionNonce()).toMatch(/^[a-f0-9]{64}$/)
  })
})
