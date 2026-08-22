import * as z from 'zod/mini'
import {
  siteAdapterPageActionResponseSchema,
  siteAdapterPageActionSchema
} from '../../application/adapter/contracts'
import {
  mediaCommandResultResponseSchema,
  mediaPageStateSchema,
  mediaPageStateSummarySchema
} from '../../application/media'
import { mediaCommandSchema } from '../../domain/command'
import {
  mediaDownloadEventSchema,
  mediaDownloadIntentIdSchema,
  mediaDownloadPreparationSchema
} from '../../domain/download'
import { mediaIdSchema } from '../../domain/media'
import { createRequestId } from '../../shared/ids'
import { PROTOCOL_VERSION } from '../../shared/protocol'

const requestIdSchema = z.string().check(z.minLength(16), z.maxLength(128))
const sessionIdSchema = z.string().check(z.minLength(16), z.maxLength(128))
const nonceSchema = z.string().check(z.regex(/^[a-f0-9]{64}$/))
const frameIdSchema = z.int().check(z.nonnegative())

export const mediaAuthorityPolicySchema = z.strictObject({
  playbackRate: z.boolean(),
  volume: z.boolean(),
  currentTime: z.boolean()
})

export type MediaAuthorityPolicy = z.infer<typeof mediaAuthorityPolicySchema>

export const experimentalMediaPolicySchema = z.strictObject({
  mediaDownload: z.boolean()
})

export type ExperimentalMediaPolicy = z.infer<typeof experimentalMediaPolicySchema>

const baseShape = {
  protocol: z.literal(PROTOCOL_VERSION),
  requestId: requestIdSchema,
  sessionId: sessionIdSchema,
  nonce: nonceSchema
}

export const pageMediaMessageSchema = z.union([
  z.strictObject({
    ...baseShape,
    type: z.literal('media.context'),
    source: z.literal('content'),
    payload: z.strictObject({
      frameId: frameIdSchema,
      siteOrigin: z.optional(z.string().check(z.minLength(1), z.maxLength(256)))
    })
  }),
  z.strictObject({
    ...baseShape,
    type: z.literal('media.configure-experimental'),
    source: z.literal('content'),
    payload: z.strictObject({ policy: experimentalMediaPolicySchema })
  }),
  z.strictObject({
    ...baseShape,
    type: z.literal('media.experimental-configured'),
    source: z.literal('page-main'),
    payload: z.strictObject({ policy: experimentalMediaPolicySchema })
  }),
  z.strictObject({
    ...baseShape,
    type: z.literal('media.context-ready'),
    source: z.literal('page-main'),
    payload: z.strictObject({})
  }),
  z.strictObject({
    ...baseShape,
    type: z.literal('media.configure-authority'),
    source: z.literal('content'),
    payload: z.strictObject({ policy: mediaAuthorityPolicySchema })
  }),
  z.strictObject({
    ...baseShape,
    type: z.literal('media.authority-configured'),
    source: z.literal('page-main'),
    payload: z.strictObject({ policy: mediaAuthorityPolicySchema })
  }),
  z.strictObject({
    ...baseShape,
    type: z.literal('media.get-state'),
    source: z.literal('content'),
    payload: z.strictObject({})
  }),
  z.strictObject({
    ...baseShape,
    type: z.literal('media.state'),
    source: z.literal('page-main'),
    payload: z.strictObject({ state: mediaPageStateSchema })
  }),
  z.strictObject({
    ...baseShape,
    type: z.literal('media.state-changed'),
    source: z.literal('page-main'),
    payload: z.strictObject({ summary: mediaPageStateSummarySchema })
  }),
  z.strictObject({
    ...baseShape,
    type: z.literal('media.execute'),
    source: z.literal('content'),
    payload: z.strictObject({ command: mediaCommandSchema })
  }),
  z.strictObject({
    ...baseShape,
    type: z.literal('media.prepare-download'),
    source: z.literal('content'),
    payload: z.strictObject({
      mediaId: mediaIdSchema,
      intentId: mediaDownloadIntentIdSchema
    })
  }),
  z.strictObject({
    ...baseShape,
    type: z.literal('media.download-prepared'),
    source: z.literal('page-main'),
    payload: z.strictObject({ preparation: mediaDownloadPreparationSchema })
  }),
  z.strictObject({
    ...baseShape,
    type: z.literal('media.cancel-download'),
    source: z.literal('content'),
    payload: z.strictObject({ mediaId: mediaIdSchema })
  }),
  z.strictObject({
    ...baseShape,
    type: z.literal('media.download-cancelled'),
    source: z.literal('page-main'),
    payload: z.strictObject({ cancelled: z.boolean() })
  }),
  z.strictObject({
    ...baseShape,
    type: z.literal('media.download-event'),
    source: z.literal('page-main'),
    payload: z.strictObject({ event: mediaDownloadEventSchema })
  }),
  z.strictObject({
    ...baseShape,
    type: z.literal('media.execute-page-action'),
    source: z.literal('content'),
    payload: z.strictObject({ action: siteAdapterPageActionSchema })
  }),
  z.strictObject({
    ...baseShape,
    type: z.literal('media.page-action-result'),
    source: z.literal('page-main'),
    payload: siteAdapterPageActionResponseSchema
  }),
  z.strictObject({
    ...baseShape,
    type: z.literal('media.command-result'),
    source: z.literal('page-main'),
    payload: mediaCommandResultResponseSchema
  }),
  z.strictObject({
    ...baseShape,
    type: z.literal('media.error'),
    source: z.literal('page-main'),
    payload: z.strictObject({
      requestType: z.enum([
        'media.context',
        'media.configure-authority',
        'media.configure-experimental',
        'media.get-state',
        'media.prepare-download',
        'media.cancel-download',
        'media.execute',
        'media.execute-page-action'
      ]),
      code: z.enum(['INVALID_PAYLOAD', 'RUNTIME_UNAVAILABLE', 'INTERNAL_ERROR']),
      messageKey: z.string().check(z.minLength(1), z.maxLength(128))
    })
  })
])

