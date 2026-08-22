import * as z from 'zod/mini'

export type MediaDownloadDisposition = 'started' | 'queued'

export const mediaDownloadFailureCodeSchema = z.enum([
  'DOWNLOAD_UNAVAILABLE',
  'DOWNLOAD_BLOCKED',
  'DOWNLOAD_TOO_LARGE',
  'DOWNLOAD_FAILED',
  'DOWNLOAD_CANCELLED'
])

export const mediaDownloadIntentIdSchema = z.string().check(z.minLength(16), z.maxLength(128))
const mediaDownloadUrlSchema = z.string().check(z.minLength(1), z.maxLength(4_096))
const mediaDownloadFilenameSchema = z.string().check(z.minLength(1), z.maxLength(256))

export const mediaDownloadArtifactSchema = z.strictObject({
  kind: z.enum(['same-origin', 'cross-origin', 'blob']),
  url: mediaDownloadUrlSchema,
  filename: mediaDownloadFilenameSchema,
  mimeType: z.optional(z.string().check(z.minLength(1), z.maxLength(256))),
  byteLength: z.optional(z.int().check(z.nonnegative(), z.lte(256 * 1_024 * 1_024))),
  revokeAfterMs: z.optional(z.int().check(z.gte(0), z.lte(120_000)))
})

export const mediaDownloadPreparationSchema = z.strictObject({
  intentId: mediaDownloadIntentIdSchema,
  disposition: z.enum(['started', 'queued']),
  artifacts: z.array(mediaDownloadArtifactSchema).check(z.maxLength(8))
})

export const mediaDownloadEventSchema = z.union([
  z.strictObject({
    type: z.literal('ready'),
    preparation: mediaDownloadPreparationSchema
  }),
  z.strictObject({
    type: z.literal('failed'),
    intentId: mediaDownloadIntentIdSchema,
    code: mediaDownloadFailureCodeSchema,
    message: z.string().check(z.minLength(1), z.maxLength(512))
  })
])

export type MediaDownloadArtifact = Readonly<z.infer<typeof mediaDownloadArtifactSchema>>
export type MediaDownloadPreparation = Readonly<z.infer<typeof mediaDownloadPreparationSchema>>

export type MediaDownloadEvent =
  | Readonly<{ type: 'ready'; preparation: MediaDownloadPreparation }>
  | Readonly<{
      type: 'failed'
      intentId: string
      code: MediaDownloadFailureCode
      message: string
    }>

export type MediaDownloadFailureCode = z.infer<typeof mediaDownloadFailureCodeSchema>

export class MediaDownloadFailure extends Error {
  constructor(
    readonly code: MediaDownloadFailureCode,
    message: string
  ) {
    super(message)
    this.name = 'MediaDownloadFailure'
  }
}

export function isMediaDownloadFailure(value: unknown): value is MediaDownloadFailure {
  return value instanceof MediaDownloadFailure
}
