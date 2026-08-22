import { mergeSettings } from './merge'
import type { GlobalSettings, SettingsData, SettingsPatch, SiteOverride } from './schema'
import { normalizeSiteOrigin } from './site-identity'

function applySiteOverride(settings: GlobalSettings, override: SiteOverride): GlobalSettings {
  return {
    ...settings,
    enabled: override.enabled,
    ui: {
      ...settings.ui,
      overlayEnabled: override.ui?.overlayEnabled ?? settings.ui.overlayEnabled
    },
    media: {
      defaultPlaybackRate:
        override.media?.defaultPlaybackRate ?? settings.media.defaultPlaybackRate,
      defaultVolume: override.media?.defaultVolume ?? settings.media.defaultVolume,
      restoreProgress: override.media?.restoreProgress ?? settings.media.restoreProgress
    },
    download: {
      enabled: override.download?.enabled ?? settings.download?.enabled ?? true
    },
    policies: {
      protectPlaybackRate:
        override.policies?.protectPlaybackRate ?? settings.policies.protectPlaybackRate,
      protectCurrentTime:
        override.policies?.protectCurrentTime ?? settings.policies.protectCurrentTime,
      protectVolume: override.policies?.protectVolume ?? settings.policies.protectVolume,
      allowExperimental:
        override.policies?.allowExperimental ?? settings.policies.allowExperimental,
      allowAcousticGain:
        override.policies?.allowAcousticGain ?? settings.policies.allowAcousticGain ?? false,
      allowMouseLongPress:
        override.policies?.allowMouseLongPress ?? settings.policies.allowMouseLongPress ?? false,
      mouseLongPressMs:
        override.policies?.mouseLongPressMs ?? settings.policies.mouseLongPressMs ?? 600,
      allowAutoplay: override.policies?.allowAutoplay ?? settings.policies.allowAutoplay ?? false
    },
    hotkeys: { ...settings.hotkeys, bindings: { ...settings.hotkeys.bindings } },
    diagnostics: { ...settings.diagnostics }
  }
}

export function resolveSettings(
  settings: SettingsData,
  siteOrigin?: string,
  sessionOverride?: SettingsPatch
): GlobalSettings {
  let resolved: GlobalSettings = {
    ...settings.global,
    ui: { ...settings.global.ui },
    hotkeys: { ...settings.global.hotkeys, bindings: { ...settings.global.hotkeys.bindings } },
    media: { ...settings.global.media },
    download: { enabled: settings.global.download?.enabled ?? true },
    policies: {
      ...settings.global.policies,
      allowAcousticGain: settings.global.policies.allowAcousticGain ?? false,
      allowMouseLongPress: settings.global.policies.allowMouseLongPress ?? false,
      mouseLongPressMs: settings.global.policies.mouseLongPressMs ?? 600,
      allowAutoplay: settings.global.policies.allowAutoplay ?? false
    },
    diagnostics: { ...settings.global.diagnostics }
  }

  if (siteOrigin) {
    const normalized = normalizeSiteOrigin(siteOrigin)
    if (normalized.ok) {
      const siteOverride = settings.sites[normalized.value]
      if (siteOverride) resolved = applySiteOverride(resolved, siteOverride)
    }
  }

  if (!sessionOverride?.global) return resolved

  const sessionData: SettingsData = {
    global: resolved,
    sites: {},
    progress: {}
  }
  return mergeSettings(sessionData, { global: sessionOverride.global }).data.global
}
