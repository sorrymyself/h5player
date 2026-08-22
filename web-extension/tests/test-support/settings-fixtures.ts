import {
  createDefaultSettings,
  SETTINGS_SCHEMA_VERSION,
  type PersistedSettingsV2
} from '../../src/domain/settings'

export function createSettingsEnvelope(revision = 0): PersistedSettingsV2 {
  return {
    schema: 'h5player.web-extension',
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    revision,
    updatedAt: 1_700_000_000_000,
    data: createDefaultSettings()
  }
}
