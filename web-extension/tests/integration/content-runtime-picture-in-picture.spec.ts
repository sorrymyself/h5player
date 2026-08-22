import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaCommandResultResponse, MediaPageState } from '../../src/application/media'
import type { MediaCommand } from '../../src/domain/command'
import { createMediaCapabilities, type MediaSnapshot } from '../../src/domain/media'
import { createDefaultSettings } from '../../src/domain/settings'
import {
  startContentRuntime,
  type ContentRuntimeHandle
} from '../../src/runtime/content/content-runtime'
import { createRuntimeSuccess, parseRuntimeRequest } from '../../src/shared/protocol'
import { FakeTransport } from '../test-support/fakes'
import { createSettingsEnvelope } from '../test-support/settings-fixtures'

const bridgeFakes = vi.hoisted(() => ({
  state: null as MediaPageState | null,
  start: vi.fn(() => Promise.resolve(true)),
  configure: vi.fn(() => Promise.resolve(true)),
  configureAuthority: vi.fn(() => Promise.resolve(true)),
  configureExperimental: vi.fn(() => Promise.resolve(true)),
  execute: vi.fn<(command: MediaCommand) => Promise<MediaCommandResultResponse>>(),
  getState: vi.fn<() => Promise<MediaPageState>>(),
  prepareDownload: vi.fn(),
  executePageAction: vi.fn<
    (
      action: 'next' | 'autoplay'
    ) => Promise<{ declared: boolean; handled: boolean; adapterId: string | null }>
  >(() => Promise.resolve({ declared: false, handled: false, adapterId: null })),
  subscribeState: vi.fn(),
  subscribeDownload: vi.fn(),
  stop: vi.fn()
}))

vi.mock('../../src/runtime/content/page-bridge', () => {
  class TestPageBridge {
    start() {
      return bridgeFakes.start()
    }

    configure(frameId: number) {
      void frameId
      return bridgeFakes.configure()
    }

    configureAuthority(policy: unknown) {
      void policy
      return bridgeFakes.configureAuthority()
    }

    configureExperimental(policy: unknown) {
      void policy
      return bridgeFakes.configureExperimental()
    }

    ping(): void {}

    getMediaState() {
      return bridgeFakes.getState()
    }

    executeMediaCommand(command: MediaCommand) {
      return bridgeFakes.execute(command)
    }

    prepareDownload(mediaId: string, intentId: string) {
      void bridgeFakes.prepareDownload(mediaId, intentId)
      return Promise.resolve({ intentId, disposition: 'queued', artifacts: [] })
    }

    executePageAction(action: 'next' | 'autoplay') {
      void bridgeFakes.executePageAction(action)
      return Promise.resolve({ declared: false, handled: false, adapterId: null })
    }

    subscribeMediaStateChanged(listener: (summary: unknown) => void) {
      bridgeFakes.subscribeState(listener)
      return () => undefined
    }

    subscribeDownloadEvents(listener: (event: unknown) => void) {
      bridgeFakes.subscribeDownload(listener)
      return () => undefined
    }

    stop() {
      bridgeFakes.stop()
    }
  }

  return { PageBridge: TestPageBridge }
})

function createMedia(
  id: string,
  state: MediaSnapshot['state'] = 'active',
  pictureInPicture = false
): MediaSnapshot {
  return {
    id,
    frameId: 0,
    kind: 'video',
    state,
    metrics: {
      width: 640,
      height: 360,
      duration: 120,
      currentTime: 20,
      volume: 0.8,
      playbackRate: 1,
      muted: false,
      visible: true
    },
    capabilities: createMediaCapabilities({
      playback: true,
      seek: true,
      playbackRate: true,
      volume: true,
      mute: true,
      pictureInPicture: true
    }),
    presentation: { fullscreen: 'none', pictureInPicture },
    adapterId: 'generic',
    updatedAt: 10_000
  }
}