export type PageMediaMessage = z.infer<typeof pageMediaMessageSchema>
export type PageMediaMessageType = PageMediaMessage['type']
export type PageMediaRequestType =
  | 'media.context'
  | 'media.configure-authority'
  | 'media.configure-experimental'
  | 'media.get-state'
  | 'media.prepare-download'
  | 'media.cancel-download'
  | 'media.execute'
  | 'media.execute-page-action'
export type PageMediaResponseType =
  | 'media.context-ready'
  | 'media.authority-configured'
  | 'media.experimental-configured'
  | 'media.state'
  | 'media.state-changed'
  | 'media.download-prepared'
  | 'media.download-cancelled'
  | 'media.download-event'
  | 'media.command-result'
  | 'media.page-action-result'
  | 'media.error'
export type PageMediaMessageForType<T extends PageMediaMessageType> = Extract<
  PageMediaMessage,
  { type: T }
>

export type PageMediaPayloadByType = {
  'media.context': { frameId: number; siteOrigin?: string | undefined }
  'media.context-ready': Record<string, never>
  'media.configure-authority': { policy: z.infer<typeof mediaAuthorityPolicySchema> }
  'media.authority-configured': { policy: z.infer<typeof mediaAuthorityPolicySchema> }
  'media.configure-experimental': { policy: z.infer<typeof experimentalMediaPolicySchema> }
  'media.experimental-configured': { policy: z.infer<typeof experimentalMediaPolicySchema> }
  'media.get-state': Record<string, never>
  'media.prepare-download': { mediaId: string; intentId: string }
  'media.cancel-download': { mediaId: string }
  'media.download-prepared': { preparation: z.infer<typeof mediaDownloadPreparationSchema> }
  'media.download-cancelled': { cancelled: boolean }
  'media.download-event': { event: z.infer<typeof mediaDownloadEventSchema> }
  'media.state': { state: z.infer<typeof mediaPageStateSchema> }
  'media.state-changed': { summary: z.infer<typeof mediaPageStateSummarySchema> }
  'media.execute': { command: z.infer<typeof mediaCommandSchema> }
  'media.command-result': z.infer<typeof mediaCommandResultResponseSchema>
  'media.execute-page-action': { action: z.infer<typeof siteAdapterPageActionSchema> }
  'media.page-action-result': z.infer<typeof siteAdapterPageActionResponseSchema>
  'media.error': {
    requestType:
      | 'media.context'
      | 'media.configure-authority'
      | 'media.configure-experimental'
      | 'media.get-state'
      | 'media.prepare-download'
      | 'media.cancel-download'
      | 'media.execute'
      | 'media.execute-page-action'
    code: 'INVALID_PAYLOAD' | 'RUNTIME_UNAVAILABLE' | 'INTERNAL_ERROR'
    messageKey: string
  }
}

