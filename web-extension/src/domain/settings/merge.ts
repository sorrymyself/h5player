import type { GlobalSettings, SettingsData, SettingsPatch, SiteOverride } from './schema'

export type SettingsMergeResult = {
  data: SettingsData
  changedPaths: string[]
}

function setIfChanged<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
  path: string,
  changedPaths: string[]
): void {
  if (value === undefined || Object.is(target[key], value)) return
  target[key] = value
  changedPaths.push(path)
}

export function mergeSettings(current: SettingsData, patch: SettingsPatch): SettingsMergeResult {
  const changedPaths: string[] = []
  const global: GlobalSettings = {
    ...current.global,
    ui: { ...current.global.ui },
    hotkeys: {
      ...current.global.hotkeys,
      bindings: { ...current.global.hotkeys.bindings }
    },
    media: { ...current.global.media },
    download: { enabled: current.global.download?.enabled ?? true },
    policies: { ...current.global.policies },
    diagnostics: { ...current.global.diagnostics }
  }
  const sites: Record<string, SiteOverride> = { ...current.sites }

  if (patch.global) {
    setIfChanged(global, 'enabled', patch.global.enabled, 'global.enabled', changedPaths)

    if (patch.global.ui) {
      setIfChanged(
        global.ui,
        'overlayEnabled',
        patch.global.ui.overlayEnabled,
        'global.ui.overlayEnabled',
        changedPaths
      )
      setIfChanged(global.ui, 'theme', patch.global.ui.theme, 'global.ui.theme', changedPaths)
      setIfChanged(global.ui, 'locale', patch.global.ui.locale, 'global.ui.locale', changedPaths)
    }

    if (patch.global.hotkeys) {
      setIfChanged(
        global.hotkeys,
        'enabled',
        patch.global.hotkeys.enabled,
        'global.hotkeys.enabled',
        changedPaths
      )
      setIfChanged(
        global.hotkeys,
        'scope',
        patch.global.hotkeys.scope,
        'global.hotkeys.scope',
        changedPaths
      )
      for (const [key, binding] of Object.entries(patch.global.hotkeys.bindings ?? {})) {
        const path = `global.hotkeys.bindings.${key}`
        if (binding === null) {
          if (key in global.hotkeys.bindings) {
            delete global.hotkeys.bindings[key]
            changedPaths.push(path)
          }
        } else if (JSON.stringify(global.hotkeys.bindings[key]) !== JSON.stringify(binding)) {
          global.hotkeys.bindings[key] = binding
          changedPaths.push(path)
        }
      }
    }

    if (patch.global.media) {
      setIfChanged(
        global.media,
        'defaultPlaybackRate',
        patch.global.media.defaultPlaybackRate,
        'global.media.defaultPlaybackRate',
        changedPaths
      )
      setIfChanged(
        global.media,
        'defaultVolume',
        patch.global.media.defaultVolume,
        'global.media.defaultVolume',
        changedPaths
      )
      setIfChanged(
        global.media,
        'restoreProgress',
        patch.global.media.restoreProgress,
        'global.media.restoreProgress',
        changedPaths
      )
    }

    if (patch.global.download) {
      const download = global.download ?? { enabled: true }
      global.download = download
      setIfChanged(
        download,
        'enabled',
        patch.global.download.enabled,
        'global.download.enabled',
        changedPaths
      )
    }

    if (patch.global.policies) {
      setIfChanged(
        global.policies,
        'protectPlaybackRate',
        patch.global.policies.protectPlaybackRate,
        'global.policies.protectPlaybackRate',
        changedPaths
      )
      setIfChanged(
        global.policies,
        'protectCurrentTime',
        patch.global.policies.protectCurrentTime,
        'global.policies.protectCurrentTime',
        changedPaths
      )
      setIfChanged(
        global.policies,
        'protectVolume',
        patch.global.policies.protectVolume,
        'global.policies.protectVolume',
        changedPaths
      )
      setIfChanged(
        global.policies,
        'allowExperimental',
        patch.global.policies.allowExperimental,
        'global.policies.allowExperimental',
        changedPaths
      )
      setIfChanged(
        global.policies,
        'allowAcousticGain',
        patch.global.policies.allowAcousticGain,
        'global.policies.allowAcousticGain',
        changedPaths
      )
      setIfChanged(
        global.policies,
        'allowMouseLongPress',
        patch.global.policies.allowMouseLongPress,
        'global.policies.allowMouseLongPress',
        changedPaths
      )
      setIfChanged(
        global.policies,
        'mouseLongPressMs',
        patch.global.policies.mouseLongPressMs,
        'global.policies.mouseLongPressMs',
        changedPaths
      )
      setIfChanged(
        global.policies,
        'allowAutoplay',
        patch.global.policies.allowAutoplay,
        'global.policies.allowAutoplay',
        changedPaths
      )
    }

    if (patch.global.diagnostics) {
      setIfChanged(
        global.diagnostics,
        'localLogLevel',
        patch.global.diagnostics.localLogLevel,
        'global.diagnostics.localLogLevel',
        changedPaths
      )
      setIfChanged(
        global.diagnostics,
        'retainProgressDays',
        patch.global.diagnostics.retainProgressDays,
        'global.diagnostics.retainProgressDays',
        changedPaths
      )
    }
  }

  for (const [siteId, override] of Object.entries(patch.sites ?? {})) {
    const path = `sites.${siteId}`
    if (override === null) {
      if (siteId in sites) {
        delete sites[siteId]
        changedPaths.push(path)
      }
    } else if (JSON.stringify(sites[siteId]) !== JSON.stringify(override)) {
      sites[siteId] = override
      changedPaths.push(path)
    }
  }

  return {
    data: {
      global,
      sites,
      progress: { ...current.progress }
    },
    changedPaths
  }
}
