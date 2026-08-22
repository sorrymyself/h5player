import type { SettingsData } from './schema'

export function createDefaultSettings(): SettingsData {
  return {
    global: {
      enabled: true,
      ui: {
        overlayEnabled: true,
        theme: 'system',
        locale: 'zh-CN'
      },
      hotkeys: {
        enabled: true,
        scope: 'page',
        bindings: {}
      },
      media: {
        defaultPlaybackRate: 1,
        defaultVolume: 1,
        restoreProgress: false
      },
      download: {
        enabled: true
      },
      policies: {
        protectPlaybackRate: true,
        protectCurrentTime: false,
        protectVolume: true,
        allowExperimental: false,
        allowAcousticGain: false,
        allowMouseLongPress: false,
        mouseLongPressMs: 600,
        allowAutoplay: false
      },
      diagnostics: {
        localLogLevel: 'error',
        retainProgressDays: 30
      }
    },
    sites: {},
    progress: {}
  }
}
