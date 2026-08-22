import type { MediaCommand } from '../../domain/command'
import type { MediaCommandResultResponse } from '../media'
import type { MediaId } from '../../domain/media'

export type MediaFeedbackKind = 'value' | 'state' | 'error' | 'policy'
export type MediaFeedbackTone = 'neutral' | 'success' | 'warning' | 'danger'
export type MediaCommandSource = 'overlay' | 'shortcut' | 'popup' | 'lifecycle'

export type MediaFeedbackEvent = Readonly<{
  id: string
  mediaId: MediaId
  commandId: MediaCommand['type'] | 'playback.policy' | 'settings.restore-progress'
  kind: MediaFeedbackKind
  messageKey: string
  value?: number | string | boolean
  tone: MediaFeedbackTone
  source: MediaCommandSource
  createdAt: number
  expiresAt: number
}>

const DEFAULT_FEEDBACK_DURATION_MS = 1_800

function successDetails(
  command: MediaCommand,
  response: Extract<MediaCommandResultResponse['result'], { ok: true }>
): Pick<MediaFeedbackEvent, 'kind' | 'messageKey' | 'value' | 'tone'> {
  const snapshot = response.value.snapshot
  switch (command.type) {
    case 'media.play':
      return { kind: 'state', messageKey: 'feedback.played', value: true, tone: 'success' }
    case 'media.pause':
      return { kind: 'state', messageKey: 'feedback.paused', value: false, tone: 'success' }
    case 'media.seek':
      return {
        kind: 'value',
        messageKey: command.deltaSeconds >= 0 ? 'feedback.seek-forward' : 'feedback.seek-backward',
        value: Math.abs(command.deltaSeconds),
        tone: 'neutral'
      }
    case 'media.step-frame':
      return {
        kind: 'value',
        messageKey: 'feedback.frame-step',
        value: command.frames,
        tone: 'neutral'
      }
    case 'media.set-rate':
    case 'media.adjust-rate':
      return {
        kind: 'value',
        messageKey: 'feedback.playback-rate',
        value: snapshot.metrics.playbackRate,
        tone: 'success'
      }
    case 'media.set-volume':
    case 'media.adjust-volume':
      return {
        kind: 'value',
        messageKey: 'feedback.volume',
        value: snapshot.metrics.volume,
        tone: 'neutral'
      }
    case 'media.set-gain':
    case 'media.adjust-gain':
      return {
        kind: 'value',
        messageKey: 'feedback.audio-gain',
        value: snapshot.metrics.gain ?? 1,
        tone: 'warning'
      }
    case 'media.set-muted':
    case 'media.toggle-mute':
      return {
        kind: 'state',
        messageKey: snapshot.metrics.muted ? 'feedback.muted' : 'feedback.unmuted',
        value: snapshot.metrics.muted,
        tone: 'neutral'
      }
    case 'media.set-zoom':
      return {
        kind: 'value',
        messageKey: 'feedback.zoom',
        value: snapshot.visual?.zoom ?? command.value,
        tone: 'neutral'
      }
    case 'media.rotate':
      return {
        kind: 'value',
        messageKey: 'feedback.rotation',
        value: snapshot.visual?.rotation ?? command.deltaDegrees,
        tone: 'neutral'
      }
    case 'media.pan':
      return {
        kind: 'value',
        messageKey: 'feedback.pan',
        value: `${snapshot.visual?.pan.x ?? command.deltaX},${snapshot.visual?.pan.y ?? command.deltaY}`,
        tone: 'neutral'
      }
    case 'media.toggle-flip':
      return {
        kind: 'state',
        messageKey:
          command.axis === 'horizontal' ? 'feedback.flip-horizontal' : 'feedback.flip-vertical',
        value: snapshot.visual?.flip[command.axis] ?? true,
        tone: 'neutral'
      }
    case 'media.set-filter':
      return {
        kind: 'value',
        messageKey: `feedback.filter-${command.filter}`,
        value: snapshot.visual?.filters[command.filter] ?? command.value,
        tone: 'neutral'
      }
    case 'media.reset-transform':
      return {
        kind: 'state',
        messageKey: 'feedback.transform-reset',
        value: true,
        tone: 'neutral'
      }
    case 'media.reset-visual':
      return {
        kind: 'state',
        messageKey: 'feedback.visual-reset',
        value: true,
        tone: 'neutral'
      }
    case 'media.toggle-fullscreen':
      return {
        kind: 'state',
        messageKey: 'feedback.fullscreen',
        value: snapshot.presentation?.fullscreen ?? 'none',
        tone: 'neutral'
      }
    case 'media.toggle-picture-in-picture':
      return {
        kind: 'state',
        messageKey: 'feedback.picture-in-picture',
        value: snapshot.presentation?.pictureInPicture ?? false,
        tone: 'neutral'
      }
    case 'media.capture':
      return { kind: 'state', messageKey: 'feedback.capture', value: true, tone: 'success' }
    case 'media.download':
      return {
        kind: 'state',
        messageKey: response.value.changed ? 'feedback.downloadStarted' : 'feedback.downloadQueued',
        value: response.value.changed,
        tone: 'success'
      }
    case 'media.play-next':
      return { kind: 'state', messageKey: 'feedback.play-next', value: true, tone: 'success' }
    default:
      return {
        kind: 'state',
        messageKey: 'feedback.operation-complete',
        value: response.value.changed,
        tone: 'neutral'
      }
  }
}

