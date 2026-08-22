import { MIN_FOREGROUND_MEDIA_OPACITY, type MediaId, type MediaSnapshot } from '../media'

const VISIBLE_WEIGHT = 1_000_000
const FOCUSED_WEIGHT = 200_000
const RECENT_INTERACTION_WEIGHT = 150_000
const PLAYING_WEIGHT = 100_000
const OPACITY_WEIGHT = 50_000
const VIDEO_WEIGHT = 10_000
const MAX_AREA_WEIGHT = VIDEO_WEIGHT - 1

export const DEFAULT_INTERACTION_WINDOW_MS = 15_000

function foregroundCandidates(
  candidates: readonly ActivePlayerCandidate[]
): readonly ActivePlayerCandidate[] {
  const foreground = candidates.filter(
    (candidate) => (candidate.snapshot.metrics.opacity ?? 1) >= MIN_FOREGROUND_MEDIA_OPACITY
  )
  // A translucent-only page remains controllable, but a preview/background
  // layer must never displace a real foreground player.
  return foreground.length > 0 ? foreground : candidates
}

export interface ActivePlayerCandidate {
  readonly snapshot: MediaSnapshot
  readonly focused: boolean
  readonly lastInteractionAt: number | null
  readonly discoveryOrder: number
}

export interface ActivePlayerScore {
  readonly total: number
  readonly visible: number
  readonly focused: number
  readonly recentInteraction: number
  readonly playing: number
  readonly opacity: number
  readonly preferredKind: number
  readonly area: number
}

export interface ActivePlayerSelectionOptions {
  readonly now: number
  readonly currentMediaId?: MediaId | null
  readonly interactionWindowMs?: number
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

function interactionScore(
  lastInteractionAt: number | null,
  now: number,
  interactionWindowMs: number
): number {
  if (lastInteractionAt === null || interactionWindowMs <= 0) return 0
  const age = Math.max(0, now - lastInteractionAt)
  if (!Number.isFinite(age) || age >= interactionWindowMs) return 0
  return Math.round(RECENT_INTERACTION_WEIGHT * (1 - age / interactionWindowMs))
}

export function scoreActivePlayer(
  candidate: ActivePlayerCandidate,
  now: number,
  interactionWindowMs = DEFAULT_INTERACTION_WINDOW_MS
): ActivePlayerScore {
  const { metrics } = candidate.snapshot
  const width = finiteNonNegative(metrics.width)
  const height = finiteNonNegative(metrics.height)
  const area = metrics.visible
    ? Math.round((Math.min(width * height, 10_000_000) / 10_000_000) * MAX_AREA_WEIGHT)
    : 0
  const visible = metrics.visible ? VISIBLE_WEIGHT : 0
  const focused = candidate.focused ? FOCUSED_WEIGHT : 0
  const recentInteraction = interactionScore(candidate.lastInteractionAt, now, interactionWindowMs)
  const playing = candidate.snapshot.state === 'active' ? PLAYING_WEIGHT : 0
  const opacity = Math.round(
    Math.min(1, Math.max(0, candidate.snapshot.metrics.opacity ?? 1)) * OPACITY_WEIGHT
  )
  const preferredKind = candidate.snapshot.kind === 'audio' ? 0 : VIDEO_WEIGHT

  return {
    total: visible + focused + recentInteraction + playing + opacity + preferredKind + area,
    visible,
    focused,
    recentInteraction,
    playing,
    opacity,
    preferredKind,
    area
  }
}

function compareIds(left: MediaId, right: MediaId): number {
  const leftValue = String(left)
  const rightValue = String(right)
  if (leftValue === rightValue) return 0
  return leftValue < rightValue ? -1 : 1
}

function compareCandidates(
  left: ActivePlayerCandidate,
  right: ActivePlayerCandidate,
  options: Required<ActivePlayerSelectionOptions>
): number {
  const leftScore = scoreActivePlayer(left, options.now, options.interactionWindowMs)
  const rightScore = scoreActivePlayer(right, options.now, options.interactionWindowMs)
  if (leftScore.total !== rightScore.total) return rightScore.total - leftScore.total

  const leftInteraction = left.lastInteractionAt ?? Number.NEGATIVE_INFINITY
  const rightInteraction = right.lastInteractionAt ?? Number.NEGATIVE_INFINITY
  if (leftInteraction !== rightInteraction) return rightInteraction - leftInteraction

  const leftIsCurrent = left.snapshot.id === options.currentMediaId
  const rightIsCurrent = right.snapshot.id === options.currentMediaId
  if (leftIsCurrent !== rightIsCurrent) return leftIsCurrent ? -1 : 1

  if (left.discoveryOrder !== right.discoveryOrder) {
    return left.discoveryOrder - right.discoveryOrder
  }
  return compareIds(left.snapshot.id, right.snapshot.id)
}

export function selectActivePlayer(
  candidates: readonly ActivePlayerCandidate[],
  options: ActivePlayerSelectionOptions
): ActivePlayerCandidate | null {
  if (candidates.length === 0) return null
  const resolvedOptions: Required<ActivePlayerSelectionOptions> = {
    now: Number.isFinite(options.now) ? options.now : 0,
    currentMediaId: options.currentMediaId ?? null,
    interactionWindowMs:
      options.interactionWindowMs === undefined || !Number.isFinite(options.interactionWindowMs)
        ? DEFAULT_INTERACTION_WINDOW_MS
        : Math.max(0, options.interactionWindowMs)
  }
  return (
    [...foregroundCandidates(candidates)].sort((left, right) =>
      compareCandidates(left, right, resolvedOptions)
    )[0] ?? null
  )
}
