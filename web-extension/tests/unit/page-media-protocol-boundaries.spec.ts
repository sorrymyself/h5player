import { describe, expect, it } from 'vitest'
import { commandSuccess } from '../../src/domain/command'
import { createMediaCapabilities, type MediaSnapshot } from '../../src/domain/media'
import {
  createPageMediaMessage,
  createPageMediaRequest,
  createPageMediaResponse,
  parsePageMediaMessage
} from '../../src/infrastructure/messaging/page-media-protocol'

const sessionId = 'session-identifier-1'
const nonce = 'a'.repeat(64)
const requestId = 'request-identifier-1'

function snapshot(): MediaSnapshot {
  return {
    id: 'media-1',
    frameId: 0,
    kind: 'video',
    state: 'paused',
    metrics: {
      width: 640,
      height: 360,
      duration: 120,
      currentTime: 12,
      volume: 0.5,
      playbackRate: 1,
      muted: false,
      visible: true
    },
    capabilities: createMediaCapabilities({
      playback: true,
      seek: true,
      playbackRate: true,
      volume: true,
      mute: true
    }),
    adapterId: 'generic',
    updatedAt: 100
  }
}

function state() {
  const media = snapshot()
  return {
    frameId: 0,
    revision: 2,
    activeMediaId: media.id,
    media: [media],
    observedAt: 101
  }
}

