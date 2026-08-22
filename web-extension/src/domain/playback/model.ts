import * as z from 'zod/mini'
import { mediaIdSchema } from '../media'

export const playbackRateScopeSchema = z.enum(['global', 'site', 'page', 'media'])
export const playbackRatePolicySourceSchema = z.enum([
  'product-default',
  'global-setting',
  'site-rule',
  'page-session',
  'media-session'
])
export const playbackRateApplicationStatusSchema = z.enum([
  'pending',
  'applied',
  'unsupported',
  'blocked',
  'failed'
])

export type PlaybackRateScope = z.infer<typeof playbackRateScopeSchema>
export type PlaybackRatePolicySource = z.infer<typeof playbackRatePolicySourceSchema>
export type PlaybackRateApplicationStatus = z.infer<typeof playbackRateApplicationStatusSchema>

export type PlaybackRateIntent = Readonly<{
  value: number
  updatedAt: number
}>

export type ResolvedPlaybackRatePolicy = Readonly<{
  value: number
  scope: PlaybackRateScope
  source: PlaybackRatePolicySource
  protectAgainstSiteReset: boolean
  syncWithinPage: boolean
  supported: boolean
  degradationReason: 'CAPABILITY_UNAVAILABLE' | null
}>

export const mediaPlaybackPolicyStateSchema = z.strictObject({
  mediaId: mediaIdSchema,
  intendedRate: z.number().check(z.gte(0.1), z.lte(16)),
  actualRate: z.number().check(z.gte(0.1), z.lte(16)),
  scope: playbackRateScopeSchema,
  source: playbackRatePolicySourceSchema,
  protectAgainstSiteReset: z.boolean(),
  applicationStatus: playbackRateApplicationStatusSchema,
  lastAppliedAt: z.nullable(z.number().check(z.nonnegative())),
  lastObservedExternalRate: z.nullable(z.number().check(z.gte(0.1), z.lte(16))),
  attemptCount: z.int().check(z.nonnegative()),
  generation: z.int().check(z.nonnegative()),
  degradationReason: z.nullable(z.enum(['CAPABILITY_UNAVAILABLE', 'RETRY_BUDGET_EXHAUSTED']))
})

export type MediaPlaybackPolicyState = z.infer<typeof mediaPlaybackPolicyStateSchema>
