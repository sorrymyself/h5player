import { describe, expect, it } from 'vitest'
import { DiagnosticsService } from '../../src/application/diagnostics'
import { SettingsService } from '../../src/application/settings/settings-service'
import { FrameRuntimeRegistry, SiteAccessService } from '../../src/application/site'
import { StructuredLogger } from '../../src/infrastructure/logging/structured-logger'
import { SettingsRepository } from '../../src/infrastructure/storage/settings-repository'
import { createTabSuccess, parseTabRequest } from '../../src/shared/tab-protocol'
import {
  FakeClock,
  FakeContentScriptRegistrationPort,
  FakeLogger,
  FakePermissionsPort,
  FakeRuntimeInfoPort,
  FakeStoragePort,
  FakeTabsPort
} from '../test-support/fakes'

describe('DiagnosticsService', () => {
  it('builds a bounded local summary while removing URL paths, titles, tokens, and user content', async () => {
    const clock = new FakeClock(1_700_000_000_000)
    const repository = new SettingsRepository(new FakeStoragePort(), clock, new FakeLogger())
    const settings = new SettingsService(repository)
    await settings.update(
      { sites: { 'https://example.com': { enabled: true } } },
      undefined,
      'test'
    )
    await settings.reset('progress', 'test')

    const tabs = new FakeTabsPort()
    tabs.handler = (raw) => {
      const request = parseTabRequest(raw)
      if (!request) return Promise.reject(new Error('invalid request'))
      return Promise.resolve(
        createTabSuccess(request, {
          ready: true,
          temporaryDisabled: false,
          mediaCount: 2,
          activeMedia: true,
          adapters: [
            {
              id: 'bilibili',
              version: '1.0.0',
              tier: 1,
              supportLevel: 'preview',
              status: 'selected',
              selected: true,
              selectedMediaCount: 1,
              failureCount: 0,
              lastFailureStage: null,
              disabledFeatures: []
            }
          ]
        })
      )
    }
    const permissions = new FakePermissionsPort()
    permissions.origins.add('https://example.com/*')
    const siteAccess = new SiteAccessService(
      settings,
      tabs,
      permissions,
      new FakeContentScriptRegistrationPort(),
      new FrameRuntimeRegistry({ now: () => clock.now() })
    )
    const logger = new StructuredLogger('background', clock)
    logger.log({
      level: 'warn',
      module: 'fixture',
      eventCode: 'PLAYER_FAILED',
      details: {
        origin: 'https://example.com/watch/private?token=secret',
        title: 'Private account video',
        token: 'secret-token',
        text: 'user supplied page text'
      }
    })

    const diagnostics = new DiagnosticsService({
      extensionVersion: '0.1.0',
      buildId: 'abc123',
      clock,
      runtimeInfo: new FakeRuntimeInfoPort(),
      permissions,
      settings,
      siteAccess,
      logger
    })
    const response = await diagnostics.get()

    expect(response.summary).toMatchObject({
      phase: 6,
      settingsSchemaVersion: 3,
      site: { hostname: 'example.com', mediaCount: 2, activeMedia: true },
      settings: { revision: 1, siteRuleCount: 1 },
      adapters: ['bilibili'],
      adapterHealth: [expect.objectContaining({ id: 'bilibili', status: 'selected' })]
    })
    expect(response.summary.permissions.required).toEqual(['activeTab', 'scripting', 'storage'])
    expect(response.json.length).toBeLessThan(1_048_576)
    expect(response.json).not.toContain('secret')
    expect(response.json).not.toContain('/watch/private')
    expect(response.json).not.toContain('Private account video')
    expect(response.json).not.toContain('user supplied page text')
    expect(response.json).toContain('[redacted]')
  })
})
