import { afterEach, describe, expect, it, vi } from 'vitest'
import { commandSuccess } from '../../src/domain/command'
import { createMediaCapabilities, type MediaSnapshot } from '../../src/domain/media'
import { ReplayGuard } from '../../src/infrastructure/messaging/replay-guard'
import {
  createPageMediaResponse,
  parsePageMediaMessage,
  type PageMediaMessage,
  type PageMediaMessageType,
  type PageMediaPayloadByType,
  type PageMediaResponseType
} from '../../src/infrastructure/messaging/page-media-protocol'
import type { SchedulerPort } from '../../src/application/ports/browser'
import { PageBridge } from '../../src/runtime/content/page-bridge'
import { createBridgeMessage, parseBridgeMessage } from '../../src/shared/protocol'

const session = {
  sessionId: 'session-identifier-1',
  nonce: 'a'.repeat(64),
  origin: window.location.origin
}

function mediaSnapshot(): MediaSnapshot {
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

function mediaState() {
  const media = mediaSnapshot()
  return {
    frameId: 0,
    revision: 4,
    activeMediaId: media.id,
    media: [media],
    observedAt: 101
  }
}

function emitMessage(data: unknown, origin = session.origin, source: Window = window): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source }))
}

class ManualScheduler implements SchedulerPort {
  private readonly callbacks = new Map<ReturnType<typeof globalThis.setTimeout>, () => void>()
  private readonly clearedCallbacks: Array<() => void> = []

  setTimeout(callback: () => void): ReturnType<typeof globalThis.setTimeout> {
    const handle = globalThis.setTimeout(() => undefined, 60_000)
    globalThis.clearTimeout(handle)
    this.callbacks.set(handle, callback)
    return handle
  }

  clearTimeout(handle: ReturnType<typeof globalThis.setTimeout>): void {
    const callback = this.callbacks.get(handle)
    if (callback) this.clearedCallbacks.push(callback)
    this.callbacks.delete(handle)
    globalThis.clearTimeout(handle)
  }

  fireNext(): void {
    const next = this.callbacks.entries().next()
    if (next.done) throw new Error('No scheduled callback')
    const [handle, callback] = next.value
    this.callbacks.delete(handle)
    callback()
  }

  fireLastCleared(): void {
    const callback = this.clearedCallbacks.pop()
    if (!callback) throw new Error('No cleared callback')
    callback()
  }

  get size(): number {
    return this.callbacks.size
  }
}

type HarnessOptions = {
  readonly autoReady?: boolean
  readonly noisyHandshake?: boolean
  readonly onMedia?: (message: Extract<PageMediaMessage, { source: 'content' }>) => void
  readonly injectPageMain?: () => Promise<void>
}

type BridgeInternals = {
  sendMediaRequest(
    message: Extract<PageMediaMessage, { source: 'content' }>,
    expectedType: PageMediaMessageType
  ): Promise<PageMediaMessage>
  finishPending(requestId: string): void
}

function createHarness(options: HarnessOptions = {}) {
  const scheduler = new ManualScheduler()
  const postedMedia: Array<Extract<PageMediaMessage, { source: 'content' }>> = []
  const onMedia = options.onMedia
  const post = vi.spyOn(window, 'postMessage').mockImplementation((raw) => {
    const bridgeMessage = parseBridgeMessage(raw)
    if (bridgeMessage?.type === 'bridge.init' && options.autoReady !== false) {
      if (options.noisyHandshake) {
        emitMessage(
          createBridgeMessage(
            'bridge.pong',
            'page-main',
            session.sessionId,
            session.nonce,
            `${bridgeMessage.requestId}-pong`
          ),
          'https://forged.example'
        )
        emitMessage(
          createBridgeMessage(
            'bridge.pong',
            'page-main',
            session.sessionId,
            session.nonce,
            `${bridgeMessage.requestId}-valid-pong`
          )
        )
      }
      emitMessage(
        createBridgeMessage(
          'bridge.ready',
          'page-main',
          session.sessionId,
          session.nonce,
          bridgeMessage.requestId
        )
      )
      emitMessage(
        createBridgeMessage(
          'bridge.ready',
          'page-main',
          session.sessionId,
          session.nonce,
          bridgeMessage.requestId
        )
      )
    }
    const mediaMessage = parsePageMediaMessage(raw)
    if (mediaMessage?.source === 'content') {
      postedMedia.push(mediaMessage)
      onMedia?.(mediaMessage)
    }
  })
  const bridge = new PageBridge({
    window,
    session,
    replayGuard: new ReplayGuard({ now: () => 100 }),
    scheduler,
    injectPageMain: options.injectPageMain ?? (() => Promise.resolve()),
    timeoutMs: 250
  })
  return { bridge, post, scheduler, postedMedia }
}

function respond<T extends PageMediaResponseType>(
  request: Extract<PageMediaMessage, { source: 'content' }>,
  type: T,
  payload: PageMediaPayloadByType[T]
): void {
  emitMessage(
    createPageMediaResponse(type, session.sessionId, session.nonce, payload, request.requestId)
  )
}

const activeBridges: PageBridge[] = []

