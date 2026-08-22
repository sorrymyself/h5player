import * as z from 'zod/mini'
import {
  type MediaController,
  fullscreenRequestModeSchema,
  mediaIdSchema,
  mediaSnapshotSchema,
  visualFilterNameSchema,
  type MediaCapabilities,
  type MediaId,
  type MediaSnapshot
} from '../media'
import { captureArtifactSchema, captureMimeTypeSchema } from '../capture'
import type { Result } from '../../shared/result'

const finiteNumberSchema = z.number()
export const playCommandSchema = z.strictObject({
  type: z.literal('media.play'),
  mediaId: mediaIdSchema
})
export const pauseCommandSchema = z.strictObject({
  type: z.literal('media.pause'),
  mediaId: mediaIdSchema
})
export const seekCommandSchema = z.strictObject({
  type: z.literal('media.seek'),
  mediaId: mediaIdSchema,
  deltaSeconds: finiteNumberSchema
})
export const stepFrameCommandSchema = z.strictObject({
  type: z.literal('media.step-frame'),
  mediaId: mediaIdSchema,
  frames: z.int().check(z.gte(-120), z.lte(120))
})
export const setRateCommandSchema = z.strictObject({
  type: z.literal('media.set-rate'),
  mediaId: mediaIdSchema,
  value: finiteNumberSchema
})
export const adjustRateCommandSchema = z.strictObject({
  type: z.literal('media.adjust-rate'),
  mediaId: mediaIdSchema,
  delta: finiteNumberSchema
})
export const setVolumeCommandSchema = z.strictObject({
  type: z.literal('media.set-volume'),
  mediaId: mediaIdSchema,
  value: finiteNumberSchema
})
export const adjustVolumeCommandSchema = z.strictObject({
  type: z.literal('media.adjust-volume'),
  mediaId: mediaIdSchema,
  delta: finiteNumberSchema
})
export const setGainCommandSchema = z.strictObject({
  type: z.literal('media.set-gain'),
  mediaId: mediaIdSchema,
  value: finiteNumberSchema
})
export const adjustGainCommandSchema = z.strictObject({
  type: z.literal('media.adjust-gain'),
  mediaId: mediaIdSchema,
  delta: finiteNumberSchema
})
export const setMutedCommandSchema = z.strictObject({
  type: z.literal('media.set-muted'),
  mediaId: mediaIdSchema,
  value: z.boolean()
})
export const toggleMuteCommandSchema = z.strictObject({
  type: z.literal('media.toggle-mute'),
  mediaId: mediaIdSchema
})
export const setZoomCommandSchema = z.strictObject({
  type: z.literal('media.set-zoom'),
  mediaId: mediaIdSchema,
  value: finiteNumberSchema
})
export const panCommandSchema = z.strictObject({
  type: z.literal('media.pan'),
  mediaId: mediaIdSchema,
  deltaX: finiteNumberSchema,
  deltaY: finiteNumberSchema
})
export const rotateCommandSchema = z.strictObject({
  type: z.literal('media.rotate'),
  mediaId: mediaIdSchema,
  deltaDegrees: finiteNumberSchema
})
export const toggleFlipCommandSchema = z.strictObject({
  type: z.literal('media.toggle-flip'),
  mediaId: mediaIdSchema,
  axis: z.enum(['horizontal', 'vertical'])
})
export const setFilterCommandSchema = z.strictObject({
  type: z.literal('media.set-filter'),
  mediaId: mediaIdSchema,
  filter: visualFilterNameSchema,
  value: finiteNumberSchema
})
export const resetVisualCommandSchema = z.strictObject({
  type: z.literal('media.reset-visual'),
  mediaId: mediaIdSchema
})
export const resetTransformCommandSchema = z.strictObject({
  type: z.literal('media.reset-transform'),
  mediaId: mediaIdSchema
})
export const toggleFullscreenCommandSchema = z.strictObject({
  type: z.literal('media.toggle-fullscreen'),
  mediaId: mediaIdSchema,
  mode: fullscreenRequestModeSchema
})
export const togglePictureInPictureCommandSchema = z.strictObject({
  type: z.literal('media.toggle-picture-in-picture'),
  mediaId: mediaIdSchema
})
export const captureCommandSchema = z.strictObject({
  type: z.literal('media.capture'),
  mediaId: mediaIdSchema,
  mimeType: z.optional(captureMimeTypeSchema),
  quality: z.optional(z.number().check(z.gte(0), z.lte(1)))
})
export const downloadCommandSchema = z.strictObject({
  type: z.literal('media.download'),
  mediaId: mediaIdSchema
})
export const playNextCommandSchema = z.strictObject({
  type: z.literal('media.play-next'),
  mediaId: mediaIdSchema
})

