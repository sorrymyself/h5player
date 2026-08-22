import { describe, expect, it } from 'vitest'
import {
  mediaPlaybackPolicyStateSchema,
  resolvePlaybackRatePolicy,
  type PlaybackRatePolicyInput
} from '../../src/domain/playback'

function resolve(overrides: Partial<PlaybackRatePolicyInput> = {}) {
  return resolvePlaybackRatePolicy({
    globalDefault: undefined,
    siteDefault: undefined,
    pageIntent: null,
    mediaIntent: null,
    protectAgainstSiteReset: false,
    capabilityAvailable: true,
    ...overrides
  })
}

describe('playback rate policy resolver', () => {
  it('uses the product default when no user intent exists', () => {
    expect(resolve()).toEqual({
      value: 1,
      scope: 'global',
      source: 'product-default',
      protectAgainstSiteReset: false,
      syncWithinPage: true,
      supported: true,
      degradationReason: null
    })
  })

  it('resolves media, page, site, and global intent in strict priority order', () => {
    const input: PlaybackRatePolicyInput = {
      globalDefault: 1.1,
      siteDefault: 1.25,
      pageIntent: { value: 1.5, updatedAt: 30 },
      mediaIntent: { value: 1.75, updatedAt: 40 },
      protectAgainstSiteReset: true,
      capabilityAvailable: true
    }

    expect(resolvePlaybackRatePolicy(input)).toMatchObject({
      value: 1.75,
      scope: 'media',
      source: 'media-session',
      syncWithinPage: false
    })
    expect(resolvePlaybackRatePolicy({ ...input, mediaIntent: null })).toMatchObject({
      value: 1.5,
      scope: 'page',
      source: 'page-session',
      syncWithinPage: true
    })
    expect(
      resolvePlaybackRatePolicy({ ...input, mediaIntent: null, pageIntent: null })
    ).toMatchObject({ value: 1.25, scope: 'site', source: 'site-rule' })
    expect(
      resolvePlaybackRatePolicy({
        ...input,
        mediaIntent: null,
        pageIntent: null,
        siteDefault: undefined
      })
    ).toMatchObject({ value: 1.1, scope: 'global', source: 'global-setting' })
  })

  it('normalizes finite values to shared media bounds and display precision', () => {
    expect(resolve({ globalDefault: 100 }).value).toBe(16)
    expect(resolve({ globalDefault: -100 }).value).toBe(0.1)
    expect(resolve({ globalDefault: 1.2349 }).value).toBe(1.23)
    expect(resolve({ globalDefault: Number.NaN }).value).toBe(1)
  })

  it('keeps a current-media temporary intent isolated from synchronised policy', () => {
    const media = resolve({
      siteDefault: 1.5,
      mediaIntent: { value: 2, updatedAt: 10 }
    })
    const sibling = resolve({ siteDefault: 1.5 })

    expect(media).toMatchObject({ value: 2, scope: 'media', syncWithinPage: false })
    expect(sibling).toMatchObject({ value: 1.5, scope: 'site', syncWithinPage: true })
  })

  it('preserves protection policy while exposing capability degradation', () => {
    expect(
      resolve({
        siteDefault: 1.5,
        protectAgainstSiteReset: true,
        capabilityAvailable: false
      })
    ).toEqual({
      value: 1.5,
      scope: 'site',
      source: 'site-rule',
      protectAgainstSiteReset: true,
      syncWithinPage: true,
      supported: false,
      degradationReason: 'CAPABILITY_UNAVAILABLE'
    })
  })

  it('validates serializable per-media application state', () => {
    expect(
      mediaPlaybackPolicyStateSchema.parse({
        mediaId: 'media-0-1',
        intendedRate: 1.5,
        actualRate: 1.25,
        scope: 'site',
        source: 'site-rule',
        protectAgainstSiteReset: true,
        applicationStatus: 'pending',
        lastAppliedAt: null,
        lastObservedExternalRate: 1.25,
        attemptCount: 1,
        generation: 2,
        degradationReason: null
      })
    ).toMatchObject({ mediaId: 'media-0-1', intendedRate: 1.5 })
  })
})
