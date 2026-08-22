import * as z from 'zod/mini'
import { persistedSettingsV2Schema } from '../../domain/settings'

const playbackRateSchema = z.number().check(z.gte(0.1), z.lte(16))

export const playbackSiteIntentPayloadSchema = z.strictObject({
  value: playbackRateSchema,
  protectAgainstSiteReset: z.optional(z.boolean())
})

export const playbackSiteIntentResponseSchema = z.strictObject({
  origin: z.string().check(z.minLength(1), z.maxLength(256)),
  value: playbackRateSchema,
  protectAgainstSiteReset: z.boolean(),
  settings: persistedSettingsV2Schema,
  changedPaths: z.array(z.string().check(z.minLength(1), z.maxLength(512)))
})

export type PlaybackSiteIntentPayload = z.infer<typeof playbackSiteIntentPayloadSchema>
export type PlaybackSiteIntentResponse = z.infer<typeof playbackSiteIntentResponseSchema>
