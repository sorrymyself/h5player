import { describe, expect, it } from 'vitest'
import { createMediaCommandRegistry } from '../../src/application/commands'
import type { MediaCommand } from '../../src/domain/command'
import {
  DEFAULT_VISUAL_STATE,
  cloneVisualState,
  createMediaCapabilities,
  type FullscreenMode,
  type MediaCapabilities,
  type MediaController,
  type MediaPresentationState,
  type MediaSnapshot,
  type VisualState
} from '../../src/domain/media'

function namedError(name: 'NotAllowedError' | 'NotSupportedError'): Error {
  const error = new Error(name)
  error.name = name
  return error
}

class VisualFakeController implements MediaController {
  readonly capabilities: MediaCapabilities
  readonly calls = {
    visual: [] as VisualState[],
    fullscreen: [] as FullscreenMode[],
    pictureInPicture: 0
  }

  fullscreenError: Error | null = null
  pictureInPictureError: Error | null = null
  private visual: VisualState
  private presentation: MediaPresentationState = {
    fullscreen: 'none',
    pictureInPicture: false
  }
  private updatedAt = 1

  constructor(
    readonly mediaId: string,
    capabilities: MediaCapabilities = createMediaCapabilities({
      playback: true,
      visual: true,
      fullscreen: true,
      fullscreenNative: true,
      fullscreenWeb: true,
      pictureInPicture: true
    }),
    visual: VisualState = DEFAULT_VISUAL_STATE
  ) {
    this.capabilities = capabilities
    this.visual = cloneVisualState(visual)
  }

  getSnapshot(): MediaSnapshot {
    return {
      id: this.mediaId,
      frameId: 0,
      kind: 'video',
      state: 'paused',
      metrics: {
        width: 640,
        height: 360,
        duration: 100,
        currentTime: 10,
        volume: 0.5,
        playbackRate: 1,
        muted: false,
        visible: true
      },
      capabilities: this.capabilities,
      visual: this.visual,
      presentation: this.presentation,
      adapterId: 'fake-visual',
      updatedAt: this.updatedAt
    }
  }

  play(): Promise<void> {
    return Promise.resolve()
  }

  pause(): Promise<void> {
    return Promise.resolve()
  }

  seekTo(): Promise<void> {
    return Promise.resolve()
  }

  setPlaybackRate(): Promise<void> {
    return Promise.resolve()
  }

  setVolume(): Promise<void> {
    return Promise.resolve()
  }

  setMuted(): Promise<void> {
    return Promise.resolve()
  }

  setVisualState(state: VisualState): Promise<void> {
    const next = cloneVisualState(state)
    this.calls.visual.push(next)
    this.visual = next
    this.updatedAt += 1
    return Promise.resolve()
  }

  toggleFullscreen(mode: FullscreenMode): Promise<void> {
    this.calls.fullscreen.push(mode)
    if (this.fullscreenError !== null) return Promise.reject(this.fullscreenError)
    this.presentation = {
      ...this.presentation,
      fullscreen: this.presentation.fullscreen === mode ? 'none' : mode
    }
    this.updatedAt += 1
    return Promise.resolve()
  }

  togglePictureInPicture(): Promise<void> {
    this.calls.pictureInPicture += 1
    if (this.pictureInPictureError !== null) return Promise.reject(this.pictureInPictureError)
    this.presentation = {
      ...this.presentation,
      pictureInPicture: !this.presentation.pictureInPicture
    }
    this.updatedAt += 1
    return Promise.resolve()
  }
}

function registry(...controllers: readonly VisualFakeController[]) {
  return createMediaCommandRegistry({
    resolve: (mediaId) => controllers.find((controller) => controller.mediaId === mediaId)
  })
}

async function successValue(result: ReturnType<ReturnType<typeof registry>['dispatch']>) {
  const resolved = await result
  expect(resolved.ok).toBe(true)
  if (!resolved.ok) throw new Error(resolved.error.code)
  return resolved.value
}

