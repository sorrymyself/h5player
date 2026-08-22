import { describe, expect, it } from 'vitest'
import { createDefaultSettings } from '../../src/domain/settings'
import { classifyPersistedSettings } from '../../src/infrastructure/storage/settings-migrations'

describe('settings migrations', () => {
  it('creates defaults for an empty store', () => {
    const result = classifyPersistedSettings(undefined, 100)
    expect(result.kind).toBe('missing')
    if (result.kind === 'missing') expect(result.value.updatedAt).toBe(100)
  })

  it('migrates N-1 settings without guessing unknown fields', () => {
    const data = createDefaultSettings()
    const legacyData = {
      ...data,
      global: {
        ...data.global,
        enabled: false,
        policies: {
          ...data.global.policies,
          allowAcousticGain: undefined,
          allowMouseLongPress: undefined,
          mouseLongPressMs: undefined,
          allowAutoplay: undefined
        },
        hotkeys: {
          ...data.global.hotkeys,
          bindings: {
            Space: { commandId: 'media.toggle-play', disabled: false },
            'Ctrl+KeyL': { commandId: 'media.toggle-play', disabled: false },
            KeyQ: { commandId: 'unknown.command', disabled: false }
          }
        }
      }
    }
    const result = classifyPersistedSettings(
      {
        schema: 'h5player.web-extension',
        schemaVersion: 1,
        revision: 4,
        updatedAt: 50,
        data: legacyData
      },
      100
    )
    expect(result.kind).toBe('migrated')
    if (result.kind === 'migrated') {
      expect(result.value.revision).toBe(5)
      expect(result.value.data.global.enabled).toBe(false)
      expect(result.value.data.global.policies).toMatchObject({
        allowAcousticGain: false,
        allowMouseLongPress: false,
        mouseLongPressMs: 600,
        allowAutoplay: false
      })
      expect(result.value.data.global.hotkeys.bindings).toEqual({
        Space: { commandId: 'media.toggle-play', disabled: false }
      })
    }
  })

  it('adds the enabled download default while migrating schema v2', () => {
    const data = createDefaultSettings()
    const legacyGlobal = Object.fromEntries(
      Object.entries(data.global).filter(([key]) => key !== 'download')
    )
    const result = classifyPersistedSettings(
      {
        schema: 'h5player.web-extension',
        schemaVersion: 2,
        revision: 7,
        updatedAt: 50,
        data: { ...data, global: legacyGlobal }
      },
      100
    )
    expect(result.kind).toBe('migrated')
    if (result.kind === 'migrated') {
      expect(result.value.data.global.download.enabled).toBe(true)
    }
  })

  it('keeps absent site policy fields inheriting the normalized global defaults', () => {
    const data = createDefaultSettings()
    const legacyPolicies = Object.fromEntries(
      Object.entries(data.global.policies).filter(
        ([key]) =>
          ![
            'allowAcousticGain',
            'allowMouseLongPress',
            'mouseLongPressMs',
            'allowAutoplay'
          ].includes(key)
      )
    )
    const legacyGlobal = Object.fromEntries(
      Object.entries({ ...data.global, policies: legacyPolicies }).filter(
        ([key]) => key !== 'download'
      )
    )
    const result = classifyPersistedSettings(
      {
        schema: 'h5player.web-extension',
        schemaVersion: 2,
        revision: 1,
        updatedAt: 50,
        data: {
          ...data,
          global: legacyGlobal,
          sites: {
            'https://example.com': { enabled: true, media: { defaultPlaybackRate: 1.25 } }
          }
        }
      },
      100
    )
    expect(result.kind).toBe('migrated')
    if (result.kind === 'migrated') {
      expect(result.value.data.global.policies.allowAutoplay).toBe(false)
      expect(result.value.data.sites['https://example.com']).toEqual({
        enabled: true,
        media: { defaultPlaybackRate: 1.25 }
      })
    }
  })

  it('still migrates the oldest V0 envelope through safe defaults', () => {
    const result = classifyPersistedSettings(
      {
        schema: 'h5player.web-extension',
        schemaVersion: 0,
        revision: 2,
        updatedAt: 50,
        data: { enabled: false, defaultPlaybackRate: 2, defaultVolume: 0.5 }
      },
      100
    )
    expect(result.kind).toBe('migrated')
    if (result.kind === 'migrated') {
      expect(result.value.data.global.media).toMatchObject({
        defaultPlaybackRate: 2,
        defaultVolume: 0.5
      })
    }
  })

  it('separates corrupt and future data so future versions are never overwritten', () => {
    expect(classifyPersistedSettings({ schemaVersion: 1, data: 'broken' }, 100).kind).toBe(
      'corrupt'
    )
    expect(classifyPersistedSettings({ schemaVersion: 4, data: {} }, 100)).toEqual({
      kind: 'future',
      schemaVersion: 4
    })
  })
})