afterEach(() => {
  for (const bridge of activeBridges) bridge.stop()
  activeBridges.length = 0
  vi.restoreAllMocks()
})

describe('PageBridge media lifecycle', () => {
  it('shares one handshake, configures once, reads state, executes commands, pings, and tears down', async () => {
    const command = { type: 'media.play', mediaId: 'media-1' } as const
    const currentState = mediaState()
    let releaseInjection: (() => void) | undefined
    const injection = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseInjection = resolve
        })
    )
    const harness = createHarness({
      noisyHandshake: true,
      injectPageMain: injection,
      onMedia: (request) => {
        if (request.type === 'media.context') {
          respond(request, 'media.context-ready', {})
        } else if (request.type === 'media.configure-authority') {
          respond(request, 'media.authority-configured', { policy: request.payload.policy })
        } else if (request.type === 'media.configure-experimental') {
          respond(request, 'media.experimental-configured', { policy: request.payload.policy })
        } else if (request.type === 'media.get-state') {
          respond(request, 'media.state', { state: currentState })
          respond(request, 'media.state', { state: currentState })
        } else if (request.type === 'media.execute') {
          respond(request, 'media.command-result', {
            result: commandSuccess(command, mediaSnapshot(), true),
            state: currentState
          })
        } else if (request.type === 'media.execute-page-action') {
          respond(request, 'media.page-action-result', {
            declared: true,
            handled: true,
            adapterId: 'tencent-video'
          })
        }
      }
    })
    activeBridges.push(harness.bridge)
    const firstStart = harness.bridge.start()
    const secondStart = harness.bridge.start()
    expect(injection).toHaveBeenCalledTimes(1)
    releaseInjection?.()
    await expect(firstStart).resolves.toBe(true)
    await expect(secondStart).resolves.toBe(true)
    expect(injection).toHaveBeenCalledTimes(1)

    await expect(harness.bridge.start()).resolves.toBe(true)
    expect(await harness.bridge.configure(0, 'https://v.qq.com')).toBe(true)
    expect(await harness.bridge.configure(1)).toBe(true)
    await expect(
      harness.bridge.configureAuthority({
        playbackRate: true,
        volume: true,
        currentTime: false
      })
    ).resolves.toBe(true)
    await expect(harness.bridge.configureExperimental({ mediaDownload: true })).resolves.toBe(true)
    await expect(harness.bridge.getMediaState()).resolves.toEqual(currentState)
    harness.scheduler.fireLastCleared()
    emitMessage(
      createPageMediaResponse(
        'media.state',
        session.sessionId,
        session.nonce,
        { state: currentState },
        'stray-request-id-1'
      )
    )
    await expect(harness.bridge.executeMediaCommand(command)).resolves.toMatchObject({
      result: { ok: true, value: { commandType: 'media.play', changed: true } },
      state: currentState
    })
    await expect(harness.bridge.executePageAction('next')).resolves.toEqual({
      declared: true,
      handled: true,
      adapterId: 'tencent-video'
    })
    harness.bridge.ping()
    const teardown = harness.bridge.teardown()
    teardown()
    harness.bridge.ping()

    expect(harness.postedMedia.map((message) => message.type)).toEqual([
      'media.context',
      'media.configure-authority',
      'media.configure-experimental',
      'media.get-state',
      'media.execute',
      'media.execute-page-action'
    ])
    expect(harness.postedMedia[0]?.payload).toEqual({
      frameId: 0,
      siteOrigin: 'https://v.qq.com'
    })
    expect(harness.post.mock.calls.some(([, target]) => target === session.origin)).toBe(true)
  })

  it('returns unavailable before start and handles injection failure, timeout, and repeated stop', async () => {
    const unavailable = createHarness()
    activeBridges.push(unavailable.bridge)
    expect(await unavailable.bridge.configure(0)).toBe(false)
    await expect(
      unavailable.bridge.configureAuthority({
        playbackRate: true,
        volume: false,
        currentTime: false
      })
    ).rejects.toMatchObject({ code: 'PAGE_RUNTIME_UNAVAILABLE' })
    await expect(
      unavailable.bridge.configureExperimental({ mediaDownload: true })
    ).rejects.toMatchObject({ code: 'PAGE_RUNTIME_UNAVAILABLE' })
    await expect(unavailable.bridge.getMediaState()).rejects.toMatchObject({
      code: 'PAGE_RUNTIME_UNAVAILABLE'
    })
    await expect(
      unavailable.bridge.executeMediaCommand({ type: 'media.play', mediaId: 'media-1' })
    ).rejects.toMatchObject({ code: 'PAGE_RUNTIME_UNAVAILABLE' })
    await expect(unavailable.bridge.executePageAction('next')).rejects.toMatchObject({
      code: 'PAGE_RUNTIME_UNAVAILABLE'
    })
    unavailable.bridge.ping()
    unavailable.bridge.stop()
    unavailable.bridge.stop()
    await expect(unavailable.bridge.start()).resolves.toBe(false)

    vi.restoreAllMocks()
    const failed = createHarness({
      injectPageMain: () => Promise.reject(new Error('injection failed'))
    })
    activeBridges.push(failed.bridge)
    await expect(failed.bridge.start()).resolves.toBe(false)
    await expect(failed.bridge.start()).resolves.toBe(false)
    failed.bridge.stop()

    vi.restoreAllMocks()
    const timedOut = createHarness({ autoReady: false })
    activeBridges.push(timedOut.bridge)
    const start = timedOut.bridge.start()
    await Promise.resolve()
    expect(timedOut.scheduler.size).toBe(1)
    timedOut.scheduler.fireNext()
    await expect(start).resolves.toBe(false)
  })

  it('maps page errors, ignores mismatched responses, times out, and rejects pending work on stop', async () => {
    let stateAttempt = 0
    const harness = createHarness({
      onMedia: (request) => {
        if (request.type === 'media.context') {
          respond(request, 'media.context-ready', {})
          return
        }
        if (request.type !== 'media.get-state') return
        stateAttempt += 1
        if (stateAttempt === 1) {
          respond(request, 'media.error', {
            requestType: 'media.get-state',
            code: 'RUNTIME_UNAVAILABLE',
            messageKey: 'media.error.runtime-unavailable'
          })
        } else if (stateAttempt === 2) {
          respond(request, 'media.error', {
            requestType: 'media.get-state',
            code: 'INVALID_PAYLOAD',
            messageKey: 'media.error.invalid-payload'
          })
        } else if (stateAttempt === 3) {
          respond(request, 'media.error', {
            requestType: 'media.execute',
            code: 'INTERNAL_ERROR',
            messageKey: 'media.error.internal'
          })
        } else if (stateAttempt === 4) {
          respond(request, 'media.context-ready', {})
        }
      }
    })
    activeBridges.push(harness.bridge)
    await expect(harness.bridge.start()).resolves.toBe(true)
    await expect(harness.bridge.configure(0)).resolves.toBe(true)

    await expect(harness.bridge.getMediaState()).rejects.toMatchObject({
      code: 'PAGE_RUNTIME_UNAVAILABLE'
    })
    await expect(harness.bridge.getMediaState()).rejects.toMatchObject({
      code: 'INTERNAL_ERROR'
    })

    const mismatchedError = harness.bridge.getMediaState()
    await Promise.resolve()
    harness.scheduler.fireNext()
    await expect(mismatchedError).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' })

    const mismatchedType = harness.bridge.getMediaState()
    await Promise.resolve()
    harness.scheduler.fireNext()
    await expect(mismatchedType).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' })

    const pending = harness.bridge.executeMediaCommand({
      type: 'media.pause',
      mediaId: 'media-1'
    })
    await Promise.resolve()
    harness.bridge.stop()
    await expect(pending).rejects.toMatchObject({ code: 'BRIDGE_UNAVAILABLE' })
    expect(harness.scheduler.size).toBe(0)
  })

  it('turns postMessage failures into bridge errors and rejects invalid/forged events', async () => {
    const harness = createHarness({
      noisyHandshake: true,
      onMedia: (request) => {
        if (request.type === 'media.context') {
          respond(request, 'media.context-ready', {})
        }
      }
    })
    activeBridges.push(harness.bridge)
    await expect(harness.bridge.start()).resolves.toBe(true)
    await expect(harness.bridge.configure(0)).resolves.toBe(true)

    harness.post.mockImplementation(() => {
      throw new Error('post failed')
    })
    const failedPost = harness.bridge.getMediaState()
    await expect(failedPost).rejects.toMatchObject({ code: 'BRIDGE_UNAVAILABLE' })
    harness.post.mockImplementation(() => undefined)
    harness.bridge.stop()
  })

  it('retains defensive response-type and unavailable-port guards', async () => {
    const unavailable = createHarness()
    activeBridges.push(unavailable.bridge)
    const unavailableInternals = unavailable.bridge as unknown as BridgeInternals
    const request = {
      protocol: 1,
      type: 'media.get-state',
      requestId: 'request-identifier-1',
      source: 'content',
      sessionId: session.sessionId,
      nonce: session.nonce,
      payload: {}
    } as const
    await expect(
      unavailableInternals.sendMediaRequest(request, 'media.state')
    ).rejects.toMatchObject({
      code: 'BRIDGE_UNAVAILABLE'
    })
    unavailableInternals.finishPending('missing-request-id')
    unavailable.bridge.stop()

    vi.restoreAllMocks()
    const harness = createHarness({
      onMedia: (message) => {
        if (message.type === 'media.context') respond(message, 'media.context-ready', {})
      }
    })
    activeBridges.push(harness.bridge)
    await harness.bridge.start()
    await harness.bridge.configure(0)
    const internals = harness.bridge as unknown as BridgeInternals
    internals.sendMediaRequest = () =>
      Promise.resolve(
        createPageMediaResponse(
          'media.context-ready',
          session.sessionId,
          session.nonce,
          {},
          'request-identifier-1'
        )
      )
    await expect(harness.bridge.getMediaState()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE'
    })
    await expect(
      harness.bridge.executeMediaCommand({ type: 'media.play', mediaId: 'media-1' })
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE'
    })
  })
})