export function createRestoreProgressFeedbackEvent(
  input: Readonly<{
    mediaId: MediaId
    enabled?: boolean
    failed?: boolean
    now?: number
    durationMs?: number
  }>
): MediaFeedbackEvent {
  const createdAt = Math.max(0, input.now ?? Date.now())
  const durationMs = Math.max(
    1_500,
    Math.min(input.durationMs ?? DEFAULT_FEEDBACK_DURATION_MS, 2_000)
  )
  const failed = input.failed ?? false
  return {
    id: `${input.mediaId}:${createdAt}:settings.restore-progress${failed ? ':error' : ''}`,
    mediaId: input.mediaId,
    commandId: 'settings.restore-progress',
    kind: failed ? 'error' : 'state',
    messageKey: failed
      ? 'feedback.restore-progress-failed'
      : input.enabled
        ? 'feedback.restore-progress-enabled'
        : 'feedback.restore-progress-disabled',
    value: failed ? false : (input.enabled ?? false),
    tone: failed ? 'danger' : 'success',
    source: 'shortcut',
    createdAt,
    expiresAt: createdAt + durationMs
  }
}

export function createMediaFeedbackEvent(
  input: Readonly<{
    command: MediaCommand
    response: MediaCommandResultResponse
    source: MediaCommandSource
    now?: number
    durationMs?: number
  }>
): MediaFeedbackEvent {
  const createdAt = Math.max(0, input.now ?? Date.now())
  const durationMs = Math.max(
    1_500,
    Math.min(input.durationMs ?? DEFAULT_FEEDBACK_DURATION_MS, 2_000)
  )
  if (!input.response.result.ok) {
    return {
      id: `${input.command.mediaId}:${createdAt}:${input.command.type}:error`,
      mediaId: input.command.mediaId,
      commandId: input.command.type,
      kind: 'error',
      messageKey: input.response.result.error.messageKey,
      value: input.response.result.error.code,
      tone: 'danger',
      source: input.source,
      createdAt,
      expiresAt: createdAt + durationMs
    }
  }
  const details = successDetails(input.command, input.response.result)
  return {
    id: `${input.command.mediaId}:${createdAt}:${input.command.type}`,
    mediaId: input.command.mediaId,
    commandId: input.command.type,
    ...details,
    source: input.source,
    createdAt,
    expiresAt: createdAt + durationMs
  }
}

export function retargetMediaFeedbackEvent(
  event: MediaFeedbackEvent,
  targetMediaId: MediaId
): MediaFeedbackEvent {
  if (event.mediaId === targetMediaId) return event
  return Object.freeze({
    ...event,
    id: `${event.id}:retarget:${String(targetMediaId)}`,
    mediaId: targetMediaId
  })
}

export class MediaFeedbackStore {
  private readonly events = new Map<MediaId, MediaFeedbackEvent>()