describe('visual and presentation media commands', () => {
  it('isolates zoom, pan, rotation, flip and filter state by media session', async () => {
    const first = new VisualFakeController('media-first')
    const second = new VisualFakeController('media-second')
    const commands = registry(first, second)

    const sequence: readonly MediaCommand[] = [
      { type: 'media.set-zoom', mediaId: first.mediaId, value: 1.5 },
      { type: 'media.pan', mediaId: first.mediaId, deltaX: 20, deltaY: -10 },
      { type: 'media.rotate', mediaId: first.mediaId, deltaDegrees: 450 },
      { type: 'media.toggle-flip', mediaId: first.mediaId, axis: 'horizontal' },
      {
        type: 'media.set-filter',
        mediaId: first.mediaId,
        filter: 'brightness',
        value: 1.25
      }
    ]
    for (const command of sequence) await successValue(commands.dispatch(command))

    expect(first.getSnapshot().visual).toMatchObject({
      zoom: 1.5,
      pan: { x: 20, y: -10 },
      rotation: 90,
      flip: { horizontal: true, vertical: false },
      filters: { brightness: 1.25 }
    })
    expect(second.getSnapshot().visual).toEqual(DEFAULT_VISUAL_STATE)
    expect(second.calls.visual).toEqual([])
  })

  it('resets all visual properties with one atomic controller update', async () => {
    const modified = {
      ...DEFAULT_VISUAL_STATE,
      zoom: 2,
      pan: { x: 30, y: 40 },
      rotation: 180,
      flip: { horizontal: true, vertical: true },
      filters: { ...DEFAULT_VISUAL_STATE.filters, contrast: 1.5, blur: 4 }
    }
    const controller = new VisualFakeController('media-reset', undefined, modified)
    const commands = registry(controller)

    expect(
      await successValue(
        commands.dispatch({ type: 'media.reset-visual', mediaId: controller.mediaId })
      )
    ).toMatchObject({ changed: true, snapshot: { visual: DEFAULT_VISUAL_STATE } })
    expect(controller.calls.visual).toEqual([DEFAULT_VISUAL_STATE])

    expect(
      await successValue(
        commands.dispatch({ type: 'media.reset-visual', mediaId: controller.mediaId })
      )
    ).toMatchObject({ changed: false })
    expect(controller.calls.visual).toHaveLength(1)
  })

  it('gates each fullscreen mode and returns structured native failures', async () => {
    const controller = new VisualFakeController(
      'media-fullscreen',
      createMediaCapabilities({
        playback: true,
        fullscreen: true,
        fullscreenNative: false,
        fullscreenWeb: true
      })
    )
    const commands = registry(controller)

    await expect(
      commands.dispatch({
        type: 'media.toggle-fullscreen',
        mediaId: controller.mediaId,
        mode: 'native'
      })
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'CAPABILITY_UNAVAILABLE',
        context: { capability: 'fullscreenNative', mode: 'native' }
      }
    })
    expect(controller.calls.fullscreen).toEqual([])

    await successValue(
      commands.dispatch({
        type: 'media.toggle-fullscreen',
        mediaId: controller.mediaId,
        mode: 'web'
      })
    )
    expect(controller.getSnapshot().presentation?.fullscreen).toBe('web')

    controller.fullscreenError = namedError('NotAllowedError')
    await expect(
      commands.dispatch({
        type: 'media.toggle-fullscreen',
        mediaId: controller.mediaId,
        mode: 'web'
      })
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'COMMAND_EXECUTION_FAILED',
        context: {
          phase: 'fullscreen',
          mode: 'web',
          cause: 'NotAllowedError'
        }
      }
    })
  })

  it('capability-gates PiP and preserves a structured operation failure', async () => {
    const denied = new VisualFakeController(
      'media-pip-denied',
      createMediaCapabilities({ playback: true, pictureInPicture: false })
    )
    await expect(
      registry(denied).dispatch({
        type: 'media.toggle-picture-in-picture',
        mediaId: denied.mediaId
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'CAPABILITY_UNAVAILABLE', context: { capability: 'pictureInPicture' } }
    })
    expect(denied.calls.pictureInPicture).toBe(0)

    const failing = new VisualFakeController('media-pip-failing')
    failing.pictureInPictureError = namedError('NotSupportedError')
    await expect(
      registry(failing).dispatch({
        type: 'media.toggle-picture-in-picture',
        mediaId: failing.mediaId
      })
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'COMMAND_EXECUTION_FAILED',
        context: { phase: 'picture-in-picture', cause: 'NotSupportedError' }
      }
    })
  })

  it('rejects malformed visual input and capability-gates capture', async () => {
    const controller = new VisualFakeController('media-invalid')
    const commands = registry(controller)

    await expect(
      commands.dispatch({
        type: 'media.set-filter',
        mediaId: controller.mediaId,
        filter: 'arbitrary',
        value: 1
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_COMMAND' } })
    await expect(
      commands.dispatch({ type: 'media.capture', mediaId: controller.mediaId })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'CAPABILITY_UNAVAILABLE', context: { capability: 'capture' } }
    })
    expect(controller.calls.visual).toEqual([])
  })
})
