import { describe, expect, it } from 'vitest'
import { OptionsApplication } from '../../src/application/ui'
import { FakeActiveTabPort, FakeSettingsChangeSourcePort } from '../test-support/fakes'
import { FakeRuntimeApi } from '../test-support/fake-runtime-api'

function createApplication() {
  const api = new FakeRuntimeApi()
  const access = new FakeActiveTabPort()
  const changes = new FakeSettingsChangeSourcePort()
  const application = new OptionsApplication(api, access, changes)
  return { api, access, changes, application }
}

describe('OptionsApplication', () => {
  it('loads a coherent snapshot and applies field patches through the runtime port', async () => {
    const { api, application } = createApplication()
    const snapshot = await application.load()
    expect(snapshot.ping.phase).toBe(6)
    expect(snapshot.settings.settings.schemaVersion).toBe(3)

    const updated = await application.update({ global: { enabled: false } })
    expect(updated.settings.settings.data.global.enabled).toBe(false)
    expect(api.updateCalls[0]).toMatchObject({ expectedRevision: 0 })
  })

  it('rejects invalid and conflicting assignments before writing, then moves a binding atomically', async () => {
    const { api, application } = createApplication()
    await application.load()

    await expect(application.assignHotkey('media.toggle-play', 'Ctrl+L')).resolves.toEqual({
      ok: false,
      code: 'INVALID_CHORD'
    })
    await expect(
      application.assignHotkey('media.seek-forward-5', 'ArrowLeft')
    ).resolves.toMatchObject({
      ok: false,
      code: 'CONFLICT',
      conflictCommandId: 'media.seek-backward-5'
    })

    const moved = await application.assignHotkey('media.toggle-play', 'KeyP', 'Space')
    expect(moved.ok).toBe(true)
    expect(api.updateCalls.at(-1)?.patch).toEqual({
      global: {
        hotkeys: {
          bindings: {
            KeyP: { commandId: 'media.toggle-play', disabled: false },
            Space: { commandId: 'media.toggle-play', disabled: true }
          }
        }
      }
    })
  })

  it('previews only bounded, schema-valid imports and reports their impact', async () => {
    const { application } = createApplication()
    const valid = await application.exportSettings()
    expect(application.previewImport(valid)).toEqual({
      formatVersion: 3,
      exportedAt: '2026-08-10T00:00:00.000Z',
      siteRuleCount: 0,
      progressCount: 0,
      hotkeyOverrideCount: 0,
      locale: 'zh-CN'
    })
    expect(application.previewImport('{broken')).toBeNull()
    expect(application.previewImport('x'.repeat(262_145))).toBeNull()
  })

  it('uses explicit permission operations and reconciles registration after grant/revoke', async () => {
    const { api, access, application } = createApplication()
    await application.load()
    await expect(application.requestAllSites()).resolves.toMatchObject({
      grantedOrigins: ['<all_urls>']
    })
    expect(api.reconcileCalls).toEqual([false])

    await application.revokeAllSites()
    expect(await access.getGrantedOrigins()).toEqual([])
    expect(api.reconcileCalls).toEqual([false, false])
  })

  it('keeps the current permission state unchanged when the browser rejects all-sites access', async () => {
    const { api, access, application } = createApplication()
    access.permissions.requestResult = false
    await application.load()
    await expect(application.requestAllSites()).rejects.toThrow('PERMISSION_DENIED')
    expect(await access.getGrantedOrigins()).toEqual([])
    expect(api.reconcileCalls).toEqual([])
  })

  it('refreshes the latest backup after reset/import/restore operations', async () => {
    const { api, application } = createApplication()
    await application.load()
    const reset = await application.resetSettings('global')
    expect(reset.settings.latestBackup?.reason).toBe('reset')
    expect(api.getSettingsCalls).toBeGreaterThan(1)

    const restored = await application.restoreBackup(reset.settings.latestBackup?.backupId ?? '')
    expect(restored.settings.latestBackup?.reason).toBe('rollback')
  })

  it('writes site playback fields without replacing sibling overrides', async () => {
    const { api, application } = createApplication()
    api.settings.data.sites['https://example.com'] = {
      enabled: false,
      media: { defaultVolume: 0.5 },
      policies: { protectCurrentTime: true }
    }
    await application.load()

    await application.setSitePlaybackRate('https://example.com', 1.75)
    expect(api.updateCalls.at(-1)).toMatchObject({
      expectedRevision: 0,
      patch: {
        sites: {
          'https://example.com': {
            enabled: false,
            media: { defaultVolume: 0.5, defaultPlaybackRate: 1.75 },
            policies: { protectCurrentTime: true }
          }
        }
      }
    })

    await application.setSitePlaybackProtection('https://example.com', false)
    expect(api.updateCalls.at(-1)?.patch).toEqual({
      sites: {
        'https://example.com': {
          enabled: false,
          media: { defaultVolume: 0.5, defaultPlaybackRate: 1.75 },
          policies: { protectCurrentTime: true, protectPlaybackRate: false }
        }
      }
    })
  })

  it('restores individual site playback fields to global inheritance without changing enabled', async () => {
    const { api, application } = createApplication()
    api.settings.data.sites['https://example.com'] = {
      enabled: false,
      media: { defaultPlaybackRate: 2, defaultVolume: 0.5 },
      policies: { protectPlaybackRate: false, protectCurrentTime: true }
    }
    await application.load()

    const rateRestored = await application.restoreSitePlaybackRate('https://example.com')
    expect(rateRestored.settings.settings.data.sites['https://example.com']).toEqual({
      enabled: false,
      media: { defaultVolume: 0.5 },
      policies: { protectPlaybackRate: false, protectCurrentTime: true }
    })

    const protectionRestored =
      await application.restoreSitePlaybackProtection('https://example.com')
    expect(protectionRestored.settings.settings.data.sites['https://example.com']).toEqual({
      enabled: false,
      media: { defaultVolume: 0.5 },
      policies: { protectCurrentTime: true }
    })
  })

  it('writes and restores individual site experimental policies without replacing siblings', async () => {
    const { api, application } = createApplication()
    api.settings.data.sites['https://example.com'] = {
      enabled: false,
      download: { enabled: false },
      policies: { protectCurrentTime: true }
    }
    await application.load()

    await application.setSiteExperimentalPolicy('https://example.com', {
      allowAcousticGain: true,
      allowMouseLongPress: true,
      mouseLongPressMs: 900,
      allowAutoplay: true
    })
    expect(api.updateCalls.at(-1)?.patch).toEqual({
      sites: {
        'https://example.com': {
          enabled: false,
          download: { enabled: false },
          policies: {
            protectCurrentTime: true,
            allowAcousticGain: true,
            allowMouseLongPress: true,
            mouseLongPressMs: 900,
            allowAutoplay: true
          }
        }
      }
    })

    await application.restoreSiteExperimentalPolicy('https://example.com', 'mouseLongPressMs')
    expect(api.settings.data.sites['https://example.com']?.policies).toEqual({
      protectCurrentTime: true,
      allowAcousticGain: true,
      allowMouseLongPress: true,
      allowAutoplay: true
    })
  })
})
