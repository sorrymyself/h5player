import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaFeedbackEvent } from '../../src/application/feedback'
import type { MediaCommandResultResponse, MediaPageState } from '../../src/application/media'
import type { MediaCommand } from '../../src/domain/command'
import { createMediaCapabilities, type MediaSnapshot } from '../../src/domain/media'
import { createProgressIdentity } from '../../src/domain/progress'
import { createDefaultSettings } from '../../src/domain/settings'
import {
  startContentRuntime,
  type ContentRuntimeSnapshot
} from '../../src/runtime/content/content-runtime'
import { PageBridgeError } from '../../src/runtime/content/page-bridge'
import { createRuntimeSuccess, parseRuntimeRequest } from '../../src/shared/protocol'
import { createTabRequest } from '../../src/shared/tab-protocol'
import { FakeTransport } from '../test-support/fakes'
import { createSettingsEnvelope } from '../test-support/settings-fixtures'

const bridgeFakes = vi.hoisted(() => ({
  configure: vi.fn((frameId: number) => {
    void frameId
    return Promise.resolve(true)
  }),
  configureAuthority: vi.fn<(policy: unknown) => Promise<boolean>>(() => Promise.resolve(true)),
  configureExperimental: vi.fn<(policy: unknown) => Promise<boolean>>(() => Promise.resolve(true)),
  prepareDownload: vi.fn<(mediaId: string, intentId: string) => Promise<unknown>>(),
  cancelDownload: vi.fn<(mediaId: string) => Promise<boolean>>(),
  execute: vi.fn<(command: MediaCommand) => Promise<MediaCommandResultResponse>>(),
  executePageAction:
    vi.fn<
      (
        action: 'next' | 'autoplay'
      ) => Promise<{ declared: boolean; handled: boolean; adapterId: string | null }>
    >(),
  getState: vi.fn<() => Promise<MediaPageState>>(),
  ping: vi.fn(),
  start: vi.fn(() => Promise.resolve(true)),
  stateListener: null as ((summary: unknown) => void) | null,
  downloadListener: null as ((event: unknown) => void) | null,
  stop: vi.fn(),
  unsubscribe: vi.fn()
}))

vi.mock('../../src/runtime/content/page-bridge', () => {
  class PageBridgeError extends Error {
    constructor(
      readonly code: string,
      message: string
    ) {
      super(message)
      this.name = 'PageBridgeError'
    }
  }

  return {
    PageBridgeError,
    PageBridge: class {
      start() {
        return bridgeFakes.start()
      }

      configure(frameId: number) {
        return bridgeFakes.configure(frameId)
      }

      configureAuthority(policy: unknown) {
        return bridgeFakes.configureAuthority(policy)
      }

      configureExperimental(policy: unknown) {
        return bridgeFakes.configureExperimental(policy)
      }

      ping() {
        bridgeFakes.ping()
      }

      getMediaState() {
        return bridgeFakes.getState()
      }

      executeMediaCommand(command: MediaCommand) {
        return bridgeFakes.execute(command)
      }

      prepareDownload(mediaId: string, intentId: string) {
        return bridgeFakes.prepareDownload(mediaId, intentId)
      }

      cancelDownload(mediaId: string) {
        return bridgeFakes.cancelDownload(mediaId)
      }

      executePageAction(action: 'next' | 'autoplay') {
        return bridgeFakes.executePageAction(action)
      }

      subscribeMediaStateChanged(listener: (summary: unknown) => void) {
        bridgeFakes.stateListener = listener
        return bridgeFakes.unsubscribe
      }

      subscribeDownloadEvents(listener: (event: unknown) => void) {
        bridgeFakes.downloadListener = listener
        return bridgeFakes.unsubscribe
      }

      stop() {
        bridgeFakes.stop()
      }
    }
  }
})

