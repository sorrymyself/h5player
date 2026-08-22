import { hotkeyChordSchema, hotkeyCommandIdSchema } from '../../domain/hotkey'
import {
  createDefaultSettings,
  persistedSettingsV0Schema,
  persistedSettingsV1Schema,
  persistedSettingsV2Schema,
  persistedSettingsLegacyV2Schema,
  SETTINGS_SCHEMA_VERSION,
  type GlobalSettings,
  type PersistedSettingsV2,
  type SettingsData,
  type SettingsDataV1
} from '../../domain/settings'

export type SettingsMigrationOutcome =
  | { kind: 'missing'; value: PersistedSettingsV2 }
  | { kind: 'current'; value: PersistedSettingsV2 }
  | { kind: 'migrated'; value: PersistedSettingsV2; raw: unknown }
  | { kind: 'future'; schemaVersion: number }
  | { kind: 'corrupt'; raw: unknown }

function readSchemaVersion(value: unknown): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const version = (value as Record<string, unknown>)['schemaVersion']
  return typeof version === 'number' && Number.isInteger(version) ? version : null
}

function normalizeGlobalPolicies(policies: GlobalSettings['policies']): GlobalSettings['policies'] {
  return {
    ...policies,
    allowAcousticGain: policies.allowAcousticGain ?? false,
    allowMouseLongPress: policies.allowMouseLongPress ?? false,
    mouseLongPressMs: policies.mouseLongPressMs ?? 600,
    allowAutoplay: policies.allowAutoplay ?? false
  }
}

export function migrateSettingsDataV1(data: SettingsDataV1): SettingsData {
  const bindings: SettingsData['global']['hotkeys']['bindings'] = {}
  for (const [chord, binding] of Object.entries(data.global.hotkeys.bindings)) {
    const parsedChord = hotkeyChordSchema.safeParse(chord)
    const parsedCommand = hotkeyCommandIdSchema.safeParse(binding.commandId)
    if (!parsedChord.success || !parsedCommand.success) continue
    bindings[parsedChord.data] = {
      commandId: parsedCommand.data,
      disabled: binding.disabled
    }
  }

  return {
    global: {
      enabled: data.global.enabled,
      ui: { ...data.global.ui },
      hotkeys: {
        enabled: data.global.hotkeys.enabled,
        scope: data.global.hotkeys.scope,
        bindings
      },
      media: { ...data.global.media },
      download: { enabled: true },
      policies: normalizeGlobalPolicies(data.global.policies),
      diagnostics: { ...data.global.diagnostics }
    },
    sites: { ...data.sites },
    progress: { ...data.progress }
  }
}

function normalizeSettingsData(data: SettingsData): SettingsData {
  return {
    ...data,
    global: {
      ...data.global,
      download: { enabled: data.global.download?.enabled ?? true },
      policies: normalizeGlobalPolicies(data.global.policies)
    }
  }
}

export function migrateSettingsDataV2(data: SettingsData): SettingsData {
  return normalizeSettingsData(data)
}

function createCurrentEnvelope(
  now: number,
  revision = 0,
  data: SettingsData = createDefaultSettings()
): PersistedSettingsV2 {
  return {
    schema: 'h5player.web-extension',
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    revision,
    updatedAt: now,
    data
  }
}

export function classifyPersistedSettings(raw: unknown, now: number): SettingsMigrationOutcome {
  if (raw === undefined) {
    return { kind: 'missing', value: createCurrentEnvelope(now) }
  }

  const current = persistedSettingsV2Schema.safeParse(raw)
  if (current.success)
    return {
      kind: 'current',
      value: { ...current.data, data: normalizeSettingsData(current.data.data) }
    }

  const schemaVersion = readSchemaVersion(raw)
  if (schemaVersion !== null && schemaVersion > SETTINGS_SCHEMA_VERSION) {
    return { kind: 'future', schemaVersion }
  }

  const previousV2 = persistedSettingsLegacyV2Schema.safeParse(raw)
  if (previousV2.success) {
    return {
      kind: 'migrated',
      raw,
      value: createCurrentEnvelope(
        now,
        previousV2.data.revision + 1,
        migrateSettingsDataV2(previousV2.data.data as SettingsData)
      )
    }
  }

  const previous = persistedSettingsV1Schema.safeParse(raw)
  if (previous.success) {
    return {
      kind: 'migrated',
      raw,
      value: createCurrentEnvelope(
        now,
        previous.data.revision + 1,
        migrateSettingsDataV1(previous.data.data)
      )
    }
  }

  const oldest = persistedSettingsV0Schema.safeParse(raw)
  if (!oldest.success) return { kind: 'corrupt', raw }

  const defaults = createDefaultSettings()
  defaults.global.enabled = oldest.data.data.enabled
  defaults.global.media.defaultPlaybackRate = oldest.data.data.defaultPlaybackRate
  defaults.global.media.defaultVolume = oldest.data.data.defaultVolume

  return {
    kind: 'migrated',
    raw,
    value: createCurrentEnvelope(now, oldest.data.revision + 1, defaults)
  }
}
