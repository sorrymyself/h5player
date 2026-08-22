import type { ActiveTabPort } from '../ports/browser'
import type { RuntimeApiPort } from '../runtime/runtime-api-port'
import type { SettingsSnapshotResponse, SystemPingResponse } from '../settings/contracts'
import type { SiteContextResponse } from '../site/contracts'
import type { MediaCommandResultResponse, MediaPageState } from '../media'
import type { MediaCommand } from '../../domain/command'
import type { PlaybackRateWriteScope } from '../playback'
import { normalizeSiteOrigin, toHostPermissionPattern } from '../../domain/settings'

export type PopupSnapshot = Readonly<{
  ping: SystemPingResponse
  settings: SettingsSnapshotResponse
  site: SiteContextResponse
  media: MediaPageState | null
  currentOrigin: string | null
  permissionPattern: string | null
}>

export class PopupApplication {
  private snapshot: PopupSnapshot | null = null

  constructor(
    private readonly api: RuntimeApiPort,
    private readonly activeTab: ActiveTabPort
  ) {}

  current(): PopupSnapshot | null {
    return this.snapshot
  }

  async load(options: { signal?: AbortSignal } = {}): Promise<PopupSnapshot> {
    const [ping, settings, site, tab] = await Promise.all([
      this.api.ping(options),
      this.api.getSettings(options),
      this.api.getSiteContext(options),
      this.activeTab.getCurrent()
    ])

    const candidateOrigin = site.tab?.origin ?? tab?.url ?? null
    const normalized = candidateOrigin ? normalizeSiteOrigin(candidateOrigin) : null
    const currentOrigin = normalized?.ok ? normalized.value : null
    const pattern = currentOrigin ? toHostPermissionPattern(currentOrigin) : null
    let media: MediaPageState | null = null
    if (site.permission === 'granted' && site.enabled && !site.temporaryDisabled) {
      try {
        media = await this.api.getMediaState(options)
      } catch {
        media = null
      }
    }

    this.snapshot = {
      ping,
      settings,
      site,
      media,
      currentOrigin,
      permissionPattern: pattern?.ok ? pattern.value : null
    }
    return this.snapshot
  }

  async requestCurrentSiteAccess(options: { signal?: AbortSignal } = {}): Promise<PopupSnapshot> {
    const pattern = this.requireSnapshot().permissionPattern
    if (!pattern) throw new Error('CURRENT_SITE_UNAVAILABLE')
    const granted = await this.activeTab.requestOrigins([pattern])
    if (!granted) throw new Error('PERMISSION_DENIED')
    await this.api.reconcileSiteAccess(true, options)
    return this.load(options)
  }

  async requestAllSitesAccess(options: { signal?: AbortSignal } = {}): Promise<PopupSnapshot> {
    const granted = await this.activeTab.requestOrigins(['<all_urls>'])
    if (!granted) throw new Error('PERMISSION_DENIED')
    await this.api.reconcileSiteAccess(true, options)
    return this.load(options)
  }

  async revokeCurrentSiteAccess(options: { signal?: AbortSignal } = {}): Promise<PopupSnapshot> {
    const pattern = this.requireSnapshot().permissionPattern
    if (!pattern) throw new Error('CURRENT_SITE_UNAVAILABLE')
    await this.activeTab.removeOrigins([pattern])
    await this.api.reconcileSiteAccess(false, options)
    return this.load(options)
  }

  async setGlobalEnabled(
    enabled: boolean,
    options: { signal?: AbortSignal } = {}
  ): Promise<PopupSnapshot> {
    const current = this.requireSnapshot()
    await this.api.updateSettings(
      { global: { enabled } },
      current.settings.settings.revision,
      options
    )
    return this.load(options)
  }

  async setSiteEnabled(
    enabled: boolean,
    options: { signal?: AbortSignal } = {}
  ): Promise<PopupSnapshot> {
    const current = this.requireSnapshot()
    if (!current.currentOrigin) throw new Error('CURRENT_SITE_UNAVAILABLE')
    const existing = current.settings.settings.data.sites[current.currentOrigin]
    await this.api.updateSettings(
      {
        sites: {
          [current.currentOrigin]: {
            ...existing,
            enabled
          }
        }
      },
      current.settings.settings.revision,
      options
    )
    return this.load(options)
  }

  async setTemporaryDisabled(
    disabled: boolean,
    options: { signal?: AbortSignal } = {}
  ): Promise<PopupSnapshot> {
    await this.api.setTemporarySiteDisabled(disabled, options)
    return this.load(options)
  }

  async setPageUiHidden(
    hidden: boolean,
    options: { signal?: AbortSignal } = {}
  ): Promise<PopupSnapshot> {
    await this.api.setPageUiHidden(hidden, options)
    return this.load(options)
  }

  async execute(
    command: MediaCommand,
    options: { signal?: AbortSignal; playbackRateScope?: PlaybackRateWriteScope } = {}
  ): Promise<MediaCommandResultResponse> {
    const response = await this.api.executeMediaCommand(command, options)
    const current = this.requireSnapshot()
    if (
      response.result.ok &&
      (command.type === 'media.set-rate' || command.type === 'media.adjust-rate')
    ) {
      try {
        const site = await this.api.getSiteContext(options)
        this.snapshot = { ...current, site, media: response.state }
      } catch {
        this.snapshot = { ...current, media: response.state }
      }
    } else {
      this.snapshot = { ...current, media: response.state }
    }
    return response
  }

  private requireSnapshot(): PopupSnapshot {
    if (!this.snapshot) throw new Error('POPUP_NOT_LOADED')
    return this.snapshot
  }
}
