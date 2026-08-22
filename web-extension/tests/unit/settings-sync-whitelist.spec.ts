import { describe, expect, it } from 'vitest'
import {
  SETTINGS_SYNC_WHITELIST,
  createDefaultSettings,
  createSyncPatch,
  filterSyncChangedPaths,
  pickSyncSettings
} from '../../src/domain/settings'

describe('settings sync whitelist', () => {
  it('projects only small non-sensitive global scalar preferences', () => {
    const settings = createDefaultSettings().global
    settings.hotkeys.bindings['KeyP'] = {
      commandId: 'media.toggle-play',
      disabled: false
    }
    settings.policies.allowExperimental = true
    settings.download.enabled = false
    settings.diagnostics.localLogLevel = 'debug'

    const projected = pickSyncSettings(settings)
    expect(projected.hotkeys.bindings).toEqual({})
    expect(projected.policies.allowExperimental).toBe(false)
    expect(projected.download.enabled).toBe(false)
    expect(JSON.stringify(projected)).not.toContain('diagnostics')

    const patch = createSyncPatch(settings)
    expect(JSON.stringify(patch)).not.toContain('bindings')
    expect(JSON.stringify(patch)).not.toContain('allowExperimental')
    expect(JSON.stringify(patch)).not.toContain('diagnostics')
  })

  it('filters changed paths against the frozen whitelist', () => {
    expect(
      filterSyncChangedPaths([...SETTINGS_SYNC_WHITELIST, 'sites.https://example.com'])
    ).toEqual(SETTINGS_SYNC_WHITELIST)
    expect(filterSyncChangedPaths(['global.hotkeys.bindings.Space', 'progress.key'])).toEqual([])
  })
})
