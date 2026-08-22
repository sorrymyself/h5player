import { describe, expect, it } from 'vitest'
import { DiagnosticsService, diagnosticResponseSchema } from '../../src/application/diagnostics'
import { SettingsService } from '../../src/application/settings/settings-service'
import { SiteAccessService } from '../../src/application/site'
import { FrameRuntimeRegistry } from '../../src/application/site'
import { mediaCommandResultResponseSchema, mediaPageStateSchema } from '../../src/application/media'
import type { MediaCommand } from '../../src/domain/command'
import {
  settingsExportResponseSchema,
  settingsMutationResponseSchema,
  settingsSnapshotResponseSchema
} from '../../src/application/settings/contracts'
import { ReplayGuard } from '../../src/infrastructure/messaging/replay-guard'
import { SettingsRepository } from '../../src/infrastructure/storage/settings-repository'
import { BackgroundRuntime } from '../../src/runtime/background/background-runtime'
import {
  createRuntimeRequest,
  parseRuntimeResponse,
  type RuntimeRequestEnvelope
} from '../../src/shared/protocol'
import { createTabSuccess, parseTabRequest } from '../../src/shared/tab-protocol'
import {
  FakeClock,
  FakeContentScriptRegistrationPort,
  FakeDiagnosticLogger,
  FakePermissionsPort,
  FakeRuntimeInfoPort,
  FakeLogger,
  FakeStoragePort,
  FakeTabsPort
} from '../test-support/fakes'

function createRuntime() {
  const clock = new FakeClock()
  const logger = new FakeLogger()
  const repository = new SettingsRepository(new FakeStoragePort(), clock, logger)
  const tabs = new FakeTabsPort()
  const settings = new SettingsService(repository)
  const permissions = new FakePermissionsPort()
  const frameRegistry = new FrameRuntimeRegistry({ now: () => clock.now() })
  const registration = new FakeContentScriptRegistrationPort()
  const siteAccess = new SiteAccessService(settings, tabs, permissions, registration, frameRegistry)
  const diagnostics = new DiagnosticsService({
    extensionVersion: '0.1.0',
    buildId: 'test-build',
    clock,
    runtimeInfo: new FakeRuntimeInfoPort(),
    permissions,
    settings,
    siteAccess,
    logger: new FakeDiagnosticLogger('background', clock)
  })
  return {
    runtime: new BackgroundRuntime({
      extensionId: 'extension-id',
      extensionVersion: '0.1.0',
      settings,
      replayGuard: new ReplayGuard(clock),
      logger,
      tabs,
      siteAccess,
      frameRegistry,
      diagnostics
    }),
    repository,
    settings,
    frameRegistry,
    logger,
    tabs,
    permissions,
    registration
  }
}

const popupSender = {
  id: 'extension-id',
  url: 'chrome-extension://extension-id/popup.html'
}

async function handle(request: RuntimeRequestEnvelope) {
  const { runtime } = createRuntime()
  return parseRuntimeResponse(await runtime.handle(request, popupSender))
}

