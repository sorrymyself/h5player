import * as z from 'zod/mini'
import { hotkeyChordSchema, hotkeyCommandIdSchema } from '../hotkey'
import { isNormalizedSiteOrigin } from './site-identity'

export const SETTINGS_SCHEMA_VERSION = 3 as const
export const SETTINGS_EXPORT_FORMAT_VERSION = 3 as const

const boundedKeySchema = z.string().check(z.minLength(1), z.maxLength(256))
const siteOriginSchema = boundedKeySchema.check(z.refine(isNormalizedSiteOrigin))
const boundedTextSchema = z.string().check(z.maxLength(512))
const revisionSchema = z.int().check(z.nonnegative())
const timestampSchema = z.number().check(z.nonnegative())
const playbackRateSchema = z.number().check(z.gte(0.1), z.lte(16))
const volumeSchema = z.number().check(z.gte(0), z.lte(1))

const uiSettingsSchema = z.strictObject({
  overlayEnabled: z.boolean(),
  theme: z.enum(['system', 'light', 'dark']),
  locale: z.enum(['zh-CN', 'en-US'])
})

const mediaSettingsSchema = z.strictObject({
  defaultPlaybackRate: playbackRateSchema,
  defaultVolume: volumeSchema,
  restoreProgress: z.boolean()
})

const downloadSettingsSchema = z.strictObject({ enabled: z.boolean() })

// These switches are deliberately optional on the wire so settings written by
// the previous schema remain readable. The repository normalizes them to the
// current defaults before exposing GlobalSettings to runtime code.
const experimentalPolicyFields = {
  allowAcousticGain: z.optional(z.boolean()),
  allowMouseLongPress: z.optional(z.boolean()),
  mouseLongPressMs: z.optional(z.int().check(z.gte(200), z.lte(2_000))),
  allowAutoplay: z.optional(z.boolean())
} as const

const policySettingsSchema = z.strictObject({
  protectPlaybackRate: z.boolean(),
  protectCurrentTime: z.boolean(),
  protectVolume: z.boolean(),
  allowExperimental: z.boolean(),
  ...experimentalPolicyFields
})

const diagnosticSettingsSchema = z.strictObject({
  localLogLevel: z.enum(['error', 'warn', 'info', 'debug']),
  retainProgressDays: z.int().check(z.gte(0), z.lte(365))
})

const legacyHotkeyBindingSchema = z.strictObject({
  commandId: boundedKeySchema,
  disabled: z.boolean()
})

export const hotkeyBindingSchema = z.strictObject({
  commandId: hotkeyCommandIdSchema,
  disabled: z.boolean()
})

const globalSettingsV1Schema = z.strictObject({
  enabled: z.boolean(),
  ui: uiSettingsSchema,
  hotkeys: z.strictObject({
    enabled: z.boolean(),
    scope: z.enum(['page', 'player']),
    bindings: z
      .record(boundedKeySchema, legacyHotkeyBindingSchema)
      .check(z.refine((value) => Object.keys(value).length <= 256))
  }),
  media: mediaSettingsSchema,
  download: z.optional(downloadSettingsSchema),
  policies: policySettingsSchema,
  diagnostics: diagnosticSettingsSchema
})

export const globalSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  ui: uiSettingsSchema,
  hotkeys: z.strictObject({
    enabled: z.boolean(),
    scope: z.enum(['page', 'player']),
    bindings: z
      .record(hotkeyChordSchema, hotkeyBindingSchema)
      .check(z.refine((value) => Object.keys(value).length <= 256))
  }),
  media: mediaSettingsSchema,
  download: downloadSettingsSchema,
  policies: policySettingsSchema,
  diagnostics: diagnosticSettingsSchema
})

