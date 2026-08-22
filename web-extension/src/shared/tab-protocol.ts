import * as z from 'zod/mini'
import { createRequestId } from './ids'
import { PROTOCOL_VERSION } from './protocol'

const requestIdSchema = z.string().check(z.minLength(16), z.maxLength(128))

export const tabRequestTypeSchema = z.enum([
  'media.get-state',
  'media.execute',
  'media.picture-in-picture.owner-changed',
  'media.cross-tab.event',
  'site.get-state',
  'site.refresh-frame-state',
  'site.set-temporary-disabled',
  'site.set-page-ui-hidden',
  'site.permission-revoked'
])

export const tabRequestEnvelopeSchema = z.strictObject({
  protocol: z.literal(PROTOCOL_VERSION),
  type: tabRequestTypeSchema,
  requestId: requestIdSchema,
  source: z.literal('background'),
  payload: z.unknown()
})

export const tabTransportErrorCodeSchema = z.enum([
  'INVALID_ENVELOPE',
  'INVALID_PAYLOAD',
  'UNAUTHORIZED_SOURCE',
  'REPLAY_DETECTED',
  'PAGE_RUNTIME_UNAVAILABLE',
  'INTERNAL_ERROR'
])

const tabTransportErrorSchema = z.strictObject({
  code: tabTransportErrorCodeSchema,
  messageKey: z.string().check(z.minLength(1), z.maxLength(128)),
  retryable: z.boolean()
})

export const tabSuccessEnvelopeSchema = z.strictObject({
  protocol: z.literal(PROTOCOL_VERSION),
  type: z.literal('protocol.response'),
  requestId: requestIdSchema,
  source: z.literal('content'),
  payload: z.strictObject({
    requestType: tabRequestTypeSchema,
    data: z.unknown()
  })
})

export const tabErrorEnvelopeSchema = z.strictObject({
  protocol: z.literal(PROTOCOL_VERSION),
  type: z.literal('protocol.error'),
  requestId: requestIdSchema,
  source: z.literal('content'),
  payload: z.strictObject({
    requestType: tabRequestTypeSchema,
    error: tabTransportErrorSchema
  })
})

export const tabResponseEnvelopeSchema = z.union([tabSuccessEnvelopeSchema, tabErrorEnvelopeSchema])

export type TabRequestType = z.infer<typeof tabRequestTypeSchema>
export type TabRequestEnvelope = z.infer<typeof tabRequestEnvelopeSchema>
export type TabTransportErrorCode = z.infer<typeof tabTransportErrorCodeSchema>
export type TabResponseEnvelope = z.infer<typeof tabResponseEnvelopeSchema>

export function createTabRequest(type: TabRequestType, payload: unknown): TabRequestEnvelope {
  return {
    protocol: PROTOCOL_VERSION,
    type,
    requestId: createRequestId(),
    source: 'background',
    payload
  }
}

export function createTabSuccess(
  request: TabRequestEnvelope,
  data: unknown
): z.infer<typeof tabSuccessEnvelopeSchema> {
  return {
    protocol: PROTOCOL_VERSION,
    type: 'protocol.response',
    requestId: request.requestId,
    source: 'content',
    payload: { requestType: request.type, data }
  }
}

export function createTabError(
  request: TabRequestEnvelope,
  code: TabTransportErrorCode,
  messageKey: string,
  retryable = false
): z.infer<typeof tabErrorEnvelopeSchema> {
  return {
    protocol: PROTOCOL_VERSION,
    type: 'protocol.error',
    requestId: request.requestId,
    source: 'content',
    payload: {
      requestType: request.type,
      error: { code, messageKey, retryable }
    }
  }
}

export function parseTabRequest(value: unknown): TabRequestEnvelope | null {
  const parsed = tabRequestEnvelopeSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parseTabResponse(value: unknown): TabResponseEnvelope | null {
  const parsed = tabResponseEnvelopeSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
