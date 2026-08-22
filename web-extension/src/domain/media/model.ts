import * as z from 'zod/mini'
import { failure, success, type Result } from '../../shared/result'
import { mediaPresentationStateSchema, visualStateSchema } from '../visual'
import { MAX_PLAYBACK_RATE, MAX_VOLUME, MIN_PLAYBACK_RATE, MIN_VOLUME } from './invariants'

function isSafeIdentifier(value: string): boolean {
  if (value.trim() !== value) return false
  return Array.from(value).every((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint !== undefined && codePoint > 31 && (codePoint < 127 || codePoint > 159)
  })
}

const boundedIdentifierSchema = z
  .string()
  .check(z.minLength(1), z.maxLength(128), z.refine(isSafeIdentifier))
const nonNegativeNumberSchema = z.number().check(z.nonnegative())

type DeepReadonly<T> = T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> } : T

export const mediaIdSchema = boundedIdentifierSchema
export const mediaKindSchema = z.enum(['video', 'audio', 'custom-video'])
export const mediaStateSchema = z.enum([
  'discovered',
  'ready',
  'active',
  'paused',
  'removed',
  'error'
])

export const mediaCapabilitiesSchema = z.strictObject({
  playback: z.boolean(),
  seek: z.boolean(),
  playbackRate: z.boolean(),
  volume: z.boolean(),
  mute: z.boolean(),
  visual: z.optional(z.boolean()),
  fullscreen: z.boolean(),
  fullscreenNative: z.optional(z.boolean()),
  fullscreenWeb: z.optional(z.boolean()),
  pictureInPicture: z.boolean(),
  audioGain: z.optional(z.boolean()),
  capture: z.boolean(),
  next: z.optional(z.boolean()),
  downloadExperimental: z.boolean()
})

export const mediaMetricsSchema = z
  .strictObject({
    width: nonNegativeNumberSchema,
    height: nonNegativeNumberSchema,
    duration: z.nullable(nonNegativeNumberSchema),
    currentTime: nonNegativeNumberSchema,
    volume: z.number().check(z.gte(MIN_VOLUME), z.lte(MAX_VOLUME)),
    gain: z.optional(z.number().check(z.gte(1), z.lte(6))),
    playbackRate: z.number().check(z.gte(MIN_PLAYBACK_RATE), z.lte(MAX_PLAYBACK_RATE)),
    muted: z.boolean(),
    // Computed opacity is a presentation hint used to distinguish foreground
    // content from low-opacity preview/background media. It is optional so
    // custom and viewport-proxy controllers can omit it safely.
    opacity: z.optional(z.number().check(z.gte(0), z.lte(1))),
    visible: z.boolean()
  })
  .check(
    z.refine((metrics) => metrics.duration === null || metrics.currentTime <= metrics.duration)
  )

export const mediaSessionSchema = z.strictObject({
  id: mediaIdSchema,
  frameId: z.int().check(z.nonnegative()),
  sourceKey: z.optional(boundedIdentifierSchema),
  kind: mediaKindSchema,
  state: mediaStateSchema,
  metrics: mediaMetricsSchema,
  capabilities: mediaCapabilitiesSchema,
  visual: z.optional(visualStateSchema),
  presentation: z.optional(mediaPresentationStateSchema),
  adapterId: boundedIdentifierSchema,
  updatedAt: nonNegativeNumberSchema
})

export const mediaSnapshotSchema = mediaSessionSchema

export type MediaId = z.infer<typeof mediaIdSchema>
export type MediaKind = z.infer<typeof mediaKindSchema>
export type MediaState = z.infer<typeof mediaStateSchema>
export type MediaCapabilities = DeepReadonly<z.infer<typeof mediaCapabilitiesSchema>>
export type MediaMetrics = DeepReadonly<z.infer<typeof mediaMetricsSchema>>
export type MediaSession = DeepReadonly<z.infer<typeof mediaSessionSchema>>
export type MediaSnapshot = MediaSession

export const MEDIA_CAPABILITY_KEYS = [
  'playback',
  'seek',
  'playbackRate',
  'volume',
  'mute',
  'visual',
  'fullscreen',
  'fullscreenNative',
  'fullscreenWeb',
  'pictureInPicture',
  'audioGain',
  'capture',
  'next',
  'downloadExperimental'
] as const satisfies readonly (keyof MediaCapabilities)[]

export const DEFAULT_MEDIA_CAPABILITIES: MediaCapabilities = Object.freeze({
  playback: false,
  seek: false,
  playbackRate: false,
  volume: false,
  mute: false,
  fullscreen: false,
  pictureInPicture: false,
  capture: false,
  next: false,
  downloadExperimental: false
})

export type MediaValidationErrorCode = 'INVALID_MEDIA_ID' | 'INVALID_MEDIA_SNAPSHOT'

export interface MediaValidationError {
  readonly code: MediaValidationErrorCode
  readonly messageKey: 'media.error.invalidId' | 'media.error.invalidSnapshot'
  readonly context: Readonly<{
    issueCount: number
  }>
}

function invalidMediaValue(
  code: MediaValidationErrorCode,
  issueCount: number
): MediaValidationError {
  return {
    code,
    messageKey:
      code === 'INVALID_MEDIA_ID' ? 'media.error.invalidId' : 'media.error.invalidSnapshot',
    context: { issueCount }
  }
}

export function createMediaId(value: unknown): Result<MediaId, MediaValidationError> {
  const parsed = mediaIdSchema.safeParse(value)
  return parsed.success
    ? success(parsed.data)
    : failure(invalidMediaValue('INVALID_MEDIA_ID', parsed.error.issues.length))
}

export const parseMediaId = createMediaId

export function isMediaId(value: unknown): value is MediaId {
  return mediaIdSchema.safeParse(value).success
}

export function createMediaCapabilities(
  overrides: Partial<MediaCapabilities> = {}
): MediaCapabilities {
  return mediaCapabilitiesSchema.parse({ ...DEFAULT_MEDIA_CAPABILITIES, ...overrides })
}

export function createMediaSession(value: unknown): Result<MediaSession, MediaValidationError> {
  const parsed = mediaSessionSchema.safeParse(value)
  return parsed.success
    ? success(parsed.data)
    : failure(invalidMediaValue('INVALID_MEDIA_SNAPSHOT', parsed.error.issues.length))
}

export const parseMediaSnapshot = createMediaSession
export const serializeMediaSession = createMediaSession

export function isMediaSnapshot(value: unknown): value is MediaSnapshot {
  return mediaSnapshotSchema.safeParse(value).success
}

export function isControllableMediaState(state: MediaState): boolean {
  return state === 'ready' || state === 'active' || state === 'paused'
}
