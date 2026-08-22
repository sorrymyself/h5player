import type { MediaSnapshot } from '../../domain/media'
import type { MediaPageState } from './contracts'

export function activeMediaForState(state: MediaPageState): MediaSnapshot | null {
  if (state.activeMediaId === null) return null
  return state.media.find((media) => media.id === state.activeMediaId) ?? null
}

/** Hidden video nodes are often preload, ad, or compatibility helpers. */
export function hasRoutableActiveMedia(state: MediaPageState): boolean {
  const active = activeMediaForState(state)
  return active !== null && (active.kind === 'audio' || active.metrics.visible)
}
