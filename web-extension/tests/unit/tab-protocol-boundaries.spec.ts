import { describe, expect, it } from 'vitest'
import {
  createTabError,
  createTabRequest,
  createTabSuccess,
  parseTabRequest,
  parseTabResponse
} from '../../src/shared/tab-protocol'

describe('tab protocol boundaries', () => {
  it('round-trips state and command requests with success and error responses', () => {
    const stateRequest = createTabRequest('media.get-state', {})
    const commandRequest = createTabRequest('media.execute', {
      command: { type: 'media.pause', mediaId: 'media-1' }
    })
    const success = createTabSuccess(stateRequest, {
      frameId: 0,
      revision: 0,
      activeMediaId: null,
      media: [],
      observedAt: 1
    })
    const defaultError = createTabError(
      commandRequest,
      'PAGE_RUNTIME_UNAVAILABLE',
      'tab.error.page-runtime-unavailable'
    )
    const retryableError = createTabError(
      commandRequest,
      'INTERNAL_ERROR',
      'tab.error.internal',
      true
    )

    expect(parseTabRequest(stateRequest)).toEqual(stateRequest)
    expect(parseTabRequest(commandRequest)).toEqual(commandRequest)
    expect(parseTabResponse(success)).toEqual(success)
    expect(parseTabResponse(defaultError)).toEqual(defaultError)
    expect(parseTabResponse(retryableError)).toEqual(retryableError)
    expect(defaultError.payload.error.retryable).toBe(false)
    expect(retryableError.payload.error.retryable).toBe(true)
    expect(success.requestId).toBe(stateRequest.requestId)
    expect(defaultError.requestId).toBe(commandRequest.requestId)
  })

  it('rejects malformed, forged, oversized, and non-strict envelopes', () => {
    const request = createTabRequest('media.get-state', {})
    const success = createTabSuccess(request, {})
    const error = createTabError(request, 'INVALID_PAYLOAD', 'tab.error.invalid-payload')
    const invalidRequests: unknown[] = [
      null,
      { ...request, protocol: 2 },
      { ...request, type: 'settings.get' },
      { ...request, source: 'popup' },
      { ...request, requestId: 'short' },
      { ...request, unexpected: true }
    ]
    const invalidResponses: unknown[] = [
      null,
      { ...success, source: 'background' },
      { ...success, requestId: 'short' },
      { ...success, payload: { ...success.payload, requestType: 'settings.get' } },
      { ...success, payload: { ...success.payload, unexpected: true } },
      { ...error, payload: { ...error.payload, error: { ...error.payload.error, retryable: 1 } } },
      {
        ...error,
        payload: {
          ...error.payload,
          error: { ...error.payload.error, code: 'UNKNOWN_ERROR' }
        }
      },
      {
        ...error,
        payload: {
          ...error.payload,
          error: { ...error.payload.error, messageKey: 'x'.repeat(129) }
        }
      },
      { ...error, unexpected: true }
    ]

    for (const invalid of invalidRequests) expect(parseTabRequest(invalid)).toBeNull()
    for (const invalid of invalidResponses) expect(parseTabResponse(invalid)).toBeNull()
  })
})
