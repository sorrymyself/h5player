import * as z from 'zod/mini'
import { persistedSettingsV2Schema, progressRecordSchema } from '../../domain/settings'

const pageUrlSchema = z.string().check(z.minLength(1), z.maxLength(8_192))
const optionalUrlSchema = z.optional(z.string().check(z.maxLength(8_192)))
const stableMediaIdSchema = z.optional(z.string().check(z.maxLength(8_192)))
const positionSchema = z.number().check(z.nonnegative())
const durationSchema = z.nullable(z.number().check(z.nonnegative()))

const identityShape = {
  pageUrl: pageUrlSchema,
  stableMediaId: stableMediaIdSchema,
  mediaSourceUrl: optionalUrlSchema
}

export const progressReadPayloadSchema = z.strictObject(identityShape)
export const progressDeletePayloadSchema = z.strictObject(identityShape)
export const progressSavePayloadSchema = z.strictObject({
  ...identityShape,
  positionSeconds: positionSchema,
  durationSeconds: z.optional(durationSchema)
})
export const progressPrunePayloadSchema = z.strictObject({})

export const progressRecordResponseSchema = z.nullable(progressRecordSchema)

export const progressReadResponseSchema = z.strictObject({
  record: progressRecordResponseSchema,
  privacyBlocked: z.boolean(),
  revision: z.int().check(z.nonnegative()),
  prunedCount: z.int().check(z.nonnegative())
})

export const progressSaveResponseSchema = z.strictObject({
  saved: z.boolean(),
  privacyBlocked: z.boolean(),
  record: progressRecordResponseSchema,
  revision: z.int().check(z.nonnegative()),
  prunedCount: z.int().check(z.nonnegative()),
  evictedCount: z.int().check(z.nonnegative())
})

export const progressDeleteResponseSchema = z.strictObject({
  deleted: z.boolean(),
  revision: z.int().check(z.nonnegative()),
  prunedCount: z.int().check(z.nonnegative())
})

export const progressPruneResponseSchema = z.strictObject({
  removedCount: z.int().check(z.nonnegative()),
  normalizedCount: z.int().check(z.nonnegative()),
  remainingCount: z.int().check(z.nonnegative()),
  revision: z.int().check(z.nonnegative())
})

export const progressRestoreToggleResponseSchema = z.strictObject({
  origin: z.string().check(z.minLength(1), z.maxLength(256)),
  enabled: z.boolean(),
  settings: persistedSettingsV2Schema,
  changedPaths: z.array(z.string().check(z.minLength(1), z.maxLength(512)))
})

export type ProgressReadPayload = z.infer<typeof progressReadPayloadSchema>
export type ProgressSavePayload = z.infer<typeof progressSavePayloadSchema>
export type ProgressDeletePayload = z.infer<typeof progressDeletePayloadSchema>
