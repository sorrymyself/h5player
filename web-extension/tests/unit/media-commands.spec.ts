import { describe, expect, it } from 'vitest'
import { createMediaCommandRegistry } from '../../src/application/commands'
import {
  createMediaCapabilities,
  type MediaCapabilities,
  type MediaController,
  type MediaSnapshot,
  type MediaState
} from '../../src/domain/media'

class FakeMediaController implements MediaController {
  readonly mediaId = 'media-1'
  readonly capabilities: MediaCapabilities
  readonly calls = {
    play: 0,
    pause: 0,
    seeks: [] as number[],
    rates: [] as number[],
    volumes: [] as number[],
    muted: [] as boolean[]
  }

  private current: MediaSnapshot

  constructor(
    metrics: Partial<MediaSnapshot['metrics']> = {},
    state: MediaState = 'paused',
    capabilities: MediaCapabilities = createMediaCapabilities({
      playback: true,
      seek: true,
      playbackRate: true,
      volume: true,
      mute: true
    })
  ) {
    this.capabilities = capabilities
    this.current = {
      id: this.mediaId,
      frameId: 0,
      kind: 'video',
      state,
      metrics: {
        width: 640,
        height: 360,
        duration: 100,
        currentTime: 10,
        volume: 0.5,
        playbackRate: 1,
        muted: false,
        visible: true,
        ...metrics
      },
      capabilities,
      adapterId: 'fake',
      updatedAt: 1
    }
  }

  getSnapshot(): MediaSnapshot {
    return this.current
  }

  play(): Promise<void> {
    this.calls.play += 1
    this.setState('active')
    return Promise.resolve()
  }

  pause(): Promise<void> {
    this.calls.pause += 1
    this.setState('paused')
    return Promise.resolve()
  }

  seekTo(seconds: number): Promise<void> {
    this.calls.seeks.push(seconds)
    this.setMetrics({ currentTime: seconds })
    return Promise.resolve()
  }

  setPlaybackRate(value: number): Promise<void> {
    this.calls.rates.push(value)
    this.setMetrics({ playbackRate: value })
    return Promise.resolve()
  }

  setVolume(value: number): Promise<void> {
    this.calls.volumes.push(value)
    this.setMetrics({ volume: value })
    return Promise.resolve()
  }

  setMuted(value: boolean): Promise<void> {
    this.calls.muted.push(value)
    this.setMetrics({ muted: value })
    return Promise.resolve()
  }

  private setState(state: MediaState): void {
    this.current = { ...this.current, state, updatedAt: this.current.updatedAt + 1 }
  }

  private setMetrics(metrics: Partial<MediaSnapshot['metrics']>): void {
    this.current = {
      ...this.current,
      metrics: { ...this.current.metrics, ...metrics },
      updatedAt: this.current.updatedAt + 1
    }
  }
}

function registry(controller: MediaController) {
  return createMediaCommandRegistry({
    resolve: (mediaId) => (mediaId === controller.mediaId ? controller : undefined)
  })
}

async function successValue(result: ReturnType<ReturnType<typeof registry>['dispatch']>) {
  const resolved = await result
  expect(resolved.ok).toBe(true)
  if (!resolved.ok) throw new Error(resolved.error.code)
  return resolved.value
}

