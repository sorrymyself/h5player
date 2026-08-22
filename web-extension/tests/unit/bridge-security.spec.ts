import { describe, expect, it } from 'vitest'
import { validateBridgeEvent } from '../../src/runtime/content/bridge-validation'
import { createBridgeMessage } from '../../src/shared/protocol'

describe('page bridge validation', () => {
  it('requires current window, exact origin, source, session and nonce', () => {
    const session = {
      sessionId: 'session-identifier-1',
      nonce: 'a'.repeat(64),
      origin: window.location.origin
    }
    const message = createBridgeMessage(
      'bridge.ready',
      'page-main',
      session.sessionId,
      session.nonce
    )
    const validEvent = { data: message, origin: session.origin, source: window }

    expect(validateBridgeEvent(validEvent, window, session, 'page-main')).toEqual(message)
    expect(
      validateBridgeEvent(
        { ...validEvent, origin: 'https://evil.example' },
        window,
        session,
        'page-main'
      )
    ).toBeNull()
    expect(
      validateBridgeEvent(
        { ...validEvent, data: { ...message, nonce: 'b'.repeat(64) } },
        window,
        session,
        'page-main'
      )
    ).toBeNull()
    expect(validateBridgeEvent(validEvent, window, session, 'content')).toBeNull()
  })
})
