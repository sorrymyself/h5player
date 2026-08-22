import axe from 'axe-core'
import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import type { MediaPageState } from '../../src/application/media'
import type { RuntimeApiPort } from '../../src/application/runtime/runtime-api-port'
import { PopupApplication } from '../../src/application/ui'
import PopupApp from '../../src/ui/popup/PopupApp.vue'
import { FakeActiveTabPort } from '../test-support/fakes'
import { createSettingsEnvelope } from '../test-support/settings-fixtures'

const mediaState: MediaPageState = {
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
}

function createApi(
  permission: 'granted' | 'missing' = 'granted',
  mediaLocation: 'top-frame' | 'child-frame' = 'top-frame'
): RuntimeApiPort {
  const settings = createSettingsEnvelope(3)
  let currentPermission = permission
  let pageUiHidden = false
  let activePlaybackPolicyScope: 'site' | 'page' | 'media' = 'site'
  const activeSnapshot = mediaState.media[0]
  if (!activeSnapshot) throw new Error('active media fixture missing')
  const executeMediaCommand: RuntimeApiPort['executeMediaCommand'] = (command, options = {}) => {
    if (command.type === 'media.set-rate' || command.type === 'media.adjust-rate') {
      activePlaybackPolicyScope = options.playbackRateScope ?? 'site'
    }
    const snapshot =
      command.type === 'media.adjust-rate'
        ? {
            ...activeSnapshot,
            metrics: {
              ...activeSnapshot.metrics,
              playbackRate: 1.1
            }
          }
        : { ...activeSnapshot, state: 'active' as const }
    return Promise.resolve({
      result: {
        ok: true,
        value: {
          commandType: command.type,
          mediaId: 'media-0-1',
          changed: true,
          snapshot
        }
      },
      state: { ...mediaState, revision: 2, media: [snapshot] }
    })
  }
  return {
    ping: vi.fn().mockResolvedValue({
      extensionVersion: '0.1.0',
      phase: 6,
      protocol: 1,
      settingsSchemaVersion: 3
    }),
    getMediaState: vi.fn().mockResolvedValue(mediaState),
    executeMediaCommand: vi.fn(executeMediaCommand),
    getSettings: vi.fn().mockResolvedValue({ settings, latestBackup: null }),
    updateSettings: vi.fn().mockResolvedValue({
      settings,
      changedPaths: ['global.enabled'],
      rebased: false
    }),
    exportSettings: vi.fn().mockResolvedValue('{}'),
    importSettings: vi.fn().mockResolvedValue({
      settings,
      changedPaths: ['global'],
      rebased: false
    }),
    restoreBackup: vi.fn().mockResolvedValue({
      settings,
      changedPaths: ['global'],
      rebased: false
    }),
    resetSettings: vi.fn().mockResolvedValue({
      settings,
      changedPaths: ['global'],
      rebased: false
    }),
    getSiteContext: vi.fn().mockImplementation(() =>
      Promise.resolve({
        tab: { id: 1, origin: 'https://example.com', hostname: 'example.com', protocol: 'https:' },
        permission: currentPermission,
        enabled: true,
        temporaryDisabled: false,
        mediaCount: currentPermission === 'granted' ? 1 : 0,
        activeMedia: currentPermission === 'granted',
        topFrameMediaCount: mediaLocation === 'top-frame' ? 1 : 0,
        childFrameMediaCount: mediaLocation === 'child-frame' ? 1 : 0,
        childFrameCount: mediaLocation === 'child-frame' ? 1 : 0,
        anchoredMediaCount: 1,
        mediaLocation,
        pageUiHidden,
        hiddenMediaCount: pageUiHidden ? 1 : 0,
        activePlaybackPolicy:
          currentPermission === 'granted'
            ? {
                mediaId: 'media-0-1',
                intendedRate: activePlaybackPolicyScope === 'site' ? 1.5 : 1.1,
                actualRate: activePlaybackPolicyScope === 'site' ? 1 : 1.1,
                scope: activePlaybackPolicyScope,
                source:
                  activePlaybackPolicyScope === 'site'
                    ? 'site-rule'
                    : activePlaybackPolicyScope === 'page'
                      ? 'page-session'
                      : 'media-session',
                protectAgainstSiteReset: true,
                applicationStatus: 'applied',
                lastAppliedAt: 1,
                lastObservedExternalRate: null,
                attemptCount: 0,
                generation: 0,
                degradationReason: null
              }
            : null,
        runtime: currentPermission === 'granted' ? 'ready' : 'unavailable',
        reason:
          currentPermission !== 'granted'
            ? 'permission-required'
            : mediaLocation === 'child-frame'
              ? 'iframe-media'
              : 'none'
      })
    ),
    setTemporarySiteDisabled: vi.fn().mockResolvedValue({ disabled: true }),
    setPageUiHidden: vi.fn().mockImplementation((hidden: boolean) => {
      pageUiHidden = hidden
      return Promise.resolve({ hidden, hiddenMediaCount: hidden ? 1 : 0 })
    }),
    reconcileSiteAccess: vi.fn().mockImplementation(() => {
      currentPermission = 'granted'
      return Promise.resolve({ registeredOrigins: 1, bootstrapped: true })
    }),
    getDiagnostics: vi.fn().mockRejectedValue(new Error('unused'))
  }
}