function pageState(media: MediaSnapshot | null): MediaPageState {
  return {
    frameId: 0,
    revision: 1,
    activeMediaId: media?.id ?? null,
    media: media === null ? [] : [media],
    observedAt: media?.updatedAt ?? 10_000
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

type HarnessOptions = Readonly<{
  localState: MediaPageState
  remoteControlState?: unknown
  tabId?: number
  frameId?: number
}>

function createHarness(options: HarnessOptions) {
  const settings = createDefaultSettings()
  settings.global.media.restoreProgress = false
  const envelope = createSettingsEnvelope()
  envelope.data = settings
  const requests: Array<{ type: string; payload: unknown }> = []
  const presence: unknown[] = []
  const remoteCommands: unknown[] = []
  const transport = new FakeTransport((raw) => {
    const request = parseRuntimeRequest(raw)
    if (!request) return Promise.reject(new Error('invalid request'))
    requests.push({ type: request.type, payload: request.payload })
    const respond = (data: unknown) =>
      Promise.resolve(
        createRuntimeSuccess(
          request,
          data,
          request.sessionId ? { sessionId: request.sessionId } : {}
        )
      )
    switch (request.type) {
      case 'system.ping':
        return respond({
          extensionVersion: '0.1.0',
          phase: 6,
          protocol: 1,
          settingsSchemaVersion: 3,
          tabId: options.tabId ?? 2,
          frameId: options.frameId ?? 0,
          siteOrigin: 'https://example.com'
        })
      case 'settings.get':
        return respond({ settings: envelope, latestBackup: null })
      case 'experimental.ensure-main':
        return respond({ allowed: false, injected: false })
      case 'site.report-frame-state':
        return respond({
          accepted: true,
          stateKnown: false,
          pageUiHidden: false,
          temporaryDisabled: false
        })
      case 'media.get-state':
        return respond(options.localState)
      case 'media.picture-in-picture.get-state':
        return respond(
          options.remoteControlState ?? {
            owner: null,
            state: null
          }
        )
      case 'media.picture-in-picture.presence':
        presence.push(request.payload)
        return respond({ owner: null })
      case 'media.picture-in-picture.execute':
        remoteCommands.push(request.payload)
        return respond({
          result: {
            ok: true,
            value: {
              commandType: 'media.adjust-rate',
              mediaId: 'remote-media',
              changed: true,
              snapshot: options.localState.media[0] ?? createMedia('remote-media')
            }
          },
          state: options.localState
        })
      case 'media.cross-tab.publish':
        return respond({
          event: {
            eventId: 'pip-test-event-0001',
            ...(request.payload as Record<string, unknown>),
            sourceTabId: options.tabId ?? 2,
            sourceFrameId: options.frameId ?? 0
          },
          attemptedTabs: 0,
          deliveredTabs: 0
        })
      default:
        return Promise.reject(new Error(`unexpected request ${request.type}`))
    }
  })
  return { transport, requests, presence, remoteCommands }
}

async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

async function startRuntime(
  harness: ReturnType<typeof createHarness>,
  state: MediaPageState
): Promise<ContentRuntimeHandle> {
  bridgeFakes.state = state
  bridgeFakes.getState.mockResolvedValue(state)
  bridgeFakes.execute.mockImplementation((command) => {
    const media = state.media[0] ?? createMedia('local-media')
    return Promise.resolve(commandResponse(command, media))
  })
  const runtime = await startContentRuntime({
    window,
    document,
    extensionId: 'extension-id',
    transport: harness.transport,
    injectPageMain: () => Promise.resolve()
  })
  activeRuntimes.add(runtime)
  return runtime
}

const activeRuntimes = new Set<ContentRuntimeHandle>()

function stopRuntime(runtime: ContentRuntimeHandle): void {
  if (!activeRuntimes.delete(runtime)) return
  runtime.teardown()
}

beforeEach(() => {
  vi.clearAllMocks()
  bridgeFakes.start.mockResolvedValue(true)
  bridgeFakes.configure.mockResolvedValue(true)
  bridgeFakes.configureAuthority.mockResolvedValue(true)
  bridgeFakes.configureExperimental.mockResolvedValue(true)
  bridgeFakes.prepareDownload.mockResolvedValue({
    intentId: 'download-intent-0001',
    disposition: 'queued',
    artifacts: []
  })
  bridgeFakes.executePageAction.mockResolvedValue({
    declared: false,
    handled: false,
    adapterId: null
  })
  window.history.replaceState({}, '', '/pip')
})

afterEach(() => {
  for (const runtime of [...activeRuntimes]) stopRuntime(runtime)
  delete document.documentElement.dataset['h5playerWebextContent']
  delete document.documentElement.dataset['h5playerWebextBridge']
  delete document.documentElement.dataset['h5playerWebextBackground']
  delete document.documentElement.dataset['h5playerWebextMedia']
  vi.restoreAllMocks()
})

describe('content runtime picture-in-picture control', () => {
  it('publishes active presence, renews it, and releases it on exit', async () => {
    const pipMedia = createMedia('pip-media', 'active', true)
    const harness = createHarness({ localState: pageState(pipMedia) })
    let now = 100_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')

    const runtime = await startRuntime(harness, pageState(pipMedia))
    await vi.waitFor(() => expect(harness.presence).toHaveLength(1))
    expect(harness.presence[0]).toMatchObject({ state: 'active', mediaId: 'pip-media' })
    await vi.waitFor(() =>
      expect(setIntervalSpy.mock.calls.some(([, timeout]) => timeout === 1_500)).toBe(true)
    )

    const heartbeat = setIntervalSpy.mock.calls.find(([, timeout]) => timeout === 1_500)?.[0]
    now += 1_500
    if (typeof heartbeat === 'function') heartbeat()
    await vi.waitFor(() => expect(harness.presence).toHaveLength(2))
    expect(harness.presence[1]).toMatchObject({ state: 'active', mediaId: 'pip-media' })

    bridgeFakes.getState.mockResolvedValue(
      pageState({ ...pipMedia, presentation: { fullscreen: 'none', pictureInPicture: false } })
    )
    bridgeFakes.state = pageState({
      ...pipMedia,
      presentation: { fullscreen: 'none', pictureInPicture: false }
    })
    // A page state notification is the same signal used by the real bridge after PiP leave.
    const stateListener = bridgeFakes.subscribeState.mock.calls[0]?.[0] as
      ((summary: unknown) => void) | undefined
    stateListener?.({})
    await settle()
    await vi.waitFor(() => expect(harness.presence).toHaveLength(3))
    expect(harness.presence[2]).toMatchObject({ state: 'inactive', mediaId: 'pip-media' })

    stopRuntime(runtime)
  })

  it('routes a remote shortcut to the PiP owner and keeps local media authoritative', async () => {
    const remoteMedia = createMedia('remote-media')
    const expiresAt = Date.now() + 20_000
    const remoteControlState = {
      owner: {
        tabId: 7,
        frameId: 3,
        mediaId: remoteMedia.id,
        state: 'active',
        generation: 9,
        observedAt: Date.now(),
        expiresAt
      },
      state: pageState(remoteMedia)
    }
    const empty = pageState(null)
    const harness = createHarness({ localState: empty, remoteControlState })
    const runtime = await startRuntime(harness, empty)

    await vi.waitFor(() =>
      expect(
        harness.requests.filter((request) => request.type === 'media.picture-in-picture.get-state')
      ).not.toHaveLength(0)
    )
    await settle()
    const event = new KeyboardEvent('keydown', { code: 'KeyC', bubbles: true, cancelable: true })
    window.dispatchEvent(event)
    await vi.waitFor(() => expect(harness.remoteCommands).toHaveLength(1))
    expect(event.defaultPrevented).toBe(true)
    expect(harness.remoteCommands[0]).toMatchObject({
      generation: 9,
      command: { type: 'media.adjust-rate', mediaId: 'remote-media', delta: 0.1 }
    })

    stopRuntime(runtime)

    const localMedia = createMedia('local-media')
    const localHarness = createHarness({ localState: pageState(localMedia), remoteControlState })
    const localRuntime = await startRuntime(localHarness, pageState(localMedia))
    bridgeFakes.execute.mockClear()
    const localEvent = new KeyboardEvent('keydown', {
      code: 'KeyC',
      bubbles: true,
      cancelable: true
    })
    window.dispatchEvent(localEvent)
    await vi.waitFor(() => expect(bridgeFakes.execute).toHaveBeenCalled())
    expect(localHarness.remoteCommands).toHaveLength(0)
    expect(localEvent.defaultPrevented).toBe(true)
    stopRuntime(localRuntime)
  })

  it('does not consume shortcuts for an expired or same-frame owner', async () => {
    const remoteMedia = createMedia('remote-media')
    const expiredState = {
      owner: {
        tabId: 7,
        frameId: 3,
        mediaId: remoteMedia.id,
        state: 'active',
        generation: 2,
        observedAt: 1,
        expiresAt: Date.now() - 1
      },
      state: pageState(remoteMedia)
    }
    const expiredHarness = createHarness({
      localState: pageState(null),
      remoteControlState: expiredState
    })
    const expiredRuntime = await startRuntime(expiredHarness, pageState(null))
    await settle()
    const expiredEvent = new KeyboardEvent('keydown', {
      code: 'KeyC',
      bubbles: true,
      cancelable: true
    })
    window.dispatchEvent(expiredEvent)
    await settle()
    expect(expiredEvent.defaultPrevented).toBe(false)
    expect(expiredHarness.remoteCommands).toHaveLength(0)
    stopRuntime(expiredRuntime)

    const sameFrameState = {
      ...expiredState,
      owner: { ...expiredState.owner, expiresAt: Date.now() + 20_000, tabId: 2, frameId: 0 }
    }
    const sameFrameHarness = createHarness({
      localState: pageState(null),
      remoteControlState: sameFrameState
    })
    const sameFrameRuntime = await startRuntime(sameFrameHarness, pageState(null))
    await settle()
    const sameFrameEvent = new KeyboardEvent('keydown', {
      code: 'KeyC',
      bubbles: true,
      cancelable: true
    })
    window.dispatchEvent(sameFrameEvent)
    await settle()
    expect(sameFrameEvent.defaultPrevented).toBe(false)
    expect(sameFrameHarness.remoteCommands).toHaveLength(0)
    stopRuntime(sameFrameRuntime)
  })

  it('releases an active owner when the content runtime tears down', async () => {
    const pipMedia = createMedia('pip-media', 'active', true)
    const harness = createHarness({ localState: pageState(pipMedia) })
    const runtime = await startRuntime(harness, pageState(pipMedia))
    await vi.waitFor(() => expect(harness.presence).toHaveLength(1))

    stopRuntime(runtime)
    await vi.waitFor(() =>
      expect(
        harness.presence.some(
          (payload) =>
            (payload as { state?: string; mediaId?: string }).state === 'inactive' &&
            (payload as { state?: string; mediaId?: string }).mediaId === 'pip-media'
        )
      ).toBe(true)
    )
  })
})
