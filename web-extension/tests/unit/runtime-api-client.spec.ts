import { describe, expect, it } from 'vitest'
import { createSettingsEnvelope } from '../test-support/settings-fixtures'
import { FakeTransport } from '../test-support/fakes'
import { RuntimeApiClient } from '../../src/infrastructure/messaging/runtime-api-client'
import { RuntimeRequestClient } from '../../src/infrastructure/messaging/request-client'
import { systemScheduler } from '../../src/infrastructure/time/system-time'
import { createRuntimeSuccess, parseRuntimeRequest } from '../../src/shared/protocol'

describe('runtime API client', () => {
  it('maps every settings operation to a typed runtime request', async () => {
    const envelope = createSettingsEnvelope(4)
    const transport = new FakeTransport((raw) => {
      const request = parseRuntimeRequest(raw)
      if (!request) return Promise.reject(new Error('invalid request'))
      switch (request.type) {
        case 'system.ping':
          return Promise.resolve(
            createRuntimeSuccess(request, {
              extensionVersion: '0.1.0',
              phase: 6,
              protocol: 1,
              settingsSchemaVersion: 3
            })
          )
        case 'settings.get':
          return Promise.resolve(
            createRuntimeSuccess(request, { settings: envelope, latestBackup: null })
          )
        case 'settings.export':
          return Promise.resolve(createRuntimeSuccess(request, { content: '{"safe":true}' }))
        case 'site.get-context':
          return Promise.resolve(
            createRuntimeSuccess(request, {
              tab: null,
              permission: 'unknown',
              enabled: true,
              temporaryDisabled: false,
              mediaCount: 0,
              activeMedia: false,
              runtime: 'unknown',
              reason: 'no-active-tab'
            })
          )
        case 'site.set-temporary-disabled':
          return Promise.resolve(createRuntimeSuccess(request, { disabled: true }))
        case 'site.set-page-ui-hidden':
          return Promise.resolve(
            createRuntimeSuccess(request, { hidden: true, hiddenMediaCount: 2 })
          )
        case 'site.reconcile':
          return Promise.resolve(
            createRuntimeSuccess(request, { registeredOrigins: 1, bootstrapped: true })
          )
        case 'diagnostics.get':
          return Promise.resolve(
            createRuntimeSuccess(request, {
              summary: {
                generatedAt: 1,
                extensionVersion: '0.1.0',
                build: 'test',
                phase: 6,
                protocolVersion: 1,
                settingsSchemaVersion: 3,
                browser: { name: 'Chromium', version: '140', platform: 'mac/arm64' },
                permissions: {
                  required: ['activeTab', 'scripting', 'storage'],
                  origins: []
                },
                site: { hostname: null, frameCount: 0, mediaCount: 0, activeMedia: false },
                settings: {
                  revision: 4,
                  enabled: true,
                  siteRuleCount: 0,
                  progressCount: 0,
                  latestBackupReason: null
                },
                modules: ['background-runtime'],
                adapters: [],
                recentEvents: [],
                notes: ['redacted']
              },
              json: '{"phase":3}'
            })
          )
        default:
          return Promise.resolve(
            createRuntimeSuccess(request, {
              settings: envelope,
              changedPaths: ['global.enabled'],
              rebased: false
            })
          )
      }
    })
    const api = new RuntimeApiClient(
      new RuntimeRequestClient('options', transport, systemScheduler)
    )

    await expect(api.ping()).resolves.toMatchObject({ phase: 6, settingsSchemaVersion: 3 })
    await expect(api.getSettings()).resolves.toMatchObject({ settings: { revision: 4 } })
    await expect(api.updateSettings({ global: { enabled: false } }, 4)).resolves.toMatchObject({
      changedPaths: ['global.enabled']
    })
    await expect(api.exportSettings()).resolves.toBe('{"safe":true}')
    await expect(api.importSettings('{"safe":true}', 4)).resolves.toMatchObject({
      settings: { revision: 4 }
    })
    await expect(api.restoreBackup('backup-id')).resolves.toMatchObject({ rebased: false })
    await expect(api.resetSettings('sites')).resolves.toMatchObject({ rebased: false })
    await expect(api.getSiteContext()).resolves.toMatchObject({ reason: 'no-active-tab' })
    await expect(api.setTemporarySiteDisabled(true)).resolves.toEqual({ disabled: true })
    await expect(api.setPageUiHidden(true)).resolves.toEqual({
      hidden: true,
      hiddenMediaCount: 2
    })
    await expect(api.reconcileSiteAccess(true)).resolves.toEqual({
      registeredOrigins: 1,
      bootstrapped: true
    })
    await expect(api.getDiagnostics()).resolves.toMatchObject({ summary: { phase: 6 } })

    const types = transport.sent.map(parseRuntimeRequest).map((request) => request?.type)
    expect(types).toEqual([
      'system.ping',
      'settings.get',
      'settings.update',
      'settings.export',
      'settings.import',
      'settings.restore-backup',
      'settings.reset',
      'site.get-context',
      'site.set-temporary-disabled',
      'site.set-page-ui-hidden',
      'site.reconcile',
      'diagnostics.get'
    ])
    expect(parseRuntimeRequest(transport.sent[9])?.payload).toEqual({ hidden: true })
  })
})
