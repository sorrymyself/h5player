import { describe, expect, it, vi } from 'vitest'
import {
  HotkeyController,
  type HotkeyEventSourcePort,
  type HotkeyRuntimeEvent
} from '../../src/application/hotkeys'
import type { MediaPageState } from '../../src/application/media'
import { createDefaultSettings } from '../../src/domain/settings'

class FakeHotkeySource implements HotkeyEventSourcePort {
  private listener: ((event: HotkeyRuntimeEvent) => void) | null = null

  subscribe(listener: (event: HotkeyRuntimeEvent) => void): () => void {
    this.listener = listener
    return () => {
      this.listener = null
    }
  }

  emit(event: HotkeyRuntimeEvent): void {
    this.listener?.(event)
  }
}

const state: MediaPageState = {
  frameId: 0,
  revision: 1,
  activeMediaId: 'media-0-1',
  observedAt: 1,
  media: [
    {
      id: 'media-0-1',
      frameId: 0,
      kind: 'video',
      state: 'paused',
      metrics: {
        width: 640,
        height: 360,
        duration: 100,
        currentTime: 20,
        volume: 0.5,
        playbackRate: 1,
        muted: false,
        visible: true
      },
      capabilities: {
        playback: true,
        seek: true,
        playbackRate: true,
        volume: true,
        mute: true,
        fullscreen: false,
        pictureInPicture: false,
        capture: false,
        downloadExperimental: false
      },
      adapterId: 'generic',
      updatedAt: 1
    }
  ]
}

function createEvent(
  code: string,
  editableTarget = false,
  trusted: boolean | undefined = undefined
): HotkeyRuntimeEvent {
  return {
    code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    repeat: false,
    isComposing: false,
    editableTarget,
    playerFocused: true,
    ...(trusted === undefined ? {} : { trusted }),
    preventDefault: vi.fn(),
    stopPropagation: vi.fn()
  }
}