type PageMediaSourceByType = {
  'media.context': 'content'
  'media.context-ready': 'page-main'
  'media.configure-authority': 'content'
  'media.authority-configured': 'page-main'
  'media.configure-experimental': 'content'
  'media.experimental-configured': 'page-main'
  'media.get-state': 'content'
  'media.prepare-download': 'content'
  'media.cancel-download': 'content'
  'media.download-prepared': 'page-main'
  'media.download-cancelled': 'page-main'
  'media.download-event': 'page-main'
  'media.state': 'page-main'
  'media.state-changed': 'page-main'
  'media.execute': 'content'
  'media.command-result': 'page-main'
  'media.execute-page-action': 'content'
  'media.page-action-result': 'page-main'
  'media.error': 'page-main'
}

export function createPageMediaMessage<T extends PageMediaMessageType>(
  type: T,
  source: PageMediaSourceByType[T],
  sessionId: string,
  nonce: string,
  payload: PageMediaPayloadByType[T],
  requestId = createRequestId()
): PageMediaMessageForType<T> {
  return pageMediaMessageSchema.parse({
    protocol: PROTOCOL_VERSION,
    type,
    requestId,
    source,
    sessionId,
    nonce,
    payload
  }) as PageMediaMessageForType<T>
}

export function createPageMediaRequest<T extends PageMediaRequestType>(
  type: T,
  sessionId: string,
  nonce: string,
  payload: PageMediaPayloadByType[T],
  requestId = createRequestId()
): PageMediaMessageForType<T> {
  return createPageMediaMessage(type, 'content', sessionId, nonce, payload, requestId)
}

export function createPageMediaResponse<T extends PageMediaResponseType>(
  type: T,
  sessionId: string,
  nonce: string,
  payload: PageMediaPayloadByType[T],
  requestId: string
): PageMediaMessageForType<T> {
  return createPageMediaMessage(type, 'page-main', sessionId, nonce, payload, requestId)
}

export function createPageMediaNotification(
  sessionId: string,
  nonce: string,
  summary: z.infer<typeof mediaPageStateSummarySchema>,
  requestId = createRequestId()
): PageMediaMessageForType<'media.state-changed'> {
  return createPageMediaMessage(
    'media.state-changed',
    'page-main',
    sessionId,
    nonce,
    { summary },
    requestId
  )
}

export function createPageMediaDownloadNotification(
  sessionId: string,
  nonce: string,
  event: z.infer<typeof mediaDownloadEventSchema>,
  requestId = createRequestId()
): PageMediaMessageForType<'media.download-event'> {
  return createPageMediaMessage(
    'media.download-event',
    'page-main',
    sessionId,
    nonce,
    { event },
    requestId
  )
}

export function parsePageMediaMessage(value: unknown): PageMediaMessage | null {
  const parsed = pageMediaMessageSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