describe('background runtime contract boundary', () => {
  it('returns versioned ping and settings responses for authorized extension pages', async () => {
    const ping = await handle(createRuntimeRequest('popup', 'system.ping', {}))
    const settings = await handle(createRuntimeRequest('popup', 'settings.get', {}))

    expect(ping?.type).toBe('protocol.response')
    if (ping?.type === 'protocol.response') expect(ping.payload.data).toMatchObject({ phase: 6 })
    expect(settings?.type).toBe('protocol.response')
  })

  it('returns the browser-resolved Tencent site origin to a delegated child frame', async () => {
    const { runtime } = createRuntime()
    const request = createRuntimeRequest(
      'content',
      'system.ping',
      {},
      {
        sessionId: 'content-session-0000000000000000'
      }
    )
    const response = parseRuntimeResponse(
      await runtime.handle(request, {
        id: 'extension-id',
        tabId: 9,
        frameId: 14,
        url: 'https://vm.gtimg.cn/thumbplayer/txv/wasm/1.0.53/fake-video-element-iframe.html',
        tabUrl: 'https://v.qq.com/x/cover/example/video.html'
      })
    )

    expect(response?.type).toBe('protocol.response')
    if (response?.type === 'protocol.response') {
      expect(response.payload.data).toMatchObject({
        tabId: 9,
        frameId: 14,
        siteOrigin: 'https://v.qq.com'
      })
    }
  })

  it('rejects forged sender identity and self-reported tab context', async () => {
    const { runtime } = createRuntime()
    const forged = createRuntimeRequest('popup', 'settings.get', {})
    const forgedResponse = parseRuntimeResponse(
      await runtime.handle(forged, { ...popupSender, id: 'attacker' })
    )
    const tabClaim = createRuntimeRequest('popup', 'settings.get', {}, { tabId: 99 })
    const tabResponse = parseRuntimeResponse(await runtime.handle(tabClaim, popupSender))

    expect(forgedResponse?.type).toBe('protocol.error')
    expect(tabResponse?.type).toBe('protocol.error')
    if (forgedResponse?.type === 'protocol.error') {
      expect(forgedResponse.payload.error.code).toBe('UNAUTHORIZED_SOURCE')
    }
  })

  it('rejects invalid payloads, unknown messages and request replay safely', async () => {
    const { runtime } = createRuntime()
    const request = createRuntimeRequest('popup', 'settings.update', { patch: { script: true } })
    const invalid = parseRuntimeResponse(await runtime.handle(request, popupSender))
    const replay = parseRuntimeResponse(await runtime.handle(request, popupSender))
    const unknown = await runtime.handle(
      { ...createRuntimeRequest('popup', 'settings.get', {}), type: 'unknown.type' },
      popupSender
    )

    expect(invalid?.type).toBe('protocol.error')
    if (invalid?.type === 'protocol.error') {
      expect(invalid.payload.error.code).toBe('INVALID_PAYLOAD')
    }
    expect(replay?.type).toBe('protocol.error')
    if (replay?.type === 'protocol.error') {
      expect(replay.payload.error.code).toBe('REPLAY_DETECTED')
    }
    expect(unknown).toBeNull()
  })

  it('does not let content sessions mutate extension settings', async () => {
    const { runtime } = createRuntime()
    const request = createRuntimeRequest(
      'content',
      'settings.update',
      { patch: { global: { enabled: false } } },
      { sessionId: 'session-identifier-1' }
    )
    const response = parseRuntimeResponse(
      await runtime.handle(request, {
        id: 'extension-id',
        tabId: 1,
        frameId: 0,
        url: 'https://example.com/watch'
      })
    )
    expect(response?.type).toBe('protocol.error')
    if (response?.type === 'protocol.error') {
      expect(response.payload.error.code).toBe('UNAUTHORIZED_SOURCE')
    }
  })

  it('injects the experimental MAIN script only for an enabled authenticated content frame', async () => {
    const { runtime, settings, registration } = createRuntime()
    const enabled = await settings.update(
      {
        global: {
          policies: { allowExperimental: true },
          download: { enabled: true }
        }
      },
      undefined,
      'options'
    )
    expect(enabled.ok).toBe(true)

    const sender = {
      id: 'extension-id',
      tabId: 7,
      frameId: 3,
      url: 'https://example.com/watch'
    }
    const allowed = parseRuntimeResponse(
      await runtime.handle(
        createRuntimeRequest(
          'content',
          'experimental.ensure-main',
          {},
          { sessionId: 'experimental-session-0000001' }
        ),
        sender
      )
    )
    expect(allowed).toMatchObject({
      type: 'protocol.response',
      payload: { data: { allowed: true, injected: true } }
    })
    expect(registration.experimentalMainInjected).toEqual([{ tabId: 7, frameId: 3 }])

    const disabled = await settings.update(
      { global: { download: { enabled: false } } },
      undefined,
      'options'
    )
    expect(disabled.ok).toBe(true)
    const denied = parseRuntimeResponse(
      await runtime.handle(
        createRuntimeRequest(
          'content',
          'experimental.ensure-main',
          {},
          { sessionId: 'experimental-session-0000002' }
        ),
        sender
      )
    )
    expect(denied).toMatchObject({
      type: 'protocol.response',
      payload: { data: { allowed: false, injected: false } }
    })
    expect(registration.experimentalMainInjected).toHaveLength(1)
  })

  it('lets content write only a playback-rate policy for its authenticated site origin', async () => {
    const { runtime, repository } = createRuntime()
    const request = createRuntimeRequest(
      'content',
      'playback.set-site-intent',
      { value: 1.75, protectAgainstSiteReset: true },
      { sessionId: 'session-identifier-1' }
    )
    const response = parseRuntimeResponse(
      await runtime.handle(request, {
        id: 'extension-id',
        tabId: 1,
        frameId: 0,
        url: 'https://Example.com:443/watch?token=secret'
      })
    )
    expect(response?.type).toBe('protocol.response')
    if (response?.type === 'protocol.response') {
      expect(response.payload.data).toMatchObject({
        origin: 'https://example.com',
        value: 1.75,
        protectAgainstSiteReset: true
      })
      expect(JSON.stringify(response.payload.data)).not.toContain('token=secret')
    }
    const stored = await repository.get()
    expect(stored.ok && stored.value.data.sites['https://example.com']).toMatchObject({
      enabled: true,
      media: { defaultPlaybackRate: 1.75 },
      policies: { protectPlaybackRate: true }
    })
  })

  it('lets content toggle only the authenticated site progress restore policy', async () => {
    const { runtime, repository } = createRuntime()
    const sender = {
      id: 'extension-id',
      tabId: 1,
      frameId: 0,
      url: 'https://Example.com:443/watch?token=secret'
    }
    const enable = parseRuntimeResponse(
      await runtime.handle(
        createRuntimeRequest(
          'content',
          'progress.toggle-restore',
          {},
          { sessionId: 'progress-toggle-session-1' }
        ),
        sender
      )
    )

    expect(enable).toMatchObject({
      type: 'protocol.response',
      payload: { data: { origin: 'https://example.com', enabled: true } }
    })
    expect(JSON.stringify(enable)).not.toContain('token=secret')
    let stored = await repository.get()
    expect(stored.ok && stored.value.data.sites['https://example.com']).toMatchObject({
      enabled: true,
      media: { restoreProgress: true }
    })

    const disable = parseRuntimeResponse(
      await runtime.handle(
        createRuntimeRequest(
          'content',
          'progress.toggle-restore',
          {},
          { sessionId: 'progress-toggle-session-1' }
        ),
        sender
      )
    )
    expect(disable).toMatchObject({
      type: 'protocol.response',
      payload: { data: { origin: 'https://example.com', enabled: false } }
    })
    stored = await repository.get()
    expect(
      stored.ok && stored.value.data.sites['https://example.com']?.media?.restoreProgress
    ).toBe(false)
  })

  it('maps the recognized Tencent child frame policy to the browser tab origin', async () => {
    const { runtime, repository } = createRuntime()
    const request = createRuntimeRequest(
      'content',
      'playback.set-site-intent',
      { value: 1.5, protectAgainstSiteReset: false },
      { sessionId: 'tencent-frame-session-1' }
    )
    const response = parseRuntimeResponse(
      await runtime.handle(request, {
        id: 'extension-id',
        tabId: 1,
        frameId: 13,
        url: 'https://vm.gtimg.cn/thumbplayer/txv/wasm/1.0.53/fake-video-element-iframe.html',
        tabUrl: 'https://v.qq.com/x/cover/example/video.html'
      })
    )
    expect(response).toMatchObject({
      type: 'protocol.response',
      payload: { data: { origin: 'https://v.qq.com', value: 1.5 } }
    })
    const stored = await repository.get()
    expect(stored.ok && stored.value.data.sites['https://v.qq.com']).toMatchObject({
      enabled: true,
      media: { defaultPlaybackRate: 1.5 }
    })
    expect(stored.ok && stored.value.data.sites['https://vm.gtimg.cn']).toBeUndefined()
  })

  it('accepts authenticated frame reports and rejects malformed or extension-page reports', async () => {
    const { runtime } = createRuntime()
    const contentRequest = createRuntimeRequest(
      'content',
      'site.report-frame-state',
      {
        ready: true,
        mediaCount: 1,
        activeMedia: true,
        anchoredMediaCount: 1,
        pageUiHidden: false,
        temporaryDisabled: false,
        updatedAt: 10
      },
      { sessionId: 'frame-session-0000001' }
    )
    const accepted = parseRuntimeResponse(
      await runtime.handle(contentRequest, {
        id: 'extension-id',
        tabId: 1,
        frameId: 2,
        url: 'https://example.com/embed'
      })
    )
    expect(accepted?.type).toBe('protocol.response')
    if (accepted?.type === 'protocol.response') {
      expect(accepted.payload.data).toEqual({
        accepted: true,
        stateKnown: false,
        pageUiHidden: false,
        temporaryDisabled: false
      })
    }

    const malformed = parseRuntimeResponse(
      await runtime.handle(
        createRuntimeRequest(
          'content',
          'site.report-frame-state',
          { ready: true, mediaCount: -1 },
          { sessionId: 'frame-session-0000002' }
        ),
        {
          id: 'extension-id',
          tabId: 1,
          frameId: 2,
          url: 'https://example.com/embed'
        }
      )
    )
    expect(malformed?.type).toBe('protocol.error')
    if (malformed?.type === 'protocol.error') {
      expect(malformed.payload.error.code).toBe('INVALID_PAYLOAD')
    }

    const popupReport = createRuntimeRequest('popup', 'site.report-frame-state', {
      ready: true,
      mediaCount: 1,
      activeMedia: true,
      anchoredMediaCount: 1,
      pageUiHidden: false,
      temporaryDisabled: false,
      updatedAt: 10
    })
    const rejected = parseRuntimeResponse(await runtime.handle(popupReport, popupSender))
    expect(rejected?.type).toBe('protocol.error')
    if (rejected?.type === 'protocol.error') {
      expect(rejected.payload.error.code).toBe('UNAUTHORIZED_SOURCE')
    }
  })

  it('keeps a disabled frame addressable and ignores teardown from its replaced session', async () => {
    const { runtime, frameRegistry } = createRuntime()
    const sender = {
      id: 'extension-id',
      tabId: 1,
      frameId: 2,
      url: 'https://example.com/embed'
    }
    const oldIdentity = { tabId: 1, frameId: 2, sessionId: 'old-frame-session-0001' }
    const newIdentity = { tabId: 1, frameId: 2, sessionId: 'new-frame-session-0001' }

    await runtime.handle(
      createRuntimeRequest(
        'content',
        'site.report-frame-state',
        {
          ready: false,
          mediaCount: 0,
          activeMedia: false,
          anchoredMediaCount: 0,
          pageUiHidden: false,
          temporaryDisabled: false,
          updatedAt: 10
        },
        { sessionId: oldIdentity.sessionId }
      ),
      sender
    )
    expect(frameRegistry.frameIds(1)).toEqual([2])
    expect(frameRegistry.summarize(1).mediaLocation).toBe('none')

    frameRegistry.connect(newIdentity)
    await runtime.handle(
      createRuntimeRequest(
        'content',
        'site.report-frame-state',
        {
          ready: true,
          mediaCount: 2,
          activeMedia: true,
          anchoredMediaCount: 1,
          pageUiHidden: false,
          temporaryDisabled: false,
          updatedAt: 20
        },
        { sessionId: newIdentity.sessionId }
      ),
      sender
    )
    frameRegistry.remove(oldIdentity)

    expect(frameRegistry.summarize(1)).toMatchObject({
      childFrameMediaCount: 2,
      childFrameCount: 1,
      mediaLocation: 'child-frame'
    })
    frameRegistry.remove(newIdentity)
    expect(frameRegistry.frameIds(1)).toEqual([])
  })

  it('keeps an unconnected replacement pending until its lifetime port connects', async () => {
    const { runtime, frameRegistry } = createRuntime()
    const sender = {
      id: 'extension-id',
      tabId: 1,
      frameId: 2,
      url: 'https://example.com/embed'
    }
    const oldIdentity = { tabId: 1, frameId: 2, sessionId: 'old-frame-session-0001' }
    const newIdentity = { tabId: 1, frameId: 2, sessionId: 'new-frame-session-0001' }
    const state = {
      ready: true,
      mediaCount: 1,
      activeMedia: true,
      anchoredMediaCount: 1,
      pageUiHidden: false,
      temporaryDisabled: false,
      updatedAt: 10
    }

    const oldReport = parseRuntimeResponse(
      await runtime.handle(
        createRuntimeRequest('content', 'site.report-frame-state', state, {
          sessionId: oldIdentity.sessionId
        }),
        sender
      )
    )
    expect(oldReport?.type).toBe('protocol.response')

    const pendingReport = parseRuntimeResponse(
      await runtime.handle(
        createRuntimeRequest(
          'content',
          'site.report-frame-state',
          { ...state, mediaCount: 2, updatedAt: 20 },
          { sessionId: newIdentity.sessionId }
        ),
        sender
      )
    )
    expect(pendingReport).toMatchObject({
      type: 'protocol.response',
      payload: { data: { accepted: false } }
    })
    expect(frameRegistry.owns(oldIdentity)).toBe(true)
    expect(frameRegistry.owns(newIdentity)).toBe(false)

    frameRegistry.connect(newIdentity)

    expect(frameRegistry.owns(oldIdentity)).toBe(false)
    expect(frameRegistry.owns(newIdentity)).toBe(true)
    expect(frameRegistry.summarize(1)).toMatchObject({ childFrameMediaCount: 2 })
  })

  it('rejects privileged requests from a replaced content-frame session', async () => {
    const { runtime, frameRegistry } = createRuntime()
    const sender = {
      id: 'extension-id',
      tabId: 1,
      frameId: 2,
      url: 'https://example.com/embed'
    }
    const oldSessionId = 'old-frame-session-0001'
    const newSessionId = 'new-frame-session-0001'
    const state = {
      ready: true,
      mediaCount: 1,
      activeMedia: true,
      anchoredMediaCount: 1,
      pageUiHidden: false,
      temporaryDisabled: false,
      updatedAt: 10
    }
    frameRegistry.report({ tabId: 1, frameId: 2, sessionId: oldSessionId }, state)
    frameRegistry.connect({ tabId: 1, frameId: 2, sessionId: newSessionId })
    expect(
      frameRegistry.report(
        { tabId: 1, frameId: 2, sessionId: newSessionId },
        { ...state, updatedAt: 20 }
      )
    ).toBe(true)

    const staleReport = parseRuntimeResponse(
      await runtime.handle(
        createRuntimeRequest(
          'content',
          'site.report-frame-state',
          { ...state, mediaCount: 9, updatedAt: 30 },
          { sessionId: oldSessionId }
        ),
        sender
      )
    )
    expect(staleReport).toMatchObject({
      type: 'protocol.response',
      payload: { data: { accepted: false } }
    })
    expect(frameRegistry.owns({ tabId: 1, frameId: 2, sessionId: newSessionId })).toBe(true)
    expect(frameRegistry.summarize(1).childFrameMediaCount).toBe(1)

    const stale = parseRuntimeResponse(
      await runtime.handle(
        createRuntimeRequest('content', 'settings.get', {}, { sessionId: oldSessionId }),
        sender
      )
    )
    expect(stale?.type).toBe('protocol.error')
    if (stale?.type === 'protocol.error') {
      expect(stale.payload.error.code).toBe('UNAUTHORIZED_SOURCE')
    }

    const current = parseRuntimeResponse(
      await runtime.handle(
        createRuntimeRequest('content', 'settings.get', {}, { sessionId: newSessionId }),
        sender
      )
    )
    expect(current?.type).toBe('protocol.response')
  })

  it('lets a late child frame inherit the top-frame hidden and temporary state', async () => {
    const { runtime, tabs } = createRuntime()
    tabs.handler = (raw) => {
      const request = parseTabRequest(raw)
      return Promise.resolve(request ? createTabSuccess(request, { accepted: true }) : null)
    }
    const topState = parseRuntimeResponse(
      await runtime.handle(
        createRuntimeRequest(
          'content',
          'site.report-frame-state',
          {
            ready: false,
            mediaCount: 0,
            activeMedia: false,
            anchoredMediaCount: 0,
            pageUiHidden: true,
            temporaryDisabled: true,
            updatedAt: 10
          },
          { sessionId: 'top-frame-session-0001' }
        ),
        {
          id: 'extension-id',
          tabId: 1,
          frameId: 0,
          url: 'https://example.com/watch'
        }
      )
    )
    expect(topState?.type).toBe('protocol.response')
    expect(tabs.sent).toHaveLength(1)
    expect(parseTabRequest(tabs.sent[0]?.message)?.type).toBe('site.refresh-frame-state')

    const childState = parseRuntimeResponse(
      await runtime.handle(
        createRuntimeRequest(
          'content',
          'site.report-frame-state',
          {
            ready: true,
            mediaCount: 1,
            activeMedia: true,
            anchoredMediaCount: 1,
            pageUiHidden: false,
            temporaryDisabled: false,
            updatedAt: 20
          },
          { sessionId: 'child-frame-session-0001' }
        ),
        {
          id: 'extension-id',
          tabId: 1,
          frameId: 2,
          url: 'https://player.example.net/embed'
        }
      )
    )
    expect(childState?.type).toBe('protocol.response')
    if (childState?.type === 'protocol.response') {
      expect(childState.payload.data).toEqual({
        accepted: true,
        stateKnown: true,
        pageUiHidden: true,
        temporaryDisabled: true
      })
    }
  })

  it('rejects playback policy writes without an authenticated http site origin', async () => {
    const { runtime } = createRuntime()
    const request = createRuntimeRequest(
      'content',
      'playback.set-site-intent',
      { value: 2 },
      { sessionId: 'session-identifier-1' }
    )
    const response = parseRuntimeResponse(
      await runtime.handle(request, {
        id: 'extension-id',
        tabId: 1,
        frameId: 0,
        url: 'chrome://settings'
      })
    )
    expect(response?.type).toBe('protocol.error')
    if (response?.type === 'protocol.error') {
      expect(response.payload.error.code).toBe('UNAUTHORIZED_SOURCE')
    }
  })

  it('serializes two options writers through the authoritative repository', async () => {
    const { runtime, repository } = createRuntime()
    const sender = {
      id: 'extension-id',
      url: 'moz-extension://extension-id/options.html'
    }
    const first = createRuntimeRequest('options', 'settings.update', {
      patch: { global: { enabled: false } },
      expectedRevision: 0
    })
    const second = createRuntimeRequest('options', 'settings.update', {
      patch: { global: { media: { defaultPlaybackRate: 2 } } },
      expectedRevision: 0
    })

    await Promise.all([runtime.handle(first, sender), runtime.handle(second, sender)])
    const final = await repository.get()
    expect(final.ok && final.value.data.global.enabled).toBe(false)
    expect(final.ok && final.value.data.global.media.defaultPlaybackRate).toBe(2)
  })

  it('routes export, import, backup restore and cancellation for options only', async () => {
    const { runtime } = createRuntime()
    const sender = {
      id: 'extension-id',
      url: 'chrome-extension://extension-id/options.html',
      tabId: 7,
      frameId: 0
    }

    const exportedResponse = parseRuntimeResponse(
      await runtime.handle(createRuntimeRequest('options', 'settings.export', {}), sender)
    )
    if (exportedResponse?.type !== 'protocol.response') throw new Error('export failed')
    const exported = settingsExportResponseSchema.parse(exportedResponse.payload.data)
    const importDocument = JSON.parse(exported.content) as {
      data: { global: { enabled: boolean } }
    }
    importDocument.data.global.enabled = false

    const importedResponse = parseRuntimeResponse(
      await runtime.handle(
        createRuntimeRequest('options', 'settings.import', {
          content: JSON.stringify(importDocument)
        }),
        sender
      )
    )
    expect(importedResponse?.type).toBe('protocol.response')

    const snapshotResponse = parseRuntimeResponse(
      await runtime.handle(createRuntimeRequest('options', 'settings.get', {}), sender)
    )
    if (snapshotResponse?.type !== 'protocol.response') throw new Error('snapshot failed')
    const snapshot = settingsSnapshotResponseSchema.parse(snapshotResponse.payload.data)
    if (!snapshot.latestBackup) throw new Error('backup missing')

    const restored = parseRuntimeResponse(
      await runtime.handle(
        createRuntimeRequest('options', 'settings.restore-backup', {
          backupId: snapshot.latestBackup.backupId
        }),
        sender
      )
    )
    expect(restored?.type).toBe('protocol.response')

    const cancelled = parseRuntimeResponse(
      await runtime.handle(
        createRuntimeRequest('options', 'protocol.cancel', {
          targetRequestId: 'missing-request-id-1234'
        }),
        sender
      )
    )
    expect(cancelled?.type).toBe('protocol.response')
  })

  it('routes settings reset, site context/reconciliation and diagnostics through typed contracts', async () => {
    const { runtime, permissions } = createRuntime()
    const sender = {
      id: 'extension-id',
      url: 'chrome-extension://extension-id/options.html'
    }

    const updated = parseRuntimeResponse(
      await runtime.handle(
        createRuntimeRequest('options', 'settings.update', {
          patch: { global: { enabled: false } },
          expectedRevision: 0
        }),
        sender
      )
    )
    expect(updated?.type).toBe('protocol.response')

    const reset = parseRuntimeResponse(
      await runtime.handle(
        createRuntimeRequest('options', 'settings.reset', { scope: 'global' }),
        sender
      )
    )
    expect(reset?.type).toBe('protocol.response')
    if (reset?.type === 'protocol.response') {
      const mutation = settingsMutationResponseSchema.parse(reset.payload.data)
      expect(mutation.settings.data.global.enabled).toBe(true)
    }

    const context = parseRuntimeResponse(
      await runtime.handle(createRuntimeRequest('options', 'site.get-context', {}), sender)
    )
    expect(context?.type).toBe('protocol.response')
    if (context?.type === 'protocol.response') {
      expect(context.payload.data).toMatchObject({ permission: 'missing' })
    }

    permissions.origins.add('https://example.com/*')
    const reconciled = parseRuntimeResponse(
      await runtime.handle(
        createRuntimeRequest('options', 'site.reconcile', { bootstrapCurrentTab: false }),
        sender
      )
    )
    expect(reconciled?.type).toBe('protocol.response')
    if (reconciled?.type === 'protocol.response') {
      expect(reconciled.payload.data).toEqual({ registeredOrigins: 1, bootstrapped: false })
    }

    const diagnostics = parseRuntimeResponse(
      await runtime.handle(createRuntimeRequest('options', 'diagnostics.get', {}), sender)
    )
    expect(diagnostics?.type).toBe('protocol.response')
    if (diagnostics?.type === 'protocol.response') {
      expect(diagnosticResponseSchema.parse(diagnostics.payload.data).summary).toMatchObject({
        phase: 6,
        settingsSchemaVersion: 3
      })
    }
  })

  it('rejects privileged content routes and arbitrary permission or file directives', async () => {
    const { runtime } = createRuntime()
    const contentSender = {
      id: 'extension-id',
      tabId: 1,
      frameId: 0,
      url: 'https://example.com/watch'
    }
    const contentRequests = [
      createRuntimeRequest(
        'content',
        'settings.reset',
        { scope: 'all' },
        {
          sessionId: 'session-identifier-1'
        }
      ),
      createRuntimeRequest(
        'content',
        'site.get-context',
        {},
        {
          sessionId: 'session-identifier-2'
        }
      ),
      createRuntimeRequest(
        'content',
        'site.reconcile',
        { bootstrapCurrentTab: true },
        {
          sessionId: 'session-identifier-3'
        }
      ),
      createRuntimeRequest(
        'content',
        'diagnostics.get',
        {},
        {
          sessionId: 'session-identifier-4'
        }
      )
    ]

    for (const request of contentRequests) {
      const response = parseRuntimeResponse(await runtime.handle(request, contentSender))
      expect(response?.type).toBe('protocol.error')
      if (response?.type === 'protocol.error') {
        expect(response.payload.error.code).toBe('UNAUTHORIZED_SOURCE')
      }
    }

    const sender = {
      id: 'extension-id',
      url: 'chrome-extension://extension-id/options.html'
    }
    const injectedPayloads = [
      createRuntimeRequest('options', 'site.reconcile', {
        bootstrapCurrentTab: true,
        origins: ['<all_urls>'],
        files: ['/content-scripts/content.js']
      }),
      createRuntimeRequest('options', 'diagnostics.get', {
        permissions: ['downloads'],
        files: ['background.js']
      }),
      createRuntimeRequest('options', 'settings.reset', {
        scope: 'all',
        origins: ['https://attacker.invalid/*']
      })
    ]

    for (const request of injectedPayloads) {
      const response = parseRuntimeResponse(await runtime.handle(request, sender))
      expect(response?.type).toBe('protocol.error')
      if (response?.type === 'protocol.error') {
        expect(response.payload.error.code).toBe('INVALID_PAYLOAD')
      }
    }
  })

  it('reports initialization and import failures without exposing raw data', async () => {
    const clock = new FakeClock()
    const logger = new FakeLogger()
    const storage = new FakeStoragePort()
    storage.failReads = true
    const repository = new SettingsRepository(storage, clock, logger)
    const settings = new SettingsService(repository)
    const permissions = new FakePermissionsPort()
    const tabs = new FakeTabsPort()
    const frameRegistry = new FrameRuntimeRegistry({ now: () => clock.now() })
    const siteAccess = new SiteAccessService(
      settings,
      tabs,
      permissions,
      new FakeContentScriptRegistrationPort(),
      frameRegistry
    )
    const runtime = new BackgroundRuntime({
      extensionId: 'extension-id',
      extensionVersion: '0.1.0',
      settings,
      replayGuard: new ReplayGuard(clock),
      logger,
      tabs,
      siteAccess,
      frameRegistry,
      diagnostics: new DiagnosticsService({
        extensionVersion: '0.1.0',
        buildId: 'test-build',
        clock,
        runtimeInfo: new FakeRuntimeInfoPort(),
        permissions,
        settings,
        siteAccess,
        logger: new FakeDiagnosticLogger('background', clock)
      })
    })
    await runtime.initialize()
    expect(
      logger.records.some((record) => record.eventCode === 'SETTINGS_INITIALIZATION_FAILED')
    ).toBe(true)

    storage.failReads = false
    const response = parseRuntimeResponse(
      await runtime.handle(
        createRuntimeRequest('options', 'settings.import', { content: '{broken' }),
        { id: 'extension-id', url: 'chrome-extension://extension-id/options.html' }
      )
    )
    expect(response?.type).toBe('protocol.error')
    if (response?.type === 'protocol.error') {
      expect(response.payload.error.code).toBe('IMPORT_INVALID')
      expect(JSON.stringify(response)).not.toContain('{broken')
    }
  })

  it('authorizes a content ping from the sender tab/frame but not an extension-page path mismatch', async () => {
    const { runtime } = createRuntime()
    const content = createRuntimeRequest(
      'content',
      'system.ping',
      {},
      {
        sessionId: 'session-identifier-1'
      }
    )
    const contentResponse = parseRuntimeResponse(
      await runtime.handle(content, {
        id: 'extension-id',
        tabId: 4,
        frameId: 2,
        url: 'https://example.com/watch'
      })
    )
    expect(contentResponse).toMatchObject({ tabId: 4, frameId: 2 })

    const mismatch = parseRuntimeResponse(
      await runtime.handle(createRuntimeRequest('popup', 'system.ping', {}), {
        id: 'extension-id',
        url: 'chrome-extension://extension-id/options.html'
      })
    )
    expect(mismatch?.type).toBe('protocol.error')
  })

  it('forwards typed media state and commands to the active top frame', async () => {
    const { runtime, tabs } = createRuntime()
    const state = mediaPageStateSchema.parse({
      frameId: 0,
      revision: 1,
      activeMediaId: 'media-0-1',
      observedAt: 1,
      media: [
        {
          id: 'media-0-1',
          frameId: 0,
          kind: 'video',
          state: 'paused',
          metrics: {
            width: 640,
            height: 360,
            duration: 100,
            currentTime: 10,
            volume: 0.5,
            playbackRate: 1,
            muted: false,
            visible: true
          },
          capabilities: {
            playback: true,
            seek: true,
            playbackRate: true,
            volume: true,
            mute: true,
            fullscreen: false,
            pictureInPicture: false,
            capture: false,
            downloadExperimental: false
          },
          adapterId: 'generic',
          updatedAt: 1
        }
      ]
    })
    const active = state.media[0]
    if (!active) throw new Error('active fixture missing')
    tabs.handler = (raw) => {
      const request = parseTabRequest(raw)
      if (!request) throw new Error('invalid tab request')
      if (request.type === 'media.get-state') {
        return Promise.resolve(createTabSuccess(request, state))
      }
      return Promise.resolve(
        createTabSuccess(
          request,
          mediaCommandResultResponseSchema.parse({
            result: {
              ok: true,
              value: {
                commandType: 'media.set-volume',
                mediaId: 'media-0-1',
                changed: true,
                snapshot: {
                  ...active,
                  metrics: { ...active.metrics, volume: 0.8 }
                }
              }
            },
            state
          })
        )
      )
    }

    const sender = { id: 'extension-id', url: 'chrome-extension://extension-id/popup.html' }
    const stateResponse = parseRuntimeResponse(
      await runtime.handle(createRuntimeRequest('popup', 'media.get-state', {}), sender)
    )
    const commandResponse = parseRuntimeResponse(
      await runtime.handle(
        createRuntimeRequest('popup', 'media.execute', {
          command: { type: 'media.set-volume', mediaId: 'media-0-1', value: 0.8 }
        }),
        sender
      )
    )

    expect(stateResponse?.type).toBe('protocol.response')
    expect(commandResponse?.type).toBe('protocol.response')
    expect(tabs.sent).toHaveLength(2)
    expect(tabs.sent.every((message) => message.frameId === 0)).toBe(true)
  })

  it('routes popup media operations to the active child frame', async () => {
    const { runtime, tabs, frameRegistry } = createRuntime()
    const childState = mediaPageStateSchema.parse({
      frameId: 7,
      revision: 1,
      activeMediaId: 'media-7-1',
      observedAt: 1,
      media: [
        {
          id: 'media-7-1',
          frameId: 7,
          kind: 'video',
          state: 'active',
          metrics: {
            width: 946,
            height: 532,
            duration: 100,
            currentTime: 10,
            volume: 0.5,
            playbackRate: 1,
            muted: false,
            visible: true
          },
          capabilities: {
            playback: true,
            seek: true,
            playbackRate: true,
            volume: true,
            mute: true,
            fullscreen: false,
            pictureInPicture: false,
            capture: false,
            downloadExperimental: false
          },
          adapterId: 'tencent-video',
          updatedAt: 1
        }
      ]
    })
    const active = childState.media[0]
    if (!active) throw new Error('child media fixture missing')
    frameRegistry.report(
      { tabId: 1, frameId: 0, sessionId: 'top-session-0000001' },
      {
        ready: true,
        mediaCount: 0,
        activeMedia: false,
        anchoredMediaCount: 0,
        pageUiHidden: false,
        temporaryDisabled: false,
        updatedAt: 1
      }
    )
    frameRegistry.report(
      { tabId: 1, frameId: 7, sessionId: 'child-session-0000007' },
      {
        ready: true,
        mediaCount: 1,
        activeMedia: true,
        anchoredMediaCount: 1,
        pageUiHidden: false,
        temporaryDisabled: false,
        updatedAt: 2
      }
    )
    tabs.handler = (raw, _tabId, frameId) => {
      const request = parseTabRequest(raw)
      if (!request) throw new Error('invalid tab request')
      if (frameId !== 7) throw new Error(`unexpected frame ${String(frameId)}`)
      if (request.type === 'media.get-state') {
        return Promise.resolve(createTabSuccess(request, childState))
      }
      return Promise.resolve(
        createTabSuccess(
          request,
          mediaCommandResultResponseSchema.parse({
            result: {
              ok: true,
              value: {
                commandType: 'media.adjust-rate',
                mediaId: active.id,
                changed: true,
                snapshot: {
                  ...active,
                  metrics: { ...active.metrics, playbackRate: 1.1 }
                }
              }
            },
            state: childState
          })
        )
      )
    }

    const stateResponse = parseRuntimeResponse(
      await runtime.handle(createRuntimeRequest('popup', 'media.get-state', {}), popupSender)
    )
    const commandResponse = parseRuntimeResponse(
      await runtime.handle(
        createRuntimeRequest('popup', 'media.execute', {
          command: { type: 'media.adjust-rate', mediaId: active.id, delta: 0.1 }
        }),
        popupSender
      )
    )

    expect(stateResponse).toMatchObject({
      type: 'protocol.response',
      payload: { data: { frameId: 7, activeMediaId: active.id } }
    })
    expect(commandResponse?.type).toBe('protocol.response')
    expect(tabs.sent.map(({ frameId }) => frameId)).toEqual([7, 7])
  })

  it('skips a hidden auxiliary frame when resolving popup media state', async () => {
    const { runtime, tabs, frameRegistry } = createRuntime()
    const makeState = (frameId: number, visible: boolean) =>
      mediaPageStateSchema.parse({
        frameId,
        revision: 1,
        activeMediaId: `media-${frameId}-1`,
        observedAt: frameId,
        media: [
          {
            id: `media-${frameId}-1`,
            frameId,
            kind: 'video',
            state: visible ? 'active' : 'paused',
            metrics: {
              width: visible ? 946 : 1,
              height: visible ? 532 : 1,
              duration: visible ? 100 : null,
              currentTime: visible ? 10 : 0,
              volume: 1,
              playbackRate: 1,
              muted: false,
              visible
            },
            capabilities: {
              playback: true,
              seek: true,
              playbackRate: true,
              volume: true,
              mute: true,
              fullscreen: false,
              pictureInPicture: false,
              capture: false,
              downloadExperimental: false
            },
            adapterId: 'tencent-video',
            updatedAt: frameId
          }
        ]
      })
    const hiddenState = makeState(7, false)
    const visibleState = makeState(9, true)
    for (const [frameId, updatedAt] of [
      [7, 20],
      [9, 10]
    ] as const) {
      frameRegistry.report(
        { tabId: 1, frameId, sessionId: `child-session-000${frameId}` },
        {
          ready: true,
          mediaCount: 1,
          activeMedia: true,
          anchoredMediaCount: 1,
          pageUiHidden: false,
          temporaryDisabled: false,
          updatedAt
        }
      )
    }
    tabs.handler = (raw, _tabId, frameId) => {
      const request = parseTabRequest(raw)
      if (!request) throw new Error('invalid tab request')
      return Promise.resolve(createTabSuccess(request, frameId === 7 ? hiddenState : visibleState))
    }

    const response = parseRuntimeResponse(
      await runtime.handle(createRuntimeRequest('popup', 'media.get-state', {}), popupSender)
    )

    expect(response).toMatchObject({
      type: 'protocol.response',
      payload: { data: { frameId: 9, activeMediaId: 'media-9-1' } }
    })
    expect(tabs.sent.map(({ frameId }) => frameId)).toEqual([7, 9])
  })

  it('keeps a connected Tencent viewport proxy authoritative over a top-frame mirror', async () => {
    const { runtime, tabs, frameRegistry } = createRuntime()
    const proxyState = mediaPageStateSchema.parse({
      frameId: 14,
      revision: 4,
      activeMediaId: 'media-14-tencent-viewport',
      observedAt: 400,
      media: [
        {
          id: 'media-14-tencent-viewport',
          frameId: 14,
          kind: 'video',
          state: 'active',
          metrics: {
            width: 946,
            height: 532,
            duration: null,
            currentTime: 0,
            volume: 1,
            playbackRate: 1.5,
            muted: false,
            visible: true
          },
          capabilities: {
            playback: false,
            seek: false,
            playbackRate: true,
            volume: false,
            mute: false,
            visual: false,
            fullscreen: false,
            pictureInPicture: false,
            capture: false,
            downloadExperimental: false
          },
          adapterId: 'tencent-video',
          updatedAt: 400
        }
      ]
    })
    const topState = mediaPageStateSchema.parse({
      frameId: 0,
      revision: 8,
      activeMediaId: 'media-0-1',
      observedAt: 401,
      media: [
        {
          id: 'media-0-1',
          frameId: 0,
          kind: 'video',
          state: 'active',
          sourceKey: 'source-top-player',
          metrics: {
            width: 946,
            height: 532,
            duration: 360,
            currentTime: 49,
            volume: 1,
            playbackRate: 1.5,
            muted: false,
            visible: true
          },
          capabilities: {
            playback: true,
            seek: true,
            playbackRate: true,
            volume: true,
            mute: true,
            visual: true,
            fullscreen: true,
            pictureInPicture: true,
            capture: true,
            downloadExperimental: false
          },
          adapterId: 'generic',
          updatedAt: 401
        }
      ]
    })
    frameRegistry.report(
      { tabId: 1, frameId: 14, sessionId: 'child-session-0000014' },
      {
        ready: true,
        mediaCount: 1,
        activeMedia: true,
        anchoredMediaCount: 1,
        pageUiHidden: false,
        temporaryDisabled: false,
        updatedAt: 400
      }
    )
    // The top report is deliberately stale/empty: this is the transition
    // window in which the browser frame lease has not caught up yet.
    frameRegistry.report(
      { tabId: 1, frameId: 0, sessionId: 'top-session-0000001' },
      {
        ready: true,
        mediaCount: 0,
        activeMedia: false,
        anchoredMediaCount: 0,
        pageUiHidden: false,
        temporaryDisabled: false,
        updatedAt: 1
      }
    )
    tabs.handler = (raw, _tabId, frameId) => {
      const request = parseTabRequest(raw)
      if (!request || request.type !== 'media.get-state') {
        throw new Error('unexpected routed request')
      }
      return Promise.resolve(createTabSuccess(request, frameId === 14 ? proxyState : topState))
    }

    const response = parseRuntimeResponse(
      await runtime.handle(createRuntimeRequest('popup', 'media.get-state', {}), popupSender)
    )

    expect(response).toMatchObject({
      type: 'protocol.response',
      payload: {
        data: {
          frameId: 14,
          activeMediaId: 'media-14-tencent-viewport',
          media: [{ id: 'media-14-tencent-viewport' }]
        }
      }
    })
    expect(tabs.sent.map(({ frameId }) => frameId)).toEqual([14, 0])
  })

  it('queries an active Tencent child after a paused top-frame player reports media', async () => {
    const { runtime, tabs, frameRegistry } = createRuntime()
    const topState = mediaPageStateSchema.parse({
      frameId: 0,
      revision: 8,
      activeMediaId: 'media-0-1',
      observedAt: 401,
      media: [
        {
          id: 'media-0-1',
          frameId: 0,
          kind: 'video',
          state: 'paused',
          sourceKey: 'source-old-top-player',
          metrics: {
            width: 946,
            height: 532,
            duration: 360,
            currentTime: 49,
            volume: 1,
            playbackRate: 1,
            muted: false,
            visible: true
          },
          capabilities: {
            playback: true,
            seek: true,
            playbackRate: true,
            volume: true,
            mute: true,
            visual: true,
            fullscreen: true,
            pictureInPicture: true,
            capture: true,
            downloadExperimental: false
          },
          adapterId: 'tencent-video',
          updatedAt: 401
        }
      ]
    })
    const childState = mediaPageStateSchema.parse({
      frameId: 17,
      revision: 4,
      activeMediaId: 'media-17-tencent-viewport',
      observedAt: 402,
      media: [
        {
          id: 'media-17-tencent-viewport',
          frameId: 17,
          kind: 'video',
          state: 'active',
          metrics: {
            width: 946,
            height: 532,
            duration: null,
            currentTime: 0,
            volume: 1,
            playbackRate: 1,
            muted: false,
            visible: true
          },
          capabilities: {
            playback: false,
            seek: false,
            playbackRate: true,
            volume: false,
            mute: false,
            visual: false,
            fullscreen: false,
            pictureInPicture: false,
            capture: false,
            downloadExperimental: false
          },
          adapterId: 'tencent-video',
          updatedAt: 402
        }
      ]
    })
    for (const frameId of [0, 17] as const) {
      frameRegistry.report(
        {
          tabId: 1,
          frameId,
          sessionId: frameId === 0 ? 'top-session-0000001' : 'child-session-0000017'
        },
        {
          ready: true,
          mediaCount: 1,
          activeMedia: true,
          anchoredMediaCount: 1,
          pageUiHidden: false,
          temporaryDisabled: false,
          updatedAt: frameId === 0 ? 401 : 402
        }
      )
    }
    tabs.handler = (raw, _tabId, frameId) => {
      const request = parseTabRequest(raw)
      if (!request || request.type !== 'media.get-state') {
        throw new Error('unexpected routed request')
      }
      return Promise.resolve(createTabSuccess(request, frameId === 0 ? topState : childState))
    }

    const response = parseRuntimeResponse(
      await runtime.handle(createRuntimeRequest('popup', 'media.get-state', {}), popupSender)
    )

    expect(response).toMatchObject({
      type: 'protocol.response',
      payload: {
        data: {
          frameId: 17,
          activeMediaId: 'media-17-tencent-viewport'
        }
      }
    })
    expect(tabs.sent.map(({ frameId }) => frameId)).toEqual([0, 17])
  })

  it('binds content frame routing to its authenticated tab and retries media-not-found frames', async () => {
    const { runtime, tabs, frameRegistry } = createRuntime()
    const targetTabId = 42
    const targetFrameId = 9
    const media = mediaPageStateSchema.parse({
      frameId: targetFrameId,
      revision: 1,
      activeMediaId: 'media-9-1',
      observedAt: 1,
      media: [
        {
          id: 'media-9-1',
          frameId: targetFrameId,
          kind: 'video',
          state: 'paused',
          metrics: {
            width: 640,
            height: 360,
            duration: 100,
            currentTime: 10,
            volume: 1,
            playbackRate: 1,
            muted: false,
            visible: true
          },
          capabilities: {
            playback: true,
            seek: true,
            playbackRate: true,
            volume: true,
            mute: true,
            fullscreen: false,
            pictureInPicture: false,
            capture: false,
            downloadExperimental: false
          },
          adapterId: 'generic',
          updatedAt: 1
        }
      ]
    })
    const active = media.media[0]
    if (!active) throw new Error('routed media fixture missing')
    for (const frameId of [7, targetFrameId]) {
      frameRegistry.report(
        { tabId: targetTabId, frameId, sessionId: `child-session-000${frameId}` },
        {
          ready: true,
          mediaCount: 1,
          activeMedia: true,
          anchoredMediaCount: 1,
          pageUiHidden: false,
          temporaryDisabled: false,
          updatedAt: frameId === 7 ? 20 : 10
        }
      )
    }
    tabs.handler = (raw, tabId, frameId) => {
      const request = parseTabRequest(raw)
      if (!request) throw new Error('invalid tab request')
      if (tabId !== targetTabId) throw new Error(`unexpected tab ${tabId}`)
      if (frameId === 7) {
        return Promise.resolve(
          createTabSuccess(
            request,
            mediaCommandResultResponseSchema.parse({
              result: {
                ok: false,
                error: {
                  code: 'MEDIA_NOT_FOUND',
                  messageKey: 'command.error.mediaNotFound',
                  context: { mediaId: active.id }
                }
              },
              state: { ...media, frameId: 7, activeMediaId: null, media: [] }
            })
          )
        )
      }
      if (frameId !== targetFrameId) throw new Error(`unexpected frame ${String(frameId)}`)
      return Promise.resolve(
        createTabSuccess(
          request,
          mediaCommandResultResponseSchema.parse({
            result: {
              ok: true,
              value: {
                commandType: 'media.play',
                mediaId: active.id,
                changed: true,
                snapshot: { ...active, state: 'active' }
              }
            },
            state: media
          })
        )
      )
    }

    const response = parseRuntimeResponse(
      await runtime.handle(
        createRuntimeRequest(
          'content',
          'media.execute',
          { command: { type: 'media.play', mediaId: active.id } },
          { sessionId: 'top-content-session-0042' }
        ),
        {
          id: 'extension-id',
          tabId: targetTabId,
          frameId: 0,
          url: 'https://v.qq.com/x/cover/example/video.html'
        }
      )
    )

    expect(response?.type).toBe('protocol.response')
    expect(tabs.sent.map(({ tabId, frameId }) => ({ tabId, frameId }))).toEqual([
      { tabId: targetTabId, frameId: 7 },
      { tabId: targetTabId, frameId: targetFrameId }
    ])
  })

  it('retargets a stale popup command to the active replacement media in the same frame', async () => {
    const { runtime, tabs, frameRegistry } = createRuntime()
    const tabId = 42
    const frameId = 9
    const staleMediaId = 'media-7-tencent-viewport'
    const activeMediaId = 'media-9-tencent-viewport'
    tabs.activeTab = { id: tabId, url: 'https://v.qq.com/x/cover/example/video.html' }
    const state = mediaPageStateSchema.parse({
      frameId,
      revision: 2,
      activeMediaId,
      observedAt: 2,
      media: [
        {
          id: activeMediaId,
          frameId,
          kind: 'video',
          state: 'active',
          metrics: {
            width: 946,
            height: 532,
            duration: null,
            currentTime: 0,
            volume: 1,
            playbackRate: 1.5,
            muted: false,
            visible: true
          },
          capabilities: {
            playback: false,
            seek: false,
            playbackRate: true,
            volume: false,
            mute: false,
            fullscreen: false,
            pictureInPicture: false,
            capture: false,
            downloadExperimental: false
          },
          adapterId: 'tencent-video',
          updatedAt: 2
        }
      ]
    })
    frameRegistry.report(
      { tabId, frameId, sessionId: 'child-session-0000009' },
      {
        ready: true,
        mediaCount: 1,
        activeMedia: true,
        anchoredMediaCount: 1,
        pageUiHidden: false,
        temporaryDisabled: false,
        updatedAt: 2
      }
    )
    tabs.handler = (raw, _tabId, targetFrameId) => {
      const request = parseTabRequest(raw)
      if (!request || targetFrameId !== frameId) throw new Error('invalid routed request')
      if (request.type === 'media.get-state') {
        return Promise.resolve(createTabSuccess(request, state))
      }
      const command = (request.payload as { command: { mediaId: string; type: string } }).command
      if (command.mediaId === staleMediaId) {
        return Promise.resolve(
          createTabSuccess(request, {
            result: {
              ok: false,
              error: {
                code: 'MEDIA_NOT_FOUND',
                messageKey: 'command.error.mediaNotFound',
                context: { mediaId: staleMediaId }
              }
            },
            state
          })
        )
      }
      return Promise.resolve(
        createTabSuccess(request, {
          result: {
            ok: true,
            value: {
              commandType: 'media.set-rate',
              mediaId: activeMediaId,
              changed: true,
              snapshot: {
                ...state.media[0],
                metrics: { ...state.media[0]?.metrics, playbackRate: 2 }
              }
            }
          },
          state
        })
      )
    }

    const response = parseRuntimeResponse(
      await runtime.handle(
        createRuntimeRequest('popup', 'media.execute', {
          command: { type: 'media.set-rate', mediaId: staleMediaId, value: 2 },
          playbackRateScope: 'site'
        }),
        popupSender
      )
    )

    expect(response).toMatchObject({
      type: 'protocol.response',
      payload: { data: { result: { ok: true, value: { mediaId: activeMediaId } } } }
    })
    expect(
      tabs.sent.map(({ message, frameId: sentFrameId }) => ({
        type: parseTabRequest(message)?.type,
        frameId: sentFrameId
      }))
    ).toEqual([
      { type: 'media.execute', frameId },
      { type: 'media.execute', frameId: 0 },
      { type: 'media.get-state', frameId },
      { type: 'media.get-state', frameId: 0 },
      { type: 'media.execute', frameId }
    ])
  })

  it('defers stale Tencent command retargeting until every frame rejects the original id', async () => {
    const { runtime, tabs, frameRegistry } = createRuntime()
    const tabId = 42
    const staleMediaId = 'media-14-tencent-viewport'
    const childMediaId = 'media-17-tencent-viewport'
    const topMediaId = 'media-0-1'
    tabs.activeTab = { id: tabId, url: 'https://v.qq.com/x/cover/example/video.html' }
    const childState = mediaPageStateSchema.parse({
      frameId: 17,
      revision: 2,
      activeMediaId: childMediaId,
      observedAt: 20,
      media: [
        {
          id: childMediaId,
          frameId: 17,
          kind: 'video',
          state: 'active',
          metrics: {
            width: 946,
            height: 532,
            duration: 360,
            currentTime: 50,
            volume: 1,
            playbackRate: 1.5,
            muted: false,
            visible: true
          },
          capabilities: {
            playback: false,
            seek: false,
            playbackRate: true,
            volume: false,
            mute: false,
            visual: false,
            fullscreen: false,
            pictureInPicture: false,
            capture: false,
            downloadExperimental: false
          },
          adapterId: 'tencent-video',
          updatedAt: 20
        }
      ]
    })
    const topState = mediaPageStateSchema.parse({
      frameId: 0,
      revision: 3,
      activeMediaId: topMediaId,
      observedAt: 21,
      media: [
        {
          id: topMediaId,
          frameId: 0,
          kind: 'video',
          state: 'active',
          sourceKey: 'source-top-mirror',
          metrics: {
            width: 946,
            height: 532,
            duration: 360,
            currentTime: 50,
            volume: 1,
            playbackRate: 1.5,
            muted: false,
            visible: true
          },
          capabilities: {
            playback: true,
            seek: true,
            playbackRate: true,
            volume: true,
            mute: true,
            visual: true,
            fullscreen: true,
            pictureInPicture: true,
            capture: true,
            downloadExperimental: false
          },
          adapterId: 'generic',
          updatedAt: 21
        }
      ]
    })
    for (const [frameId, updatedAt] of [
      [0, 30],
      [17, 20]
    ] as const) {
      frameRegistry.report(
        {
          tabId,
          frameId,
          sessionId: frameId === 0 ? 'top-session-0000001' : 'child-session-0000017'
        },
        {
          ready: true,
          mediaCount: 1,
          activeMedia: true,
          anchoredMediaCount: 1,
          pageUiHidden: false,
          temporaryDisabled: false,
          updatedAt
        }
      )
    }
    tabs.handler = (raw, _tabId, frameId) => {
      const request = parseTabRequest(raw)
      if (!request) throw new Error('invalid routed request')
      const state = frameId === 17 ? childState : topState
      if (request.type === 'media.get-state') {
        return Promise.resolve(createTabSuccess(request, state))
      }
      const command = (request.payload as { command: MediaCommand }).command
      if (frameId === 17 && command.mediaId === childMediaId) {
        const snapshot = {
          ...childState.media[0],
          metrics: { ...childState.media[0]?.metrics, playbackRate: 2 }
        }
        return Promise.resolve(
          createTabSuccess(request, {
            result: {
              ok: true,
              value: {
                commandType: 'media.set-rate',
                mediaId: childMediaId,
                changed: true,
                snapshot
              }
            },
            state: { ...childState, media: [snapshot] }
          })
        )
      }
      if (frameId === 0 && command.mediaId === topMediaId) {
        throw new Error('top-frame mirror must not receive the retargeted command')
      }
      return Promise.resolve(
        createTabSuccess(request, {
          result: {
            ok: false,
            error: {
              code: 'MEDIA_NOT_FOUND',
              messageKey: 'command.error.mediaNotFound',
              context: { mediaId: command.mediaId }
            }
          },
          state
        })
      )
    }

    const response = parseRuntimeResponse(
      await runtime.handle(
        createRuntimeRequest('popup', 'media.execute', {
          command: { type: 'media.set-rate', mediaId: staleMediaId, value: 2 },
          playbackRateScope: 'site'
        }),
        popupSender
      )
    )

    expect(response).toMatchObject({
      type: 'protocol.response',
      payload: { data: { result: { ok: true, value: { mediaId: childMediaId } } } }
    })
    expect(
      tabs.sent.map(({ message, frameId }) => {
        const request = parseTabRequest(message)
        return {
          type: request?.type,
          frameId,
          mediaId:
            request?.type === 'media.execute'
              ? (request.payload as { command: MediaCommand }).command.mediaId
              : null
        }
      })
    ).toEqual([
      { type: 'media.execute', frameId: 0, mediaId: staleMediaId },
      { type: 'media.execute', frameId: 17, mediaId: staleMediaId },
      { type: 'media.get-state', frameId: 0, mediaId: null },
      { type: 'media.get-state', frameId: 17, mediaId: null },
      { type: 'media.execute', frameId: 17, mediaId: childMediaId }
    ])
  })

  it('forwards rate scope and page UI visibility only for authorized popup requests', async () => {
    const { runtime, tabs } = createRuntime()
    const state = mediaPageStateSchema.parse({
      frameId: 0,
      revision: 1,
      activeMediaId: 'media-0-1',
      observedAt: 1,
      media: [
        {
          id: 'media-0-1',
          frameId: 0,
          kind: 'video',
          state: 'paused',
          metrics: {
            width: 640,
            height: 360,
            duration: 120,
            currentTime: 0,
            volume: 1,
            playbackRate: 1,
            muted: false,
            visible: true
          },
          capabilities: {
            playback: true,
            seek: true,
            playbackRate: true,
            volume: true,
            mute: true,
            fullscreen: false,
            pictureInPicture: false,
            capture: false,
            downloadExperimental: false
          },
          adapterId: 'generic',
          updatedAt: 1
        }
      ]
    })
    tabs.handler = (raw) => {
      const request = parseTabRequest(raw)
      if (!request) throw new Error('invalid tab request')
      if (request.type === 'media.get-state')
        return Promise.resolve(createTabSuccess(request, state))
      if (request.type === 'site.set-page-ui-hidden') {
        return Promise.resolve(createTabSuccess(request, { hidden: true, hiddenMediaCount: 1 }))
      }
      const active = state.media[0]
      if (!active) throw new Error('active fixture missing')
      return Promise.resolve(
        createTabSuccess(
          request,
          mediaCommandResultResponseSchema.parse({
            result: {
              ok: true,
              value: {
                commandType: 'media.adjust-rate',
                mediaId: active.id,
                changed: true,
                snapshot: {
                  ...active,
                  metrics: { ...active.metrics, playbackRate: 1.1 }
                }
              }
            },
            state
          })
        )
      )
    }
    const sender = { id: 'extension-id', url: 'chrome-extension://extension-id/popup.html' }

    const rate = parseRuntimeResponse(
      await runtime.handle(
        createRuntimeRequest('popup', 'media.execute', {
          command: { type: 'media.adjust-rate', mediaId: 'media-0-1', delta: 0.1 },
          playbackRateScope: 'media'
        }),
        sender
      )
    )
    const hidden = parseRuntimeResponse(
      await runtime.handle(
        createRuntimeRequest('popup', 'site.set-page-ui-hidden', { hidden: true }),
        sender
      )
    )
    expect(rate?.type).toBe('protocol.response')
    expect(hidden?.type).toBe('protocol.response')
    expect(tabs.sent[0]?.message).toMatchObject({
      payload: {
        command: { type: 'media.adjust-rate', mediaId: 'media-0-1', delta: 0.1 },
        playbackRateScope: 'media'
      }
    })
    expect(tabs.sent[1]?.message).toMatchObject({ payload: { hidden: true } })

    const optionsResponse = parseRuntimeResponse(
      await runtime.handle(
        createRuntimeRequest('options', 'site.set-page-ui-hidden', { hidden: true }),
        { id: 'extension-id', url: 'chrome-extension://extension-id/options.html' }
      )
    )
    expect(optionsResponse?.type).toBe('protocol.error')
    if (optionsResponse?.type === 'protocol.error') {
      expect(optionsResponse.payload.error.code).toBe('UNAUTHORIZED_SOURCE')
    }
  })

  it('reports an unavailable active page without trusting a popup tab claim', async () => {
    const { runtime, tabs } = createRuntime()
    tabs.activeTab = null
    const sender = { id: 'extension-id', url: 'chrome-extension://extension-id/popup.html' }
    const unavailable = parseRuntimeResponse(
      await runtime.handle(createRuntimeRequest('popup', 'media.get-state', {}), sender)
    )
    const claimed = parseRuntimeResponse(
      await runtime.handle(
        createRuntimeRequest('popup', 'media.get-state', {}, { tabId: 99 }),
        sender
      )
    )

    expect(unavailable?.type).toBe('protocol.error')
    if (unavailable?.type === 'protocol.error') {
      expect(unavailable.payload.error.code).toBe('TARGET_UNAVAILABLE')
    }
    expect(claimed?.type).toBe('protocol.error')
    if (claimed?.type === 'protocol.error') {
      expect(claimed.payload.error.code).toBe('UNAUTHORIZED_SOURCE')
    }
  })
})
