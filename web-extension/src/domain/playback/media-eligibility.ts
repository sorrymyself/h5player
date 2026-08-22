import { MIN_FOREGROUND_MEDIA_OPACITY, type MediaId, type MediaSnapshot } from '../media'

export const MIN_CONTENT_VIDEO_WIDTH = 240
export const MIN_CONTENT_VIDEO_HEIGHT = 135
export const MIN_CONTENT_VIDEO_AREA = 43_200

export type PlaybackMediaEligibility = Readonly<{
  eligible: boolean
  reason:
    'active' | 'content-video' | 'hidden' | 'small-video' | 'background-audio' | 'background-media'
}>

export const MIN_CONTENT_MEDIA_OPACITY = MIN_FOREGROUND_MEDIA_OPACITY

function videoIsLargeEnough(snapshot: MediaSnapshot): boolean {
  const { width, height } = snapshot.metrics
  return (
    width >= MIN_CONTENT_VIDEO_WIDTH &&
    height >= MIN_CONTENT_VIDEO_HEIGHT &&
    width * height >= MIN_CONTENT_VIDEO_AREA
  )
}

/**
 * Conservative Phase 6.5 content-media classifier. The active media remains
 * controllable after an explicit user interaction; background/hidden media do
 * not inherit page-wide playback policy until an adapter provides stronger
 * classification evidence.
 */
export function classifyPlaybackMedia(
  snapshot: MediaSnapshot,
  activeMediaId: MediaId | null
): PlaybackMediaEligibility {
  if (!snapshot.metrics.visible) return { eligible: false, reason: 'hidden' }
  if ((snapshot.metrics.opacity ?? 1) < MIN_CONTENT_MEDIA_OPACITY) {
    return { eligible: false, reason: 'background-media' }
  }
  if (snapshot.id === activeMediaId && snapshot.capabilities.playbackRate) {
    return { eligible: true, reason: 'active' }
  }
  if (snapshot.kind === 'audio') return { eligible: false, reason: 'background-audio' }
  if (!videoIsLargeEnough(snapshot)) return { eligible: false, reason: 'small-video' }
  return { eligible: true, reason: 'content-video' }
}

export function playbackEligibleMedia(
  media: readonly MediaSnapshot[],
  activeMediaId: MediaId | null
): readonly MediaSnapshot[] {
  return media.filter((snapshot) => classifyPlaybackMedia(snapshot, activeMediaId).eligible)
}