export const mediaCommandSchema = z.union([
  playCommandSchema,
  pauseCommandSchema,
  seekCommandSchema,
  stepFrameCommandSchema,
  setRateCommandSchema,
  adjustRateCommandSchema,
  setVolumeCommandSchema,
  adjustVolumeCommandSchema,
  setGainCommandSchema,
  adjustGainCommandSchema,
  setMutedCommandSchema,
  toggleMuteCommandSchema,
  setZoomCommandSchema,
  panCommandSchema,
  rotateCommandSchema,
  toggleFlipCommandSchema,
  setFilterCommandSchema,
  resetVisualCommandSchema,
  resetTransformCommandSchema,
  toggleFullscreenCommandSchema,
  togglePictureInPictureCommandSchema,
  captureCommandSchema,
  downloadCommandSchema,
  playNextCommandSchema
])

export const MEDIA_COMMAND_TYPES = [
  'media.play',
  'media.pause',
  'media.seek',
  'media.step-frame',
  'media.set-rate',
  'media.adjust-rate',
  'media.set-volume',
  'media.adjust-volume',
  'media.set-gain',
  'media.adjust-gain',
  'media.set-muted',
  'media.toggle-mute',
  'media.set-zoom',
  'media.pan',
  'media.rotate',
  'media.toggle-flip',
  'media.set-filter',
  'media.reset-visual',
  'media.reset-transform',
  'media.toggle-fullscreen',
  'media.toggle-picture-in-picture',
  'media.capture',
  'media.download',
  'media.play-next'
] as const

export const mediaCommandTypeSchema = z.enum(MEDIA_COMMAND_TYPES)

export type PlayCommand = z.infer<typeof playCommandSchema>
export type PauseCommand = z.infer<typeof pauseCommandSchema>
export type SeekCommand = z.infer<typeof seekCommandSchema>
export type StepFrameCommand = z.infer<typeof stepFrameCommandSchema>
export type SetRateCommand = z.infer<typeof setRateCommandSchema>
export type AdjustRateCommand = z.infer<typeof adjustRateCommandSchema>
export type SetVolumeCommand = z.infer<typeof setVolumeCommandSchema>
export type AdjustVolumeCommand = z.infer<typeof adjustVolumeCommandSchema>
export type SetGainCommand = z.infer<typeof setGainCommandSchema>
export type AdjustGainCommand = z.infer<typeof adjustGainCommandSchema>
export type SetMutedCommand = z.infer<typeof setMutedCommandSchema>
export type ToggleMuteCommand = z.infer<typeof toggleMuteCommandSchema>
export type SetZoomCommand = z.infer<typeof setZoomCommandSchema>
export type PanCommand = z.infer<typeof panCommandSchema>
export type RotateCommand = z.infer<typeof rotateCommandSchema>
export type ToggleFlipCommand = z.infer<typeof toggleFlipCommandSchema>
export type SetFilterCommand = z.infer<typeof setFilterCommandSchema>
export type ResetVisualCommand = z.infer<typeof resetVisualCommandSchema>
export type ResetTransformCommand = z.infer<typeof resetTransformCommandSchema>
export type ToggleFullscreenCommand = z.infer<typeof toggleFullscreenCommandSchema>
export type TogglePictureInPictureCommand = z.infer<typeof togglePictureInPictureCommandSchema>
export type CaptureCommand = z.infer<typeof captureCommandSchema>
export type DownloadCommand = z.infer<typeof downloadCommandSchema>
export type PlayNextCommand = z.infer<typeof playNextCommandSchema>
export type MediaCommand = z.infer<typeof mediaCommandSchema>
export type MediaCommandType = MediaCommand['type']

export type CommandForType<T extends MediaCommandType> = Extract<MediaCommand, { type: T }>

export type CommandDiagnosticValue = string | number | boolean | null
export type CommandDiagnosticContext = Readonly<Record<string, CommandDiagnosticValue>>

export type CommandErrorCode =
  | 'INVALID_COMMAND'
  | 'COMMAND_NOT_REGISTERED'
  | 'COMMAND_ALREADY_REGISTERED'
  | 'INVALID_COMMAND_HANDLER'
  | 'MEDIA_NOT_FOUND'
  | 'MEDIA_UNAVAILABLE'
  | 'INVALID_MEDIA_SNAPSHOT'
  | 'CAPABILITY_UNAVAILABLE'
  | 'INVALID_COMMAND_RESULT'
  | 'COMMAND_EXECUTION_FAILED'
  | 'CAPTURE_NOT_READY'
  | 'CAPTURE_BLOCKED'
  | 'CAPTURE_TOO_LARGE'
  | 'CAPTURE_FAILED'
  | 'DOWNLOAD_UNAVAILABLE'
  | 'DOWNLOAD_BLOCKED'
  | 'DOWNLOAD_TOO_LARGE'
  | 'DOWNLOAD_FAILED'
  | 'DOWNLOAD_CANCELLED'

