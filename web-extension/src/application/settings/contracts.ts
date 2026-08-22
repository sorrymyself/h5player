import * as z from 'zod/mini'
import {
  persistedSettingsV2Schema,
  SETTINGS_SCHEMA_VERSION,
  settingsPatchSchema,
  settingsBackupSchema
} from '../../domain/settings'
import { CURRENT_EXTENSION_PHASE } from '../../shared/protocol'

const revisionSchema = z.int().check(z.nonnegative())

export const emptyPayloadSchema = z.strictObject({})

export const settingsUpdatePayloadSchema = z.strictObject({
  patch: settingsPatchSchema,
  expectedRevision: z.optional(revisionSchema)
})

export const settingsImportPayloadSchema = z.strictObject({
  content: z.string().check(z.minLength(1), z.maxLength(262_144)),
  expectedRevision: z.optional(revisionSchema)
})

export const settingsRestorePayloadSchema = z.strictObject({
  backupId: z.string().check(z.minLength(1), z.maxLength(256))
})

export const settingsResetPayloadSchema = z.strictObject({
  scope: z.enum(['all', 'global', 'sites', 'progress'])
})

export const protocolCancelPayloadSchema = z.strictObject({
  targetRequestId: z.string().check(z.minLength(16), z.maxLength(128))
})

export const settingsSnapshotResponseSchema = z.strictObject({
  settings: persistedSettingsV2Schema,
  latestBackup: z.nullable(settingsBackupSchema)
})

export const settingsMutationResponseSchema = z.strictObject({
  settings: persistedSettingsV2Schema,
  changedPaths: z.array(z.string().check(z.minLength(1), z.maxLength(512))),
  rebased: z.boolean()
})

export const settingsExportResponseSchema = z.strictObject({
  content: z.string().check(z.minLength(1), z.maxLength(262_144))
})

export const cancellationResponseSchema = z.strictObject({
  cancelled: z.boolean()
})

export const systemPingResponseSchema = z.strictObject({
  extensionVersion: z.string().check(z.minLength(1), z.maxLength(32)),
  phase: z.literal(CURRENT_EXTENSION_PHASE),
  protocol: z.literal(1),
  settingsSchemaVersion: z.literal(SETTINGS_SCHEMA_VERSION),
  tabId: z.optional(z.int().check(z.nonnegative())),
  frameId: z.optional(z.int().check(z.nonnegative())),
  // The background resolves this from the browser sender metadata. Content
  // frames must not infer a Tencent parent origin from a potentially empty
  // referrer after a reload.
  siteOrigin: z.optional(z.string().check(z.minLength(1), z.maxLength(256)))
})

export type SettingsUpdatePayload = z.infer<typeof settingsUpdatePayloadSchema>
export type SettingsImportPayload = z.infer<typeof settingsImportPayloadSchema>
export type SettingsRestorePayload = z.infer<typeof settingsRestorePayloadSchema>
export type SettingsResetPayload = z.infer<typeof settingsResetPayloadSchema>
export type ProtocolCancelPayload = z.infer<typeof protocolCancelPayloadSchema>
export type SettingsSnapshotResponse = z.infer<typeof settingsSnapshotResponseSchema>
export type SettingsMutationResponse = z.infer<typeof settingsMutationResponseSchema>
export type SystemPingResponse = z.infer<typeof systemPingResponseSchema>
