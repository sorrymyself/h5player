import type { GlobalSettings, SettingsPatch } from './schema'

export const SETTINGS_SYNC_WHITELIST = [
  'global.enabled',
  'global.ui.overlayEnabled',
  'global.ui.theme',
  'global.ui.locale',
  'global.hotkeys.enabled',
  'global.hotkeys.scope',
  'global.media.defaultPlaybackRate',
  'global.media.defaultVolume',
  'global.media.restoreProgress',
  'global.download.enabled',
  'global.policies.protectPlaybackRate',
  'global.policies.protectCurrentTime',
  'global.policies.protectVolume'
] as const

export type SettingsSyncPath = (typeof SETTINGS_SYNC_WHITELIST)[number]

const SYNC_PATH_SET = new Set<string>(SETTINGS_SYNC_WHITELIST)

export function isSettingsSyncPath(value: string): value is SettingsSyncPath {
  return SYNC_PATH_SET.has(value)
}

export function pickSyncSettings(
  global: GlobalSettings
): Pick<GlobalSettings, 'enabled' | 'ui' | 'hotkeys' | 'media' | 'policies' | 'download'> {
  return {
    enabled: global.enabled,
    ui: {
      overlayEnabled: global.ui.overlayEnabled,
      theme: global.ui.theme,
      locale: global.ui.locale
    },
    hotkeys: {
      enabled: global.hotkeys.enabled,
      scope: global.hotkeys.scope,
      bindings: {}
    },
    media: {
      defaultPlaybackRate: global.media.defaultPlaybackRate,
      defaultVolume: global.media.defaultVolume,
      restoreProgress: global.media.restoreProgress
    },
    download: {
      enabled: global.download?.enabled ?? true
    },
    policies: {
      protectPlaybackRate: global.policies.protectPlaybackRate,
      protectCurrentTime: global.policies.protectCurrentTime,
      protectVolume: global.policies.protectVolume,
      allowExperimental: false
    }
  }
}

export function filterSyncChangedPaths(paths: readonly string[]): readonly SettingsSyncPath[] {
  return paths.filter((path): path is SettingsSyncPath => isSettingsSyncPath(path))
}

export function createSyncPatch(global: GlobalSettings): SettingsPatch {
  const picked = pickSyncSettings(global)
  return {
    global: {
      enabled: picked.enabled,
      ui: picked.ui,
      hotkeys: {
        enabled: picked.hotkeys.enabled,
        scope: picked.hotkeys.scope
      },
      media: picked.media,
      download: picked.download,
      policies: {
        protectPlaybackRate: picked.policies.protectPlaybackRate,
        protectCurrentTime: picked.policies.protectCurrentTime,
        protectVolume: picked.policies.protectVolume
      }
    }
  }
}
