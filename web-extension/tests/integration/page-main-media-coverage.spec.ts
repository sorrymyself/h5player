import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createPageMediaRequest,
  createPageMediaResponse,
  parsePageMediaMessage
} from '../../src/infrastructure/messaging/page-media-protocol'
import { startPageMainRuntime } from '../../src/runtime/page-main/page-main-runtime'
import { createBridgeMessage, parseBridgeMessage } from '../../src/shared/protocol'

const runtimeFakes = vi.hoisted(() => ({
  construct: vi.fn<(currentWindow: Window, currentDocument: Document, frameId: number) => void>(),
  cancelDownload: vi.fn<(frameId: number, mediaId: string) => boolean>(),
  execute: vi.fn<(frameId: number, command: unknown) => Promise<unknown>>(),
  failConstructionFor: new Set<number>(),
  getState: vi.fn<(frameId: number) => unknown>(),
  refresh: vi.fn<(frameId: number) => void>(),
  teardown: vi.fn<(frameId: number) => void>()
}))

vi.mock('../../src/runtime/page-main/media-page-runtime', () => ({
  MediaPageRuntime: class {
    constructor(
      currentWindow: Window,
      currentDocument: Document,
      private readonly frameId: number
    ) {
      runtimeFakes.construct(currentWindow, currentDocument, frameId)
      if (runtimeFakes.failConstructionFor.has(frameId)) {
        throw new Error('runtime construction failed')
      }
    }

    getState(): unknown {
      return runtimeFakes.getState(this.frameId)
    }

    execute(command: unknown): Promise<unknown> {
      return runtimeFakes.execute(this.frameId, command)
    }

    cancelDownload(mediaId: string): boolean {
      return runtimeFakes.cancelDownload(this.frameId, mediaId)
    }

    refresh(): void {
      runtimeFakes.refresh(this.frameId)
    }

    subscribeDownloadEvents(): () => void {
      return () => undefined
    }

    teardown(): void {
      runtimeFakes.teardown(this.frameId)
    }
  }
}))

const RUNTIME_KEY = Symbol.for('h5player.web-extension.page-runtime.v1')
const SESSION_ID = 'session-identifier-1'
const SECOND_SESSION_ID = 'session-identifier-2'
const NONCE = 'a'.repeat(64)
const SECOND_NONCE = 'b'.repeat(64)

let requestSequence = 0
const activeTeardowns: Array<() => void> = []

function requestId(prefix: string): string {
  requestSequence += 1
  return `${prefix}-${String(requestSequence).padStart(16, '0')}`
}

function pageState(frameId: number) {
  return {
    frameId,
    revision: 1,
    activeMediaId: null,
    media: [],
    observedAt: 100
  }
}

function commandResponse(frameId: number) {
  return {
    result: {
      ok: false as const,
      error: {
        code: 'MEDIA_NOT_FOUND' as const,
        messageKey: 'command.error.mediaNotFound' as const
      }
    },
    state: pageState(frameId)
  }
}

function dispatchMessage(
  data: unknown,
  origin = window.location.origin,
  source: MessageEventSource | null = window
): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source }))
}

function startRuntime(): () => void {
  const teardown = startPageMainRuntime(window, document)
  activeTeardowns.push(teardown)
  return teardown
}

function initializeSession(
  sessionId = SESSION_ID,
  nonce = NONCE,
  id = requestId('bridge-init')
): void {
  dispatchMessage(createBridgeMessage('bridge.init', 'content', sessionId, nonce, id))
}

function mediaResponses(posted: readonly unknown[]) {
  return posted
    .map((message) => parsePageMediaMessage(message))
    .filter((message) => message !== null)
}

function bridgeResponses(posted: readonly unknown[]) {
  return posted.map((message) => parseBridgeMessage(message)).filter((message) => message !== null)
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (reason: Error) => void = () => undefined
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, reject, resolve }
}

beforeEach(() => {
  for (const teardown of activeTeardowns.splice(0)) teardown()
  delete (window as unknown as Record<PropertyKey, unknown>)[RUNTIME_KEY]
  requestSequence = 0
  runtimeFakes.failConstructionFor.clear()
  vi.clearAllMocks()
  runtimeFakes.getState.mockImplementation((frameId) => pageState(frameId))
  runtimeFakes.execute.mockImplementation((frameId) => Promise.resolve(commandResponse(frameId)))
  runtimeFakes.cancelDownload.mockReturnValue(true)
  delete document.documentElement.dataset['h5playerWebextMain']
})

afterEach(() => {
  for (const teardown of activeTeardowns.splice(0)) teardown()
  delete (window as unknown as Record<PropertyKey, unknown>)[RUNTIME_KEY]
  vi.restoreAllMocks()
  delete document.documentElement.dataset['h5playerWebextMain']
})