export type CommandErrorMessageKey =
  | 'command.error.invalidInput'
  | 'command.error.notRegistered'
  | 'command.error.alreadyRegistered'
  | 'command.error.invalidHandler'
  | 'command.error.mediaNotFound'
  | 'command.error.mediaUnavailable'
  | 'command.error.invalidMediaSnapshot'
  | 'command.error.capabilityUnavailable'
  | 'command.error.invalidResult'
  | 'command.error.executionFailed'
  | 'capture.error.notReady'
  | 'capture.error.blocked'
  | 'capture.error.tooLarge'
  | 'capture.error.failed'
  | 'download.error.unavailable'
  | 'download.error.blocked'
  | 'download.error.tooLarge'
  | 'download.error.failed'
  | 'download.error.cancelled'

export interface CommandError {
  readonly code: CommandErrorCode
  readonly messageKey: CommandErrorMessageKey
  readonly context?: CommandDiagnosticContext
}

export interface CommandSuccess {
  readonly commandType: MediaCommandType
  readonly mediaId: MediaId
  readonly changed: boolean
  readonly snapshot: MediaSnapshot
  readonly artifact?: z.infer<typeof captureArtifactSchema> | undefined
}

export type CommandResult = Result<CommandSuccess, CommandError>
export type CommandSuccessResult = { readonly ok: true; readonly value: CommandSuccess }

export interface ResolvedCommandContext {
  readonly controller: MediaController
  readonly snapshot: MediaSnapshot
}

export interface CommandHandler<C extends MediaCommand = MediaCommand> {
  readonly type: C['type']
  readonly requiredCapability?: keyof MediaCapabilities
  execute(command: C, context: ResolvedCommandContext): Promise<CommandResult>
}

export const commandSuccessSchema = z.strictObject({
  commandType: mediaCommandTypeSchema,
  mediaId: mediaIdSchema,
  changed: z.boolean(),
  snapshot: mediaSnapshotSchema,
  artifact: z.optional(captureArtifactSchema)
})

const diagnosticValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
const diagnosticContextSchema = z
  .record(z.string().check(z.minLength(1), z.maxLength(64)), diagnosticValueSchema)
  .check(z.refine((value) => Object.keys(value).length <= 16))

export const commandErrorSchema = z.strictObject({
  code: z.enum([
    'INVALID_COMMAND',
    'COMMAND_NOT_REGISTERED',
    'COMMAND_ALREADY_REGISTERED',
    'INVALID_COMMAND_HANDLER',
    'MEDIA_NOT_FOUND',
    'MEDIA_UNAVAILABLE',
    'INVALID_MEDIA_SNAPSHOT',
    'CAPABILITY_UNAVAILABLE',
    'INVALID_COMMAND_RESULT',
    'COMMAND_EXECUTION_FAILED',
    'CAPTURE_NOT_READY',
    'CAPTURE_BLOCKED',
    'CAPTURE_TOO_LARGE',
    'CAPTURE_FAILED',
    'DOWNLOAD_UNAVAILABLE',
    'DOWNLOAD_BLOCKED',
    'DOWNLOAD_TOO_LARGE',
    'DOWNLOAD_FAILED',
    'DOWNLOAD_CANCELLED'
  ]),
  messageKey: z.enum([
    'command.error.invalidInput',
    'command.error.notRegistered',
    'command.error.alreadyRegistered',
    'command.error.invalidHandler',
    'command.error.mediaNotFound',
    'command.error.mediaUnavailable',
    'command.error.invalidMediaSnapshot',
    'command.error.capabilityUnavailable',
    'command.error.invalidResult',
    'command.error.executionFailed',
    'capture.error.notReady',
    'capture.error.blocked',
    'capture.error.tooLarge',
    'capture.error.failed',
    'download.error.unavailable',
    'download.error.blocked',
    'download.error.tooLarge',
    'download.error.failed',
    'download.error.cancelled'
  ]),
  context: z.optional(diagnosticContextSchema)
})

export const commandResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), value: commandSuccessSchema }),
  z.strictObject({ ok: z.literal(false), error: commandErrorSchema })
])

export function commandSuccess(
  command: MediaCommand,
  snapshot: MediaSnapshot,
  changed: boolean,
  artifact?: z.infer<typeof captureArtifactSchema>
): CommandSuccessResult {
  return {
    ok: true,
    value: {
      commandType: command.type,
      mediaId: command.mediaId,
      changed,
      snapshot,
      ...(artifact === undefined ? {} : { artifact })
    }
  }
}