function renderPopup(api = createApi(), activeTab = new FakeActiveTabPort()) {
  const application = new PopupApplication(api, activeTab)
  return { api, activeTab, application, ...render(PopupApp, { props: { application } }) }
}

describe('PopupApp', () => {
  it('renders platform and active media state from the application facade', async () => {
    renderPopup()

    expect(screen.getByRole('heading', { name: 'H5Player 控制台' })).toBeTruthy()
    expect(await screen.findByText('媒体控制已就绪')).toBeTruthy()
    expect((await screen.findByTestId('active-media')).textContent).toContain('视频 · 已暂停')
    expect(screen.getByTestId('playback-policy').textContent).toContain('本站策略')
    expect(screen.getByText('配置修订 3')).toBeTruthy()
  })

  it('dispatches media commands through PopupApplication', async () => {
    const api = createApi()
    const executeMediaCommand = vi.spyOn(api, 'executeMediaCommand')
    renderPopup(api)

    await fireEvent.click(await screen.findByRole('button', { name: '播放' }))
    expect(executeMediaCommand).toHaveBeenCalledTimes(1)
    expect(executeMediaCommand.mock.calls[0]?.[0]).toEqual({
      type: 'media.play',
      mediaId: 'media-0-1'
    })
    expect(executeMediaCommand.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('dispatches the selected rate scope and refreshes the effective policy source', async () => {
    const api = createApi()
    const executeMediaCommand = vi.spyOn(api, 'executeMediaCommand')
    const getSiteContext = vi.spyOn(api, 'getSiteContext')
    renderPopup(api)

    await fireEvent.update(await screen.findByLabelText('倍速应用范围'), 'media')
    await fireEvent.click(screen.getByRole('button', { name: '加速' }))

    expect(executeMediaCommand.mock.calls[0]?.[0]).toEqual({
      type: 'media.adjust-rate',
      mediaId: 'media-0-1',
      delta: 0.1
    })
    expect(executeMediaCommand.mock.calls[0]?.[1]?.playbackRateScope).toBe('media')
    expect(executeMediaCommand.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
    expect(getSiteContext).toHaveBeenCalledTimes(2)
    await vi.waitFor(() =>
      expect(screen.getByTestId('playback-policy').textContent).toContain('当前媒体')
    )
  })

  it('hides and restores page controls through the typed page UI operation', async () => {
    const api = createApi()
    const setPageUiHidden = vi.spyOn(api, 'setPageUiHidden')
    renderPopup(api)

    await fireEvent.click(await screen.findByRole('button', { name: '临时隐藏本页控件' }))
    expect(setPageUiHidden.mock.calls[0]?.[0]).toBe(true)
    expect(setPageUiHidden.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
    await fireEvent.click(await screen.findByRole('button', { name: '恢复本页控件' }))
    expect(setPageUiHidden.mock.calls[1]?.[0]).toBe(false)
    expect(setPageUiHidden.mock.calls[1]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('loads and controls media routed from an embedded player frame', async () => {
    const api = createApi('granted', 'child-frame')
    const getMediaState = vi.spyOn(api, 'getMediaState')
    const executeMediaCommand = vi.spyOn(api, 'executeMediaCommand')
    renderPopup(api)

    expect((await screen.findByTestId('active-media')).textContent).toContain('视频 · 已暂停')
    expect(getMediaState).toHaveBeenCalledOnce()
    await fireEvent.click(screen.getByRole('button', { name: '播放' }))
    expect(executeMediaCommand.mock.calls[0]?.[0]).toEqual({
      type: 'media.play',
      mediaId: 'media-0-1'
    })
    expect(executeMediaCommand.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('requests current-origin permission only after the user activates the onboarding button', async () => {
    const api = createApi('missing')
    const activeTab = new FakeActiveTabPort()
    const request = vi.spyOn(activeTab, 'requestOrigins')
    const reconcile = vi.spyOn(api, 'reconcileSiteAccess')
    renderPopup(api, activeTab)

    await fireEvent.click(await screen.findByRole('button', { name: '允许当前站点' }))
    expect(request).toHaveBeenCalledWith(['https://example.com/*'])
    expect(reconcile).toHaveBeenCalledWith(true, expect.any(Object))
    expect(await screen.findByText('媒体控制已就绪')).toBeTruthy()
  })

  it('has no automated accessibility violations in the ready state', async () => {
    const { container } = renderPopup()
    await screen.findByText('媒体控制已就绪')
    const result = await axe.run(container)
    expect(result.violations).toEqual([])
  })
})
