import { describe, expect, it } from 'vitest'
import {
  MediaFeedbackStore,
  createPlaybackPolicyFeedbackEvent,
  createMediaFeedbackEvent,
  createRestoreProgressFeedbackEvent,
  retargetMediaFeedbackEvent
} from '../../src/application/feedback'
import type { MediaCommandResultResponse } from '../../src/application/media'
import { createMediaCapabilities, type MediaSnapshot } from '../../src/domain/media'

function snapshot(rate = 1.5): MediaSnapshot {
  return {
    id: 'media-0-1',
    frameId: 0,
    kind: 'video',
    state: 'active',
    metrics: {
      width: 640,
      height: 360,
      duration: 120,
      currentTime: 30,
      volume: 0.75,
      playbackRate: rate,
      muted: false,
      visible: true
    },
    capabilities: createMediaCapabilities({ playback: true, playbackRate: true }),
    adapterId: 'generic',
    updatedAt: 10
  }
}

function success(media = snapshot()): MediaCommandResultResponse {
  return {
    result: {
      ok: true,
      value: {
        commandType: 'media.set-rate',
        mediaId: media.id,
        changed: true,
        snapshot: media
      }
    },
    state: {
      frameId: 0,
      revision: 1,
      activeMediaId: media.id,
      media: [media],
      observedAt: 10
    }
  }
}

