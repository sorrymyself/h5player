import { describe, expect, it, vi } from 'vitest'
import type { MediaCommandResultResponse, MediaPageState } from '../../src/application/media'
import type { MediaCommand } from '../../src/domain/command'
import { createMediaCapabilities, type MediaSnapshot } from '../../src/domain/media'
import { createOverlayEvent, type OverlayEvent } from '../../src/ui/overlay'
import { ContentOverlayController } from '../../src/runtime/content/content-overlay-controller'
import type { ContentRuntimeSnapshot } from '../../src/runtime/content/content-runtime'

function snapshot(overrides: Partial<MediaSnapshot> = {}): MediaSnapshot {
  return {
    id: 'media-0-1',
    frameId: 0,
    kind: 'video',
    state: 'paused',
    metrics: {
      width: 1_280,
      height: 720,
      duration: 100,
      currentTime: 30,
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
      mute: true,
      visual: true,
      fullscreen: true,
      fullscreenNative: true,
      fullscreenWeb: true,
      pictureInPicture: true,
      capture: true
    }),
    visual: {
      zoom: 1,
      pan: { x: 0, y: 0 },
      rotation: 0,
      flip: { horizontal: false, vertical: false },
      filters: { brightness: 1, contrast: 1, saturation: 1, hue: 0, blur: 0 }
    },
    presentation: { fullscreen: 'none', pictureInPicture: false },
    adapterId: 'generic',
    updatedAt: 100,
    ...overrides
  }
}

function pageState(media: MediaSnapshot = snapshot()): MediaPageState {
  return {
    frameId: 0,
    revision: 1,
    activeMediaId: media.id,
    media: [media],
    observedAt: media.updatedAt
  }
}

function runtimeState(mediaState: MediaPageState | null = pageState()): ContentRuntimeSnapshot {
  return {
    ready: true,
    mediaReady: true,
    siteEnabled: true,
    temporaryDisabled: false,
    pageUiHidden: false,
    hiddenMediaCount: 0,
    settings: {
      enabled: true,
      ui: { overlayEnabled: true, theme: 'system', locale: 'zh-CN' },
      hotkeys: { enabled: true, scope: 'page', bindings: {} },
      media: { defaultPlaybackRate: 1, defaultVolume: 1, restoreProgress: false },
      download: { enabled: true },
      policies: {
        protectPlaybackRate: true,
        protectCurrentTime: false,
        protectVolume: true,
        allowExperimental: false
      },
      diagnostics: { localLogLevel: 'error', retainProgressDays: 30 }
    },
    mediaState,
    playbackPolicies: {}
  }
}

function success(
  commandType: MediaCommand['type'],
  media: MediaSnapshot = snapshot(),
  artifact = commandType === 'media.capture'
    ? {
        mimeType: 'image/png' as const,
        width: 1,
        height: 1,
        byteLength: 3,
        dataBase64: 'AQID'
      }
    : undefined
): MediaCommandResultResponse {
  const response: MediaCommandResultResponse = {
    result: {
      ok: true,
      value: {
        commandType,
        mediaId: media.id,
        changed: commandType !== 'media.capture',
        snapshot: media,
        ...(artifact === undefined ? {} : { artifact })
      }
    },
    state: pageState(media)
  }
  return response
}

type ExecuteMediaCommand = (command: MediaCommand) => Promise<MediaCommandResultResponse>

function harness(
  execute = vi.fn<ExecuteMediaCommand>(),
  options: {
    runtime?: ContentRuntimeSnapshot | null
    getMediaState?: () => Promise<MediaPageState>
  } = {}
) {
  const models: ReturnType<ContentOverlayController['currentModel']>[] = []
  const downloadCapture = vi.fn()
  const controller = new ContentOverlayController({
    media: {
      getMediaState: options.getMediaState ?? (() => Promise.resolve(pageState())),
      executeMediaCommand: execute
    },
    downloadCapture,
    resolveTheme: () => 'dark',
    onModelChanged: (model) => models.push(model)
  })
  if (options.runtime !== null) controller.updateRuntime(options.runtime ?? runtimeState())
  return { controller, execute, downloadCapture, models }
}