function mediaSnapshot(
  currentTime: number,
  duration: number,
  state: MediaSnapshot['state'] = 'paused',
  updatedAt = 10_000
): MediaSnapshot {
  return {
    id: 'media-0-1',
    frameId: 0,
    kind: 'video',
    state,
    metrics: {
      width: 640,
      height: 360,
      duration,
      currentTime,
      volume: 1,
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
    updatedAt
  }
}

function pageState(media: MediaSnapshot): MediaPageState {
  return {
    frameId: 0,
    revision: 1,
    activeMediaId: media.id,
    media: [media],
    observedAt: media.updatedAt
  }
}

function commandResponse(command: MediaCommand, media: MediaSnapshot): MediaCommandResultResponse {
  return {
    result: {
      ok: true,
      value: {
        commandType: command.type,
        mediaId: media.id,
        changed: true,
        snapshot: media
      }
    },
    state: pageState(media)
  }
}

function runtimeHarness(
  media: MediaSnapshot,
  options: Readonly<{
    restoreProgress: boolean
    restoredPosition?: number | null
    enabled?: boolean
    allowExperimental?: boolean
    allowAutoplay?: boolean
    frameId?: number
    downloadEnabled?: boolean
    siteDownloadEnabled?: boolean
    retainProgressDays?: number
    failRequestTypes?: readonly string[]
    progressSaved?: boolean
    frameReportAcceptedForRequest?: (requestIndex: number) => boolean
    routedState?: MediaPageState
    routedCommandResponse?: MediaCommandResultResponse
    routedStateForRequest?: (requestIndex: number) => MediaPageState
    routedCommandResponseForRequest?: (
      command: MediaCommand,
      requestIndex: number
    ) => MediaCommandResultResponse
  }> = { restoreProgress: true }
) {
  const settings = createDefaultSettings()
  settings.global.enabled = options.enabled ?? true
  settings.global.media.restoreProgress = options.restoreProgress
  settings.global.policies.allowExperimental = options.allowExperimental ?? false
  settings.global.policies.allowAutoplay = options.allowAutoplay ?? false
  settings.global.download.enabled = options.downloadEnabled ?? true
  if (options.siteDownloadEnabled !== undefined) {
    settings.sites[window.location.origin] = {
      enabled: true,
      download: { enabled: options.siteDownloadEnabled }
    }
  }
  settings.global.diagnostics.retainProgressDays = options.retainProgressDays ?? 30
  const envelope = createSettingsEnvelope()
  envelope.data = settings
  const identity = createProgressIdentity({ pageUrl: window.location.href })
  if (!identity.ok) throw new Error(identity.error.code)
  const requestTypes: string[] = []
  const requestPayloads: unknown[] = []
  const remainingFailures = new Map<string, number>()
  let routedStateRequestCount = 0
  let routedCommandRequestCount = 0
  let frameReportRequestCount = 0
  const transport = new FakeTransport((raw) => {
    const request = parseRuntimeRequest(raw)
    if (!request) return Promise.reject(new Error('invalid runtime request'))
    requestTypes.push(request.type)
    requestPayloads.push(request.payload)
    const context = request.sessionId ? { sessionId: request.sessionId } : {}
    const respond = (data: unknown) => Promise.resolve(createRuntimeSuccess(request, data, context))

    const remainingFailureCount = remainingFailures.get(request.type) ?? 0
    if (remainingFailureCount > 0) {
      remainingFailures.set(request.type, remainingFailureCount - 1)
      return Promise.reject(new Error(`failed request ${request.type}`))
    }
    if (options.failRequestTypes?.includes(request.type)) {
      return Promise.reject(new Error(`failed request ${request.type}`))
    }

    switch (request.type) {
      case 'system.ping':
        return respond({
          extensionVersion: '0.1.0',
          phase: 6,
          protocol: 1,
          settingsSchemaVersion: 3,
          frameId: options.frameId ?? 0
        })
      case 'settings.get':
        return respond({ settings: envelope, latestBackup: null })
      case 'experimental.ensure-main':
        return respond({
          allowed: options.allowExperimental ?? false,
          injected: options.allowExperimental ?? false
        })
      case 'playback.set-site-intent': {
        const payload = request.payload as {
          value: number
          protectAgainstSiteReset?: boolean
        }
        return respond({
          origin: window.location.origin,
          value: payload.value,
          protectAgainstSiteReset: payload.protectAgainstSiteReset ?? true,
          settings: envelope,
          changedPaths: [`sites.${window.location.origin}`]
        })
      }
      case 'progress.read': {
        const position = options.restoredPosition ?? null
        return respond({
          record:
            position === null
              ? null
              : {
                  site: identity.value.site,
                  mediaKey: identity.value.mediaKey,
                  positionSeconds: position,
                  durationSeconds: media.metrics.duration,
                  updatedAt: 1_000,
                  expiresAt: 2_000_000_000_000
                },
          privacyBlocked: false,
          revision: 1,
          prunedCount: 0
        })
      }
      case 'progress.save':
        return respond({
          saved: options.progressSaved ?? true,
          privacyBlocked: false,
          record: {
            site: identity.value.site,
            mediaKey: identity.value.mediaKey,
            positionSeconds: media.metrics.currentTime,
            durationSeconds: media.metrics.duration,
            updatedAt: media.updatedAt,
            expiresAt: 2_000_000_000_000
          },
          revision: 2,
          prunedCount: 0,
          evictedCount: 0
        })
      case 'progress.delete':
        return respond({ deleted: true, revision: 2, prunedCount: 0 })
      case 'progress.toggle-restore': {
        const origin = window.location.origin
        const existing = envelope.data.sites[origin]
        const enabled = !(
          existing?.media?.restoreProgress ?? envelope.data.global.media.restoreProgress
        )
        envelope.revision += 1
        envelope.updatedAt += 1
        envelope.data.sites[origin] = {
          ...existing,
          enabled: existing?.enabled ?? true,
          media: { ...existing?.media, restoreProgress: enabled }
        }
        return respond({
          origin,
          enabled,
          settings: envelope,
          changedPaths: [`sites.${origin}`]
        })
      }
      case 'media.cross-tab.publish': {
        const payload = request.payload as {
          kind: 'playback-started' | 'playback-paused' | 'progress-saved'
          mediaKey: string
          observedAt: number
        }
        return respond({
          event: {
            eventId: 'event-identifier-0001',
            ...payload,
            sourceTabId: 1,
            sourceFrameId: 0
          },
          attemptedTabs: 0,
          deliveredTabs: 0
        })
      }
      case 'media.get-state':
        routedStateRequestCount += 1
        if (options.routedStateForRequest !== undefined) {
          return respond(options.routedStateForRequest(routedStateRequestCount))
        }
        return options.routedState === undefined
          ? Promise.reject(new Error('unexpected routed media state request'))
          : respond(options.routedState)
      case 'media.execute': {
        routedCommandRequestCount += 1
        if (options.routedCommandResponseForRequest !== undefined) {
          const payload = request.payload as { command: MediaCommand }
          return respond(
            options.routedCommandResponseForRequest(payload.command, routedCommandRequestCount)
          )
        }
        return options.routedCommandResponse === undefined
          ? Promise.reject(new Error('unexpected routed media command request'))
          : respond(options.routedCommandResponse)
      }
      case 'site.report-frame-state':
        frameReportRequestCount += 1
        return respond({
          accepted: options.frameReportAcceptedForRequest?.(frameReportRequestCount) ?? true,
          stateKnown: false,
          pageUiHidden: false,
          temporaryDisabled: false
        })
      case 'site.set-page-ui-hidden': {
        const payload = request.payload as { hidden: boolean }
        return respond({ hidden: payload.hidden, hiddenMediaCount: payload.hidden ? 2 : 0 })
      }
      default:
        return Promise.reject(new Error(`unexpected request ${request.type}`))
    }
  })

  bridgeFakes.getState.mockResolvedValue(pageState(media))
  bridgeFakes.execute.mockImplementation((command) =>
    Promise.resolve(commandResponse(command, media))
  )
  return {
    envelope,
    requestPayloads,
    requestTypes,
    transport,
    failNext(requestType: string, count = 1): void {
      remainingFailures.set(requestType, Math.max(0, count))
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  bridgeFakes.start.mockResolvedValue(true)
  bridgeFakes.configure.mockResolvedValue(true)
  bridgeFakes.configureAuthority.mockResolvedValue(true)
  bridgeFakes.configureExperimental.mockResolvedValue(true)
  bridgeFakes.prepareDownload.mockImplementation((_mediaId, intentId) =>
    Promise.resolve({ intentId, disposition: 'queued', artifacts: [] })
  )
  bridgeFakes.cancelDownload.mockResolvedValue(true)
  bridgeFakes.executePageAction.mockResolvedValue({
    declared: false,
    handled: false,
    adapterId: null
  })
  bridgeFakes.ping.mockImplementation(() => undefined)
  bridgeFakes.stop.mockImplementation(() => undefined)
  bridgeFakes.unsubscribe.mockImplementation(() => undefined)
  bridgeFakes.stateListener = null
  bridgeFakes.downloadListener = null
  window.history.replaceState({}, '', '/watch')
})

afterEach(() => {
  delete document.documentElement.dataset['h5playerWebextContent']
  delete document.documentElement.dataset['h5playerWebextBridge']
  delete document.documentElement.dataset['h5playerWebextBackground']
  delete document.documentElement.dataset['h5playerWebextMedia']
})

describe('content runtime progress and advisory orchestration', () => {
  it('routes enabled autoplay through the declared page action without generic media.play', async () => {
    vi.useFakeTimers()
    const media = mediaSnapshot(0, 120)
    const harness = runtimeHarness(media, { restoreProgress: false, allowAutoplay: true })
    bridgeFakes.executePageAction.mockResolvedValue({
      declared: false,
      handled: false,
      adapterId: 'youtube'
    })
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve()
    })

    await vi.advanceTimersByTimeAsync(0)

    expect(bridgeFakes.executePageAction).toHaveBeenCalledOnce()
    expect(bridgeFakes.executePageAction).toHaveBeenCalledWith('autoplay')
    expect(bridgeFakes.execute).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'media.play' })
    )
    runtime.teardown()
    vi.useRealTimers()
  })

  it('keeps autoplay disabled in child frames even when the site setting is enabled', async () => {
    vi.useFakeTimers()
    const media = { ...mediaSnapshot(0, 120), frameId: 7 }
    const harness = runtimeHarness(media, {
      restoreProgress: false,
      allowAutoplay: true,
      frameId: 7
    })
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve()
    })

    await vi.advanceTimersByTimeAsync(5_000)

    expect(bridgeFakes.executePageAction).not.toHaveBeenCalled()
    runtime.teardown()
    vi.useRealTimers()
  })

  it('returns a safe unavailable handle when the document has no root element', async () => {
    const runtime = await startContentRuntime({
      window,
      document: { documentElement: null } as unknown as Document,
      extensionId: 'extension-id',
      transport: new FakeTransport(() => Promise.reject(new Error('transport must not run'))),
      injectPageMain: () => Promise.resolve()
    })

    await expect(runtime.handleTabMessage({}, { id: 'extension-id' })).resolves.toBeNull()
    await expect(runtime.getMediaState()).rejects.toMatchObject({
      code: 'PAGE_RUNTIME_UNAVAILABLE'
    })
    await expect(
      runtime.executeMediaCommand({ type: 'media.play', mediaId: 'media-0-1' })
    ).rejects.toMatchObject({ code: 'PAGE_RUNTIME_UNAVAILABLE' })
    expect(runtime.teardown()).toBeUndefined()
  })

  it('keeps page control isolated when background ping is unavailable', async () => {
    const media = mediaSnapshot(0, 120)
    const harness = runtimeHarness(media, {
      restoreProgress: false,
      failRequestTypes: ['system.ping']
    })
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve()
    })

    expect(document.documentElement.dataset['h5playerWebextBackground']).toBe('failed')
    expect(document.documentElement.dataset['h5playerWebextBridge']).toBe('ready')
    expect(document.documentElement.dataset['h5playerWebextMedia']).toBe('ready')
    expect(harness.transport.reconnectCount).toBe(1)
    runtime.teardown()
  })

  it('blocks experimental downloads in isolated content when the persisted policy is off', async () => {
    const baseMedia = mediaSnapshot(0, 120)
    const media: MediaSnapshot = {
      ...baseMedia,
      capabilities: { ...baseMedia.capabilities, downloadExperimental: true }
    }
    const harness = runtimeHarness(media, { restoreProgress: false, allowExperimental: false })
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve()
    })

    await expect(
      runtime.executeMediaCommand({ type: 'media.download', mediaId: media.id })
    ).resolves.toMatchObject({
      result: {
        ok: false,
        error: { code: 'DOWNLOAD_BLOCKED', messageKey: 'download.error.blocked' }
      }
    })
    expect(bridgeFakes.execute).not.toHaveBeenCalled()

    await expect(
      runtime.handleTabMessage(
        createTabRequest('media.execute', {
          command: { type: 'media.download', mediaId: media.id }
        }),
        { id: 'extension-id' }
      )
    ).resolves.toMatchObject({
      type: 'protocol.response',
      payload: {
        data: { result: { ok: false, error: { code: 'DOWNLOAD_BLOCKED' } } }
      }
    })
    expect(bridgeFakes.execute).not.toHaveBeenCalled()
    runtime.teardown()
  })

  it('requires the global download switch in addition to the experimental policy', async () => {
    const baseMedia = mediaSnapshot(0, 120)
    const media: MediaSnapshot = {
      ...baseMedia,
      capabilities: { ...baseMedia.capabilities, downloadExperimental: true }
    }
    const harness = runtimeHarness(media, {
      restoreProgress: false,
      allowExperimental: true,
      downloadEnabled: false
    })
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve()
    })

    await expect(
      runtime.executeMediaCommand({ type: 'media.download', mediaId: media.id })
    ).resolves.toMatchObject({
      result: {
        ok: false,
        error: { code: 'DOWNLOAD_BLOCKED', messageKey: 'download.error.blocked' }
      }
    })
    expect(bridgeFakes.configureExperimental).not.toHaveBeenCalledWith({ mediaDownload: true })
    expect(bridgeFakes.prepareDownload).not.toHaveBeenCalled()
    runtime.teardown()
  })

  it('allows a site override to disable downloads without changing the global experiment switch', async () => {
    const baseMedia = mediaSnapshot(0, 120)
    const media: MediaSnapshot = {
      ...baseMedia,
      capabilities: { ...baseMedia.capabilities, downloadExperimental: true }
    }
    const harness = runtimeHarness(media, {
      restoreProgress: false,
      allowExperimental: true,
      downloadEnabled: true,
      siteDownloadEnabled: false
    })
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve()
    })

    await expect(
      runtime.executeMediaCommand({ type: 'media.download', mediaId: media.id })
    ).resolves.toMatchObject({
      result: {
        ok: false,
        error: { code: 'DOWNLOAD_BLOCKED', messageKey: 'download.error.blocked' }
      }
    })
    expect(bridgeFakes.configureExperimental).not.toHaveBeenCalledWith({ mediaDownload: true })
    expect(bridgeFakes.prepareDownload).not.toHaveBeenCalled()
    runtime.teardown()
  })

  it('allows a site override to enable downloads when the global switch is disabled', async () => {
    const baseMedia = mediaSnapshot(0, 120)
    const media: MediaSnapshot = {
      ...baseMedia,
      capabilities: { ...baseMedia.capabilities, downloadExperimental: true }
    }
    const harness = runtimeHarness(media, {
      restoreProgress: false,
      allowExperimental: true,
      downloadEnabled: false,
      siteDownloadEnabled: true
    })
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve()
    })

    await expect(
      runtime.executeMediaCommand({ type: 'media.download', mediaId: media.id })
    ).resolves.toMatchObject({ result: { ok: true } })
    expect(bridgeFakes.configureExperimental).toHaveBeenCalledWith({ mediaDownload: true })
    expect(bridgeFakes.prepareDownload).toHaveBeenCalledWith(media.id, expect.any(String))
    runtime.teardown()
  })

  it('cancels a queued experimental download through the typed page bridge', async () => {
    const baseMedia = mediaSnapshot(0, 120)
    const media: MediaSnapshot = {
      ...baseMedia,
      capabilities: { ...baseMedia.capabilities, downloadExperimental: true }
    }
    const harness = runtimeHarness(media, { restoreProgress: false, allowExperimental: true })
    const feedback: MediaFeedbackEvent[] = []
    let intentId = ''
    bridgeFakes.prepareDownload.mockImplementation((_mediaId, nextIntentId) => {
      intentId = nextIntentId
      return Promise.resolve({ intentId, disposition: 'queued', artifacts: [] })
    })
    bridgeFakes.cancelDownload.mockImplementation((mediaId) => {
      bridgeFakes.downloadListener?.({
        type: 'failed',
        intentId,
        code: 'DOWNLOAD_CANCELLED',
        message: `Cancelled ${mediaId}`
      })
      return Promise.resolve(true)
    })
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve(),
      onFeedback: (event) => feedback.push(event)
    })

    await expect(
      runtime.executeMediaCommand({ type: 'media.download', mediaId: media.id })
    ).resolves.toMatchObject({ result: { ok: true, value: { changed: false } } })
    await expect(runtime.cancelMediaDownload(media.id)).resolves.toBe(true)
    expect(bridgeFakes.cancelDownload).toHaveBeenCalledWith(media.id)
    expect(feedback.at(-1)).toMatchObject({
      commandId: 'media.download',
      kind: 'error',
      messageKey: 'download.error.cancelled'
    })
    runtime.teardown()
  })

  it('routes top-frame hotkeys to an active media child frame', async () => {
    const localMedia = mediaSnapshot(10, 120, 'paused')
    const routedMedia: MediaSnapshot = {
      ...localMedia,
      id: 'media-7-1',
      frameId: 7,
      adapterId: 'tencent-video'
    }
    const localEmptyState: MediaPageState = {
      frameId: 0,
      revision: 1,
      activeMediaId: null,
      media: [],
      observedAt: 10_000
    }
    const routedState: MediaPageState = {
      frameId: 7,
      revision: 1,
      activeMediaId: routedMedia.id,
      media: [routedMedia],
      observedAt: routedMedia.updatedAt
    }
    const routedCommandResponse: MediaCommandResultResponse = {
      result: {
        ok: true,
        value: {
          commandType: 'media.adjust-rate',
          mediaId: routedMedia.id,
          changed: true,
          snapshot: {
            ...routedMedia,
            metrics: { ...routedMedia.metrics, playbackRate: 1.1 }
          }
        }
      },
      state: routedState
    }
    const harness = runtimeHarness(localMedia, {
      restoreProgress: false,
      routedState,
      routedCommandResponse
    })
    bridgeFakes.getState.mockResolvedValue(localEmptyState)
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve()
    })
    bridgeFakes.execute.mockClear()

    const event = new KeyboardEvent('keydown', {
      code: 'KeyC',
      bubbles: true,
      cancelable: true
    })
    window.dispatchEvent(event)

    await vi.waitFor(() =>
      expect(harness.requestTypes.filter((type) => type === 'media.execute')).toHaveLength(1)
    )
    const commandIndex = harness.requestTypes.lastIndexOf('media.execute')
    expect(harness.requestPayloads[commandIndex]).toEqual({
      command: { type: 'media.adjust-rate', mediaId: routedMedia.id, delta: 0.1 }
    })
    expect(harness.requestTypes).toContain('media.get-state')
    expect(bridgeFakes.execute).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
    runtime.teardown()
  })

  it('keeps Tencent shortcut targeting and feedback on the live child authority', async () => {
    const topMedia: MediaSnapshot = {
      ...mediaSnapshot(50, 360, 'active'),
      metrics: {
        ...mediaSnapshot(50, 360, 'active').metrics,
        playbackRate: 1.5
      }
    }
    const childMedia: MediaSnapshot = {
      ...topMedia,
      id: 'media-17-tencent-viewport',
      frameId: 17,
      capabilities: createMediaCapabilities({ playbackRate: true }),
      adapterId: 'tencent-video'
    }
    let routedState: MediaPageState = {
      frameId: 17,
      revision: 1,
      activeMediaId: childMedia.id,
      media: [childMedia],
      observedAt: childMedia.updatedAt
    }
    const harness = runtimeHarness(topMedia, {
      restoreProgress: false,
      routedStateForRequest: () => routedState,
      routedCommandResponseForRequest: (command) => {
        const updatedMedia: MediaSnapshot = {
          ...childMedia,
          metrics: { ...childMedia.metrics, playbackRate: 2 }
        }
        routedState = { ...routedState, revision: 2, media: [updatedMedia] }
        return {
          ...commandResponse(command, updatedMedia),
          state: routedState
        }
      }
    })
    bridgeFakes.getState.mockResolvedValue(pageState(topMedia))
    const runtimeStates: ContentRuntimeSnapshot[] = []
    const feedback: MediaFeedbackEvent[] = []
    const runtime = await startContentRuntime({
      window,
      document,
      siteOrigin: 'https://v.qq.com',
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve(),
      onRuntimeStateChanged: (state) => runtimeStates.push(state),
      onFeedback: (event) => feedback.push(event)
    })

    await vi.waitFor(() =>
      expect(runtimeStates.at(-1)?.mediaState?.activeMediaId).toBe(childMedia.id)
    )
    bridgeFakes.execute.mockClear()
    const commandCountBefore = harness.requestTypes.filter(
      (type) => type === 'media.execute'
    ).length
    const event = new KeyboardEvent('keydown', {
      code: 'Digit2',
      bubbles: true,
      cancelable: true
    })
    window.dispatchEvent(event)

    await vi.waitFor(() =>
      expect(harness.requestTypes.filter((type) => type === 'media.execute').length).toBe(
        commandCountBefore + 1
      )
    )
    const commandIndex = harness.requestTypes.lastIndexOf('media.execute')
    expect(harness.requestPayloads[commandIndex]).toEqual({
      command: { type: 'media.set-rate', mediaId: childMedia.id, value: 2 }
    })
    expect(bridgeFakes.execute).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
    await vi.waitFor(() =>
      expect(feedback.filter((item) => item.source === 'shortcut')).toEqual([
        expect.objectContaining({
          mediaId: childMedia.id,
          commandId: 'media.set-rate',
          messageKey: 'feedback.playback-rate',
          value: 2,
          source: 'shortcut'
        })
      ])
    )
    expect(runtimeStates.at(-1)?.mediaState).toMatchObject({
      activeMediaId: childMedia.id,
      media: [{ id: childMedia.id, metrics: { playbackRate: 2 } }]
    })
    runtime.teardown()
  })

  it('executes Tencent next episode in the top page while media authority stays in a child frame', async () => {
    const localMedia = mediaSnapshot(10, 120, 'paused')
    const childMedia: MediaSnapshot = {
      ...localMedia,
      id: 'media-21-tencent-viewport',
      frameId: 21,
      capabilities: createMediaCapabilities({ playback: true, next: true }),
      adapterId: 'tencent-video'
    }
    const localEmptyState: MediaPageState = {
      frameId: 0,
      revision: 1,
      activeMediaId: null,
      media: [],
      observedAt: localMedia.updatedAt
    }
    const routedState: MediaPageState = {
      frameId: 21,
      revision: 1,
      activeMediaId: childMedia.id,
      media: [childMedia],
      observedAt: childMedia.updatedAt
    }
    const harness = runtimeHarness(localMedia, {
      restoreProgress: false,
      routedState
    })
    bridgeFakes.getState.mockResolvedValue(localEmptyState)
    bridgeFakes.executePageAction.mockResolvedValue({
      declared: true,
      handled: true,
      adapterId: 'tencent-video'
    })
    const runtimeStates: ContentRuntimeSnapshot[] = []
    const feedback: MediaFeedbackEvent[] = []
    const runtime = await startContentRuntime({
      window,
      document,
      siteOrigin: 'https://v.qq.com',
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve(),
      onRuntimeStateChanged: (state) => runtimeStates.push(state),
      onFeedback: (event) => feedback.push(event)
    })

    await vi.waitFor(() =>
      expect(runtimeStates.at(-1)?.mediaState?.activeMediaId).toBe(childMedia.id)
    )
    const routedCommandCount = harness.requestTypes.filter(
      (type) => type === 'media.execute'
    ).length
    const result = await runtime.executeMediaCommand(
      { type: 'media.play-next', mediaId: childMedia.id },
      { source: 'shortcut' }
    )

    expect(result).toMatchObject({
      result: {
        ok: true,
        value: {
          commandType: 'media.play-next',
          mediaId: childMedia.id,
          changed: true
        }
      },
      state: { activeMediaId: childMedia.id }
    })
    expect(bridgeFakes.executePageAction).toHaveBeenCalledWith('next')
    expect(harness.requestTypes.filter((type) => type === 'media.execute')).toHaveLength(
      routedCommandCount
    )
    expect(feedback.at(-1)).toMatchObject({
      commandId: 'media.play-next',
      mediaId: childMedia.id,
      source: 'shortcut'
    })
    runtime.teardown()
  })

  it('recovers a Tencent shortcut when authority migrates from child frame to top frame', async () => {
    const topMedia = mediaSnapshot(50, 360, 'active')
    const childMedia: MediaSnapshot = {
      ...topMedia,
      id: 'media-14-tencent-viewport',
      frameId: 14,
      capabilities: createMediaCapabilities({ playbackRate: true }),
      adapterId: 'tencent-video'
    }
    const childState: MediaPageState = {
      frameId: 14,
      revision: 1,
      activeMediaId: childMedia.id,
      media: [childMedia],
      observedAt: childMedia.updatedAt
    }
    let authority: 'child' | 'top' = 'child'
    const harness = runtimeHarness(topMedia, {
      restoreProgress: false,
      routedStateForRequest: () => (authority === 'child' ? childState : pageState(topMedia)),
      routedCommandResponseForRequest: (command) => {
        if (command.type === 'media.set-rate' && command.value === 2) {
          authority = 'top'
          return {
            result: {
              ok: false,
              error: {
                code: 'MEDIA_NOT_FOUND',
                messageKey: 'command.error.mediaNotFound',
                context: { mediaId: command.mediaId }
              }
            },
            state: childState
          }
        }
        return commandResponse(command, childMedia)
      }
    })
    bridgeFakes.getState.mockResolvedValue(pageState(topMedia))
    const updatedTopMedia: MediaSnapshot = {
      ...topMedia,
      metrics: { ...topMedia.metrics, playbackRate: 2 }
    }
    bridgeFakes.execute.mockImplementation((command) =>
      Promise.resolve(commandResponse(command, updatedTopMedia))
    )
    const feedback: MediaFeedbackEvent[] = []
    const runtimeStates: ContentRuntimeSnapshot[] = []
    const runtime = await startContentRuntime({
      window,
      document,
      siteOrigin: 'https://v.qq.com',
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve(),
      onRuntimeStateChanged: (state) => runtimeStates.push(state),
      onFeedback: (event) => feedback.push(event)
    })

    await vi.waitFor(() =>
      expect(runtimeStates.at(-1)?.mediaState?.activeMediaId).toBe(childMedia.id)
    )
    bridgeFakes.execute.mockClear()
    const event = new KeyboardEvent('keydown', {
      code: 'Digit2',
      bubbles: true,
      cancelable: true
    })
    window.dispatchEvent(event)

    await vi.waitFor(() =>
      expect(bridgeFakes.execute).toHaveBeenCalledWith({
        type: 'media.set-rate',
        mediaId: topMedia.id,
        value: 2
      })
    )
    expect(
      harness.requestPayloads.filter(
        (_payload, index) => harness.requestTypes[index] === 'media.execute'
      )
    ).toContainEqual({
      command: { type: 'media.set-rate', mediaId: childMedia.id, value: 2 }
    })
    expect(event.defaultPrevented).toBe(true)
    await vi.waitFor(() =>
      expect(feedback.filter((item) => item.source === 'shortcut')).toEqual([
        expect.objectContaining({
          mediaId: topMedia.id,
          commandId: 'media.set-rate',
          messageKey: 'feedback.playback-rate',
          value: 2,
          source: 'shortcut'
        })
      ])
    )
    expect(runtimeStates.at(-1)?.mediaState).toMatchObject({
      activeMediaId: topMedia.id,
      media: [{ id: topMedia.id, metrics: { playbackRate: 2 } }]
    })
    runtime.teardown()
  })

  it('recovers a routed Tencent rate command when the first response is stale', async () => {
    const localMedia = mediaSnapshot(50, 360, 'active')
    const childMedia: MediaSnapshot = {
      ...localMedia,
      id: 'media-15-tencent-viewport',
      frameId: 15,
      adapterId: 'tencent-video',
      capabilities: createMediaCapabilities({ playbackRate: true })
    }
    const staleState: MediaPageState = {
      frameId: 15,
      revision: 1,
      activeMediaId: childMedia.id,
      media: [childMedia],
      observedAt: childMedia.updatedAt
    }
    const appliedMedia: MediaSnapshot = {
      ...childMedia,
      metrics: { ...childMedia.metrics, playbackRate: 2 },
      updatedAt: childMedia.updatedAt + 1
    }
    const appliedState: MediaPageState = {
      ...staleState,
      revision: 2,
      media: [appliedMedia],
      observedAt: appliedMedia.updatedAt
    }
    let routedState = staleState
    const harness = runtimeHarness(localMedia, {
      restoreProgress: false,
      routedStateForRequest: () => routedState,
      routedCommandResponseForRequest: (command) => {
        routedState = appliedState
        return commandResponse(command, childMedia)
      }
    })
    bridgeFakes.getState.mockResolvedValue({
      frameId: 0,
      revision: 1,
      activeMediaId: null,
      media: [],
      observedAt: localMedia.updatedAt
    })
    const runtime = await startContentRuntime({
      window,
      document,
      siteOrigin: 'https://v.qq.com',
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve()
    })

    await vi.waitFor(async () =>
      expect((await runtime.getMediaState()).activeMediaId).toBe(childMedia.id)
    )
    const result = await runtime.executeMediaCommand(
      { type: 'media.set-rate', mediaId: childMedia.id, value: 2 },
      { source: 'overlay', playbackRateScope: 'site' }
    )

    expect(result).toMatchObject({
      result: {
        ok: true,
        value: {
          mediaId: appliedMedia.id,
          snapshot: { metrics: { playbackRate: 2 } }
        }
      },
      state: appliedState
    })
    expect(
      harness.requestTypes.filter((requestType) => requestType === 'media.execute')
    ).toHaveLength(1)
    runtime.teardown()
  })

  it('publishes routed Tencent child media to the top overlay and routes its commands', async () => {
    const localMedia = mediaSnapshot(10, 120, 'paused')
    const routedMedia: MediaSnapshot = {
      ...localMedia,
      id: 'media-7-1',
      frameId: 7,
      adapterId: 'tencent-video'
    }
    const localEmptyState: MediaPageState = {
      frameId: 0,
      revision: 1,
      activeMediaId: null,
      media: [],
      observedAt: 10_000
    }
    const routedState: MediaPageState = {
      frameId: 7,
      revision: 1,
      activeMediaId: routedMedia.id,
      media: [routedMedia],
      observedAt: routedMedia.updatedAt
    }
    const updatedMedia: MediaSnapshot = {
      ...routedMedia,
      metrics: { ...routedMedia.metrics, playbackRate: 1.5 }
    }
    const routedCommandResponse: MediaCommandResultResponse = {
      ...commandResponse(
        { type: 'media.set-rate', mediaId: routedMedia.id, value: 1.5 },
        updatedMedia
      ),
      state: { ...routedState, media: [updatedMedia] }
    }
    const harness = runtimeHarness(localMedia, {
      restoreProgress: false,
      routedState,
      routedCommandResponse
    })
    bridgeFakes.getState.mockResolvedValue(localEmptyState)
    const runtimeStates: ContentRuntimeSnapshot[] = []
    const feedback: unknown[] = []
    const runtime = await startContentRuntime({
      window,
      document,
      siteOrigin: 'https://v.qq.com',
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve(),
      onRuntimeStateChanged: (state) => runtimeStates.push(state),
      onFeedback: (event) => feedback.push(event)
    })

    await vi.waitFor(() =>
      expect(runtimeStates.at(-1)?.mediaState?.activeMediaId).toBe(routedMedia.id)
    )
    bridgeFakes.execute.mockClear()
    const result = await runtime.executeMediaCommand(
      { type: 'media.set-rate', mediaId: routedMedia.id, value: 1.5 },
      { source: 'overlay', playbackRateScope: 'site' }
    )

    expect(result.result.ok).toBe(true)
    expect(harness.requestPayloads[harness.requestTypes.lastIndexOf('media.execute')]).toEqual({
      command: { type: 'media.set-rate', mediaId: routedMedia.id, value: 1.5 },
      playbackRateScope: 'site'
    })
    expect(bridgeFakes.execute).not.toHaveBeenCalled()
    expect(feedback).toHaveLength(1)
    expect(runtimeStates.at(-1)?.mediaState?.media[0]?.metrics.playbackRate).toBe(1.5)
    runtime.teardown()
  })

  it('restores and saves progress for routed Tencent child media', async () => {
    const localMedia = mediaSnapshot(0, 120, 'paused')
    const routedActive: MediaSnapshot = {
      ...mediaSnapshot(0, 120, 'active', 10_000),
      id: 'media-7-1',
      frameId: 7,
      adapterId: 'tencent-video'
    }
    const routedPaused: MediaSnapshot = {
      ...routedActive,
      state: 'paused',
      metrics: { ...routedActive.metrics, currentTime: 43 },
      updatedAt: 11_000
    }
    let currentRoutedState: MediaPageState = {
      frameId: 7,
      revision: 1,
      activeMediaId: routedActive.id,
      media: [routedActive],
      observedAt: routedActive.updatedAt
    }
    const localEmptyState: MediaPageState = {
      frameId: 0,
      revision: 1,
      activeMediaId: null,
      media: [],
      observedAt: 10_000
    }
    const restoredMedia: MediaSnapshot = {
      ...routedActive,
      metrics: { ...routedActive.metrics, currentTime: 42 }
    }
    const restoredState: MediaPageState = {
      ...currentRoutedState,
      media: [restoredMedia]
    }
    const harness = runtimeHarness(localMedia, {
      restoreProgress: true,
      restoredPosition: 42,
      routedStateForRequest: () => currentRoutedState,
      routedCommandResponse: {
        result: {
          ok: true,
          value: {
            commandType: 'media.seek',
            mediaId: routedActive.id,
            changed: true,
            snapshot: restoredMedia
          }
        },
        state: restoredState
      }
    })
    bridgeFakes.getState.mockResolvedValue(localEmptyState)
    const runtime = await startContentRuntime({
      window,
      document,
      siteOrigin: 'https://v.qq.com',
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve()
    })

    await vi.waitFor(() =>
      expect(
        harness.requestPayloads.filter(
          (_payload, index) => harness.requestTypes[index] === 'media.execute'
        )
      ).toContainEqual({
        command: { type: 'media.seek', mediaId: routedActive.id, deltaSeconds: 42 }
      })
    )
    expect(bridgeFakes.execute).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'media.seek', mediaId: routedActive.id })
    )

    currentRoutedState = {
      frameId: 7,
      revision: 2,
      activeMediaId: routedPaused.id,
      media: [routedPaused],
      observedAt: routedPaused.updatedAt
    }
    bridgeFakes.stateListener?.({})
    await vi.waitFor(() =>
      expect(
        harness.requestTypes.filter((requestType) => requestType === 'progress.save')
      ).toHaveLength(1)
    )
    runtime.teardown()
  })

  it('retries routed progress restore after a stale child is replaced', async () => {
    const localMedia = mediaSnapshot(0, 120, 'paused')
    const staleMedia: MediaSnapshot = {
      ...mediaSnapshot(0, 120, 'active', 10_000),
      id: 'media-7-stale',
      frameId: 7,
      adapterId: 'tencent-video'
    }
    const replacementMedia: MediaSnapshot = {
      ...staleMedia,
      id: 'media-13-replacement',
      frameId: 13,
      updatedAt: 11_000
    }
    const staleState: MediaPageState = {
      frameId: 7,
      revision: 1,
      activeMediaId: staleMedia.id,
      media: [staleMedia],
      observedAt: staleMedia.updatedAt
    }
    const replacementState: MediaPageState = {
      frameId: 13,
      revision: 1,
      activeMediaId: replacementMedia.id,
      media: [replacementMedia],
      observedAt: replacementMedia.updatedAt
    }
    const localEmptyState: MediaPageState = {
      frameId: 0,
      revision: 1,
      activeMediaId: null,
      media: [],
      observedAt: 10_000
    }
    let currentRoutedState = staleState
    const harness = runtimeHarness(localMedia, {
      restoreProgress: true,
      restoredPosition: 42,
      routedStateForRequest: () => currentRoutedState,
      routedCommandResponseForRequest: (command) => {
        if (command.mediaId === staleMedia.id) {
          return {
            result: {
              ok: false,
              error: {
                code: 'MEDIA_NOT_FOUND',
                messageKey: 'command.error.mediaNotFound',
                context: { mediaId: staleMedia.id }
              }
            },
            state: { ...staleState, activeMediaId: null, media: [] }
          }
        }
        const restoredMedia: MediaSnapshot = {
          ...replacementMedia,
          metrics: { ...replacementMedia.metrics, currentTime: 42 }
        }
        return {
          result: {
            ok: true,
            value: {
              commandType: command.type,
              mediaId: replacementMedia.id,
              changed: true,
              snapshot: restoredMedia
            }
          },
          state: { ...replacementState, media: [restoredMedia] }
        }
      }
    })
    bridgeFakes.getState.mockResolvedValue(localEmptyState)
    const runtime = await startContentRuntime({
      window,
      document,
      siteOrigin: 'https://v.qq.com',
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve()
    })

    await vi.waitFor(() =>
      expect(
        harness.requestPayloads.filter(
          (_payload, index) => harness.requestTypes[index] === 'media.execute'
        )
      ).toContainEqual({
        command: { type: 'media.seek', mediaId: staleMedia.id, deltaSeconds: 42 }
      })
    )

    currentRoutedState = replacementState
    bridgeFakes.stateListener?.({})

    await vi.waitFor(() =>
      expect(
        harness.requestPayloads.filter(
          (_payload, index) => harness.requestTypes[index] === 'media.execute'
        )
      ).toContainEqual({
        command: { type: 'media.seek', mediaId: replacementMedia.id, deltaSeconds: 42 }
      })
    )
    expect(
      harness.requestTypes.filter((requestType) => requestType === 'progress.read')
    ).toHaveLength(2)
    runtime.teardown()
  })

  it('refreshes and retries a Tencent command after the previous frame media disappears', async () => {
    const localMedia = mediaSnapshot(10, 120, 'paused')
    const oldMedia: MediaSnapshot = {
      ...localMedia,
      id: 'media-7-1',
      frameId: 7,
      adapterId: 'tencent-video'
    }
    const newMedia: MediaSnapshot = {
      ...localMedia,
      id: 'media-13-tencent-viewport',
      frameId: 13,
      adapterId: 'tencent-video'
    }
    const localEmptyState: MediaPageState = {
      frameId: 0,
      revision: 1,
      activeMediaId: null,
      media: [],
      observedAt: 10_000
    }
    const oldState: MediaPageState = {
      frameId: 7,
      revision: 1,
      activeMediaId: oldMedia.id,
      media: [oldMedia],
      observedAt: oldMedia.updatedAt
    }
    const newState: MediaPageState = {
      frameId: 13,
      revision: 1,
      activeMediaId: newMedia.id,
      media: [newMedia],
      observedAt: newMedia.updatedAt
    }
    const harness = runtimeHarness(localMedia, {
      restoreProgress: false,
      routedStateForRequest: (requestIndex) => (requestIndex <= 2 ? oldState : newState),
      routedCommandResponseForRequest: (command) => {
        if (command.mediaId === oldMedia.id) {
          return {
            result: {
              ok: false,
              error: {
                code: 'MEDIA_NOT_FOUND',
                messageKey: 'command.error.mediaNotFound',
                context: { mediaId: oldMedia.id }
              }
            },
            state: { ...oldState, activeMediaId: null, media: [] }
          }
        }
        const updatedMedia: MediaSnapshot = {
          ...newMedia,
          metrics: { ...newMedia.metrics, playbackRate: 1.5 }
        }
        return {
          result: {
            ok: true,
            value: {
              commandType: command.type,
              mediaId: updatedMedia.id,
              changed: true,
              snapshot: updatedMedia
            }
          },
          state: { ...newState, media: [updatedMedia] }
        }
      }
    })
    bridgeFakes.getState.mockResolvedValue(localEmptyState)
    const feedback: unknown[] = []
    const runtime = await startContentRuntime({
      window,
      document,
      siteOrigin: 'https://v.qq.com',
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve(),
      onFeedback: (event) => feedback.push(event)
    })

    await vi.waitFor(async () =>
      expect((await runtime.getMediaState()).activeMediaId).toBe(oldMedia.id)
    )
    const result = await runtime.executeMediaCommand(
      { type: 'media.set-rate', mediaId: oldMedia.id, value: 1.5 },
      { source: 'shortcut' }
    )

    expect(result.result.ok).toBe(true)
    const commandPayloads = harness.requestPayloads.filter(
      (_payload, index) => harness.requestTypes[index] === 'media.execute'
    )
    expect(commandPayloads).toEqual([
      { command: { type: 'media.set-rate', mediaId: oldMedia.id, value: 1.5 } },
      {
        command: {
          type: 'media.set-rate',
          mediaId: newMedia.id,
          value: 1.5
        }
      }
    ])
    expect(feedback).toHaveLength(1)
    runtime.teardown()
  })

  it('reports an unavailable runtime when page bridge startup does not complete', async () => {
    const media = mediaSnapshot(0, 120)
    const harness = runtimeHarness(media, { restoreProgress: false })
    bridgeFakes.start.mockResolvedValueOnce(false)
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve()
    })

    expect(document.documentElement.dataset['h5playerWebextBridge']).toBe('failed')
    expect(document.documentElement.dataset['h5playerWebextMedia']).toBe('failed')
    expect(bridgeFakes.configure).not.toHaveBeenCalled()
    expect(bridgeFakes.stateListener).toBeNull()
    await expect(runtime.getMediaState()).rejects.toMatchObject({
      code: 'PAGE_RUNTIME_UNAVAILABLE'
    })

    const response = await runtime.handleTabMessage(createTabRequest('site.get-state', {}), {
      id: 'extension-id'
    })
    expect(response).toMatchObject({
      type: 'protocol.response',
      payload: { data: { ready: false, mediaCount: 0, activeMedia: false } }
    })
    runtime.teardown()
  })

  it('contains bridge configuration failures without exposing a partial runtime', async () => {
    const media = mediaSnapshot(0, 120)
    const harness = runtimeHarness(media, { restoreProgress: false })
    bridgeFakes.configure.mockRejectedValueOnce(new Error('configuration failed'))
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve()
    })

    expect(document.documentElement.dataset['h5playerWebextBridge']).toBe('ready')
    expect(document.documentElement.dataset['h5playerWebextMedia']).toBe('failed')
    expect(bridgeFakes.ping).not.toHaveBeenCalled()
    await expect(
      runtime.executeMediaCommand({ type: 'media.play', mediaId: media.id })
    ).rejects.toMatchObject({ code: 'PAGE_RUNTIME_UNAVAILABLE' })
    runtime.teardown()
  })

  it('fails closed when settings cannot be loaded', async () => {
    const media = mediaSnapshot(0, 120)
    const harness = runtimeHarness(media, {
      restoreProgress: false,
      failRequestTypes: ['settings.get']
    })
    const onRuntimeStateChanged = vi.fn()
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve(),
      onRuntimeStateChanged
    })
    expect(harness.transport.reconnectCount).toBe(1)
    expect(onRuntimeStateChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({ ready: false, siteEnabled: false, mediaState: null })
    )
    await expect(runtime.getMediaState()).rejects.toMatchObject({
      code: 'PAGE_RUNTIME_UNAVAILABLE'
    })
    runtime.teardown()
  })

  it('restores a stored position through a bounded relative seek', async () => {
    const media = mediaSnapshot(0, 120)
    const harness = runtimeHarness(media, { restoreProgress: true, restoredPosition: 42 })
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(bridgeFakes.execute).toHaveBeenCalledWith({
        type: 'media.seek',
        mediaId: media.id,
        deltaSeconds: 42
      })
    })
    expect(harness.requestTypes).toContain('progress.read')
    expect(harness.requestTypes).not.toContain('progress.save')
    runtime.teardown()
  })

  it('toggles per-site progress restore with Shift+R and restores immediately when enabled', async () => {
    const media = mediaSnapshot(0, 120)
    const harness = runtimeHarness(media, { restoreProgress: false, restoredPosition: 42 })
    const feedback: unknown[] = []
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve(),
      onFeedback: (event) => feedback.push(event)
    })

    const event = new KeyboardEvent('keydown', {
      code: 'KeyR',
      shiftKey: true,
      bubbles: true,
      cancelable: true
    })
    window.dispatchEvent(event)

    await vi.waitFor(() => expect(harness.requestTypes).toContain('progress.toggle-restore'))
    await vi.waitFor(() =>
      expect(bridgeFakes.execute).toHaveBeenCalledWith({
        type: 'media.seek',
        mediaId: media.id,
        deltaSeconds: 42
      })
    )
    expect(event.defaultPrevented).toBe(true)
    expect(harness.envelope.data.sites[window.location.origin]?.media?.restoreProgress).toBe(true)
    expect(feedback).toContainEqual(
      expect.objectContaining({
        commandId: 'settings.restore-progress',
        messageKey: 'feedback.restore-progress-enabled',
        value: true
      })
    )
    runtime.teardown()
  })

  it('prepares enabled downloads through the page boundary and delivers artifacts to isolated content', async () => {
    const media = mediaSnapshot(0, 120)
    const harness = runtimeHarness(media, { restoreProgress: false, allowExperimental: true })
    const artifacts = [
      {
        kind: 'same-origin' as const,
        url: `${window.location.origin}/video.mp4`,
        filename: 'episode_video.mp4'
      }
    ]
    let delivered: unknown = null
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve(),
      onMediaDownloadArtifacts: (value) => {
        delivered = value
      }
    })
    bridgeFakes.prepareDownload.mockImplementationOnce((_mediaId, intentId) =>
      Promise.resolve({ intentId, disposition: 'started', artifacts })
    )

    const response = await runtime.executeMediaCommand({
      type: 'media.download',
      mediaId: media.id
    })
    expect(response.result.ok).toBe(true)
    expect(delivered).toEqual(artifacts)
    expect(bridgeFakes.execute).not.toHaveBeenCalled()
    runtime.teardown()
  })

  it('reports an isolated sink failure through the media feedback channel', async () => {
    const media = mediaSnapshot(0, 120)
    const harness = runtimeHarness(media, { restoreProgress: false, allowExperimental: true })
    const feedback: MediaFeedbackEvent[] = []
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve(),
      onFeedback: (event) => feedback.push(event),
      onMediaDownloadArtifacts: () => {
        throw new Error('browser rejected download')
      }
    })
    bridgeFakes.prepareDownload.mockImplementationOnce((_mediaId, intentId) =>
      Promise.resolve({
        intentId,
        disposition: 'started',
        artifacts: [
          {
            kind: 'same-origin' as const,
            url: `${window.location.origin}/video.mp4`,
            filename: 'episode_video.mp4'
          }
        ]
      })
    )

    const response = await runtime.executeMediaCommand({
      type: 'media.download',
      mediaId: media.id
    })
    expect(response.result.ok).toBe(true)
    await vi.waitFor(() => {
      expect(feedback).toContainEqual(
        expect.objectContaining({
          commandId: 'media.download',
          kind: 'error',
          messageKey: 'download.error.failed'
        })
      )
    })
    runtime.teardown()
  })

  it('reports a non-blocking user download cancellation through the feedback channel', async () => {
    const media = mediaSnapshot(0, 120)
    const harness = runtimeHarness(media, { restoreProgress: false, allowExperimental: true })
    const feedback: MediaFeedbackEvent[] = []
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve(),
      onFeedback: (event) => feedback.push(event),
      onMediaDownloadArtifacts: () => false
    })
    bridgeFakes.prepareDownload.mockImplementationOnce((_mediaId, intentId) =>
      Promise.resolve({
        intentId,
        disposition: 'started',
        artifacts: [
          {
            kind: 'same-origin' as const,
            url: `${window.location.origin}/video.mp4`,
            filename: 'episode_video.mp4'
          }
        ]
      })
    )

    const response = await runtime.executeMediaCommand({
      type: 'media.download',
      mediaId: media.id
    })
    expect(response.result.ok).toBe(true)
    await vi.waitFor(() => {
      expect(feedback).toContainEqual(
        expect.objectContaining({
          commandId: 'media.download',
          kind: 'error',
          messageKey: 'download.error.cancelled'
        })
      )
    })
    runtime.teardown()
  })

  it('ignores a queued download event when its one-shot intent is no longer pending', async () => {
    const media = mediaSnapshot(0, 120)
    const harness = runtimeHarness(media, { restoreProgress: false, allowExperimental: true })
    const deliver = vi.fn()
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve(),
      onMediaDownloadArtifacts: deliver
    })
    bridgeFakes.prepareDownload.mockImplementationOnce((_mediaId, intentId) =>
      Promise.resolve({ intentId, disposition: 'queued', artifacts: [] })
    )
    await runtime.executeMediaCommand({ type: 'media.download', mediaId: media.id })
    const listener = bridgeFakes.downloadListener
    expect(listener).not.toBeNull()
    listener?.({
      type: 'ready',
      preparation: {
        intentId: 'forged-intent-0000000',
        disposition: 'started',
        artifacts: []
      }
    })
    expect(deliver).not.toHaveBeenCalled()
    runtime.teardown()
  })

  it('delivers a shortcut capture artifact to the download callback', async () => {
    const media: MediaSnapshot = {
      ...mediaSnapshot(10, 120),
      capabilities: createMediaCapabilities({ playback: true, capture: true })
    }
    const artifact = {
      mimeType: 'image/png' as const,
      width: 1,
      height: 1,
      byteLength: 3,
      dataBase64: 'AQID'
    }
    const harness = runtimeHarness(media, { restoreProgress: false })
    bridgeFakes.execute.mockImplementation((command) =>
      Promise.resolve({
        ...commandResponse(command, media),
        result: {
          ok: true,
          value: {
            commandType: command.type,
            mediaId: media.id,
            changed: false,
            snapshot: media,
            artifact
          }
        }
      })
    )
    const onCaptureArtifact = vi.fn()
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve(),
      onCaptureArtifact
    })

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        code: 'KeyS',
        shiftKey: true,
        bubbles: true,
        cancelable: true
      })
    )

    await vi.waitFor(() => expect(onCaptureArtifact).toHaveBeenCalledWith(artifact))
    expect(bridgeFakes.execute).toHaveBeenCalledWith({
      type: 'media.capture',
      mediaId: media.id
    })
    runtime.teardown()
  })

  it('deletes completed short-media progress before applying the three-second save floor', async () => {
    const media = mediaSnapshot(1, 4)
    const harness = runtimeHarness(media, { restoreProgress: true, restoredPosition: null })
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve()
    })

    await vi.waitFor(() => expect(harness.requestTypes).toContain('progress.delete'))
    expect(harness.requestTypes).not.toContain('progress.save')
    runtime.teardown()
  })

  it('publishes local playback events and accepts typed advisory events from background', async () => {
    const media = mediaSnapshot(10, 120, 'active')
    const harness = runtimeHarness(media, { restoreProgress: false })
    const onCrossTabEvent = vi.fn()
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve(),
      onCrossTabEvent
    })

    await runtime.executeMediaCommand({ type: 'media.play', mediaId: media.id })
    await vi.waitFor(() => expect(harness.requestTypes).toContain('media.cross-tab.publish'))
    expect(
      harness.requestPayloads.find(
        (payload) =>
          typeof payload === 'object' &&
          payload !== null &&
          (payload as { kind?: unknown }).kind === 'playback-started'
      )
    ).toBeDefined()

    const response = await runtime.handleTabMessage(
      createTabRequest('media.cross-tab.event', {
        event: {
          eventId: 'incoming-event-0001',
          kind: 'playback-paused',
          mediaKey: 'page:fnv1a64:01234567',
          sourceTabId: 2,
          sourceFrameId: 0,
          observedAt: 9_000
        }
      }),
      { id: 'extension-id' }
    )
    expect(response).toMatchObject({ type: 'protocol.response' })
    expect(onCrossTabEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'playback-paused', sourceTabId: 2 })
    )
    runtime.teardown()
  })

  it('authenticates, validates, and replay-protects tab messages', async () => {
    const media = mediaSnapshot(10, 120, 'active')
    const harness = runtimeHarness(media, { restoreProgress: false })
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve()
    })

    await expect(
      runtime.handleTabMessage({ unexpected: true }, { id: 'extension-id' })
    ).resolves.toBeNull()

    const unauthorizedRequest = createTabRequest('site.get-state', {})
    await expect(
      runtime.handleTabMessage(unauthorizedRequest, { id: 'other-extension' })
    ).resolves.toMatchObject({
      type: 'protocol.error',
      payload: { error: { code: 'UNAUTHORIZED_SOURCE', retryable: false } }
    })

    const replayedRequest = createTabRequest('site.get-state', {})
    await expect(
      runtime.handleTabMessage(replayedRequest, { id: 'extension-id' })
    ).resolves.toMatchObject({
      type: 'protocol.response'
    })
    await expect(
      runtime.handleTabMessage(replayedRequest, { id: 'extension-id' })
    ).resolves.toMatchObject({
      type: 'protocol.error',
      payload: { error: { code: 'REPLAY_DETECTED' } }
    })

    await expect(
      runtime.handleTabMessage(createTabRequest('media.cross-tab.event', { event: null }), {
        id: 'extension-id'
      })
    ).resolves.toMatchObject({
      type: 'protocol.error',
      payload: { error: { code: 'INVALID_PAYLOAD' } }
    })
    runtime.teardown()
  })

  it('rejects malformed frame-state refresh payloads without reporting runtime state', async () => {
    const media = mediaSnapshot(10, 120, 'active')
    const harness = runtimeHarness(media, { restoreProgress: false })
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve()
    })

    await vi.waitFor(() =>
      expect(
        harness.requestTypes.filter((requestType) => requestType === 'site.report-frame-state')
      ).toHaveLength(2)
    )
    const reportsBeforeInvalidRequest = harness.requestTypes.filter(
      (requestType) => requestType === 'site.report-frame-state'
    ).length

    await expect(
      runtime.handleTabMessage(createTabRequest('site.refresh-frame-state', { unexpected: true }), {
        id: 'extension-id'
      })
    ).resolves.toMatchObject({
      type: 'protocol.error',
      payload: { error: { code: 'INVALID_PAYLOAD' } }
    })
    expect(
      harness.requestTypes.filter((requestType) => requestType === 'site.report-frame-state')
    ).toHaveLength(reportsBeforeInvalidRequest)
    runtime.teardown()
  })

  it('deduplicates frame reports when only observed timestamps and playback time change', async () => {
    const initial = mediaSnapshot(10, 120, 'active', 10_000)
    const harness = runtimeHarness(initial, { restoreProgress: false })
    const onMediaStateChanged = vi.fn()
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve(),
      onMediaStateChanged
    })

    await vi.waitFor(() =>
      expect(
        harness.requestTypes.filter((requestType) => requestType === 'site.report-frame-state')
      ).toHaveLength(2)
    )
    await vi.waitFor(() =>
      expect(onMediaStateChanged).toHaveBeenCalledWith(pageState(initial), expect.anything())
    )
    const reportsBeforeTimeUpdates = harness.requestTypes.filter(
      (requestType) => requestType === 'site.report-frame-state'
    ).length

    for (const [currentTime, updatedAt] of [
      [11, 11_000],
      [12, 12_000],
      [13, 13_000]
    ] as const) {
      const updated = mediaSnapshot(currentTime, 120, 'active', updatedAt)
      const stateNotificationsBeforeUpdate = onMediaStateChanged.mock.calls.length
      bridgeFakes.getState.mockResolvedValueOnce(pageState(updated))
      bridgeFakes.stateListener?.({ observedAt: updatedAt })
      await vi.waitFor(() =>
        expect(onMediaStateChanged).toHaveBeenCalledTimes(stateNotificationsBeforeUpdate + 1)
      )
    }

    await vi.waitFor(() =>
      expect(
        harness.requestTypes.filter((requestType) => requestType === 'site.report-frame-state')
      ).toHaveLength(reportsBeforeTimeUpdates)
    )
    runtime.teardown()
  })

  it('retries a fresh frame report after the background runtime reconnects', async () => {
    const media = mediaSnapshot(10, 120, 'active')
    const harness = runtimeHarness(media, { restoreProgress: false })
    const reconnectListeners: Array<() => void> = []
    const reconnectTeardown = vi.fn()
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve(),
      subscribeRuntimeReconnect: (_sessionId, listener) => {
        reconnectListeners.push(listener)
        return reconnectTeardown
      }
    })

    await vi.waitFor(() =>
      expect(
        harness.requestTypes.filter((requestType) => requestType === 'site.report-frame-state')
      ).toHaveLength(2)
    )
    const reportsBeforeReconnect = harness.requestTypes.filter(
      (requestType) => requestType === 'site.report-frame-state'
    ).length

    expect(reconnectListeners).toHaveLength(1)
    harness.failNext('site.report-frame-state', 2)
    reconnectListeners[0]?.()
    await vi.waitFor(() =>
      expect(
        harness.requestTypes.filter((requestType) => requestType === 'site.report-frame-state')
      ).toHaveLength(reportsBeforeReconnect + 3)
    )

    runtime.teardown()
    expect(reconnectTeardown).toHaveBeenCalledOnce()
  })

  it('retries a reconnect frame report until the connected session is accepted', async () => {
    const media = mediaSnapshot(10, 120, 'active')
    let rejectedReports = 0
    const harness = runtimeHarness(media, {
      restoreProgress: false,
      frameReportAcceptedForRequest: () => {
        if (rejectedReports <= 0) return true
        rejectedReports -= 1
        return false
      }
    })
    const reconnectListeners: Array<() => void> = []
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve(),
      subscribeRuntimeReconnect: (_sessionId, listener) => {
        reconnectListeners.push(listener)
        return () => undefined
      }
    })

    await vi.waitFor(() =>
      expect(
        harness.requestTypes.filter((requestType) => requestType === 'site.report-frame-state')
      ).toHaveLength(2)
    )
    const reportsBeforeReconnect = harness.requestTypes.filter(
      (requestType) => requestType === 'site.report-frame-state'
    ).length

    rejectedReports = 2
    reconnectListeners[0]?.()
    await vi.waitFor(() =>
      expect(
        harness.requestTypes.filter((requestType) => requestType === 'site.report-frame-state')
      ).toHaveLength(reportsBeforeReconnect + 3)
    )
    runtime.teardown()
  })

  it('coalesces a media refresh that arrives while progress work is in flight', async () => {
    const initial = mediaSnapshot(10, 120, 'active', 10_000)
    const intermediate = mediaSnapshot(11, 120, 'active', 11_000)
    const paused = mediaSnapshot(12, 120, 'paused', 12_000)
    const harness = runtimeHarness(initial, { restoreProgress: false })
    const onMediaStateChanged = vi.fn()
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve(),
      onMediaStateChanged
    })

    await vi.waitFor(() =>
      expect(onMediaStateChanged).toHaveBeenCalledWith(pageState(initial), expect.anything())
    )
    const intermediateState = {
      resolve: null as ((state: MediaPageState) => void) | null
    }
    bridgeFakes.getState
      .mockImplementationOnce(
        () =>
          new Promise<MediaPageState>((resolve) => {
            intermediateState.resolve = resolve
          })
      )
      .mockResolvedValueOnce(pageState(paused))

    bridgeFakes.stateListener?.({})
    await vi.waitFor(() => expect(intermediateState.resolve).not.toBeNull())
    bridgeFakes.stateListener?.({})
    intermediateState.resolve?.(pageState(intermediate))

    await vi.waitFor(() =>
      expect(onMediaStateChanged).toHaveBeenLastCalledWith(pageState(paused), expect.anything())
    )
    runtime.teardown()
  })

  it('recovers fail-closed startup state after the background runtime reconnects', async () => {
    const media = mediaSnapshot(10, 120, 'active')
    const harness = runtimeHarness(media, { restoreProgress: false })
    const reconnectListeners: Array<() => void> = []
    const onRuntimeStateChanged = vi.fn()
    harness.failNext('settings.get', 2)

    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve(),
      subscribeRuntimeReconnect: (_sessionId, listener) => {
        reconnectListeners.push(listener)
        return () => undefined
      },
      onRuntimeStateChanged
    })

    expect(harness.requestTypes.filter((type) => type === 'settings.get')).toHaveLength(2)
    expect(onRuntimeStateChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({ ready: false, siteEnabled: false, mediaState: null })
    )
    await expect(runtime.getMediaState()).rejects.toMatchObject({
      code: 'PAGE_RUNTIME_UNAVAILABLE'
    })

    reconnectListeners[0]?.()

    await vi.waitFor(() =>
      expect(harness.requestTypes.filter((type) => type === 'settings.get')).toHaveLength(3)
    )
    await vi.waitFor(() =>
      expect(onRuntimeStateChanged).toHaveBeenLastCalledWith(
        expect.objectContaining({
          ready: true,
          siteEnabled: true,
          mediaState: pageState(media)
        })
      )
    )
    await vi.waitFor(() => {
      const reports = harness.requestPayloads.filter(
        (_payload, index) => harness.requestTypes[index] === 'site.report-frame-state'
      ) as Array<{ ready?: boolean; mediaCount?: number; activeMedia?: boolean }>
      expect(reports.at(-1)).toMatchObject({ ready: true, mediaCount: 1, activeMedia: true })
    })

    runtime.teardown()
  })

  it('applies temporary disable and permission revocation as immediate runtime boundaries', async () => {
    const media = mediaSnapshot(10, 120, 'active')
    const harness = runtimeHarness(media, { restoreProgress: false, allowExperimental: true })
    const onRuntimeStateChanged = vi.fn()
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve(),
      onRuntimeStateChanged
    })
    expect(bridgeFakes.configureAuthority).toHaveBeenLastCalledWith({
      playbackRate: true,
      volume: true,
      currentTime: false
    })
    expect(bridgeFakes.configureExperimental).toHaveBeenLastCalledWith({ mediaDownload: true })

    await expect(
      runtime.handleTabMessage(
        createTabRequest('site.set-temporary-disabled', { disabled: 'yes' }),
        { id: 'extension-id' }
      )
    ).resolves.toMatchObject({
      type: 'protocol.error',
      payload: { error: { code: 'INVALID_PAYLOAD' } }
    })

    await expect(
      runtime.handleTabMessage(
        createTabRequest('site.set-temporary-disabled', { disabled: true }),
        { id: 'extension-id' }
      )
    ).resolves.toMatchObject({
      type: 'protocol.response',
      payload: { data: { disabled: true } }
    })
    expect(bridgeFakes.configureAuthority).toHaveBeenLastCalledWith({
      playbackRate: false,
      volume: false,
      currentTime: false
    })
    expect(bridgeFakes.configureExperimental).toHaveBeenLastCalledWith({ mediaDownload: false })
    await expect(runtime.getMediaState()).rejects.toMatchObject({
      code: 'PAGE_RUNTIME_UNAVAILABLE'
    })
    await expect(
      runtime.handleTabMessage(createTabRequest('media.get-state', {}), {
        id: 'extension-id'
      })
    ).resolves.toMatchObject({
      type: 'protocol.error',
      payload: { error: { code: 'PAGE_RUNTIME_UNAVAILABLE', retryable: true } }
    })

    await expect(
      runtime.handleTabMessage(
        createTabRequest('site.set-temporary-disabled', { disabled: false }),
        { id: 'extension-id' }
      )
    ).resolves.toMatchObject({
      type: 'protocol.response',
      payload: { data: { disabled: false } }
    })
    expect(bridgeFakes.configureAuthority).toHaveBeenLastCalledWith({
      playbackRate: true,
      volume: true,
      currentTime: false
    })
    expect(bridgeFakes.configureExperimental).toHaveBeenLastCalledWith({ mediaDownload: true })
    await expect(runtime.getMediaState()).resolves.toEqual(pageState(media))
    expect(onRuntimeStateChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({ ready: true, mediaState: pageState(media) })
    )

    await expect(
      runtime.handleTabMessage(createTabRequest('site.permission-revoked', {}), {
        id: 'extension-id'
      })
    ).resolves.toMatchObject({
      type: 'protocol.response',
      payload: { data: { disabled: true } }
    })
    expect(bridgeFakes.unsubscribe).toHaveBeenCalled()
    expect(bridgeFakes.stop).toHaveBeenCalled()
    expect(bridgeFakes.configureAuthority).toHaveBeenLastCalledWith({
      playbackRate: false,
      volume: false,
      currentTime: false
    })
    expect(bridgeFakes.configureExperimental).toHaveBeenLastCalledWith({ mediaDownload: false })
    expect(onRuntimeStateChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({ ready: false, mediaReady: false, temporaryDisabled: true })
    )
    await expect(
      runtime.executeMediaCommand({ type: 'media.play', mediaId: media.id })
    ).rejects.toMatchObject({ code: 'PAGE_RUNTIME_UNAVAILABLE' })
    runtime.teardown()
  })

  it('applies page UI visibility through the typed tab protocol and broadcasts state', async () => {
    const media = mediaSnapshot(10, 120, 'active')
    const harness = runtimeHarness(media, { restoreProgress: false })
    const pageUi = {
      getState: vi.fn(() => ({ hidden: false, hiddenMediaCount: 2 })),
      setHidden: vi.fn((hidden: boolean) => ({
        hidden,
        hiddenMediaCount: hidden ? 2 : 0
      }))
    }
    const onRuntimeStateChanged = vi.fn()
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve(),
      pageUi,
      onRuntimeStateChanged
    })

    const response = await runtime.handleTabMessage(
      createTabRequest('site.set-page-ui-hidden', { hidden: true }),
      { id: 'extension-id' }
    )
    expect(response).toMatchObject({
      type: 'protocol.response',
      payload: { data: { hidden: true, hiddenMediaCount: 2 } }
    })
    expect(pageUi.setHidden).toHaveBeenCalledWith(true)
    expect(onRuntimeStateChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({ pageUiHidden: true, hiddenMediaCount: 2 })
    )

    await expect(
      runtime.handleTabMessage(createTabRequest('site.set-page-ui-hidden', { hidden: 'yes' }), {
        id: 'extension-id'
      })
    ).resolves.toMatchObject({
      type: 'protocol.error',
      payload: { error: { code: 'INVALID_PAYLOAD' } }
    })

    pageUi.setHidden.mockClear()
    await expect(runtime.setPageUiHidden(false)).resolves.toEqual({
      hidden: false,
      hiddenMediaCount: 0
    })
    expect(pageUi.setHidden).toHaveBeenCalledWith(false)
    expect(harness.requestTypes).toContain('site.set-page-ui-hidden')
    runtime.teardown()
  })

  it('keeps page and media rate intents session-local and falls back when site persistence fails', async () => {
    const media = mediaSnapshot(10, 120, 'active')
    const pageHarness = runtimeHarness(media, { restoreProgress: false })
    const pageRuntime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: pageHarness.transport,
      injectPageMain: () => Promise.resolve()
    })

    await pageRuntime.executeMediaCommand(
      { type: 'media.adjust-rate', mediaId: media.id, delta: 0.1 },
      { source: 'popup', playbackRateScope: 'page' }
    )
    expect(pageHarness.requestTypes).not.toContain('playback.set-site-intent')
    pageRuntime.teardown()

    const mediaHarness = runtimeHarness(media, { restoreProgress: false })
    const mediaRuntime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: mediaHarness.transport,
      injectPageMain: () => Promise.resolve()
    })
    await mediaRuntime.executeMediaCommand(
      { type: 'media.adjust-rate', mediaId: media.id, delta: 0.1 },
      { source: 'popup', playbackRateScope: 'media' }
    )
    expect(mediaHarness.requestTypes).not.toContain('playback.set-site-intent')
    mediaRuntime.teardown()

    const fallbackHarness = runtimeHarness(media, {
      restoreProgress: false,
      failRequestTypes: ['playback.set-site-intent']
    })
    const fallbackRuntime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: fallbackHarness.transport,
      injectPageMain: () => Promise.resolve()
    })
    await expect(
      fallbackRuntime.executeMediaCommand(
        { type: 'media.adjust-rate', mediaId: media.id, delta: 0.1 },
        { source: 'popup', playbackRateScope: 'site' }
      )
    ).resolves.toMatchObject({ result: { ok: true } })
    expect(fallbackHarness.requestTypes).toContain('playback.set-site-intent')
    fallbackRuntime.teardown()
  })

  it('does not repeat a successful user rate command through lifecycle reconciliation', async () => {
    const initial = mediaSnapshot(10, 120, 'active')
    const applied = {
      ...initial,
      metrics: { ...initial.metrics, playbackRate: 1.5 },
      updatedAt: initial.updatedAt + 1
    }
    const harness = runtimeHarness(initial, { restoreProgress: false })
    bridgeFakes.execute.mockImplementation((command) =>
      Promise.resolve(commandResponse(command, applied))
    )
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve()
    })

    bridgeFakes.execute.mockClear()
    await runtime.executeMediaCommand(
      { type: 'media.set-rate', mediaId: initial.id, value: 1.5 },
      { source: 'popup', playbackRateScope: 'page' }
    )

    expect(bridgeFakes.execute).toHaveBeenCalledTimes(1)
    expect(bridgeFakes.execute).toHaveBeenCalledWith({
      type: 'media.set-rate',
      mediaId: initial.id,
      value: 1.5
    })
    runtime.teardown()
  })

  it('does not apply a changed playback default while a settings refresh disables the site', async () => {
    const initial = mediaSnapshot(10, 120, 'active')
    const harness = runtimeHarness(initial, { restoreProgress: false })
    const settingsListeners: Array<() => void> = []
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve(),
      subscribeSettings: (listener) => {
        settingsListeners.push(listener)
        return () => undefined
      }
    })
    await vi.waitFor(() => expect(bridgeFakes.getState).toHaveBeenCalled())
    bridgeFakes.execute.mockClear()
    harness.envelope.data.global.media.defaultPlaybackRate = 2
    harness.envelope.data.global.enabled = false

    settingsListeners[0]?.()
    await vi.waitFor(() =>
      expect(harness.requestTypes.filter((type) => type === 'settings.get')).toHaveLength(2)
    )

    expect(bridgeFakes.execute).not.toHaveBeenCalled()
    runtime.teardown()
  })

  it('serves typed media requests and maps page bridge failures to bounded protocol errors', async () => {
    const media = mediaSnapshot(10, 120, 'active')
    const harness = runtimeHarness(media, { restoreProgress: false })
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve()
    })

    await expect(
      runtime.handleTabMessage(createTabRequest('media.get-state', { extra: true }), {
        id: 'extension-id'
      })
    ).resolves.toMatchObject({
      type: 'protocol.error',
      payload: { error: { code: 'INVALID_PAYLOAD' } }
    })
    await expect(
      runtime.handleTabMessage(createTabRequest('media.get-state', {}), {
        id: 'extension-id'
      })
    ).resolves.toMatchObject({
      type: 'protocol.response',
      payload: { data: { activeMediaId: media.id } }
    })
    await expect(
      runtime.handleTabMessage(createTabRequest('media.execute', {}), {
        id: 'extension-id'
      })
    ).resolves.toMatchObject({
      type: 'protocol.error',
      payload: { error: { code: 'INVALID_PAYLOAD' } }
    })
    await expect(
      runtime.handleTabMessage(
        createTabRequest('media.execute', {
          command: { type: 'media.play', mediaId: media.id }
        }),
        { id: 'extension-id' }
      )
    ).resolves.toMatchObject({
      type: 'protocol.response',
      payload: { data: { result: { ok: true } } }
    })

    bridgeFakes.getState.mockRejectedValueOnce(
      new PageBridgeError('REQUEST_TIMEOUT', 'bridge timed out')
    )
    await expect(
      runtime.handleTabMessage(createTabRequest('media.get-state', {}), {
        id: 'extension-id'
      })
    ).resolves.toMatchObject({
      type: 'protocol.error',
      payload: { error: { code: 'PAGE_RUNTIME_UNAVAILABLE', retryable: true } }
    })

    bridgeFakes.execute.mockRejectedValueOnce(
      new PageBridgeError('INVALID_RESPONSE', 'invalid bridge response')
    )
    await expect(
      runtime.handleTabMessage(
        createTabRequest('media.execute', {
          command: { type: 'media.pause', mediaId: media.id }
        }),
        { id: 'extension-id' }
      )
    ).resolves.toMatchObject({
      type: 'protocol.error',
      payload: { error: { code: 'INTERNAL_ERROR', retryable: false } }
    })

    bridgeFakes.execute.mockRejectedValueOnce(new Error('unexpected page failure'))
    await expect(
      runtime.handleTabMessage(
        createTabRequest('media.execute', {
          command: { type: 'media.pause', mediaId: media.id }
        }),
        { id: 'extension-id' }
      )
    ).resolves.toMatchObject({
      type: 'protocol.error',
      payload: { error: { code: 'INTERNAL_ERROR', retryable: false } }
    })
    runtime.teardown()
  })

  it('refreshes settings subscriptions and clears disabled-site media state', async () => {
    const media = mediaSnapshot(10, 120, 'active')
    const harness = runtimeHarness(media, { restoreProgress: false })
    const settingsListeners: Array<() => void> = []
    const settingsTeardown = vi.fn()
    const onRuntimeStateChanged = vi.fn()
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve(),
      subscribeSettings: (listener) => {
        settingsListeners.push(listener)
        return settingsTeardown
      },
      onRuntimeStateChanged
    })

    await vi.waitFor(() =>
      expect(onRuntimeStateChanged).toHaveBeenCalledWith(
        expect.objectContaining({ siteEnabled: true, mediaState: pageState(media) })
      )
    )
    harness.envelope.data.global.enabled = false
    settingsListeners[0]?.()
    await vi.waitFor(() =>
      expect(onRuntimeStateChanged).toHaveBeenLastCalledWith(
        expect.objectContaining({ ready: false, siteEnabled: false, mediaState: null })
      )
    )
    await expect(runtime.getMediaState()).rejects.toMatchObject({
      code: 'PAGE_RUNTIME_UNAVAILABLE'
    })

    runtime.teardown()
    expect(settingsTeardown).toHaveBeenCalledOnce()
  })

  it('saves pause progress immediately and throttles repeated advisory refreshes', async () => {
    const active = mediaSnapshot(12, 120, 'active', 10_000)
    const paused = mediaSnapshot(13, 120, 'paused', 11_000)
    const repeatedPause = mediaSnapshot(14, 120, 'paused', 12_000)
    const harness = runtimeHarness(active, { restoreProgress: true, restoredPosition: null })
    const onMediaStateChanged = vi.fn()
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve(),
      onMediaStateChanged
    })

    await vi.waitFor(() =>
      expect(
        harness.requestTypes.filter((requestType) => requestType === 'progress.save')
      ).toHaveLength(1)
    )
    await vi.waitFor(() =>
      expect(onMediaStateChanged).toHaveBeenCalledWith(pageState(active), expect.anything())
    )
    bridgeFakes.getState.mockResolvedValue(pageState(paused))
    bridgeFakes.stateListener?.({})
    await vi.waitFor(() =>
      expect(
        harness.requestTypes.filter((requestType) => requestType === 'progress.save')
      ).toHaveLength(2)
    )

    bridgeFakes.getState.mockResolvedValue(pageState(repeatedPause))
    bridgeFakes.stateListener?.({})
    await vi.waitFor(() =>
      expect(onMediaStateChanged).toHaveBeenCalledWith(pageState(repeatedPause), expect.anything())
    )
    expect(
      harness.requestTypes.filter((requestType) => requestType === 'progress.save')
    ).toHaveLength(2)
    runtime.teardown()
  })

  it('publishes pause progress, applies seek and rate save policy, and preserves failed commands', async () => {
    const media = mediaSnapshot(20, 120, 'paused', 20_000)
    const harness = runtimeHarness(media, { restoreProgress: true, restoredPosition: null })
    const runtime = await startContentRuntime({
      window,
      document,
      extensionId: 'extension-id',
      transport: harness.transport,
      injectPageMain: () => Promise.resolve()
    })

    await runtime.executeMediaCommand({ type: 'media.pause', mediaId: media.id })
    await runtime.executeMediaCommand({
      type: 'media.seek',
      mediaId: media.id,
      deltaSeconds: 5
    })
    await runtime.executeMediaCommand({ type: 'media.set-rate', mediaId: media.id, value: 1.5 })

    bridgeFakes.execute.mockResolvedValueOnce({
      result: {
        ok: false,
        error: {
          code: 'CAPABILITY_UNAVAILABLE',
          messageKey: 'command.error.capabilityUnavailable'
        }
      },
      state: pageState(media)
    })
    await expect(
      runtime.executeMediaCommand({ type: 'media.toggle-picture-in-picture', mediaId: media.id })
    ).resolves.toMatchObject({ result: { ok: false } })

    expect(
      harness.requestPayloads.some(
        (payload) =>
          typeof payload === 'object' &&
          payload !== null &&
          (payload as { kind?: unknown }).kind === 'playback-paused'
      )
    ).toBe(true)
    expect(harness.requestTypes).toContain('progress.save')
    runtime.teardown()
  })
})
