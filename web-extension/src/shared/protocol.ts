import * as z from 'zod/mini'
import { createRequestId } from './ids'

export const PROTOCOL_VERSION = 1 as const
export const CURRENT_EXTENSION_PHASE = 6 as const

const requestIdSchema = z.string().check(z.minLength(16), z.maxLength(128))
const sessionIdSchema = z.string().check(z.minLength(16), z.maxLength(128))
const nonceSchema = z.string().check(z.regex(/^[a-f0-9]{64}$/))
const tabIdSchema = z.int().check(z.nonnegative())
const frameIdSchema = z.int().check(z.nonnegative())

export const runtimeRequestTypeSchema = z.enum([
  'protocol.cancel',
  'system.ping',
  'settings.get',
  'settings.update',
  'playback.set-site-intent',
  'settings.export',
  'settings.import',
  'settings.restore-backup',
  'settings.reset',
  'site.get-context',
  'site.set-temporary-disabled',
  'site.set-page-ui-hidden',
  'site.report-frame-state',
  'site.reconcile',
  'diagnostics.get',
  'experimental.ensure-main',
  'media.get-state',
  'media.execute',
  'media.picture-in-picture.presence',
  'media.picture-in-picture.get-state',
  'media.picture-in-picture.execute',
  'media.cross-tab.publish',
  'progress.read',
  'progress.save',
  'progress.delete',
  'progress.toggle-restore',
  'progress.prune'
])

export const runtimeClientSourceSchema = z.enum(['content', 'popup', 'options'])

export const protocolErrorCodeSchema = z.enum([
  'INVALID_ENVELOPE',
  'INVALID_PAYLOAD',
  'UNKNOWN_MESSAGE',
  'UNAUTHORIZED_SOURCE',
  'REPLAY_DETECTED',
  'REQUEST_TIMEOUT',
  'REQUEST_CANCELLED',
  'TRANSPORT_UNAVAILABLE',
  'REVISION_CONFLICT',
  'STORAGE_CORRUPT',
  'MIGRATION_FAILED',
  'IMPORT_INVALID',
  'FUTURE_SCHEMA',
  'PERMISSION_DENIED',
  'TARGET_UNAVAILABLE',
  'INTERNAL_ERROR'
])

export const runtimeRequestEnvelopeSchema = z.strictObject({
  protocol: z.literal(PROTOCOL_VERSION),
  type: runtimeRequestTypeSchema,
  requestId: requestIdSchema,
  source: runtimeClientSourceSchema,
  tabId: z.optional(tabIdSchema),
  frameId: z.optional(frameIdSchema),
  sessionId: z.optional(sessionIdSchema),
  nonce: z.optional(nonceSchema),
  payload: z.unknown()
})

const protocolErrorSchema = z.strictObject({
  code: protocolErrorCodeSchema,
  messageKey: z.string().check(z.minLength(1), z.maxLength(128)),
  retryable: z.boolean()
})

export const runtimeSuccessEnvelopeSchema = z.strictObject({
  protocol: z.literal(PROTOCOL_VERSION),
  type: z.literal('protocol.response'),
  requestId: requestIdSchema,
  source: z.literal('background'),
  tabId: z.optional(tabIdSchema),
  frameId: z.optional(frameIdSchema),
  sessionId: z.optional(sessionIdSchema),
  payload: z.strictObject({
    requestType: runtimeRequestTypeSchema,
    data: z.unknown()
  })
})

export const runtimeErrorEnvelopeSchema = z.strictObject({
  protocol: z.literal(PROTOCOL_VERSION),
  type: z.literal('protocol.error'),
  requestId: requestIdSchema,
  source: z.literal('background'),
  tabId: z.optional(tabIdSchema),
  frameId: z.optional(frameIdSchema),
  sessionId: z.optional(sessionIdSchema),
  payload: z.strictObject({
    requestType: runtimeRequestTypeSchema,
    error: protocolErrorSchema
  })
})