describe('HotkeyController', () => {
  it('uses a primed state for a shortcut fired immediately after startup', async () => {
    const source = new FakeHotkeySource()
    const getState = vi.fn().mockResolvedValue(state)
    const execute = vi.fn().mockResolvedValue({ result: { ok: false }, state })
    const controller = new HotkeyController(
      source,
      { getState, execute },
      createDefaultSettings().global
    )

    controller.start(state)
    const event = createEvent('KeyC')
    source.emit(event)

    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledWith({
      type: 'media.adjust-rate',
      mediaId: 'media-0-1',
      delta: 0.1
    })
    expect(getState).toHaveBeenCalledOnce()
  })

  it('executes the first shortcut when a routed media frame appears after cache priming', async () => {
    const source = new FakeHotkeySource()
    const emptyState: MediaPageState = {
      frameId: 0,
      revision: 1,
      activeMediaId: null,
      media: [],
      observedAt: 1
    }
    const getState = vi.fn().mockResolvedValue(state)
    const execute = vi.fn().mockResolvedValue({ result: { ok: false }, state })
    const controller = new HotkeyController(
      source,
      { getState, peekState: () => emptyState, execute },
      createDefaultSettings().global
    )

    controller.start(emptyState)
    source.emit(createEvent('KeyC'))

    await vi.waitFor(() =>
      expect(execute).toHaveBeenCalledWith({
        type: 'media.adjust-rate',
        mediaId: 'media-0-1',
        delta: 0.1
      })
    )
    expect(getState).toHaveBeenCalledOnce()
  })

  it('dispatches typed commands, consumes only matched events, and stops cleanly', async () => {
    const source = new FakeHotkeySource()
    const execute = vi.fn().mockResolvedValue({ result: { ok: false }, state })
    const settings = createDefaultSettings().global
    const controller = new HotkeyController(
      source,
      { getState: vi.fn().mockResolvedValue(state), peekState: () => state, execute },
      settings
    )
    const stop = controller.start()

    const editable = createEvent('Space', true)
    source.emit(editable)
    expect(editable.preventDefault).not.toHaveBeenCalled()

    const matched = createEvent('Space')
    source.emit(matched)
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    expect(matched.preventDefault).toHaveBeenCalledOnce()
    expect(matched.stopPropagation).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledWith({ type: 'media.play', mediaId: 'media-0-1' })

    stop()
    source.emit(createEvent('ArrowRight'))
    await Promise.resolve()
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('serializes rapid repeatable commands and reports asynchronous failures', async () => {
    const source = new FakeHotkeySource()
    let activeExecutions = 0
    let maxExecutions = 0
    const execute = vi.fn().mockImplementation(async () => {
      activeExecutions += 1
      maxExecutions = Math.max(maxExecutions, activeExecutions)
      await Promise.resolve()
      activeExecutions -= 1
      return { result: { ok: false }, state }
    })
    const onError = vi.fn()
    const controller = new HotkeyController(
      source,
      { getState: vi.fn().mockResolvedValue(state), peekState: () => state, execute },
      createDefaultSettings().global,
      onError
    )
    controller.start()

    source.emit(createEvent('ArrowRight'))
    source.emit(createEvent('ArrowRight'))
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2))
    expect(maxExecutions).toBe(1)
    expect(onError).not.toHaveBeenCalled()

    execute.mockRejectedValueOnce(new Error('media failed'))
    source.emit(createEvent('ArrowLeft'))
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce())
  })

  it('does not consume a matched shortcut when the active media lacks the capability', async () => {
    const source = new FakeHotkeySource()
    const execute = vi.fn()
    const controller = new HotkeyController(
      source,
      { getState: vi.fn().mockResolvedValue(state), peekState: () => state, execute },
      createDefaultSettings().global
    )
    controller.start()

    const unsupported = createEvent('Enter')
    source.emit(unsupported)
    await Promise.resolve()

    expect(unsupported.preventDefault).not.toHaveBeenCalled()
    expect(unsupported.stopPropagation).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })

  it('routes Shift+R to the site progress setting without issuing a media command', async () => {
    const source = new FakeHotkeySource()
    const execute = vi.fn()
    const toggleSiteRestoreProgress = vi.fn().mockResolvedValue(undefined)
    const controller = new HotkeyController(
      source,
      {
        getState: vi.fn().mockResolvedValue(state),
        peekState: () => state,
        execute,
        toggleSiteRestoreProgress
      },
      createDefaultSettings().global
    )
    controller.start()

    const event = { ...createEvent('KeyR'), shiftKey: true }
    source.emit(event)

    await vi.waitFor(() => expect(toggleSiteRestoreProgress).toHaveBeenCalledWith('media-0-1'))
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.stopPropagation).toHaveBeenCalledOnce()
    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects a synthetic Shift+D download shortcut before consuming the event', async () => {
    const source = new FakeHotkeySource()
    const execute = vi.fn()
    const downloadState: MediaPageState = {
      ...state,
      media: state.media.map((media) => ({
        ...media,
        capabilities: { ...media.capabilities, downloadExperimental: true }
      }))
    }
    const controller = new HotkeyController(
      source,
      {
        getState: vi.fn().mockResolvedValue(downloadState),
        peekState: () => downloadState,
        execute
      },
      createDefaultSettings().global
    )
    controller.start()

    const synthetic = { ...createEvent('KeyD', false, false), shiftKey: true }
    source.emit(synthetic)
    await Promise.resolve()

    expect(synthetic.preventDefault).not.toHaveBeenCalled()
    expect(synthetic.stopPropagation).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()

    const trusted = { ...createEvent('KeyD', false, true), shiftKey: true }
    source.emit(trusted)
    await vi.waitFor(() =>
      expect(execute).toHaveBeenCalledWith({
        type: 'media.download',
        mediaId: 'media-0-1'
      })
    )
  })

  it('preserves Legacy Z memory and numeric accumulation in the runtime path', async () => {
    vi.useFakeTimers()
    const source = new FakeHotkeySource()
    const initialMedia = state.media[0]
    if (!initialMedia) {
      throw new Error('Expected the hotkey fixture to contain one media item')
    }
    let currentState: MediaPageState = {
      ...state,
      media: [
        {
          ...initialMedia,
          metrics: { ...initialMedia.metrics, playbackRate: 1.7 }
        }
      ]
    }
    const execute = vi.fn().mockImplementation((command: { type: string; value?: number }) => {
      const activeMedia = currentState.media[0]
      if (!activeMedia) {
        throw new Error('Expected the runtime state to contain one media item')
      }
      if (command.type === 'media.set-rate' && command.value !== undefined) {
        currentState = {
          ...currentState,
          revision: currentState.revision + 1,
          media: [
            {
              ...activeMedia,
              metrics: { ...activeMedia.metrics, playbackRate: command.value }
            }
          ]
        }
      }
      return Promise.resolve({ result: { ok: false as const }, state: currentState })
    })
    const controller = new HotkeyController(
      source,
      {
        getState: () => Promise.resolve(currentState),
        peekState: () => currentState,
        execute
      },
      createDefaultSettings().global
    )
    controller.start()

    source.emit(createEvent('KeyZ'))
    await vi.runAllTimersAsync()
    source.emit(createEvent('KeyZ'))
    await vi.runAllTimersAsync()
    source.emit(createEvent('Digit2'))
    await vi.runAllTimersAsync()
    vi.advanceTimersByTime(200)
    source.emit(createEvent('Digit2'))
    await vi.runAllTimersAsync()

    expect(execute).toHaveBeenNthCalledWith(1, {
      type: 'media.set-rate',
      mediaId: 'media-0-1',
      value: 1
    })
    expect(execute).toHaveBeenNthCalledWith(2, {
      type: 'media.set-rate',
      mediaId: 'media-0-1',
      value: 1.7
    })
    expect(execute).toHaveBeenNthCalledWith(3, {
      type: 'media.set-rate',
      mediaId: 'media-0-1',
      value: 2
    })
    expect(execute).toHaveBeenNthCalledWith(4, {
      type: 'media.set-rate',
      mediaId: 'media-0-1',
      value: 4
    })
    vi.useRealTimers()
  })

  it('uses an active remote owner only when local media is unavailable', async () => {
    const source = new FakeHotkeySource()
    const emptyState: MediaPageState = {
      ...state,
      activeMediaId: null,
      media: []
    }
    const remoteState: MediaPageState = {
      ...state,
      media: [],
      activeMediaId: null
    }
    const remoteMedia = state.media[0]
    if (!remoteMedia) throw new Error('Expected a media fixture')
    remoteState.media = [
      {
        ...remoteMedia,
        capabilities: { ...remoteMedia.capabilities, playbackRate: true }
      }
    ]
    remoteState.activeMediaId = remoteMedia.id
    const execute = vi.fn().mockResolvedValue({ result: { ok: true }, state: remoteState })
    const remote = {
      getState: vi.fn().mockResolvedValue({ generation: 4, state: remoteState }),
      peekState: vi.fn().mockReturnValue({ generation: 4, state: remoteState }),
      execute,
      supportsCommand: vi.fn().mockReturnValue(true)
    }
    const controller = new HotkeyController(
      source,
      {
        getState: vi.fn().mockResolvedValue(emptyState),
        peekState: () => emptyState,
        execute: vi.fn(),
        remote
      },
      createDefaultSettings().global
    )
    controller.start(emptyState)

    const event = createEvent('KeyC')
    source.emit(event)
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      type: 'media.adjust-rate',
      mediaId: 'media-0-1',
      delta: 0.1
    })
    expect(execute.mock.calls[0]?.[1]).toBe(4)
    expect(remote.getState).toHaveBeenCalledOnce()
  })

  it('does not consume reserved browser shortcuts for a remote owner', async () => {
    const source = new FakeHotkeySource()
    const emptyState: MediaPageState = { ...state, activeMediaId: null, media: [] }
    const settings = createDefaultSettings().global
    settings.hotkeys.bindings = {
      ...settings.hotkeys.bindings,
      'Ctrl+KeyC': { commandId: 'media.rate-up', disabled: false }
    }
    const execute = vi.fn()
    const controller = new HotkeyController(
      source,
      {
        getState: vi.fn().mockResolvedValue(emptyState),
        peekState: () => emptyState,
        execute,
        remote: {
          getState: vi.fn(),
          peekState: () => ({ generation: 1, state }),
          execute: vi.fn(),
          supportsCommand: () => true
        }
      },
      settings
    )
    controller.start(emptyState)

    const event = { ...createEvent('KeyC'), ctrlKey: true }
    source.emit(event)
    await Promise.resolve()

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })
})
