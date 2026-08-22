import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReplayGuard } from '../../src/infrastructure/messaging/replay-guard'
import {
  createPageMediaMessage,
  parsePageMediaMessage
} from '../../src/infrastructure/messaging/page-media-protocol'
import { systemClock, systemScheduler } from '../../src/infrastructure/time/system-time'
import { startContentRuntime } from '../../src/runtime/content/content-runtime'
import { PageBridge } from '../../src/runtime/content/page-bridge'
import { startPageMainRuntime } from '../../src/runtime/page-main/page-main-runtime'
import {
  createBridgeMessage,
  createRuntimeSuccess,
  parseBridgeMessage,
  parseRuntimeRequest
} from '../../src/shared/protocol'
import { FakeTransport } from '../test-support/fakes'

afterEach(() => {
  vi.restoreAllMocks()
  delete document.documentElement.dataset['h5playerWebextContent']
  delete document.documentElement.dataset['h5playerWebextMain']
  delete document.documentElement.dataset['h5playerWebextBridge']
  delete document.documentElement.dataset['h5playerWebextBackground']
  delete document.documentElement.dataset['h5playerWebextMedia']
})

describe('page/content runtime bridge', () => {
  it('completes a nonce-bound handshake and tears down cleanly', async () => {
    const session = {
      sessionId: 'session-identifier-1',
      nonce: 'a'.repeat(64),
      origin: window.location.origin
    }
    const post = vi.spyOn(window, 'postMessage').mockImplementation((raw) => {
      const request = parseBridgeMessage(raw)
      if (request?.type !== 'bridge.init') return
      queueMicrotask(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: createBridgeMessage(
              'bridge.ready',
              'page-main',
              session.sessionId,
              session.nonce,
              request.requestId
            ),
            origin: session.origin,
            source: window
          })
        )
      })
    })
    const bridge = new PageBridge({
      window,
      session,
      replayGuard: new ReplayGuard(systemClock),
      scheduler: systemScheduler,
      injectPageMain: () => Promise.resolve()
    })

    await expect(bridge.start()).resolves.toBe(true)
    bridge.ping()
    bridge.stop()
    expect(post).toHaveBeenCalled()
  })

  it('page-main accepts one session, answers ping and ignores forged sessions', () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const teardown = startPageMainRuntime(window, document)
    const sessionId = 'session-identifier-1'
    const nonce = 'a'.repeat(64)
    const dispatch = (data: unknown) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          data,
          origin: window.location.origin,
          source: window
        })
      )

    dispatch(createBridgeMessage('bridge.init', 'content', sessionId, nonce))
    dispatch(createBridgeMessage('bridge.ping', 'content', sessionId, nonce))
    dispatch(
      createBridgeMessage('bridge.dispose', 'content', 'other-session-value', 'b'.repeat(64))
    )

    const responseTypes = post.mock.calls
      .map(([message]) => parseBridgeMessage(message)?.type)
      .filter(Boolean)
    expect(responseTypes).toEqual(['bridge.ready', 'bridge.pong'])
    teardown()
  })

  it('assembles content, page bridge and background transport without exposing secrets in DOM', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation((raw) => {
      const request = parseBridgeMessage(raw)
      const mediaRequest = parsePageMediaMessage(raw)
      if (request?.type === 'bridge.init') {
        queueMicrotask(() => {
          window.dispatchEvent(
            new MessageEvent('message', {
              data: createBridgeMessage(
                'bridge.ready',
                'page-main',
                request.sessionId,
                request.nonce,
                request.requestId
              ),
              origin: window.location.origin,
              source: window
            })
          )
        })
      }
      if (mediaRequest?.type === 'media.context') {
        queueMicrotask(() => {
          window.dispatchEvent(
            new MessageEvent('message', {
              data: createPageMediaMessage(
                'media.context-ready',
                'page-main',
                mediaRequest.sessionId,
                mediaRequest.nonce,
                {},
                mediaRequest.requestId
              ),
              origin: window.location.origin,
              source: window
            })
          )
        })
      }
    })
    const transport = new FakeTransport((raw) => {
      const request = parseRuntimeRequest(raw)
      if (!request) return Promise.reject(new Error('invalid request'))
      return Promise.resolve(
        createRuntimeSuccess(
          request,
          {
            extensionVersion: '0.1.0',
            phase: 6,
            protocol: 1,
            settingsSchemaVersion: 3
          },
          request.sessionId ? { sessionId: request.sessionId } : {}
        )
      )
    })

    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport,
      injectPageMain: () => Promise.resolve()
    })
    expect(document.documentElement.dataset['h5playerWebextBridge']).toBe('ready')
    expect(document.documentElement.dataset['h5playerWebextBackground']).toBe('ready')
    expect(document.documentElement.dataset['h5playerWebextMedia']).toBe('ready')
    expect(document.documentElement.dataset['h5playerWebextSession']).toBeUndefined()
    runtime.teardown()
    expect(post).toHaveBeenCalled()
  })
})
