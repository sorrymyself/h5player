import * as z from 'zod/mini'
import { commandResultSchema, mediaCommandSchema } from '../../domain/command'
import { mediaIdSchema, mediaSnapshotSchema } from '../../domain/media'
import { adapterRuntimeDiagnosticsSchema } from '../adapter'

const frameIdSchema = z.int().check(z.nonnegative())
const revisionSchema = z.int().check(z.nonnegative())
const timestampSchema = z.number().check(z.nonnegative())

export const mediaPageStateSchema = z
  .strictObject({
    frameId: frameIdSchema,
    revision: revisionSchema,
    activeMediaId: z.nullable(mediaIdSchema),
    media: z.array(mediaSnapshotSchema).check(z.maxLength(128)),
    adapters: z.optional(adapterRuntimeDiagnosticsSchema),
    observedAt: timestampSchema
  })
  .check(
    z.refine((state) => {
      if (state.activeMediaId === null) return state.media.length === 0
      return state.media.some((snapshot) => snapshot.id === state.activeMediaId)
    })
  )

/**
 * Bounded event payload used by the page bridge to tell isolated content that
 * the media graph changed. Consumers can then explicitly request the complete
 * state; the notification never carries the potentially large media array.
 */
export const mediaPageStateSummarySchema = z.strictObject({
  frameId: frameIdSchema,
  revision: revisionSchema,
  activeMediaId: z.nullable(mediaIdSchema),
  mediaCount: z.int().check(z.nonnegative(), z.lte(128)),
  adapters: z.optional(adapterRuntimeDiagnosticsSchema),
  observedAt: timestampSchema
})

export const mediaGetStatePayloadSchema = z.strictObject({})

export const experimentalEnsureMainResponseSchema = z.strictObject({
  injected: z.boolean(),
  allowed: z.boolean()
})

export const mediaExecutePayloadSchema = z.strictObject({
  command: mediaCommandSchema,
  playbackRateScope: z.optional(z.union([z.literal('site'), z.literal('page'), z.literal('media')]))
})

export const mediaCommandResultResponseSchema = z.strictObject({
  result: commandResultSchema,
  state: mediaPageStateSchema
})

export type MediaPageState = z.infer<typeof mediaPageStateSchema>
export type MediaPageStateSummary = z.infer<typeof mediaPageStateSummarySchema>
export type MediaExecutePayload = z.infer<typeof mediaExecutePayloadSchema>
export type MediaCommandResultResponse = z.infer<typeof mediaCommandResultResponseSchema>
export type ExperimentalEnsureMainResponse = z.infer<typeof experimentalEnsureMainResponseSchema>