describe('page-main media runtime coverage', () => {
  it('owns one runtime marker, one session, and restores restartability after teardown', () => {
    const posted: unknown[] = []
    vi.spyOn(window, 'postMessage').mockImplementation((message: unknown) => {
      posted.push(message)
    })
    const firstTeardown = startRuntime()
    const duplicateTeardown = startRuntime()
    expect(document.documentElement.dataset['h5playerWebextMain']).toBe('ready')

    const ignoredInit = createBridgeMessage(
      'bridge.init',
      'content',
      SESSION_ID,
      NONCE,
      requestId('ignored-init')
    )
    dispatchMessage(ignoredInit, 'https://forged.invalid')
    dispatchMessage(ignoredInit, window.location.origin, null)
    dispatchMessage(
      createPageMediaRequest(
        'media.get-state',
        SESSION_ID,
        NONCE,
        {},
        requestId('media-before-session')
      )
    )
    expect(posted).toHaveLength(0)

    const init = createBridgeMessage(
      'bridge.init',
      'content',
      SESSION_ID,
      NONCE,
      requestId('accepted-init')
    )
    dispatchMessage(init)
    dispatchMessage(init)
    dispatchMessage(
      createBridgeMessage(
        'bridge.init',
        'content',
        SECOND_SESSION_ID,
        SECOND_NONCE,
        requestId('conflicting-init')
      )
    )
    dispatchMessage(
      createBridgeMessage('bridge.ping', 'content', SESSION_ID, NONCE, requestId('ping'))
    )
    duplicateTeardown()
    dispatchMessage(
      createBridgeMessage('bridge.ping', 'content', SESSION_ID, NONCE, requestId('ping-after-noop'))
    )
    dispatchMessage(
      createBridgeMessage(
        'bridge.ping',
        'content',
        SECOND_SESSION_ID,
        SECOND_NONCE,
        requestId('replacement-session-ping')
      )
    )

    expect(bridgeResponses(posted).map((message) => message.type)).toEqual([
      'bridge.ready',
      'bridge.ready',
      'bridge.pong'
    ])

    firstTeardown()
    firstTeardown()
    const countAfterStop = posted.length
    dispatchMessage(
      createBridgeMessage('bridge.ping', 'content', SESSION_ID, NONCE, requestId('stopped-ping'))
    )
    expect(posted).toHaveLength(countAfterStop)

    const restartedTeardown = startRuntime()
    initializeSession(SECOND_SESSION_ID, SECOND_NONCE)
    expect(bridgeResponses(posted).at(-1)?.type).toBe('bridge.ready')
    restartedTeardown()
  })

  it('reports availability, switches frame runtimes, and contains state/init failures', () => {
    const posted: unknown[] = []
    vi.spyOn(window, 'postMessage').mockImplementation((message: unknown) => {
      posted.push(message)
    })
    startRuntime()
    initializeSession()

    const authorityPolicy = { playbackRate: true, volume: true, currentTime: false } as const
    const authorityRequest = createPageMediaRequest(
      'media.configure-authority',
      SESSION_ID,
      NONCE,
      { policy: authorityPolicy },
      requestId('configure-authority')
    )
    dispatchMessage(authorityRequest)
    const experimentalPolicy = { mediaDownload: true } as const
    const experimentalRequest = createPageMediaRequest(
      'media.configure-experimental',
      SESSION_ID,
      NONCE,
      { policy: experimentalPolicy },
      requestId('configure-experimental')
    )
    dispatchMessage(experimentalRequest)

    const countBeforeInvalidMedia = posted.length
    dispatchMessage({ invalid: true })
    dispatchMessage(
      createPageMediaResponse(
        'media.context-ready',
        SESSION_ID,
        NONCE,
        {},
        requestId('wrong-media-source')
      )
    )
    dispatchMessage(
      createPageMediaRequest(
        'media.get-state',
        SECOND_SESSION_ID,
        NONCE,
        {},
        requestId('wrong-media-session')
      )
    )
    dispatchMessage(
      createPageMediaRequest(
        'media.get-state',
        SESSION_ID,
        SECOND_NONCE,
        {},
        requestId('wrong-media-nonce')
      )
    )
    expect(posted).toHaveLength(countBeforeInvalidMedia)

    const stateBeforeContextId = requestId('state-before-context')
    dispatchMessage(
      createPageMediaRequest('media.get-state', SESSION_ID, NONCE, {}, stateBeforeContextId)
    )
    const executeBeforeContextId = requestId('execute-before-context')
    dispatchMessage(
      createPageMediaRequest(
        'media.execute',
        SESSION_ID,
        NONCE,
        { command: { type: 'media.play', mediaId: 'media-1-1' } },
        executeBeforeContextId
      )
    )

    const firstContext = createPageMediaRequest(
      'media.context',
      SESSION_ID,
      NONCE,
      { frameId: 1 },
      requestId('context-one')
    )
    dispatchMessage(firstContext)
    dispatchMessage(firstContext)
    dispatchMessage(
      createPageMediaRequest(
        'media.context',
        SESSION_ID,
        NONCE,
        { frameId: 1 },
        requestId('same-context')
      )
    )

    const cancelRequest = createPageMediaRequest(
      'media.cancel-download',
      SESSION_ID,
      NONCE,
      { mediaId: 'media-1-1' },
      requestId('cancel-download')
    )
    dispatchMessage(cancelRequest)

    const stateId = requestId('state-success')
    dispatchMessage(createPageMediaRequest('media.get-state', SESSION_ID, NONCE, {}, stateId))
    runtimeFakes.getState.mockImplementationOnce(() => {
      throw new Error('state failed')
    })
    const failedStateId = requestId('state-failure')
    dispatchMessage(createPageMediaRequest('media.get-state', SESSION_ID, NONCE, {}, failedStateId))

    dispatchMessage(
      createPageMediaRequest(
        'media.context',
        SESSION_ID,
        NONCE,
        { frameId: 2 },
        requestId('context-two')
      )
    )
    runtimeFakes.failConstructionFor.add(3)
    const failedContextId = requestId('context-three-failed')
    dispatchMessage(
      createPageMediaRequest('media.context', SESSION_ID, NONCE, { frameId: 3 }, failedContextId)
    )
    const unavailableAfterFailureId = requestId('state-after-failed-context')
    dispatchMessage(
      createPageMediaRequest('media.get-state', SESSION_ID, NONCE, {}, unavailableAfterFailureId)
    )

    const responses = mediaResponses(posted)
    expect(
      responses.find((message) => message.requestId === authorityRequest.requestId)
    ).toMatchObject({
      type: 'media.authority-configured',
      payload: { policy: authorityPolicy }
    })
    expect(
      responses.find((message) => message.requestId === experimentalRequest.requestId)
    ).toMatchObject({
      type: 'media.experimental-configured',
      payload: { policy: experimentalPolicy }
    })
    expect(
      responses.find((message) => message.requestId === cancelRequest.requestId)
    ).toMatchObject({
      type: 'media.download-cancelled',
      payload: { cancelled: true }
    })
    expect(runtimeFakes.cancelDownload).toHaveBeenCalledWith(1, 'media-1-1')
    expect(responses.find((message) => message.requestId === stateBeforeContextId)).toMatchObject({
      type: 'media.error',
      payload: { requestType: 'media.get-state', code: 'RUNTIME_UNAVAILABLE' }
    })
    expect(responses.find((message) => message.requestId === executeBeforeContextId)).toMatchObject(
      {
        type: 'media.error',
        payload: { requestType: 'media.execute', code: 'RUNTIME_UNAVAILABLE' }
      }
    )
    expect(responses.filter((message) => message.type === 'media.context-ready')).toHaveLength(3)
    expect(responses.find((message) => message.requestId === stateId)).toMatchObject({
      type: 'media.state',
      payload: { state: { frameId: 1 } }
    })
    expect(responses.find((message) => message.requestId === failedStateId)).toMatchObject({
      type: 'media.error',
      payload: { code: 'INTERNAL_ERROR', messageKey: 'media.error.state-failed' }
    })
    expect(responses.find((message) => message.requestId === failedContextId)).toMatchObject({
      type: 'media.error',
      payload: { code: 'INTERNAL_ERROR', messageKey: 'media.error.runtime-init' }
    })
    expect(
      responses.find((message) => message.requestId === unavailableAfterFailureId)
    ).toMatchObject({
      type: 'media.error',
      payload: { code: 'RUNTIME_UNAVAILABLE' }
    })
    expect(runtimeFakes.construct.mock.calls.map((call) => call[2])).toEqual([1, 2, 3])
    expect(runtimeFakes.teardown.mock.calls.map((call) => call[0])).toEqual([1, 2])
  })

  it('posts command results and suppresses async completion after session disposal', async () => {
    const posted: unknown[] = []
    vi.spyOn(window, 'postMessage').mockImplementation((message: unknown) => {
      posted.push(message)
    })
    startRuntime()
    initializeSession()
    dispatchMessage(
      createPageMediaRequest(
        'media.context',
        SESSION_ID,
        NONCE,
        { frameId: 4 },
        requestId('context-four')
      )
    )

    const successId = requestId('execute-success')
    dispatchMessage(
      createPageMediaRequest(
        'media.execute',
        SESSION_ID,
        NONCE,
        { command: { type: 'media.pause', mediaId: 'media-4-1' } },
        successId
      )
    )
    await vi.waitFor(() => {
      expect(mediaResponses(posted).some((message) => message.requestId === successId)).toBe(true)
    })

    runtimeFakes.execute.mockRejectedValueOnce(new Error('command failed'))
    const rejectedId = requestId('execute-rejected')
    dispatchMessage(
      createPageMediaRequest(
        'media.execute',
        SESSION_ID,
        NONCE,
        { command: { type: 'media.play', mediaId: 'media-4-1' } },
        rejectedId
      )
    )
    await vi.waitFor(() => {
      expect(
        mediaResponses(posted).find((message) => message.requestId === rejectedId)
      ).toMatchObject({
        type: 'media.error',
        payload: { code: 'INTERNAL_ERROR', messageKey: 'media.error.command-failed' }
      })
    })

    const pending = deferred<unknown>()
    runtimeFakes.execute.mockReturnValueOnce(pending.promise)
    const pendingId = requestId('execute-pending')
    dispatchMessage(
      createPageMediaRequest(
        'media.execute',
        SESSION_ID,
        NONCE,
        { command: { type: 'media.play', mediaId: 'media-4-1' } },
        pendingId
      )
    )
    dispatchMessage(
      createBridgeMessage(
        'bridge.dispose',
        'content',
        SESSION_ID,
        NONCE,
        requestId('dispose-pending')
      )
    )
    pending.resolve(commandResponse(4))
    await Promise.resolve()
    await Promise.resolve()
    expect(mediaResponses(posted).some((message) => message.requestId === pendingId)).toBe(false)

    startRuntime()
    initializeSession(SECOND_SESSION_ID, SECOND_NONCE)
    dispatchMessage(
      createPageMediaRequest(
        'media.context',
        SECOND_SESSION_ID,
        SECOND_NONCE,
        { frameId: 5 },
        requestId('context-five')
      )
    )
    const pendingRejection = deferred<unknown>()
    runtimeFakes.execute.mockReturnValueOnce(pendingRejection.promise)
    const rejectedAfterDisposeId = requestId('execute-reject-after-dispose')
    dispatchMessage(
      createPageMediaRequest(
        'media.execute',
        SECOND_SESSION_ID,
        SECOND_NONCE,
        { command: { type: 'media.play', mediaId: 'media-5-1' } },
        rejectedAfterDisposeId
      )
    )
    dispatchMessage(
      createBridgeMessage(
        'bridge.dispose',
        'content',
        SECOND_SESSION_ID,
        SECOND_NONCE,
        requestId('dispose-rejection')
      )
    )
    pendingRejection.reject(new Error('late failure'))
    await Promise.resolve()
    await Promise.resolve()
    expect(
      mediaResponses(posted).some((message) => message.requestId === rejectedAfterDisposeId)
    ).toBe(false)
  })

  it('contains invalid runtime payloads and marker installation failure', async () => {
    const posted: unknown[] = []
    vi.spyOn(window, 'postMessage').mockImplementation((message: unknown) => {
      posted.push(message)
    })
    startRuntime()
    initializeSession()
    dispatchMessage(
      createPageMediaRequest(
        'media.context',
        SESSION_ID,
        NONCE,
        { frameId: 6 },
        requestId('context-six')
      )
    )

    runtimeFakes.getState.mockReturnValueOnce({ invalid: true })
    const invalidStateId = requestId('invalid-state')
    dispatchMessage(
      createPageMediaRequest('media.get-state', SESSION_ID, NONCE, {}, invalidStateId)
    )
    runtimeFakes.execute.mockResolvedValueOnce({ invalid: true })
    const invalidCommandId = requestId('invalid-command-result')
    dispatchMessage(
      createPageMediaRequest(
        'media.execute',
        SESSION_ID,
        NONCE,
        { command: { type: 'media.play', mediaId: 'media-6-1' } },
        invalidCommandId
      )
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(mediaResponses(posted).some((message) => message.requestId === invalidStateId)).toBe(
      false
    )
    expect(mediaResponses(posted).some((message) => message.requestId === invalidCommandId)).toBe(
      false
    )

    const addEventListener = vi.fn<(type: string, listener: EventListener) => void>()
    const removeEventListener = vi.fn<(type: string, listener: EventListener) => void>()
    const target = {
      addEventListener,
      location: { origin: 'https://example.test' },
      postMessage: vi.fn(),
      removeEventListener
    }
    const markerRejectingWindow = new Proxy(target, {
      defineProperty(current, property, attributes) {
        if (property === RUNTIME_KEY) throw new Error('marker rejected')
        return Reflect.defineProperty(current, property, attributes)
      }
    }) as unknown as Window
    const documentWithoutRoot = { documentElement: null } as unknown as Document
    const teardown = startPageMainRuntime(markerRejectingWindow, documentWithoutRoot)

    expect(addEventListener.mock.calls[0]?.[0]).toBe('message')
    teardown()
    expect(removeEventListener.mock.calls[0]?.[0]).toBe('message')
  })
})