export const siteOverrideSchema = z.strictObject({
  enabled: z.boolean(),
  includePath: z.optional(z.string().check(z.minLength(1), z.maxLength(256))),
  ui: z.optional(
    z.strictObject({
      overlayEnabled: z.optional(z.boolean())
    })
  ),
  media: z.optional(
    z.strictObject({
      defaultPlaybackRate: z.optional(playbackRateSchema),
      defaultVolume: z.optional(volumeSchema),
      restoreProgress: z.optional(z.boolean())
    })
  ),
  download: z.optional(
    z.strictObject({
      enabled: z.optional(z.boolean())
    })
  ),
  policies: z.optional(
    z.strictObject({
      protectPlaybackRate: z.optional(z.boolean()),
      protectCurrentTime: z.optional(z.boolean()),
      protectVolume: z.optional(z.boolean()),
      allowExperimental: z.optional(z.boolean()),
      ...experimentalPolicyFields
    })
  )
})

export const progressRecordSchema = z.strictObject({
  site: siteOriginSchema,
  mediaKey: boundedKeySchema,
  positionSeconds: z.number().check(z.nonnegative()),
  durationSeconds: z.nullable(z.number().check(z.nonnegative())),
  titleHint: z.optional(boundedTextSchema),
  updatedAt: timestampSchema,
  expiresAt: timestampSchema
})

const siteMapSchema = z
  .record(siteOriginSchema, siteOverrideSchema)
  .check(z.refine((value) => Object.keys(value).length <= 1_000))

const progressMapSchema = z
  .record(boundedKeySchema, progressRecordSchema)
  .check(z.refine((value) => Object.keys(value).length <= 5_000))

export const settingsDataV1Schema = z.strictObject({
  global: globalSettingsV1Schema,
  sites: siteMapSchema,
  progress: progressMapSchema
})

export const settingsDataSchema = z.strictObject({
  global: globalSettingsSchema,
  sites: siteMapSchema,
  progress: progressMapSchema
})

const hotkeyBindingsPatchSchema = z
  .record(hotkeyChordSchema, z.union([hotkeyBindingSchema, z.null()]))
  .check(z.refine((value) => Object.keys(value).length <= 256))

export const settingsPatchSchema = z.strictObject({
  global: z.optional(
    z.strictObject({
      enabled: z.optional(z.boolean()),
      ui: z.optional(
        z.strictObject({
          overlayEnabled: z.optional(z.boolean()),
          theme: z.optional(z.enum(['system', 'light', 'dark'])),
          locale: z.optional(z.enum(['zh-CN', 'en-US']))
        })
      ),
      hotkeys: z.optional(
        z.strictObject({
          enabled: z.optional(z.boolean()),
          scope: z.optional(z.enum(['page', 'player'])),
          bindings: z.optional(hotkeyBindingsPatchSchema)
        })
      ),
      media: z.optional(
        z.strictObject({
          defaultPlaybackRate: z.optional(playbackRateSchema),
          defaultVolume: z.optional(volumeSchema),
          restoreProgress: z.optional(z.boolean())
        })
      ),
      download: z.optional(z.strictObject({ enabled: z.optional(z.boolean()) })),
      policies: z.optional(
        z.strictObject({
          protectPlaybackRate: z.optional(z.boolean()),
          protectCurrentTime: z.optional(z.boolean()),
          protectVolume: z.optional(z.boolean()),
          allowExperimental: z.optional(z.boolean()),
          ...experimentalPolicyFields
        })
      ),
      diagnostics: z.optional(
        z.strictObject({
          localLogLevel: z.optional(z.enum(['error', 'warn', 'info', 'debug'])),
          retainProgressDays: z.optional(z.int().check(z.gte(0), z.lte(365)))
        })
      )
    })
  ),
  sites: z.optional(
    z
      .record(siteOriginSchema, z.union([siteOverrideSchema, z.null()]))
      .check(z.refine((value) => Object.keys(value).length <= 1_000))
  )
})

export const persistedSettingsV2Schema = z.strictObject({
  schema: z.literal('h5player.web-extension'),
  schemaVersion: z.literal(SETTINGS_SCHEMA_VERSION),
  revision: revisionSchema,
  updatedAt: timestampSchema,
  data: settingsDataSchema
})

