import { describe, expect, it } from 'vitest'
import {
  createBridgeMessage,
  createRuntimeError,
  createRuntimeRequest,
  createRuntimeSuccess,
  parseBridgeMessage,
  parseRuntimeRequest,
  parseRuntimeResponse
} from '../../src/shared/protocol'

describe('versioned message protocol', () => {
  it('round-trips strict runtime requests and responses', () => {
    const request = createRuntimeRequest('popup', 'system.ping', {})
    const response = createRuntimeSuccess(request, { phase: 1 })

    expect(parseRuntimeRequest(request)).toEqual(request)
    expect(parseRuntimeResponse(response)).toEqual(response)
    expect(parseRuntimeRequest({ ...request, unknown: true })).toBeNull()
  })

  it('returns typed errors without stack or diagnostic payloads', () => {
    const request = createRuntimeRequest('options', 'settings.get', {})
    const response = createRuntimeError(
      request,
      'UNAUTHORIZED_SOURCE',
      'protocol.error.unauthorized-source'
    )

    expect(parseRuntimeResponse(response)).toEqual(response)
    expect(JSON.stringify(response)).not.toContain('stack')
  })

  it('requires a 256-bit hexadecimal nonce for page bridge messages', () => {
    const valid = createBridgeMessage(
      'bridge.init',
      'content',
      'session-identifier-1',
      'a'.repeat(64)
    )

    expect(parseBridgeMessage(valid)).toEqual(valid)
    expect(parseBridgeMessage({ ...valid, nonce: 'short' })).toBeNull()
    expect(parseBridgeMessage({ ...valid, type: 'settings.update' })).toBeNull()
  })
})
