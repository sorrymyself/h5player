import * as z from 'zod/mini'
import { describe, expect, it } from 'vitest'
import { createMediaCommandRegistry } from '../../src/application/commands'
import { mediaCommandSchema } from '../../src/domain/command'
import {
  createMediaCapabilities,
  type MediaCapabilities,
  type MediaController,
  type MediaSnapshot,
  type MediaState
} from '../../src/domain/media'
import legacyOracleSource from '../baselines/legacy-core-media.json'
import legacyUserscript from '../baselines/legacy-userscript.json'

const initialSchema = z.strictObject({
  state: z.optional(z.enum(['paused', 'active'])),
  currentTime: z.optional(z.number().check(z.nonnegative())),
  duration: z.optional(z.nullable(z.number().check(z.nonnegative()))),
  volume: z.optional(z.number().check(z.gte(0), z.lte(1))),
  playbackRate: z.optional(z.number().check(z.gte(0.1), z.lte(16))),
  muted: z.optional(z.boolean())
})

const expectedSchema = z.strictObject({
  changed: z.boolean(),
  state: z.optional(z.enum(['paused', 'active'])),
  currentTime: z.optional(z.number().check(z.nonnegative())),
  volume: z.optional(z.number().check(z.gte(0), z.lte(1))),
  playbackRate: z.optional(z.number().check(z.gte(0.1), z.lte(16))),
  muted: z.optional(z.boolean())
})

const legacyOracleSchema = z.strictObject({
  legacyReleaseCommit: z.string().check(z.minLength(7)),
  legacyArtifactSha256: z.string().check(z.length(64)),
  sources: z.array(z.string().check(z.minLength(1))),
  cases: z.array(
    z.strictObject({
      id: z.string().check(z.minLength(1)),
      initial: initialSchema,
      command: mediaCommandSchema,
      expected: expectedSchema
    })
  )
})

const legacyOracle = legacyOracleSchema.parse(legacyOracleSource)

class DifferentialMediaController implements MediaController {
  readonly mediaId = 'media-1'
  readonly capabilities: MediaCapabilities = createMediaCapabilities({
    playback: true,
    seek: true,
    playbackRate: true,
    volume: true,
    mute: true
  })

  private snapshot: MediaSnapshot

  constructor(initial: z.infer<typeof initialSchema>) {
    this.snapshot = {
      id: this.mediaId,
      frameId: 0,
      kind: 'video',
      state: initial.state ?? 'paused',
      metrics: {
        width: 640,
        height: 360,
        duration: initial.duration ?? 100,
        currentTime: initial.currentTime ?? 10,
        volume: initial.volume ?? 0.5,
        playbackRate: initial.playbackRate ?? 1,
        muted: initial.muted ?? false,
        visible: true
      },
      capabilities: this.capabilities,
      adapterId: 'legacy-differential-fixture',
      updatedAt: 1
    }
  }

  getSnapshot(): MediaSnapshot {
    return this.snapshot
  }

  play(): Promise<void> {
    this.setState('active')
    return Promise.resolve()
  }

  pause(): Promise<void> {
    this.setState('paused')
    return Promise.resolve()
  }

  seekTo(seconds: number): Promise<void> {
    this.setMetrics({ currentTime: seconds })
    return Promise.resolve()
  }

  setPlaybackRate(value: number): Promise<void> {
    this.setMetrics({ playbackRate: value })
    return Promise.resolve()
  }

  setVolume(value: number): Promise<void> {
    this.setMetrics({ volume: value })
    return Promise.resolve()
  }

  setMuted(value: boolean): Promise<void> {
    this.setMetrics({ muted: value })
    return Promise.resolve()
  }

  private setState(state: MediaState): void {
    this.snapshot = { ...this.snapshot, state, updatedAt: this.snapshot.updatedAt + 1 }
  }

  private setMetrics(metrics: Partial<MediaSnapshot['metrics']>): void {
    this.snapshot = {
      ...this.snapshot,
      metrics: { ...this.snapshot.metrics, ...metrics },
      updatedAt: this.snapshot.updatedAt + 1
    }
  }
}

describe('Legacy core media differential oracle', () => {
  it('is tied to the frozen Legacy release artifact', () => {
    expect(legacyOracle.legacyReleaseCommit).toBe(legacyUserscript.legacyReleaseCommit)
    expect(legacyOracle.legacyArtifactSha256).toBe(legacyUserscript.sha256)
    expect(new Set(legacyOracle.cases.map((entry) => entry.id)).size).toBe(
      legacyOracle.cases.length
    )
  })

  it.each(legacyOracle.cases)('$id', async ({ initial, command, expected }) => {
    const controller = new DifferentialMediaController(initial)
    const registry = createMediaCommandRegistry({
      resolve: (mediaId) => (mediaId === controller.mediaId ? controller : undefined)
    })

    const result = await registry.execute(command)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.code)

    const actual = result.value.snapshot
    expect(result.value.changed).toBe(expected.changed)
    if (expected.state !== undefined) expect(actual.state).toBe(expected.state)
    if (expected.currentTime !== undefined) {
      expect(actual.metrics.currentTime).toBe(expected.currentTime)
    }
    if (expected.volume !== undefined) expect(actual.metrics.volume).toBe(expected.volume)
    if (expected.playbackRate !== undefined) {
      expect(actual.metrics.playbackRate).toBe(expected.playbackRate)
    }
    if (expected.muted !== undefined) expect(actual.metrics.muted).toBe(expected.muted)
  })
})
