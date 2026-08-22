import { describe, expect, it } from 'vitest'
import { SettingsService } from '../../src/application/settings/settings-service'
import { SiteAccessService } from '../../src/application/site'
import { FrameRuntimeRegistry } from '../../src/application/site'
import { SettingsRepository } from '../../src/infrastructure/storage/settings-repository'
import { createTabSuccess, parseTabRequest } from '../../src/shared/tab-protocol'
import {
  FakeClock,
  FakeContentScriptRegistrationPort,
  FakeLogger,
  FakePermissionsPort,
  FakeStoragePort,
  FakeTabsPort
} from '../test-support/fakes'

function createService() {
  const clock = new FakeClock()
  const repository = new SettingsRepository(new FakeStoragePort(), clock, new FakeLogger())
  const settings = new SettingsService(repository)
  const tabs = new FakeTabsPort()
  const permissions = new FakePermissionsPort()
  const registration = new FakeContentScriptRegistrationPort()
  const frames = new FrameRuntimeRegistry({ now: () => clock.now() })
  const service = new SiteAccessService(settings, tabs, permissions, registration, frames)
  return { repository, settings, tabs, permissions, registration, frames, service }
}

describe('SiteAccessService', () => {
  it('bounds recovery retries for tabs without child media reports', async () => {
    const { tabs, service } = createService()
    tabs.tabs = [
      { id: 1, url: 'https://example.com/' },
      { id: 2, url: 'https://example.org/' }
    ]

    await service.recoverFrameStates()

    expect(tabs.sent).toHaveLength(6)
    expect(tabs.sent.every((entry) => entry.frameId === undefined)).toBe(true)
    expect(
      tabs.sent.every(
        (entry) => parseTabRequest(entry.message)?.type === 'site.refresh-frame-state'
      )
    ).toBe(true)
  })

  it('retries worker recovery until a late child frame reports', async () => {
    const { tabs, frames, service } = createService()
    let attempts = 0
    tabs.handler = () => {
      attempts += 1
      frames.report(
        { tabId: 1, frameId: 0, sessionId: 'top-session-0000001' },
        {
          ready: true,
          mediaCount: 0,
          activeMedia: false,
          anchoredMediaCount: 0,
          pageUiHidden: false,
          temporaryDisabled: false,
          updatedAt: attempts
        }
      )
      if (attempts === 2) {
        globalThis.setTimeout(() => {
          frames.report(
            { tabId: 1, frameId: 2, sessionId: 'child-session-0000001' },
            {
              ready: true,
              mediaCount: 1,
              activeMedia: true,
              anchoredMediaCount: 1,
              pageUiHidden: false,
              temporaryDisabled: false,
              updatedAt: 20
            }
          )
        }, 0)
      }
      return Promise.resolve(null)
    }

    await service.recoverFrameStates()

    expect(attempts).toBe(2)
    expect(frames.summarize(1)).toMatchObject({
      childFrameMediaCount: 1,
      mediaLocation: 'child-frame'
    })
  })

  it('stops recovery after the first ready top-frame media report', async () => {
    const { tabs, frames, service } = createService()
    let attempts = 0
    tabs.handler = () => {
      attempts += 1
      frames.report(
        { tabId: 1, frameId: 0, sessionId: 'top-session-0000001' },
        {
          ready: true,
          mediaCount: 1,
          activeMedia: true,
          anchoredMediaCount: 1,
          pageUiHidden: false,
          temporaryDisabled: false,
          updatedAt: attempts
        }
      )
      return Promise.resolve(null)
    }

    await service.recoverFrameStates()

    expect(attempts).toBe(1)
    expect(frames.summarize(1)).toMatchObject({
      topFrameMediaCount: 1,
      mediaLocation: 'top-frame'
    })
  })

  it('reconciles only granted web origins, bootstraps allowed tabs, and tears down revoked tabs', async () => {
    const { tabs, permissions, registration, service } = createService()
    permissions.origins.add('https://example.com/*')
    permissions.origins.add('file:///*')

    await expect(service.reconcile(true)).resolves.toEqual({
      registeredOrigins: 1,
      bootstrapped: true
    })
    expect(registration.reconciled).toEqual([['https://example.com/*']])
    expect(registration.bootstrapped).toEqual([1])

    permissions.origins.clear()
    await expect(service.reconcile(false)).resolves.toEqual({
      registeredOrigins: 0,
      bootstrapped: false
    })
    expect(registration.tornDown).toEqual([1])

    tabs.activeTab = { id: 2, url: 'chrome://extensions' }
    await service.reconcile(true)
    expect(registration.bootstrapped).toEqual([1])
  })

  it('clears revoked non-active tab frame owners during reconciliation', async () => {
    const { tabs, permissions, registration, frames, service } = createService()
    tabs.tabs = [
      { id: 1, url: 'https://example.com/' },
      { id: 2, url: 'https://revoked.example/' }
    ]
    tabs.activeTab = tabs.tabs[0] ?? null
    permissions.origins.add('https://example.com/*')
    frames.report(
      { tabId: 2, frameId: 4, sessionId: 'revoked-child-session-0001' },
      {
        ready: true,
        mediaCount: 1,
        activeMedia: true,
        anchoredMediaCount: 1,
        pageUiHidden: false,
        temporaryDisabled: false,
        updatedAt: 10
      }
    )

    await service.reconcile(false)

    expect(registration.tornDown).toContain(2)
    expect(frames.frameIds(2)).toEqual([])
  })

  it('serializes permission-event and explicit reconciliation work', async () => {
    const { registration, service } = createService()
    let activeReconciliations = 0
    let maximumConcurrentReconciliations = 0
    registration.reconcile = async (origins) => {
      registration.reconciled.push([...origins])
      activeReconciliations += 1
      maximumConcurrentReconciliations = Math.max(
        maximumConcurrentReconciliations,
        activeReconciliations
      )
      await Promise.resolve()
      activeReconciliations -= 1
    }

    await Promise.all([service.reconcile(false), service.reconcile(false)])

    expect(maximumConcurrentReconciliations).toBe(1)
    expect(registration.reconciled).toHaveLength(2)
  })

  it('distinguishes no tab, restricted pages, missing permission, and initialization failure', async () => {
    const { tabs, permissions, service } = createService()

    tabs.activeTab = null
    await expect(service.getContext()).resolves.toMatchObject({
      permission: 'unknown',
      reason: 'no-active-tab'
    })

    tabs.activeTab = { id: 1, url: 'chrome://settings' }
    await expect(service.getContext()).resolves.toMatchObject({
      permission: 'restricted',
      reason: 'restricted-page'
    })

    tabs.activeTab = { id: 1, url: 'https://example.com/watch' }
    await expect(service.getContext()).resolves.toMatchObject({
      permission: 'missing',
      reason: 'permission-required'
    })

    permissions.origins.add('https://example.com/*')
    tabs.handler = () => Promise.reject(new Error('content missing'))
    await expect(service.getContext()).resolves.toMatchObject({
      permission: 'granted',
      runtime: 'unavailable',
      reason: 'initialization-failed'
    })
  })

  it('reports ready, no-media, temporary, site-disabled, and global-disabled states precisely', async () => {
    const { repository, tabs, permissions, service } = createService()
    permissions.origins.add('https://example.com/*')
    let runtimeState = {
      ready: true,
      temporaryDisabled: false,
      mediaCount: 1,
      activeMedia: true
    }
    tabs.handler = (raw) => {
      const request = parseTabRequest(raw)
      if (!request) return Promise.reject(new Error('invalid request'))
      return Promise.resolve(createTabSuccess(request, runtimeState))
    }

    await expect(service.getContext()).resolves.toMatchObject({
      runtime: 'ready',
      reason: 'none',
      mediaCount: 1
    })
    runtimeState = { ...runtimeState, mediaCount: 0, activeMedia: false }
    await expect(service.getContext()).resolves.toMatchObject({ reason: 'no-media' })
    runtimeState = { ...runtimeState, temporaryDisabled: true }
    await expect(service.getContext()).resolves.toMatchObject({
      runtime: 'disabled',
      reason: 'temporarily-disabled'
    })

    await repository.update(
      { sites: { 'https://example.com': { enabled: false } } },
      undefined,
      'test'
    )
    await expect(service.getContext()).resolves.toMatchObject({ reason: 'site-disabled' })

    await repository.update({ global: { enabled: false } }, undefined, 'test')
    await expect(service.getContext()).resolves.toMatchObject({ reason: 'extension-disabled' })
  })

  it('reports iframe-only media as a distinct Popup degradation state', async () => {
    const { tabs, permissions, frames, service } = createService()
    permissions.origins.add('https://example.com/*')
    tabs.handler = (raw) => {
      const request = parseTabRequest(raw)
      if (!request) return Promise.reject(new Error('invalid request'))
      return Promise.resolve(
        createTabSuccess(request, {
          ready: true,
          temporaryDisabled: false,
          mediaCount: 0,
          activeMedia: false
        })
      )
    }
    frames.report(
      { tabId: 1, frameId: 2, sessionId: 'child-session-0001' },
      {
        ready: true,
        mediaCount: 1,
        activeMedia: true,
        anchoredMediaCount: 1,
        pageUiHidden: false,
        temporaryDisabled: false,
        updatedAt: 10
      }
    )

    await expect(service.getContext()).resolves.toMatchObject({
      runtime: 'ready',
      reason: 'iframe-media',
      mediaCount: 1,
      topFrameMediaCount: 0,
      childFrameMediaCount: 1,
      childFrameCount: 1,
      anchoredMediaCount: 1,
      mediaLocation: 'child-frame',
      activeMedia: false
    })
  })

  it('uses a live child report when the top runtime is temporarily unavailable', async () => {
    const { tabs, permissions, frames, service } = createService()
    permissions.origins.add('https://example.com/*')
    tabs.handler = () => Promise.reject(new Error('top runtime unavailable'))
    frames.report(
      { tabId: 1, frameId: 2, sessionId: 'child-session-0001' },
      {
        ready: true,
        mediaCount: 1,
        activeMedia: true,
        anchoredMediaCount: 1,
        pageUiHidden: false,
        temporaryDisabled: false,
        updatedAt: 10
      }
    )

    await expect(service.getContext()).resolves.toMatchObject({
      runtime: 'ready',
      reason: 'iframe-media',
      mediaLocation: 'child-frame',
      activePlaybackPolicy: null
    })
  })

  it('forwards temporary disable through the typed tab protocol', async () => {
    const { tabs, service } = createService()
    tabs.handler = (raw) => {
      const request = parseTabRequest(raw)
      if (!request) return Promise.reject(new Error('invalid request'))
      return Promise.resolve(createTabSuccess(request, { disabled: true }))
    }
    await expect(service.setTemporaryDisabled(true)).resolves.toEqual({ disabled: true })
    expect(parseTabRequest(tabs.sent[0]?.message)?.type).toBe('site.set-temporary-disabled')
  })

  it('fans page-level visibility and temporary state to registered child frames', async () => {
    const { tabs, frames, service } = createService()
    frames.report(
      { tabId: 1, frameId: 2, sessionId: 'child-session-0001' },
      {
        ready: true,
        mediaCount: 1,
        activeMedia: true,
        anchoredMediaCount: 1,
        pageUiHidden: false,
        temporaryDisabled: false,
        updatedAt: 10
      }
    )
    tabs.handler = (raw, _tabId, frameId) => {
      const request = parseTabRequest(raw)
      if (!request) return Promise.reject(new Error('invalid request'))
      if (frameId === 0) {
        expect(service.runtimeStateForTab(1)).toMatchObject(
          request.type === 'site.set-page-ui-hidden'
            ? { stateKnown: true, pageUiHidden: true }
            : { stateKnown: true, temporaryDisabled: true }
        )
        return Promise.resolve(
          createTabSuccess(
            request,
            request.type === 'site.set-page-ui-hidden'
              ? { hidden: true, hiddenMediaCount: 0 }
              : { disabled: true }
          )
        )
      }
      return Promise.resolve(createTabSuccess(request, { accepted: true }))
    }

    await service.setPageUiHidden(true)
    await service.setTemporaryDisabled(true)

    expect(tabs.sent.map((entry) => [entry.frameId, parseTabRequest(entry.message)?.type])).toEqual(
      [
        [0, 'site.set-page-ui-hidden'],
        [2, 'site.set-page-ui-hidden'],
        [0, 'site.set-temporary-disabled'],
        [2, 'site.set-temporary-disabled']
      ]
    )
  })

  it('does not broadcast page-level controls to empty or stale child frame records', async () => {
    const { tabs, frames, service } = createService()
    frames.report(
      { tabId: 1, frameId: 2, sessionId: 'empty-child-session-0001' },
      {
        ready: true,
        mediaCount: 0,
        activeMedia: false,
        anchoredMediaCount: 0,
        pageUiHidden: false,
        temporaryDisabled: false,
        updatedAt: 10
      }
    )
    frames.report(
      { tabId: 1, frameId: 4, sessionId: 'media-child-session-0001' },
      {
        ready: true,
        mediaCount: 1,
        activeMedia: true,
        anchoredMediaCount: 1,
        pageUiHidden: false,
        temporaryDisabled: false,
        updatedAt: 20
      }
    )
    tabs.handler = (raw, _tabId, frameId) => {
      const request = parseTabRequest(raw)
      return Promise.resolve(
        request
          ? createTabSuccess(
              request,
              frameId === 0 ? { hidden: true, hiddenMediaCount: 0 } : { accepted: true }
            )
          : null
      )
    }

    await service.setPageUiHidden(true)

    expect(tabs.sent.map((entry) => entry.frameId)).toEqual([0, 4])
  })

  it('broadcasts recovery controls to a temporarily unavailable media owner', async () => {
    const { tabs, frames, service } = createService()
    frames.report(
      { tabId: 1, frameId: 4, sessionId: 'child-session-0001' },
      {
        ready: false,
        mediaCount: 1,
        activeMedia: true,
        anchoredMediaCount: 1,
        pageUiHidden: true,
        temporaryDisabled: true,
        updatedAt: 10
      }
    )
    tabs.handler = (raw, _tabId, frameId) => {
      const request = parseTabRequest(raw)
      return Promise.resolve(
        request
          ? createTabSuccess(
              request,
              frameId === 0 ? { hidden: false, hiddenMediaCount: 0 } : { accepted: true }
            )
          : null
      )
    }

    await service.setPageUiHidden(false)

    expect(tabs.sent.map((entry) => entry.frameId)).toEqual([0, 4])
  })

  it('replays temporary-enable to the last controlled child when its dormant report is late', async () => {
    const { tabs, frames, service } = createService()
    frames.report(
      { tabId: 1, frameId: 4, sessionId: 'child-session-0001' },
      {
        ready: true,
        mediaCount: 1,
        activeMedia: true,
        anchoredMediaCount: 1,
        pageUiHidden: false,
        temporaryDisabled: false,
        updatedAt: 10
      }
    )
    tabs.handler = (raw, _tabId, frameId) => {
      const request = parseTabRequest(raw)
      const payload = request?.payload as { disabled?: unknown } | undefined
      return Promise.resolve(
        request
          ? createTabSuccess(
              request,
              frameId === 0 ? { disabled: payload?.disabled === true } : { accepted: true }
            )
          : null
      )
    }

    await service.setTemporaryDisabled(true)
    frames.removeFrame(1, 4)
    await service.setTemporaryDisabled(false)

    expect(tabs.sent.map((entry) => [entry.frameId, parseTabRequest(entry.message)?.type])).toEqual(
      [
        [0, 'site.set-temporary-disabled'],
        [4, 'site.set-temporary-disabled'],
        [0, 'site.set-temporary-disabled'],
        [4, 'site.set-temporary-disabled']
      ]
    )
  })

  it('serializes rapid temporary-disable changes with monotonically increasing revisions', async () => {
    const { tabs, service } = createService()
    let resolveFirst!: () => void
    let topFrameCalls = 0
    tabs.handler = (raw, _tabId, frameId) => {
      const request = parseTabRequest(raw)
      if (!request) return Promise.reject(new Error('invalid request'))
      const payload = request.payload as { disabled?: unknown }
      if (frameId !== 0) return Promise.resolve(createTabSuccess(request, { accepted: true }))
      topFrameCalls += 1
      if (topFrameCalls === 1) {
        return new Promise((resolve) => {
          resolveFirst = () => resolve(createTabSuccess(request, { disabled: true }))
        })
      }
      return Promise.resolve(createTabSuccess(request, { disabled: payload.disabled === true }))
    }

    const disable = service.setTemporaryDisabled(true)
    const enable = service.setTemporaryDisabled(false)
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0))
    expect(tabs.sent).toHaveLength(1)
    resolveFirst()
    await expect(Promise.all([disable, enable])).resolves.toEqual([
      { disabled: true },
      { disabled: false }
    ])

    const commands = tabs.sent.map((entry) => {
      const request = parseTabRequest(entry.message)
      return request?.payload as
        { disabled?: boolean; commandIssuedAt?: number; commandRevision?: number } | undefined
    })
    expect(commands).toHaveLength(2)
    expect(commands.map((payload) => payload?.disabled)).toEqual([true, false])
    expect(commands.map((payload) => payload?.commandRevision)).toEqual([1, 2])
    expect(commands[1]?.commandIssuedAt).toBeGreaterThanOrEqual(commands[0]?.commandIssuedAt ?? 0)
  })

  it('includes a child frame that registers while the top-frame state update is in flight', async () => {
    const { tabs, frames, service } = createService()
    tabs.handler = (raw, _tabId, frameId) => {
      const request = parseTabRequest(raw)
      if (!request) return Promise.reject(new Error('invalid request'))
      if (frameId === 0) {
        expect(service.runtimeStateForTab(1)).toEqual({
          stateKnown: true,
          pageUiHidden: false,
          temporaryDisabled: true
        })
        frames.report(
          { tabId: 1, frameId: 3, sessionId: 'late-child-session-0001' },
          {
            ready: true,
            mediaCount: 1,
            activeMedia: true,
            anchoredMediaCount: 1,
            pageUiHidden: false,
            temporaryDisabled: false,
            updatedAt: 20
          }
        )
        return Promise.resolve(createTabSuccess(request, { disabled: true }))
      }
      return Promise.resolve(createTabSuccess(request, { accepted: true }))
    }

    await service.setTemporaryDisabled(true)

    expect(tabs.sent.map((entry) => [entry.frameId, parseTabRequest(entry.message)?.type])).toEqual(
      [
        [0, 'site.set-temporary-disabled'],
        [3, 'site.set-temporary-disabled']
      ]
    )
    expect(service.runtimeStateForTab(1)).toEqual({
      stateKnown: true,
      pageUiHidden: false,
      temporaryDisabled: true
    })
  })

  it('rolls back optimistic page-level state when the top runtime is unavailable', async () => {
    const { tabs, service } = createService()
    tabs.handler = () => Promise.reject(new Error('top runtime unavailable'))

    await expect(service.setPageUiHidden(true)).rejects.toThrow('Site runtime unavailable')
    expect(service.runtimeStateForTab(1).stateKnown).toBe(false)

    service.recordTopFrameRuntimeState(1, 'top-session-0000001', {
      pageUiHidden: false,
      temporaryDisabled: false
    })
    await expect(service.setTemporaryDisabled(true)).rejects.toThrow('Site runtime unavailable')
    expect(service.runtimeStateForTab(1)).toEqual({
      stateKnown: true,
      pageUiHidden: false,
      temporaryDisabled: false
    })
  })

  it('returns the current tab state to late frame reports and refreshes frames after top-state changes', async () => {
    const { tabs, service } = createService()
    expect(service.runtimeStateForTab(1)).toEqual({
      stateKnown: false,
      pageUiHidden: false,
      temporaryDisabled: false
    })

    expect(
      service.recordTopFrameRuntimeState(1, 'top-session-0000001', {
        pageUiHidden: true,
        temporaryDisabled: true
      })
    ).toBe(true)
    expect(
      service.recordTopFrameRuntimeState(1, 'top-session-0000001', {
        pageUiHidden: true,
        temporaryDisabled: true
      })
    ).toBe(false)
    expect(service.runtimeStateForTab(1)).toEqual({
      stateKnown: true,
      pageUiHidden: true,
      temporaryDisabled: true
    })
    expect(
      service.recordTopFrameRuntimeState(1, 'top-session-0000001', {
        pageUiHidden: false,
        temporaryDisabled: true
      })
    ).toBe(false)

    await service.refreshFrameStates(1)
    expect(parseTabRequest(tabs.sent[0]?.message)?.type).toBe('site.refresh-frame-state')
    expect(tabs.sent[0]?.frameId).toBeUndefined()

    service.clearTabRuntimeState(1)
    expect(service.runtimeStateForTab(1).stateKnown).toBe(false)
  })

  it('resets page-local state for a new top-frame session but preserves it on reconnect', () => {
    const { service } = createService()

    expect(
      service.recordTopFrameRuntimeState(1, 'top-session-old-0001', {
        pageUiHidden: true,
        temporaryDisabled: true
      })
    ).toBe(true)
    expect(
      service.recordTopFrameRuntimeState(1, 'top-session-old-0001', {
        pageUiHidden: false,
        temporaryDisabled: false
      })
    ).toBe(false)
    expect(service.runtimeStateForTab(1)).toEqual({
      stateKnown: true,
      pageUiHidden: true,
      temporaryDisabled: true
    })

    expect(
      service.recordTopFrameRuntimeState(1, 'top-session-new-0001', {
        pageUiHidden: false,
        temporaryDisabled: false
      })
    ).toBe(false)
    expect(service.runtimeStateForTab(1)).toEqual({
      stateKnown: true,
      pageUiHidden: false,
      temporaryDisabled: false
    })
  })
})