  push(event: MediaFeedbackEvent): MediaFeedbackEvent {
    this.events.set(event.mediaId, event)
    return event
  }

  current(mediaId: MediaId, now = Date.now()): MediaFeedbackEvent | null {
    const event = this.events.get(mediaId)
    if (event === undefined) return null
    if (event.expiresAt > now) return event
    this.events.delete(mediaId)
    return null
  }

  /**
   * Moves an unexpired event with its original timestamp to a replacement
   * media instance so an in-flight feedback window is not restarted.
   */
  move(
    sourceMediaId: MediaId,
    targetMediaId: MediaId,
    now = Date.now()
  ): MediaFeedbackEvent | null {
    if (sourceMediaId === targetMediaId) return this.current(sourceMediaId, now)
    const source = this.current(sourceMediaId, now)
    if (source === null) return null
    const target = this.current(targetMediaId, now)
    if (target !== null && target.createdAt >= source.createdAt) return null
    const moved = retargetMediaFeedbackEvent(source, targetMediaId)
    this.events.delete(sourceMediaId)
    this.events.set(targetMediaId, moved)
    return moved
  }

  remove(mediaId: MediaId): void {
    this.events.delete(mediaId)
  }

  clear(): void {
    this.events.clear()
  }
}

export function createPlaybackPolicyFeedbackEvent(
  input: Readonly<{
    state: Readonly<{
      mediaId: MediaId
      intendedRate: number
      actualRate: number
      applicationStatus: 'pending' | 'applied' | 'unsupported' | 'blocked' | 'failed'
      degradationReason: 'CAPABILITY_UNAVAILABLE' | 'RETRY_BUDGET_EXHAUSTED' | null
      protectAgainstSiteReset: boolean
      lastObservedExternalRate: number | null
      attemptCount: number
      generation: number
    }>
    previousState?: Readonly<{
      applicationStatus: 'pending' | 'applied' | 'unsupported' | 'blocked' | 'failed'
      degradationReason: 'CAPABILITY_UNAVAILABLE' | 'RETRY_BUDGET_EXHAUSTED' | null
      protectAgainstSiteReset: boolean
      lastObservedExternalRate: number | null
      attemptCount: number
      generation: number
    }> | null
    now?: number
    durationMs?: number
  }>
): MediaFeedbackEvent | null {
  const { state } = input
  const previous = input.previousState ?? null
  const sameGeneration = previous?.generation === state.generation
  const externalResetObserved = state.lastObservedExternalRate !== null
  const restored =
    state.applicationStatus === 'applied' &&
    externalResetObserved &&
    (!sameGeneration || state.attemptCount > (previous?.attemptCount ?? 0))
  const protectionDisabled =
    state.applicationStatus === 'blocked' &&
    externalResetObserved &&
    !state.protectAgainstSiteReset &&
    !(
      sameGeneration &&
      previous?.applicationStatus === 'blocked' &&
      previous.lastObservedExternalRate !== null &&
      !previous.protectAgainstSiteReset
    )
  const retryExhausted =
    state.applicationStatus === 'blocked' &&
    state.degradationReason === 'RETRY_BUDGET_EXHAUSTED' &&
    !(
      sameGeneration &&
      previous?.applicationStatus === 'blocked' &&
      previous.degradationReason === 'RETRY_BUDGET_EXHAUSTED'
    )
  if (!restored && !protectionDisabled && !retryExhausted) return null

  const createdAt = Math.max(0, input.now ?? Date.now())
  const durationMs = Math.max(
    1_500,
    Math.min(input.durationMs ?? DEFAULT_FEEDBACK_DURATION_MS, 2_000)
  )
  return {
    id: `${String(state.mediaId)}:${createdAt}:playback.policy`,
    mediaId: state.mediaId,
    commandId: 'playback.policy',
    kind: 'policy',
    messageKey: restored
      ? 'feedback.playback-rate-restored'
      : protectionDisabled
        ? 'feedback.playback-rate-protection-disabled'
        : 'feedback.playback-rate-protection-exhausted',
    value: restored ? state.intendedRate : state.actualRate,
    tone: restored ? 'success' : 'warning',
    source: 'lifecycle',
    createdAt,
    expiresAt: createdAt + durationMs
  }
}