export const runtimeResponseEnvelopeSchema = z.union([
  runtimeSuccessEnvelopeSchema,
  runtimeErrorEnvelopeSchema
])

export const bridgeMessageTypeSchema = z.enum([
  'bridge.init',
  'bridge.ready',
  'bridge.ping',
  'bridge.pong',
  'bridge.dispose'
])

export const bridgeMessageSchema = z.strictObject({
  protocol: z.literal(PROTOCOL_VERSION),
  type: bridgeMessageTypeSchema,
  requestId: requestIdSchema,
  source: z.enum(['content', 'page-main']),
  sessionId: sessionIdSchema,
  nonce: nonceSchema,
  payload: z.strictObject({})
})

export type RuntimeRequestType = z.infer<typeof runtimeRequestTypeSchema>
export type RuntimeClientSource = z.infer<typeof runtimeClientSourceSchema>
export type ProtocolErrorCode = z.infer<typeof protocolErrorCodeSchema>
export type RuntimeRequestEnvelope = z.infer<typeof runtimeRequestEnvelopeSchema>
export type RuntimeSuccessEnvelope = z.infer<typeof runtimeSuccessEnvelopeSchema>
export type RuntimeErrorEnvelope = z.infer<typeof runtimeErrorEnvelopeSchema>
export type RuntimeResponseEnvelope = z.infer<typeof runtimeResponseEnvelopeSchema>
export type BridgeMessage = z.infer<typeof bridgeMessageSchema>
export type BridgeMessageType = z.infer<typeof bridgeMessageTypeSchema>

export type EnvelopeContext = {
  tabId?: number
  frameId?: number
  sessionId?: string
  nonce?: string
}

function applyEnvelopeContext<T extends object>(target: T, context: EnvelopeContext): T {
  return Object.assign(target, context)
}

export function createRuntimeRequest(
  source: RuntimeClientSource,
  type: RuntimeRequestType,
  payload: unknown,
  context: EnvelopeContext = {}
): RuntimeRequestEnvelope {
  return applyEnvelopeContext(
    {
      protocol: PROTOCOL_VERSION,
      type,
      requestId: createRequestId(),
      source,
      payload
    },
    context
  )
}

export function createRuntimeSuccess(
  request: RuntimeRequestEnvelope,
  data: unknown,
  context: EnvelopeContext = {}
): RuntimeSuccessEnvelope {
  return applyEnvelopeContext(
    {
      protocol: PROTOCOL_VERSION,
      type: 'protocol.response',
      requestId: request.requestId,
      source: 'background',
      payload: { requestType: request.type, data }
    },
    context
  )
}

export function createRuntimeError(
  request: RuntimeRequestEnvelope,
  code: ProtocolErrorCode,
  messageKey: string,
  retryable = false,
  context: EnvelopeContext = {}
): RuntimeErrorEnvelope {
  return applyEnvelopeContext(
    {
      protocol: PROTOCOL_VERSION,
      type: 'protocol.error',
      requestId: request.requestId,
      source: 'background',
      payload: {
        requestType: request.type,
        error: { code, messageKey, retryable }
      }
    },
    context
  )
}

export function createBridgeMessage(
  type: BridgeMessageType,
  source: BridgeMessage['source'],
  sessionId: string,
  nonce: string,
  requestId = createRequestId()
): BridgeMessage {
  return {
    protocol: PROTOCOL_VERSION,
    type,
    requestId,
    source,
    sessionId,
    nonce,
    payload: {}
  }
}

export function parseRuntimeRequest(value: unknown): RuntimeRequestEnvelope | null {
  const result = runtimeRequestEnvelopeSchema.safeParse(value)
  return result.success ? result.data : null
}

export function parseRuntimeResponse(value: unknown): RuntimeResponseEnvelope | null {
  const result = runtimeResponseEnvelopeSchema.safeParse(value)
  return result.success ? result.data : null
}

export function parseBridgeMessage(value: unknown): BridgeMessage | null {
  const result = bridgeMessageSchema.safeParse(value)
  return result.success ? result.data : null
}