describe('built-in media commands', () => {
  it('plays and pauses idempotently', async () => {
    const controller = new FakeMediaController()
    const commands = registry(controller)

    expect(
      await successValue(commands.dispatch({ type: 'media.play', mediaId: 'media-1' }))
    ).toMatchObject({ changed: true, snapshot: { state: 'active' } })
    expect(
      await successValue(commands.dispatch({ type: 'media.play', mediaId: 'media-1' }))
    ).toMatchObject({ changed: false, snapshot: { state: 'active' } })
    expect(controller.calls.play).toBe(1)

    expect(
      await successValue(commands.dispatch({ type: 'media.pause', mediaId: 'media-1' }))
    ).toMatchObject({ changed: true, snapshot: { state: 'paused' } })
    expect(
      await successValue(commands.dispatch({ type: 'media.pause', mediaId: 'media-1' }))
    ).toMatchObject({ changed: false, snapshot: { state: 'paused' } })
    expect(controller.calls.pause).toBe(1)
  })

  it('serializes commands per media so concurrent idempotent requests execute once', async () => {
    const controller = new FakeMediaController()
    const originalPlay = controller.play.bind(controller)
    let starts = 0
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    controller.play = () => {
      starts += 1
      return gate.then(originalPlay)
    }
    const commands = registry(controller)

    const first = commands.dispatch({ type: 'media.play', mediaId: 'media-1' })
    await Promise.resolve()
    const second = commands.dispatch({ type: 'media.play', mediaId: 'media-1' })
    await Promise.resolve()
    expect(starts).toBe(1)

    release?.()
    const results = await Promise.all([successValue(first), successValue(second)])
    expect(results.map((result) => result.changed)).toEqual([true, false])
    expect(controller.calls.play).toBe(1)
  })

  it('seeks relative to the current position and clamps to media bounds', async () => {
    const controller = new FakeMediaController()
    const commands = registry(controller)

    expect(
      await successValue(
        commands.dispatch({ type: 'media.seek', mediaId: 'media-1', deltaSeconds: 0 })
      )
    ).toMatchObject({ changed: false })
    expect(controller.calls.seeks).toEqual([])

    expect(
      await successValue(
        commands.dispatch({ type: 'media.seek', mediaId: 'media-1', deltaSeconds: -20 })
      )
    ).toMatchObject({ changed: true, snapshot: { metrics: { currentTime: 0 } } })
    expect(
      await successValue(
        commands.dispatch({ type: 'media.seek', mediaId: 'media-1', deltaSeconds: -1 })
      )
    ).toMatchObject({ changed: false })
    await successValue(
      commands.dispatch({ type: 'media.seek', mediaId: 'media-1', deltaSeconds: 500 })
    )
    expect(controller.calls.seeks).toEqual([0, 100])
  })

  it('matches the Legacy seek precision and backward near-zero behavior', async () => {
    const forward = new FakeMediaController({ currentTime: 10.04 })
    await successValue(
      registry(forward).dispatch({
        type: 'media.seek',
        mediaId: 'media-1',
        deltaSeconds: 0.04
      })
    )
    expect(forward.calls.seeks).toEqual([10.1])

    const backward = new FakeMediaController({ currentTime: 1.04 })
    await successValue(
      registry(backward).dispatch({
        type: 'media.seek',
        mediaId: 'media-1',
        deltaSeconds: -0.05
      })
    )
    expect(backward.calls.seeks).toEqual([0])
  })

  it('sets and adjusts playback rate with clamping and stable decimal steps', async () => {
    const controller = new FakeMediaController()
    const commands = registry(controller)

    expect(
      await successValue(
        commands.dispatch({ type: 'media.adjust-rate', mediaId: 'media-1', delta: 0 })
      )
    ).toMatchObject({ changed: false })

    await successValue(
      commands.dispatch({ type: 'media.set-rate', mediaId: 'media-1', value: 100 })
    )
    expect(
      await successValue(
        commands.dispatch({ type: 'media.adjust-rate', mediaId: 'media-1', delta: 1 })
      )
    ).toMatchObject({ changed: false })
    await successValue(commands.dispatch({ type: 'media.set-rate', mediaId: 'media-1', value: 1 }))
    await successValue(
      commands.dispatch({ type: 'media.adjust-rate', mediaId: 'media-1', delta: 0.1 })
    )
    await successValue(
      commands.dispatch({ type: 'media.set-rate', mediaId: 'media-1', value: 1.26 })
    )
    expect(
      await successValue(
        commands.dispatch({ type: 'media.set-rate', mediaId: 'media-1', value: 1.3 })
      )
    ).toMatchObject({ changed: false })
    expect(controller.calls.rates).toEqual([16, 1, 1.1, 1.3])
  })

  it('sets and adjusts volume while preserving bounded values', async () => {
    const controller = new FakeMediaController()
    const commands = registry(controller)

    expect(
      await successValue(
        commands.dispatch({ type: 'media.set-volume', mediaId: 'media-1', value: 0.5 })
      )
    ).toMatchObject({ changed: false })
    expect(
      await successValue(
        commands.dispatch({ type: 'media.adjust-volume', mediaId: 'media-1', delta: 0 })
      )
    ).toMatchObject({ changed: false })

    await successValue(
      commands.dispatch({ type: 'media.set-volume', mediaId: 'media-1', value: -10 })
    )
    expect(
      await successValue(
        commands.dispatch({ type: 'media.adjust-volume', mediaId: 'media-1', delta: -0.1 })
      )
    ).toMatchObject({ changed: false })
    await successValue(
      commands.dispatch({ type: 'media.adjust-volume', mediaId: 'media-1', delta: 0.05 })
    )
    await successValue(
      commands.dispatch({ type: 'media.set-volume', mediaId: 'media-1', value: 0.556 })
    )
    await successValue(
      commands.dispatch({ type: 'media.set-volume', mediaId: 'media-1', value: 10 })
    )
    expect(controller.calls.volumes).toEqual([0, 0.05, 0.56, 1])
  })

  it('unmutes when volume changes, matching Legacy observable behavior', async () => {
    const controller = new FakeMediaController({ muted: true })
    const commands = registry(controller)

    await successValue(
      commands.dispatch({ type: 'media.adjust-volume', mediaId: 'media-1', delta: 0.05 })
    )
    expect(controller.calls.volumes).toEqual([0.55])
    expect(controller.calls.muted).toEqual([false])
  })

  it('supports idempotent mute assignment and explicit toggle semantics', async () => {
    const controller = new FakeMediaController()
    const commands = registry(controller)

    expect(
      await successValue(
        commands.dispatch({ type: 'media.set-muted', mediaId: 'media-1', value: false })
      )
    ).toMatchObject({ changed: false })
    await successValue(
      commands.dispatch({ type: 'media.set-muted', mediaId: 'media-1', value: true })
    )
    expect(
      await successValue(
        commands.dispatch({ type: 'media.set-muted', mediaId: 'media-1', value: true })
      )
    ).toMatchObject({ changed: false })
    await successValue(commands.dispatch({ type: 'media.toggle-mute', mediaId: 'media-1' }))
    await successValue(commands.dispatch({ type: 'media.toggle-mute', mediaId: 'media-1' }))
    expect(controller.calls.muted).toEqual([true, false, true])
  })

  it('does not call controllers for invalid numeric input or denied capabilities', async () => {
    const controller = new FakeMediaController(
      {},
      'paused',
      createMediaCapabilities({ playback: true })
    )
    const commands = registry(controller)
    const invalid = await commands.dispatch({
      type: 'media.set-volume',
      mediaId: 'media-1',
      value: Number.NaN
    })
    const denied = await commands.dispatch({
      type: 'media.set-volume',
      mediaId: 'media-1',
      value: 0.8
    })
    expect(invalid).toMatchObject({ ok: false, error: { code: 'INVALID_COMMAND' } })
    expect(denied).toMatchObject({
      ok: false,
      error: { code: 'CAPABILITY_UNAVAILABLE' }
    })
    expect(controller.calls.volumes).toEqual([])
  })
})
