import { describe, expect, it } from 'vitest'
import {
  createDefaultSettings,
  mergeSettings,
  normalizeSiteOrigin,
  resolveSettings,
  settingsDataSchema,
  settingsPatchSchema,
  toHostPermissionPattern
} from '../../src/domain/settings'

describe('settings domain', () => {
  it('creates schema-valid defaults and rejects unsafe ranges or unknown fields', () => {
    expect(settingsDataSchema.safeParse(createDefaultSettings()).success).toBe(true)
    expect(
      settingsPatchSchema.safeParse({ global: { media: { defaultPlaybackRate: 100 } } }).success
    ).toBe(false)
    expect(
      settingsPatchSchema.safeParse({ global: { enabled: true, script: 'alert(1)' } }).success
    ).toBe(false)
    expect(
      settingsPatchSchema.safeParse({
        global: {
          hotkeys: {
            bindings: {
              'Ctrl+KeyL': { commandId: 'media.toggle-play', disabled: false }
            }
          }
        }
      }).success
    ).toBe(false)
  })

  it('merges independent fields and reports exact changed paths', () => {
    const current = createDefaultSettings()
    const result = mergeSettings(current, {
      global: {
        enabled: false,
        download: { enabled: false },
        media: { defaultPlaybackRate: 2 },
        hotkeys: {
          bindings: { Space: { commandId: 'media.toggle-play', disabled: false } }
        }
      },
      sites: {
        'https://example.com': { enabled: false }
      }
    })

    expect(result.data.global.enabled).toBe(false)
    expect(result.data.global.media.defaultPlaybackRate).toBe(2)
    expect(result.data.global.hotkeys.bindings['Space']?.commandId).toBe('media.toggle-play')
    expect(result.changedPaths).toEqual([
      'global.enabled',
      'global.hotkeys.bindings.Space',
      'global.media.defaultPlaybackRate',
      'global.download.enabled',
      'sites.https://example.com'
    ])
    expect(current.global.enabled).toBe(true)
  })

  it('removes binding and site entries without changing absent entries', () => {
    const current = createDefaultSettings()
    current.global.hotkeys.bindings['Space'] = {
      commandId: 'media.toggle-play',
      disabled: false
    }
    current.sites['https://example.com'] = { enabled: false }

    const result = mergeSettings(current, {
      global: { hotkeys: { bindings: { Space: null } } },
      sites: { 'https://example.com': null, 'https://missing.example': null }
    })
    expect(result.data.global.hotkeys.bindings).toEqual({})
    expect(result.data.sites).toEqual({})
    expect(result.changedPaths).toEqual([
      'global.hotkeys.bindings.Space',
      'sites.https://example.com'
    ])
  })

  it('normalizes safe origins and resolves session over site over global settings', () => {
    expect(normalizeSiteOrigin('HTTPS://Example.COM:443/path?q=1')).toEqual({
      ok: true,
      value: 'https://example.com'
    })
    expect(normalizeSiteOrigin('javascript:alert(1)')).toEqual({
      ok: false,
      error: 'INVALID_SCHEME'
    })
    expect(toHostPermissionPattern('http://127.0.0.1:47173/watch')).toEqual({
      ok: true,
      value: 'http://127.0.0.1:47173/*'
    })
    expect(toHostPermissionPattern('https://example.com:443/watch')).toEqual({
      ok: true,
      value: 'https://example.com/*'
    })
    expect(toHostPermissionPattern('http://[::1]:47173/watch')).toEqual({
      ok: true,
      value: 'http://[::1]:47173/*'
    })

    const settings = createDefaultSettings()
    settings.global.download.enabled = false
    settings.global.media.defaultPlaybackRate = 1.25
    settings.sites['https://example.com'] = {
      enabled: false,
      download: { enabled: true },
      media: { defaultPlaybackRate: 2 }
    }
    const resolved = resolveSettings(settings, 'https://example.com/watch', {
      global: { enabled: true, media: { defaultPlaybackRate: 3 } }
    })
    expect(resolved.enabled).toBe(true)
    expect(resolved.media.defaultPlaybackRate).toBe(3)
    expect(resolved.download.enabled).toBe(true)
  })
})
