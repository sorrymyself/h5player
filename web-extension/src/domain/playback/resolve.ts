import { clampPlaybackRate, roundMediaValue } from '../media'
import type { PlaybackRateIntent, ResolvedPlaybackRatePolicy } from './model'

export type PlaybackRatePolicyInput = Readonly<{
  globalDefault?: number | undefined
  siteDefault?: number | undefined
  pageIntent?: PlaybackRateIntent | null
  mediaIntent?: PlaybackRateIntent | null
  protectAgainstSiteReset: boolean
  capabilityAvailable: boolean
}>

function normalizeRate(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return roundMediaValue(clampPlaybackRate(value), 2)
}

export function resolvePlaybackRatePolicy(
  input: PlaybackRatePolicyInput
): ResolvedPlaybackRatePolicy {
  const globalDefault = normalizeRate(input.globalDefault, 1)
  const selected = input.mediaIntent
    ? {
        value: normalizeRate(input.mediaIntent.value, globalDefault),
        scope: 'media' as const,
        source: 'media-session' as const
      }
    : input.pageIntent
      ? {
          value: normalizeRate(input.pageIntent.value, globalDefault),
          scope: 'page' as const,
          source: 'page-session' as const
        }
      : input.siteDefault !== undefined
        ? {
            value: normalizeRate(input.siteDefault, globalDefault),
            scope: 'site' as const,
            source: 'site-rule' as const
          }
        : input.globalDefault !== undefined
          ? {
              value: globalDefault,
              scope: 'global' as const,
              source: 'global-setting' as const
            }
          : {
              value: 1,
              scope: 'global' as const,
              source: 'product-default' as const
            }

  return {
    ...selected,
    protectAgainstSiteReset: input.protectAgainstSiteReset,
    syncWithinPage: selected.scope !== 'media',
    supported: input.capabilityAvailable,
    degradationReason: input.capabilityAvailable ? null : 'CAPABILITY_UNAVAILABLE'
  }
}