describe('media feedback', () => {
  it('uses the final command snapshot value and a bounded visible window', () => {
    const event = createMediaFeedbackEvent({
      command: { type: 'media.set-rate', mediaId: 'media-0-1', value: 3 },
      response: success(snapshot(1.75)),
      source: 'shortcut',
      now: 100,
      durationMs: 99_999
    })
    expect(event).toMatchObject({
      mediaId: 'media-0-1',
      kind: 'value',
      messageKey: 'feedback.playback-rate',
      value: 1.75,
      source: 'shortcut',
      expiresAt: 2_100
    })
  })

  it('maps failures to per-media error feedback without leaking diagnostic context', () => {
    const response: MediaCommandResultResponse = {
      ...success(),
      result: {
        ok: false,
        error: {
          code: 'CAPABILITY_UNAVAILABLE',
          messageKey: 'command.error.capabilityUnavailable',
          context: { privateUrl: 'https://secret.example/token' }
        }
      }
    }
    const event = createMediaFeedbackEvent({
      command: { type: 'media.set-rate', mediaId: 'media-0-1', value: 2 },
      response,
      source: 'overlay',
      now: 10
    })
    expect(event).toMatchObject({ kind: 'error', tone: 'danger' })
    expect(JSON.stringify(event)).not.toContain('secret.example')
  })

  it('uses dedicated feedback for frame, visual, reset, and next actions', () => {
    const visualSnapshot: MediaSnapshot = {
      ...snapshot(),
      visual: {
        zoom: 1.2,
        pan: { x: 20, y: -10 },
        rotation: 90,
        flip: { horizontal: true, vertical: false },
        filters: { brightness: 1.1, contrast: 1, saturation: 1, hue: 0, blur: 0 }
      }
    }
    const commands = [
      { type: 'media.step-frame', mediaId: 'media-0-1', frames: -1 } as const,
      { type: 'media.pan', mediaId: 'media-0-1', deltaX: 10, deltaY: 0 } as const,
      {
        type: 'media.toggle-flip',
        mediaId: 'media-0-1',
        axis: 'horizontal'
      } as const,
      {
        type: 'media.set-filter',
        mediaId: 'media-0-1',
        filter: 'brightness',
        value: 1.1
      } as const,
      { type: 'media.reset-transform', mediaId: 'media-0-1' } as const,
      { type: 'media.reset-visual', mediaId: 'media-0-1' } as const,
      { type: 'media.play-next', mediaId: 'media-0-1' } as const
    ]

    expect(
      commands.map(
        (command) =>
          createMediaFeedbackEvent({
            command,
            response: success(visualSnapshot),
            source: 'shortcut',
            now: 100
          }).messageKey
      )
    ).toEqual([
      'feedback.frame-step',
      'feedback.pan',
      'feedback.flip-horizontal',
      'feedback.filter-brightness',
      'feedback.transform-reset',
      'feedback.visual-reset',
      'feedback.play-next'
    ])
  })

  it('reports per-site progress restore state without exposing settings internals', () => {
    expect(
      createRestoreProgressFeedbackEvent({ mediaId: 'media-0-1', enabled: true, now: 10 })
    ).toMatchObject({
      commandId: 'settings.restore-progress',
      messageKey: 'feedback.restore-progress-enabled',
      value: true,
      source: 'shortcut'
    })
    expect(
      createRestoreProgressFeedbackEvent({ mediaId: 'media-0-1', failed: true, now: 20 })
    ).toMatchObject({
      kind: 'error',
      messageKey: 'feedback.restore-progress-failed',
      tone: 'danger'
    })
  })

  it('replaces feedback per media and expires it without stacking', () => {
    const store = new MediaFeedbackStore()
    const first = createMediaFeedbackEvent({
      command: { type: 'media.set-rate', mediaId: 'media-0-1', value: 1.5 },
      response: success(snapshot(1.5)),
      source: 'overlay',
      now: 10
    })
    const latest = createMediaFeedbackEvent({
      command: { type: 'media.set-rate', mediaId: 'media-0-1', value: 2 },
      response: success(snapshot(2)),
      source: 'overlay',
      now: 20
    })
    store.push(first)
    store.push(latest)
    expect(store.current('media-0-1', 30)).toEqual(latest)
    expect(store.current('media-0-1', latest.expiresAt)).toBeNull()
  })

  it('moves a live feedback event to a replacement media id without extending its expiry', () => {
    const store = new MediaFeedbackStore()
    const event = createMediaFeedbackEvent({
      command: { type: 'media.set-rate', mediaId: 'media-14-tencent-viewport', value: 2 },
      response: success(snapshot(2)),
      source: 'shortcut',
      now: 100
    })
    store.push(event)

    const moved = store.move('media-14-tencent-viewport', 'media-0-1', 200)

    expect(moved).toMatchObject({
      mediaId: 'media-0-1',
      createdAt: event.createdAt,
      expiresAt: event.expiresAt,
      source: 'shortcut'
    })
    expect(moved?.id).not.toBe(event.id)
    expect(store.current('media-14-tencent-viewport', 200)).toBeNull()
    expect(store.current('media-0-1', 200)).toEqual(moved)
  })

  it('retargets feedback ownership while preserving the original visible window', () => {
    const event = createMediaFeedbackEvent({
      command: { type: 'media.set-rate', mediaId: 'media-14-tencent-viewport', value: 2 },
      response: success(snapshot(2)),
      source: 'shortcut',
      now: 100
    })

    expect(retargetMediaFeedbackEvent(event, 'media-0-1')).toMatchObject({
      mediaId: 'media-0-1',
      createdAt: event.createdAt,
      expiresAt: event.expiresAt,
      value: 2
    })
  })

  it('creates one explainable feedback event for reset recovery and retry exhaustion', () => {
    expect(
      createPlaybackPolicyFeedbackEvent({
        state: {
          mediaId: 'media-0-1',
          intendedRate: 1.5,
          actualRate: 1.5,
          applicationStatus: 'applied',
          degradationReason: null,
          protectAgainstSiteReset: true,
          lastObservedExternalRate: 1,
          attemptCount: 2,
          generation: 0
        },
        previousState: {
          applicationStatus: 'pending',
          degradationReason: null,
          protectAgainstSiteReset: true,
          lastObservedExternalRate: 1,
          attemptCount: 1,
          generation: 0
        },
        now: 100
      })
    ).toMatchObject({
      kind: 'policy',
      messageKey: 'feedback.playback-rate-restored',
      value: 1.5,
      source: 'lifecycle'
    })

    expect(
      createPlaybackPolicyFeedbackEvent({
        state: {
          mediaId: 'media-0-1',
          intendedRate: 1.5,
          actualRate: 1,
          applicationStatus: 'blocked',
          degradationReason: 'RETRY_BUDGET_EXHAUSTED',
          protectAgainstSiteReset: true,
          lastObservedExternalRate: 1,
          attemptCount: 3,
          generation: 0
        },
        previousState: {
          applicationStatus: 'pending',
          degradationReason: null,
          protectAgainstSiteReset: true,
          lastObservedExternalRate: 1,
          attemptCount: 3,
          generation: 0
        },
        now: 200
      })
    ).toMatchObject({
      messageKey: 'feedback.playback-rate-protection-exhausted',
      tone: 'warning'
    })
  })

  it('emits policy warnings and restored state only on lifecycle edges', () => {
    const exhausted = {
      mediaId: 'media-0-1',
      intendedRate: 1.5,
      actualRate: 1,
      applicationStatus: 'blocked' as const,
      degradationReason: 'RETRY_BUDGET_EXHAUSTED' as const,
      protectAgainstSiteReset: true,
      lastObservedExternalRate: 1,
      attemptCount: 3,
      generation: 0
    }
    expect(
      createPlaybackPolicyFeedbackEvent({ state: exhausted, previousState: exhausted, now: 10 })
    ).toBeNull()

    expect(
      createPlaybackPolicyFeedbackEvent({
        state: {
          ...exhausted,
          actualRate: 1.5,
          applicationStatus: 'applied',
          degradationReason: null,
          attemptCount: 1,
          generation: 1
        },
        previousState: exhausted,
        now: 20
      })
    ).toMatchObject({ messageKey: 'feedback.playback-rate-restored' })
  })
})