describe('page media protocol boundaries', () => {
  it('constructs and parses every request and response with correlated IDs', () => {
    const mediaState = state()
    const command = { type: 'media.set-volume', mediaId: 'media-1', value: 0.8 } as const
    const context = createPageMediaRequest(
      'media.context',
      sessionId,
      nonce,
      { frameId: 0, siteOrigin: 'https://v.qq.com' },
      requestId
    )
    const getState = createPageMediaRequest('media.get-state', sessionId, nonce, {})
    const configureAuthority = createPageMediaRequest(
      'media.configure-authority',
      sessionId,
      nonce,
      { policy: { playbackRate: true, volume: true, currentTime: false } },
      requestId
    )
    const configureExperimental = createPageMediaRequest(
      'media.configure-experimental',
      sessionId,
      nonce,
      { policy: { mediaDownload: true } },
      requestId
    )
    const execute = createPageMediaRequest(
      'media.execute',
      sessionId,
      nonce,
      { command },
      requestId
    )
    const executePageAction = createPageMediaRequest(
      'media.execute-page-action',
      sessionId,
      nonce,
      { action: 'next' },
      requestId
    )
    const executeAutoplay = createPageMediaRequest(
      'media.execute-page-action',
      sessionId,
      nonce,
      { action: 'autoplay' },
      requestId
    )
    const ready = createPageMediaResponse(
      'media.context-ready',
      sessionId,
      nonce,
      {},
      context.requestId
    )
    const authorityConfigured = createPageMediaResponse(
      'media.authority-configured',
      sessionId,
      nonce,
      { policy: configureAuthority.payload.policy },
      configureAuthority.requestId
    )
    const experimentalConfigured = createPageMediaResponse(
      'media.experimental-configured',
      sessionId,
      nonce,
      { policy: configureExperimental.payload.policy },
      configureExperimental.requestId
    )
    const stateResponse = createPageMediaResponse(
      'media.state',
      sessionId,
      nonce,
      { state: mediaState },
      getState.requestId
    )
    const commandResponse = createPageMediaResponse(
      'media.command-result',
      sessionId,
      nonce,
      {
        result: commandSuccess(command, snapshot(), true),
        state: mediaState
      },
      execute.requestId
    )
    const pageActionResponse = createPageMediaResponse(
      'media.page-action-result',
      sessionId,
      nonce,
      { declared: true, handled: true, adapterId: 'tencent-video' },
      executePageAction.requestId
    )
    const error = createPageMediaResponse(
      'media.error',
      sessionId,
      nonce,
      {
        requestType: 'media.execute',
        code: 'RUNTIME_UNAVAILABLE',
        messageKey: 'media.error.runtime-unavailable'
      },
      execute.requestId
    )
    const direct = createPageMediaMessage('media.get-state', 'content', sessionId, nonce, {})

    for (const message of [
      context,
      configureAuthority,
      configureExperimental,
      getState,
      execute,
      executePageAction,
      executeAutoplay,
      ready,
      authorityConfigured,
      experimentalConfigured,
      stateResponse,
      commandResponse,
      pageActionResponse,
      error,
      direct
    ]) {
      expect(parsePageMediaMessage(message)).toEqual(message)
    }
    expect(getState.requestId.length).toBeGreaterThanOrEqual(16)
    expect(direct.requestId.length).toBeGreaterThanOrEqual(16)
    expect(ready.requestId).toBe(context.requestId)
    expect(authorityConfigured.requestId).toBe(configureAuthority.requestId)
    expect(experimentalConfigured.requestId).toBe(configureExperimental.requestId)
    expect(commandResponse.requestId).toBe(execute.requestId)
    expect(pageActionResponse.requestId).toBe(executePageAction.requestId)
  })

  it('rejects wrong direction, malformed identity fields, extras, and invalid payloads', () => {
    const valid = createPageMediaRequest(
      'media.context',
      sessionId,
      nonce,
      { frameId: 0 },
      requestId
    )
    const validState = state()
    const validStateMessage = createPageMediaMessage(
      'media.state',
      'page-main',
      sessionId,
      nonce,
      { state: validState },
      requestId
    )
    const invalidMessages: unknown[] = [
      null,
      { ...valid, protocol: 2 },
      { ...valid, source: 'page-main' },
      { ...valid, requestId: 'short' },
      { ...valid, sessionId: 'short' },
      { ...valid, nonce: nonce.toUpperCase() },
      { ...valid, nonce: 'a'.repeat(63) },
      { ...valid, extra: true },
      { ...valid, payload: { frameId: -1 } },
      { ...valid, payload: { frameId: 0, siteOrigin: '' } },
      { ...valid, payload: { frameId: 0, extra: true } },
      {
        ...createPageMediaRequest(
          'media.configure-authority',
          sessionId,
          nonce,
          { policy: { playbackRate: true, volume: true, currentTime: false } },
          requestId
        ),
        payload: { policy: { playbackRate: true, volume: true } }
      },
      {
        ...createPageMediaRequest(
          'media.configure-authority',
          sessionId,
          nonce,
          { policy: { playbackRate: true, volume: true, currentTime: false } },
          requestId
        ),
        payload: {
          policy: { playbackRate: true, volume: true, currentTime: false, extra: true }
        }
      },
      {
        ...createPageMediaRequest(
          'media.configure-experimental',
          sessionId,
          nonce,
          { policy: { mediaDownload: true } },
          requestId
        ),
        payload: { policy: { mediaDownload: 'yes' } }
      },
      {
        ...createPageMediaRequest(
          'media.configure-experimental',
          sessionId,
          nonce,
          { policy: { mediaDownload: true } },
          requestId
        ),
        payload: { policy: { mediaDownload: true, extra: true } }
      },
      {
        ...validStateMessage,
        payload: { state: { ...validState, activeMediaId: null } }
      },
      {
        ...createPageMediaRequest(
          'media.execute',
          sessionId,
          nonce,
          { command: { type: 'media.play', mediaId: 'media-1' } },
          requestId
        ),
        payload: { command: { type: 'media.play', mediaId: 'media-1', extra: true } }
      },
      {
        ...createPageMediaRequest(
          'media.execute-page-action',
          sessionId,
          nonce,
          { action: 'next' },
          requestId
        ),
        payload: { action: 'arbitrary' }
      },
      {
        ...createPageMediaResponse(
          'media.error',
          sessionId,
          nonce,
          {
            requestType: 'media.get-state',
            code: 'INTERNAL_ERROR',
            messageKey: 'media.error.internal'
          },
          requestId
        ),
        payload: {
          requestType: 'media.get-state',
          code: 'UNKNOWN_ERROR',
          messageKey: ''
        }
      }
    ]

    for (const message of invalidMessages) {
      expect(parsePageMediaMessage(message)).toBeNull()
    }
  })
})
