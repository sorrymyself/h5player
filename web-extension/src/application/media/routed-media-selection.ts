import type { MediaSnapshot } from '../../domain/media'
import type { MediaPageState } from './contracts'
import { activeMediaForState, hasRoutableActiveMedia } from './active-media'

type RoutedMediaCandidate = Readonly<{
  state: MediaPageState
  snapshot: MediaSnapshot
  discoveryOrder: number
}>

function capabilityScore(snapshot: MediaSnapshot): number {
  const capabilities = snapshot.capabilities
  return [
    capabilities.playback,
    capabilities.seek,
    capabilities.playbackRate,
    capabilities.volume,
    capabilities.mute,
    capabilities.visual,
    capabilities.fullscreen,
    capabilities.pictureInPicture,
    capabilities.capture,
    capabilities.downloadExperimental
  ].filter(Boolean).length
}

function timelineEvidenceScore(snapshot: MediaSnapshot): number {
  let score = 0
  if (snapshot.sourceKey !== undefined) score += 3
  if (snapshot.metrics.duration !== null && snapshot.metrics.duration > 0) score += 2
  if (snapshot.metrics.currentTime > 0.5) score += 1
  return score
}

function areaScore(snapshot: MediaSnapshot): number {
  const width = Number.isFinite(snapshot.metrics.width) ? Math.max(0, snapshot.metrics.width) : 0
  const height = Number.isFinite(snapshot.metrics.height) ? Math.max(0, snapshot.metrics.height) : 0
  return Math.min(width * height, 10_000_000)
}

function activeSnapshot(state: MediaPageState): MediaSnapshot | null {
  return hasRoutableActiveMedia(state) ? activeMediaForState(state) : null
}

function isTencentViewportProxy(snapshot: MediaSnapshot): boolean {
  return snapshot.adapterId === 'tencent-video' && String(snapshot.id).endsWith('-tencent-viewport')
}

/**
 * A state with native controls or a real timeline is normally strong enough
 * to stop probing lower-priority frames. Tencent's top native mirror and
 * viewport proxy remain provisional until their sibling frames are compared.
 */
export function isDefinitiveRoutableMediaState(state: MediaPageState): boolean {
  const snapshot = activeSnapshot(state)
  if (snapshot === null) return false
  // Tencent can keep a top-frame native mirror connected while a replacement
  // fake-video frame owns playback. Keep both sides of that topology
  // provisional so a strong but stale top snapshot cannot stop discovery.
  if (
    isTencentViewportProxy(snapshot) ||
    (snapshot.adapterId === 'tencent-video' && snapshot.frameId === 0)
  ) {
    return false
  }
  return capabilityScore(snapshot) >= 3 || timelineEvidenceScore(snapshot) >= 3
}

function compareCandidates(left: RoutedMediaCandidate, right: RoutedMediaCandidate): number {
  const leftPlaying = left.snapshot.state === 'active' ? 1 : 0
  const rightPlaying = right.snapshot.state === 'active' ? 1 : 0
  if (leftPlaying !== rightPlaying) return rightPlaying - leftPlaying

  const leftTencentViewport = isTencentViewportProxy(left.snapshot)
  const rightTencentViewport = isTencentViewportProxy(right.snapshot)
  if (leftTencentViewport !== rightTencentViewport) {
    return rightTencentViewport ? 1 : -1
  }
  if (
    leftTencentViewport &&
    rightTencentViewport &&
    left.snapshot.frameId !== right.snapshot.frameId
  ) {
    // Chromium allocates replacement frame ids monotonically within a tab.
    // Prefer the newest connected Tencent fake-video authority.
    return right.snapshot.frameId - left.snapshot.frameId
  }

  const leftCapabilities = capabilityScore(left.snapshot)
  const rightCapabilities = capabilityScore(right.snapshot)
  if (leftCapabilities !== rightCapabilities) return rightCapabilities - leftCapabilities

  const leftTimeline = timelineEvidenceScore(left.snapshot)
  const rightTimeline = timelineEvidenceScore(right.snapshot)
  if (leftTimeline !== rightTimeline) return rightTimeline - leftTimeline

  const leftArea = areaScore(left.snapshot)
  const rightArea = areaScore(right.snapshot)
  if (leftArea !== rightArea) return rightArea - leftArea

  // A top-frame native element is preferable when all observable playback
  // evidence is otherwise tied with a child-frame viewport proxy.
  const leftTopFrame = left.snapshot.frameId === 0 ? 1 : 0
  const rightTopFrame = right.snapshot.frameId === 0 ? 1 : 0
  if (leftTopFrame !== rightTopFrame) return rightTopFrame - leftTopFrame

  if (left.snapshot.updatedAt !== right.snapshot.updatedAt) {
    return right.snapshot.updatedAt - left.snapshot.updatedAt
  }
  if (left.state.observedAt !== right.state.observedAt) {
    return right.state.observedAt - left.state.observedAt
  }
  if (left.snapshot.frameId !== right.snapshot.frameId) {
    return right.snapshot.frameId - left.snapshot.frameId
  }
  if (left.discoveryOrder !== right.discoveryOrder) {
    return left.discoveryOrder - right.discoveryOrder
  }
  return String(left.snapshot.id).localeCompare(String(right.snapshot.id))
}

/**
 * Select one active media state after querying multiple content frames.
 *
 * Frame runtime reports are advisory and can lag a frame replacement. The
 * state itself is therefore the source of truth; capability and timeline
 * evidence distinguish a real native player from a lightweight viewport proxy.
 */
export function selectRoutableMediaState(states: readonly MediaPageState[]): MediaPageState | null {
  const candidates: RoutedMediaCandidate[] = []
  states.forEach((state, discoveryOrder) => {
    const snapshot = activeSnapshot(state)
    if (snapshot === null) return
    candidates.push({ state, snapshot, discoveryOrder })
  })
  return [...candidates].sort(compareCandidates)[0]?.state ?? null
}