describe('content overlay controller', () => {
  it('maps runtime state to an isolated serializable view model', () => {
    const { controller } = harness()
    expect(controller.currentModel()).toMatchObject({
      open: true,
      locale: 'zh-CN',
      theme: 'dark',
      state: 'ready',
      media: { id: 'media-0-1', currentTimeSeconds: 30, zoom: 1 },
      capabilities: { visual: true, capture: true, download: false }
    })
  })

  it('converts absolute seek and zoom intents to typed media commands', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(success('media.seek'))
      .mockResolvedValueOnce(success('media.seek'))
    const { controller } = harness(execute)

    await controller.handle(
      createOverlayEvent({
        type: 'media.seek-to',
        mediaId: 'media-0-1',
        valueSeconds: 42,
        source: 'control'
      })
    )
    await controller.handle(
      createOverlayEvent({
        type: 'visual.adjust-zoom',
        mediaId: 'media-0-1',
        delta: 0.1,
        source: 'control'
      })
    )

    expect(execute.mock.calls[0]?.[0]).toEqual({
      type: 'media.seek',
      mediaId: 'media-0-1',
      deltaSeconds: 12
    })
    expect(execute.mock.calls[1]?.[0]).toEqual({
      type: 'media.set-zoom',
      mediaId: 'media-0-1',
      value: 1.1
    })
  })

  it('falls back from native to web fullscreen only when entering fullscreen', async () => {
    const unavailable: MediaCommandResultResponse = {
      result: {
        ok: false,
        error: {
          code: 'COMMAND_EXECUTION_FAILED',
          messageKey: 'command.error.executionFailed'
        }
      },
      state: pageState()
    }
    const execute = vi
      .fn()
      .mockResolvedValueOnce(unavailable)
      .mockResolvedValueOnce(success('media.toggle-fullscreen'))
    const { controller } = harness(execute)

    await controller.handle(
      createOverlayEvent({
        type: 'display.toggle-fullscreen',
        mediaId: 'media-0-1',
        source: 'control'
      })
    )

    const calls = execute.mock.calls as Array<[MediaCommand]>
    expect(calls.map((call) => call[0])).toEqual([
      { type: 'media.toggle-fullscreen', mediaId: 'media-0-1', mode: 'native' },
      { type: 'media.toggle-fullscreen', mediaId: 'media-0-1', mode: 'web' }
    ])
  })

  it('downloads capture artifacts and keeps dismiss state session-only', async () => {
    const execute = vi.fn().mockResolvedValue(success('media.capture'))
    const { controller, downloadCapture } = harness(execute)
    const capture: OverlayEvent = createOverlayEvent({
      type: 'capture.request',
      mediaId: 'media-0-1',
      source: 'control'
    })

    await controller.handle(capture)
    expect(downloadCapture).toHaveBeenCalledWith(expect.objectContaining({ dataBase64: 'AQID' }))
    expect(controller.currentModel().notice).toMatchObject({ tone: 'success' })

    await controller.handle(createOverlayEvent({ type: 'overlay.close', source: 'control' }))
    controller.updateRuntime(runtimeState())
    expect(controller.currentModel().open).toBe(false)
  })

  it('renders capture policy failures without exposing diagnostic context', async () => {
    const execute = vi.fn().mockResolvedValue({
      result: {
        ok: false,
        error: {
          code: 'CAPTURE_BLOCKED',
          messageKey: 'capture.error.blocked',
          context: { mediaId: 'media-0-1', source: 'https://private.example/token' }
        }
      },
      state: pageState()
    })
    const { controller } = harness(execute)

    await controller.handle(
      createOverlayEvent({ type: 'capture.request', mediaId: 'media-0-1', source: 'control' })
    )
    expect(controller.currentModel().notice?.message).toMatch(/跨域|受保护/)
    expect(JSON.stringify(controller.currentModel())).not.toContain('private.example')
  })

  it('covers localized media labels and playback presentation states', () => {
    const active = snapshot({ kind: 'audio', state: 'active' })
    const { controller } = harness(undefined, {
      runtime: {
        ...runtimeState(pageState(active)),
        settings: {
          ...runtimeState().settings,
          ui: { overlayEnabled: true, theme: 'system', locale: 'en-US' }
        }
      }
    })
    expect(controller.currentModel().media).toMatchObject({
      label: 'Active audio',
      playbackState: 'playing'
    })

    const ended = snapshot({
      kind: 'custom-video',
      state: 'paused',
      metrics: { ...active.metrics, currentTime: 99.9 }
    })
    controller.updateRuntime(runtimeState(pageState(ended)))
    expect(controller.currentModel().media).toMatchObject({
      label: '当前站点视频',
      playbackState: 'ended'
    })

    const buffering = snapshot({ state: 'discovered' })
    controller.updateRuntime(runtimeState(pageState(buffering)))
    expect(controller.currentModel().media?.playbackState).toBe('buffering')
  })

  it('maps loading, empty, unsupported, disabled, and bridge error states', () => {
    const { controller } = harness(undefined, { runtime: null })
    expect(controller.currentModel()).toMatchObject({ open: false, state: 'loading' })

    controller.updateRuntime(
      runtimeState({
        frameId: 0,
        revision: 2,
        activeMediaId: null,
        media: [],
        observedAt: 101
      })
    )
    expect(controller.currentModel()).toMatchObject({ open: true, state: 'empty', media: null })

    controller.updateRuntime(runtimeState(pageState(snapshot({ state: 'error' }))))
    expect(controller.currentModel().state).toBe('unsupported')

    controller.updateRuntime({ ...runtimeState(), temporaryDisabled: true })
    expect(controller.currentModel().open).toBe(false)

    controller.updateRuntime({ ...runtimeState(), mediaReady: false })
    expect(controller.currentModel()).toMatchObject({ open: true, state: 'error' })
    expect(controller.currentModel().statusDetail).toMatch(/桥接|bridge/i)
  })

  it('handles retry, stale events, and experimental download intent', async () => {
    const getMediaState = vi.fn().mockResolvedValue(pageState())
    const { controller } = harness(undefined, { getMediaState })
    await controller.handle({
      version: 999 as never,
      intent: { type: 'overlay.retry', source: 'control' } as never
    })
    expect(getMediaState).not.toHaveBeenCalled()

    await controller.handle(createOverlayEvent({ type: 'overlay.retry', source: 'control' }))
    expect(getMediaState).toHaveBeenCalledTimes(1)

    const execute = vi.fn<ExecuteMediaCommand>().mockResolvedValue(success('media.play'))
    const retryFailure = vi.fn().mockRejectedValue(new Error('offline'))
    const failed = harness(execute, { getMediaState: retryFailure })
    await failed.controller.handle(createOverlayEvent({ type: 'overlay.retry', source: 'control' }))
    expect(failed.controller.currentModel().notice?.tone).toBe('warning')

    await controller.handle(
      createOverlayEvent({ type: 'download.request', mediaId: 'media-0-1', source: 'control' })
    )
    expect(execute).not.toHaveBeenCalled()

    const downloadMedia = snapshot({
      capabilities: createMediaCapabilities({
        playback: true,
        seek: true,
        playbackRate: true,
        volume: true,
        mute: true,
        visual: true,
        fullscreen: true,
        fullscreenNative: true,
        fullscreenWeb: true,
        pictureInPicture: true,
        capture: true,
        downloadExperimental: true
      })
    })
    const downloadExecute = vi
      .fn<ExecuteMediaCommand>()
      .mockResolvedValue(success('media.download', downloadMedia))
    const downloadHarness = harness(downloadExecute, {
      runtime: {
        ...runtimeState(pageState(downloadMedia)),
        settings: {
          ...runtimeState().settings,
          policies: { ...runtimeState().settings.policies, allowExperimental: true }
        }
      }
    })
    await downloadHarness.controller.handle(
      createOverlayEvent({ type: 'download.request', mediaId: 'media-0-1', source: 'control' })
    )
    expect(downloadExecute).toHaveBeenCalledWith({ type: 'media.download', mediaId: 'media-0-1' })
    expect(downloadHarness.controller.currentModel().notice?.message).toMatch(/下载|download/i)
  })

  it('maps every supported overlay media intent and clamps visual zoom', async () => {
    const visual = snapshot().visual
    if (visual === undefined) throw new Error('visual fixture missing')
    const execute = vi
      .fn<ExecuteMediaCommand>()
      .mockImplementation((command) =>
        Promise.resolve(success(command.type, snapshot({ visual: { ...visual, zoom: 1 } })))
      )
    const { controller } = harness(execute)
    const intents = [
      { type: 'media.play', mediaId: 'media-0-1', source: 'control' },
      { type: 'media.pause', mediaId: 'media-0-1', source: 'shortcut' },
      { type: 'media.seek', mediaId: 'media-0-1', deltaSeconds: -5, source: 'shortcut' },
      { type: 'media.set-rate', mediaId: 'media-0-1', value: 1.5, source: 'control' },
      { type: 'media.set-volume', mediaId: 'media-0-1', value: 0.2, source: 'control' },
      { type: 'media.toggle-mute', mediaId: 'media-0-1', source: 'control' },
      { type: 'visual.reset', mediaId: 'media-0-1', source: 'control' },
      { type: 'display.toggle-picture-in-picture', mediaId: 'media-0-1', source: 'shortcut' },
      { type: 'visual.adjust-zoom', mediaId: 'media-0-1', delta: 99, source: 'control' }
    ] as const
    for (const intent of intents) await controller.handle(createOverlayEvent(intent))
    expect(execute).toHaveBeenCalledTimes(intents.length)
    expect(execute.mock.calls.map(([command]) => command.type)).toEqual([
      'media.play',
      'media.pause',
      'media.seek',
      'media.set-rate',
      'media.set-volume',
      'media.toggle-mute',
      'media.reset-visual',
      'media.toggle-picture-in-picture',
      'media.set-zoom'
    ])
    expect(execute.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'media.set-zoom', value: 4 })
  })

  it('ignores duplicate busy controls and reports missing media/runtime failures', async () => {
    let resolve!: (response: MediaCommandResultResponse) => void
    const execute = vi
      .fn<ExecuteMediaCommand>()
      .mockImplementation(() => new Promise<MediaCommandResultResponse>((done) => (resolve = done)))
    const { controller } = harness(execute)
    const event = createOverlayEvent({
      type: 'media.play',
      mediaId: 'media-0-1',
      source: 'control'
    })
    const first = controller.handle(event)
    const second = controller.handle(event)
    expect(execute).toHaveBeenCalledTimes(1)
    resolve(success('media.play'))
    await Promise.all([first, second])

    await controller.handle(
      createOverlayEvent({ type: 'media.play', mediaId: 'missing-media', source: 'control' })
    )
    expect(controller.currentModel().notice?.message).toMatch(/不可用|unavailable/)
  })

  it('renders all command failures and isolates download errors', async () => {
    const codes = [
      'CAPTURE_NOT_READY',
      'CAPTURE_BLOCKED',
      'CAPTURE_TOO_LARGE',
      'CAPABILITY_UNAVAILABLE',
      'COMMAND_EXECUTION_FAILED'
    ] as const
    for (const code of codes) {
      const execute = vi.fn<ExecuteMediaCommand>().mockResolvedValue({
        result: { ok: false, error: { code, messageKey: 'command.error.executionFailed' } },
        state: pageState()
      })
      const { controller } = harness(execute)
      await controller.handle(
        createOverlayEvent({ type: 'capture.request', mediaId: 'media-0-1', source: 'control' })
      )
      expect(controller.currentModel().notice?.tone).toBe('warning')
    }

    const execute = vi.fn<ExecuteMediaCommand>().mockResolvedValue(success('media.capture'))
    const { controller } = harness(execute)
    const failingDownload = new ContentOverlayController({
      media: { getMediaState: () => Promise.resolve(pageState()), executeMediaCommand: execute },
      downloadCapture: () => {
        throw new Error('download failed')
      },
      resolveTheme: () => 'dark',
      onModelChanged: () => undefined
    })
    failingDownload.updateRuntime(runtimeState())
    await failingDownload.handle(
      createOverlayEvent({ type: 'capture.request', mediaId: 'media-0-1', source: 'control' })
    )
    expect(failingDownload.currentModel().notice?.message).toMatch(/下载失败|download failed/i)
    expect(controller.currentModel().state).toBe('ready')
  })

  it('handles fullscreen capability fallback and failure without stale notices', async () => {
    const unavailable: MediaCommandResultResponse = {
      result: {
        ok: false,
        error: { code: 'CAPABILITY_UNAVAILABLE', messageKey: 'command.error.capabilityUnavailable' }
      },
      state: pageState()
    }
    const execute = vi.fn<ExecuteMediaCommand>().mockResolvedValue(unavailable)
    const { controller } = harness(execute)
    await controller.handle(
      createOverlayEvent({
        type: 'display.toggle-fullscreen',
        mediaId: 'media-0-1',
        source: 'control'
      })
    )
    expect(execute).toHaveBeenCalledTimes(2)
    expect(controller.currentModel().notice?.tone).toBe('warning')

    const exiting = snapshot({ presentation: { fullscreen: 'web', pictureInPicture: false } })
    const exitExecute = vi
      .fn<ExecuteMediaCommand>()
      .mockResolvedValue(success('media.toggle-fullscreen', exiting))
    const exitHarness = harness(exitExecute)
    exitHarness.controller.updateRuntime(runtimeState(pageState(exiting)))
    await exitHarness.controller.handle(
      createOverlayEvent({
        type: 'display.toggle-fullscreen',
        mediaId: 'media-0-1',
        source: 'control'
      })
    )
    expect(exitExecute.mock.calls[0]?.[0]).toMatchObject({ mode: 'web' })
  })
})