const settingsDataV2Schema = z.strictObject({
  global: z.strictObject({
    enabled: z.boolean(),
    ui: uiSettingsSchema,
    hotkeys: z.strictObject({
      enabled: z.boolean(),
      scope: z.enum(['page', 'player']),
      bindings: z
        .record(hotkeyChordSchema, hotkeyBindingSchema)
        .check(z.refine((value) => Object.keys(value).length <= 256))
    }),
    media: mediaSettingsSchema,
    policies: policySettingsSchema,
    diagnostics: diagnosticSettingsSchema
  }),
  sites: siteMapSchema,
  progress: progressMapSchema
})

export const persistedSettingsLegacyV2Schema = z.strictObject({
  schema: z.literal('h5player.web-extension'),
  schemaVersion: z.literal(2),
  revision: revisionSchema,
  updatedAt: timestampSchema,
  data: settingsDataV2Schema
})

export const persistedSettingsV1Schema = z.strictObject({
  schema: z.literal('h5player.web-extension'),
  schemaVersion: z.literal(1),
  revision: revisionSchema,
  updatedAt: timestampSchema,
  data: settingsDataV1Schema
})

export const persistedSettingsV0Schema = z.strictObject({
  schema: z.literal('h5player.web-extension'),
  schemaVersion: z.literal(0),
  revision: revisionSchema,
  updatedAt: timestampSchema,
  data: z.strictObject({
    enabled: z.boolean(),
    defaultPlaybackRate: playbackRateSchema,
    defaultVolume: volumeSchema
  })
})

export const settingsBackupSchema = z.strictObject({
  backupId: boundedKeySchema,
  createdAt: timestampSchema,
  reason: z.enum(['migration', 'corrupt-recovery', 'import', 'rollback', 'reset']),
  checksum: z.string().check(z.regex(/^fnv1a64:[a-f0-9]{16}$/)),
  raw: z.unknown()
})

export const settingsExportFileV1Schema = z.strictObject({
  format: z.literal('h5player.web-extension.settings'),
  formatVersion: z.literal(1),
  exportedAt: z.string().check(z.minLength(20), z.maxLength(64)),
  data: settingsDataV1Schema
})

export const settingsExportFileSchema = z.strictObject({
  format: z.literal('h5player.web-extension.settings'),
  formatVersion: z.literal(SETTINGS_EXPORT_FORMAT_VERSION),
  exportedAt: z.string().check(z.minLength(20), z.maxLength(64)),
  data: settingsDataSchema
})

export const settingsExportFileV2Schema = z.strictObject({
  format: z.literal('h5player.web-extension.settings'),
  formatVersion: z.literal(2),
  exportedAt: z.string().check(z.minLength(20), z.maxLength(64)),
  data: settingsDataV2Schema
})

export const settingsImportFileSchema = z.union([
  settingsExportFileSchema,
  settingsExportFileV2Schema,
  settingsExportFileV1Schema
])

export type GlobalSettings = z.infer<typeof globalSettingsSchema>
export type GlobalSettingsV1 = z.infer<typeof globalSettingsV1Schema>
export type SiteOverride = z.infer<typeof siteOverrideSchema>
export type ProgressRecord = z.infer<typeof progressRecordSchema>
export type SettingsData = z.infer<typeof settingsDataSchema>
export type SettingsDataV1 = z.infer<typeof settingsDataV1Schema>
export type SettingsPatch = z.infer<typeof settingsPatchSchema>
export type PersistedSettingsV2 = z.infer<typeof persistedSettingsV2Schema>
export type PersistedSettingsLegacyV2 = z.infer<typeof persistedSettingsLegacyV2Schema>
export type PersistedSettingsV1 = z.infer<typeof persistedSettingsV1Schema>
export type PersistedSettingsV0 = z.infer<typeof persistedSettingsV0Schema>
export type SettingsBackup = z.infer<typeof settingsBackupSchema>
export type SettingsExportFile = z.infer<typeof settingsExportFileSchema>
export type SettingsExportFileV2 = z.infer<typeof settingsExportFileV2Schema>

export type DownloadSettings = { enabled: boolean }
export type SettingsExportFileV1 = z.infer<typeof settingsExportFileV1Schema>
