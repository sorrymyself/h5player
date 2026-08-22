import type { MediaId, MediaSnapshot } from '../../domain/media'
import { classifyPlaybackMedia } from '../../domain/playback'
import { isUsableMediaAnchor, type MediaAnchor } from './media-anchor-registry'

export const MEDIA_OVERLAY_SLOT_IOU_THRESHOLD = 0.85

type OverlayCandidate = Readonly<{
  snapshot: MediaSnapshot
  anchor: MediaAnchor & { rect: DOMRectReadOnly }
}>

function rectArea(rect: DOMRectReadOnly): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height)
}

function intersectionArea(left: DOMRectReadOnly, right: DOMRectReadOnly): number {
  const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left))
  const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top))
  return width * height
}

function sharesVisualSlot(left: OverlayCandidate, right: OverlayCandidate): boolean {
  const overlap = intersectionArea(left.anchor.rect, right.anchor.rect)
  if (overlap <= 0) return false
  const union = rectArea(left.anchor.rect) + rectArea(right.anchor.rect) - overlap
  return union > 0 && overlap / union >= MEDIA_OVERLAY_SLOT_IOU_THRESHOLD
}

function compareOwnerCandidates(
  left: OverlayCandidate,
  right: OverlayCandidate,
  activeMediaId: MediaId | null
): number {
  const leftIsActive = left.snapshot.id === activeMediaId
  const rightIsActive = right.snapshot.id === activeMediaId
  if (leftIsActive !== rightIsActive) return leftIsActive ? -1 : 1

  const leftIsPlaying = left.snapshot.state === 'active'
  const rightIsPlaying = right.snapshot.state === 'active'
  if (leftIsPlaying !== rightIsPlaying) return leftIsPlaying ? -1 : 1

  const leftHasDuration = left.snapshot.metrics.duration !== null
  const rightHasDuration = right.snapshot.metrics.duration !== null
  if (leftHasDuration !== rightHasDuration) return leftHasDuration ? -1 : 1

  if (left.snapshot.metrics.currentTime !== right.snapshot.metrics.currentTime) {
    return right.snapshot.metrics.currentTime - left.snapshot.metrics.currentTime
  }

  const leftHasSource = left.snapshot.sourceKey !== undefined
  const rightHasSource = right.snapshot.sourceKey !== undefined
  if (leftHasSource !== rightHasSource) return leftHasSource ? -1 : 1

  if (left.snapshot.updatedAt !== right.snapshot.updatedAt) {
    return right.snapshot.updatedAt - left.snapshot.updatedAt
  }

  const leftArea = rectArea(left.anchor.rect)
  const rightArea = rectArea(right.anchor.rect)
  if (leftArea !== rightArea) return rightArea - leftArea
  return String(left.snapshot.id).localeCompare(String(right.snapshot.id))
}

/**
 * Selects one UI owner for each visual playback slot. Some production players
 * keep ad, preload, and content videos fully overlapped; mounting one overlay
 * per DOM node would stack duplicate controls over the same pixels.
 */
export function selectMediaOverlayOwners(
  media: readonly MediaSnapshot[],
  activeMediaId: MediaId | null,
  anchors: readonly MediaAnchor[]
): ReadonlySet<MediaId> {
  const anchorByMediaId = new Map(anchors.map((anchor) => [anchor.mediaId, anchor]))
  const candidates = media.flatMap((snapshot): readonly OverlayCandidate[] => {
    if (snapshot.kind === 'audio' || !classifyPlaybackMedia(snapshot, activeMediaId).eligible) {
      return []
    }
    const anchor = anchorByMediaId.get(snapshot.id)
    if (anchor === undefined || anchor.rect === null || !isUsableMediaAnchor(anchor)) return []
    return [{ snapshot, anchor: anchor as MediaAnchor & { rect: DOMRectReadOnly } }]
  })

  const groups: OverlayCandidate[][] = []
  for (const candidate of candidates) {
    const overlapping = groups
      .map((group, index) => (group.some((item) => sharesVisualSlot(item, candidate)) ? index : -1))
      .filter((index) => index >= 0)
    const firstIndex = overlapping[0]
    if (firstIndex === undefined) {
      groups.push([candidate])
      continue
    }
    const target = groups[firstIndex]
    if (target === undefined) continue
    target.push(candidate)
    for (const index of overlapping.slice(1).sort((left, right) => right - left)) {
      const merged = groups[index]
      if (merged === undefined) continue
      target.push(...merged)
      groups.splice(index, 1)
    }
  }

  return new Set(
    groups.flatMap((group) => {
      const owner = [...group].sort((left, right) =>
        compareOwnerCandidates(left, right, activeMediaId)
      )[0]
      return owner === undefined ? [] : [owner.snapshot.id]
    })
  )
}
