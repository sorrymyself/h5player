import * as z from 'zod/mini'
import { CURRENT_EXTENSION_PHASE } from '../../shared/protocol'
import { SETTINGS_SCHEMA_VERSION } from '../../domain/settings'
import { adapterRuntimeDiagnosticSchema } from '../adapter'

const diagnosticEventSchema = z.strictObject({
  timestamp: z.number().check(z.nonnegative()),
  level: z.enum(['error', 'warn', 'info', 'debug']),
  context: z.enum(['background', 'content', 'page-main', 'popup', 'options']),
  module: z.string().check(z.minLength(1), z.maxLength(128)),
  eventCode: z.string().check(z.minLength(1), z.maxLength(128)),
  correlationId: z.optional(z.string().check(z.minLength(1), z.maxLength(128))),
  details: z.optional(z.unknown())
})

export const diagnosticSummarySchema = z.strictObject({
  generatedAt: z.number().check(z.nonnegative()),
  extensionVersion: z.string().check(z.minLength(1), z.maxLength(32)),
  build: z.string().check(z.minLength(1), z.maxLength(128)),
  phase: z.literal(CURRENT_EXTENSION_PHASE),
  protocolVersion: z.literal(1),
  settingsSchemaVersion: z.literal(SETTINGS_SCHEMA_VERSION),
  browser: z.strictObject({
    name: z.string().check(z.minLength(1), z.maxLength(64)),
    version: z.string().check(z.minLength(1), z.maxLength(64)),
    platform: z.string().check(z.minLength(1), z.maxLength(64))
  }),
  permissions: z.strictObject({
    required: z.array(z.string().check(z.minLength(1), z.maxLength(64))),
    origins: z.array(z.string().check(z.minLength(1), z.maxLength(256)))
  }),
  site: z.strictObject({
    hostname: z.nullable(z.string().check(z.minLength(1), z.maxLength(256))),
    frameCount: z.int().check(z.nonnegative()),
    mediaCount: z.int().check(z.nonnegative()),
    activeMedia: z.boolean()
  }),
  settings: z.strictObject({
    revision: z.int().check(z.nonnegative()),
    enabled: z.boolean(),
    siteRuleCount: z.int().check(z.nonnegative()),
    progressCount: z.int().check(z.nonnegative()),
    latestBackupReason: z.nullable(z.string().check(z.minLength(1), z.maxLength(64)))
  }),
  modules: z.array(z.string().check(z.minLength(1), z.maxLength(128))),
  adapters: z.array(z.string().check(z.minLength(1), z.maxLength(128))),
  adapterHealth: z.optional(z.array(adapterRuntimeDiagnosticSchema).check(z.maxLength(32))),
  recentEvents: z.array(diagnosticEventSchema).check(z.maxLength(200)),
  notes: z.array(z.string().check(z.minLength(1), z.maxLength(256))).check(z.maxLength(32))
})

export const diagnosticResponseSchema = z.strictObject({
  summary: diagnosticSummarySchema,
  json: z.string().check(z.minLength(1), z.maxLength(1_048_576))
})

export type DiagnosticEvent = z.infer<typeof diagnosticEventSchema>
export type DiagnosticSummary = z.infer<typeof diagnosticSummarySchema>
export type DiagnosticResponse = z.infer<typeof diagnosticResponseSchema>
