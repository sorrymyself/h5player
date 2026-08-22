import * as z from 'zod/mini'

export const CAPTURE_MAX_DIMENSION = 8_192
export const CAPTURE_MAX_PIXELS = 16_777_216
export const CAPTURE_MAX_BYTES = 4 * 1_024 * 1_024
export const CAPTURE_MAX_BASE64_LENGTH = Math.ceil(CAPTURE_MAX_BYTES / 3) * 4

export const captureMimeTypeSchema = z.enum(['image/png', 'image/jpeg'])
export const captureOptionsSchema = z.strictObject({
  mimeType: captureMimeTypeSchema,
  quality: z.optional(z.number().check(z.gte(0), z.lte(1)))
})

export const captureArtifactSchema = z.strictObject({
  mimeType: captureMimeTypeSchema,
  width: z.int().check(z.gte(1), z.lte(CAPTURE_MAX_DIMENSION)),
  height: z.int().check(z.gte(1), z.lte(CAPTURE_MAX_DIMENSION)),
  byteLength: z.int().check(z.gte(1), z.lte(CAPTURE_MAX_BYTES)),
  dataBase64: z.string().check(z.minLength(1), z.maxLength(CAPTURE_MAX_BASE64_LENGTH))
})

export type CaptureMimeType = z.infer<typeof captureMimeTypeSchema>
export type CaptureOptions = Readonly<z.infer<typeof captureOptionsSchema>>
export type CaptureArtifact = Readonly<z.infer<typeof captureArtifactSchema>>

export type CaptureFailureCode =
  'CAPTURE_NOT_READY' | 'CAPTURE_BLOCKED' | 'CAPTURE_TOO_LARGE' | 'CAPTURE_FAILED'

export class CaptureFailure extends Error {
  constructor(
    readonly code: CaptureFailureCode,
    message: string
  ) {
    super(message)
    this.name = 'CaptureFailure'
  }
}

export function isCaptureFailure(value: unknown): value is CaptureFailure {
  return value instanceof CaptureFailure
}
