import type { HotkeyCommandId } from '../../domain/hotkey'
import {
  DEFAULT_HOTKEY_BINDINGS,
  findHotkeyConflict,
  hotkeyCommandIdSchema,
  resolveHotkeyBindings,
  validateHotkeyChord
} from '../../domain/hotkey'
import {
  settingsImportFileSchema,
  type SettingsPatch,
  type SiteOverride
} from '../../domain/settings'
import type { DiagnosticResponse } from '../diagnostics/contracts'
import type { ActiveTabPort, SettingsChangeSourcePort, Teardown } from '../ports/browser'
import type { RuntimeApiPort } from '../runtime/runtime-api-port'
import type {
  SettingsMutationResponse,
  SettingsSnapshotResponse,
  SystemPingResponse
} from '../settings/contracts'

export type OptionsSnapshot = Readonly<{
  ping: SystemPingResponse
  settings: SettingsSnapshotResponse
  grantedOrigins: readonly string[]
}>

export type ImportPreview = Readonly<{
  formatVersion: 1 | 2 | 3
  exportedAt: string
  siteRuleCount: number
  progressCount: number
  hotkeyOverrideCount: number
  locale: 'zh-CN' | 'en-US'
}>

export type HotkeyEditResult =
  | { readonly ok: true; readonly snapshot: OptionsSnapshot }
  | {
      readonly ok: false
      readonly code: 'INVALID_CHORD' | 'INVALID_COMMAND' | 'CONFLICT'
      readonly conflictCommandId?: HotkeyCommandId
    }

type ExperimentalSitePolicyPatch = Pick<
  NonNullable<SiteOverride['policies']>,
  'allowAcousticGain' | 'allowMouseLongPress' | 'mouseLongPressMs' | 'allowAutoplay'
>

type ExperimentalSitePolicyKey = keyof ExperimentalSitePolicyPatch

export class OptionsApplication {
  private snapshot: OptionsSnapshot | null = null

  constructor(
    private readonly api: RuntimeApiPort,
    private readonly access: ActiveTabPort,
    private readonly changes: SettingsChangeSourcePort
  ) {}

  current(): OptionsSnapshot | null {
    return this.snapshot
  }

  async load(options: { signal?: AbortSignal } = {}): Promise<OptionsSnapshot> {
    const [ping, settings, grantedOrigins] = await Promise.all([
      this.api.ping(options),
      this.api.getSettings(options),
      this.access.getGrantedOrigins()
    ])
    this.snapshot = { ping, settings, grantedOrigins }
    return this.snapshot
  }

  subscribe(listener: () => void): Teardown {
    return this.changes.subscribe(listener)
  }

  async update(
    patch: SettingsPatch,
    options: { signal?: AbortSignal } = {}
  ): Promise<OptionsSnapshot> {
    const current = this.requireSnapshot()
    const mutation = await this.api.updateSettings(
      patch,
      current.settings.settings.revision,
      options
    )
    return this.applyMutation(mutation)
  }

  setSiteEnabled(
    origin: string,
    enabled: boolean,
    options: { signal?: AbortSignal } = {}
  ): Promise<OptionsSnapshot> {
    const current = this.requireSnapshot()
    const existing = current.settings.settings.data.sites[origin]
    const override: SiteOverride = { ...existing, enabled }
    return this.update({ sites: { [origin]: override } }, options)
  }

  setSitePlaybackRate(
    origin: string,
    value: number,
    options: { signal?: AbortSignal } = {}
  ): Promise<OptionsSnapshot> {
    const current = this.requireSnapshot()
    const existing = current.settings.settings.data.sites[origin]
    const override: SiteOverride = {
      ...existing,
      enabled: existing?.enabled ?? true,
      media: {
        ...existing?.media,
        defaultPlaybackRate: value
      }
    }
    return this.update({ sites: { [origin]: override } }, options)
  }

  setSitePlaybackProtection(
    origin: string,
    protectPlaybackRate: boolean,
    options: { signal?: AbortSignal } = {}
  ): Promise<OptionsSnapshot> {
    const current = this.requireSnapshot()
    const existing = current.settings.settings.data.sites[origin]
    const override: SiteOverride = {
      ...existing,
      enabled: existing?.enabled ?? true,
      policies: {
        ...existing?.policies,
        protectPlaybackRate
      }
    }
    return this.update({ sites: { [origin]: override } }, options)
  }

  setSiteDownloadEnabled(
    origin: string,
    enabled: boolean,
    options: { signal?: AbortSignal } = {}
  ): Promise<OptionsSnapshot> {
    const current = this.requireSnapshot()
    const existing = current.settings.settings.data.sites[origin]
    const override: SiteOverride = {
      ...existing,
      enabled: existing?.enabled ?? true,
      download: { ...existing?.download, enabled }
    }
    return this.update({ sites: { [origin]: override } }, options)
  }

  setSiteExperimentalPolicy(
    origin: string,
    patch: ExperimentalSitePolicyPatch,
    options: { signal?: AbortSignal } = {}
  ): Promise<OptionsSnapshot> {
    const current = this.requireSnapshot()
    const existing = current.settings.settings.data.sites[origin]
    const override: SiteOverride = {
      ...existing,
      enabled: existing?.enabled ?? true,
      policies: { ...existing?.policies, ...patch }
    }
    return this.update({ sites: { [origin]: override } }, options)
  }

  restoreSiteExperimentalPolicy(
    origin: string,
    key: ExperimentalSitePolicyKey,
    options: { signal?: AbortSignal } = {}
  ): Promise<OptionsSnapshot> {
    const current = this.requireSnapshot()
    const existing = current.settings.settings.data.sites[origin]
    if (!existing?.policies) return Promise.resolve(current)
    const policies = { ...existing.policies }
    delete policies[key]
    const override: SiteOverride = { ...existing }
    if (Object.keys(policies).length === 0) delete override.policies
    else override.policies = policies
    return this.update({ sites: { [origin]: override } }, options)
  }

  restoreSiteDownload(
    origin: string,
    options: { signal?: AbortSignal } = {}
  ): Promise<OptionsSnapshot> {
    const current = this.requireSnapshot()
    const existing = current.settings.settings.data.sites[origin]
    if (!existing) return Promise.resolve(current)
    const override: SiteOverride = { ...existing }
    delete override.download
    return this.update({ sites: { [origin]: override } }, options)
  }

  restoreSitePlaybackRate(
    origin: string,
    options: { signal?: AbortSignal } = {}
  ): Promise<OptionsSnapshot> {
    const current = this.requireSnapshot()
    const existing = current.settings.settings.data.sites[origin]
    if (!existing) return Promise.resolve(current)
    const media = { ...existing.media }
    delete media.defaultPlaybackRate
    const override: SiteOverride = {
      ...existing,
      ...(Object.keys(media).length === 0 ? {} : { media })
    }
    if (Object.keys(media).length === 0) delete override.media
    return this.update({ sites: { [origin]: override } }, options)
  }

  restoreSitePlaybackProtection(
    origin: string,
    options: { signal?: AbortSignal } = {}
  ): Promise<OptionsSnapshot> {
    const current = this.requireSnapshot()
    const existing = current.settings.settings.data.sites[origin]
    if (!existing) return Promise.resolve(current)
    const policies = { ...existing.policies }
    delete policies.protectPlaybackRate
    const override: SiteOverride = {
      ...existing,
      ...(Object.keys(policies).length === 0 ? {} : { policies })
    }
    if (Object.keys(policies).length === 0) delete override.policies
    return this.update({ sites: { [origin]: override } }, options)
  }

  removeSite(origin: string, options: { signal?: AbortSignal } = {}): Promise<OptionsSnapshot> {
    return this.update({ sites: { [origin]: null } }, options)
  }

  async assignHotkey(
    commandIdInput: string,
    chordInput: string,
    previousChord?: string,
    options: { signal?: AbortSignal } = {}
  ): Promise<HotkeyEditResult> {
    const command = hotkeyCommandIdSchema.safeParse(commandIdInput)
    if (!command.success) return { ok: false, code: 'INVALID_COMMAND' }
    const chord = validateHotkeyChord(chordInput)
    if (!chord.ok) return { ok: false, code: 'INVALID_CHORD' }

    const current = this.requireSnapshot()
    const overrides = current.settings.settings.data.global.hotkeys.bindings
    const conflict = findHotkeyConflict(resolveHotkeyBindings(overrides), chord.chord, command.data)
    if (conflict) {
      return { ok: false, code: 'CONFLICT', conflictCommandId: conflict.commandId }
    }

    const bindingPatch: NonNullable<
      NonNullable<NonNullable<SettingsPatch['global']>['hotkeys']>['bindings']
    > = {
      [chord.chord]: { commandId: command.data, disabled: false }
    }
    if (previousChord && previousChord !== chord.chord) {
      const previousDefault = DEFAULT_HOTKEY_BINDINGS[previousChord]
      bindingPatch[previousChord] = previousDefault
        ? { commandId: previousDefault, disabled: true }
        : null
    }

    return {
      ok: true,
      snapshot: await this.update({ global: { hotkeys: { bindings: bindingPatch } } }, options)
    }
  }

  async setHotkeyDisabled(
    chord: string,
    disabled: boolean,
    options: { signal?: AbortSignal } = {}
  ): Promise<HotkeyEditResult> {
    const validated = validateHotkeyChord(chord)
    if (!validated.ok) return { ok: false, code: 'INVALID_CHORD' }
    const current = this.requireSnapshot()
    const effective = resolveHotkeyBindings(
      current.settings.settings.data.global.hotkeys.bindings
    ).find((binding) => binding.chord === validated.chord)
    if (!effective) return { ok: false, code: 'INVALID_COMMAND' }
    const snapshot = await this.update(
      {
        global: {
          hotkeys: {
            bindings: {
              [validated.chord]: { commandId: effective.commandId, disabled }
            }
          }
        }
      },
      options
    )
    return { ok: true, snapshot }
  }

  restoreHotkeyDefaults(options: { signal?: AbortSignal } = {}): Promise<OptionsSnapshot> {
    const overrides = this.requireSnapshot().settings.settings.data.global.hotkeys.bindings
    const bindings = Object.fromEntries(Object.keys(overrides).map((chord) => [chord, null]))
    return this.update({ global: { hotkeys: { bindings } } }, options)
  }

  previewImport(content: string): ImportPreview | null {
    if (new TextEncoder().encode(content).byteLength > 262_144) return null
    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(content) as unknown
    } catch {
      return null
    }
    const parsed = settingsImportFileSchema.safeParse(parsedJson)
    if (!parsed.success) return null
    return {
      formatVersion: parsed.data.formatVersion,
      exportedAt: parsed.data.exportedAt,
      siteRuleCount: Object.keys(parsed.data.data.sites).length,
      progressCount: Object.keys(parsed.data.data.progress).length,
      hotkeyOverrideCount: Object.keys(parsed.data.data.global.hotkeys.bindings).length,
      locale: parsed.data.data.global.ui.locale
    }
  }

  exportSettings(options: { signal?: AbortSignal } = {}): Promise<string> {
    return this.api.exportSettings(options)
  }

  async importSettings(
    content: string,
    options: { signal?: AbortSignal } = {}
  ): Promise<OptionsSnapshot> {
    const current = this.requireSnapshot()
    const mutation = await this.api.importSettings(
      content,
      current.settings.settings.revision,
      options
    )
    this.applyMutation(mutation)
    return this.load(options)
  }

  async resetSettings(
    scope: 'all' | 'global' | 'sites' | 'progress',
    options: { signal?: AbortSignal } = {}
  ): Promise<OptionsSnapshot> {
    const mutation = await this.api.resetSettings(scope, options)
    this.applyMutation(mutation)
    return this.load(options)
  }

  async restoreBackup(
    backupId: string,
    options: { signal?: AbortSignal } = {}
  ): Promise<OptionsSnapshot> {
    const mutation = await this.api.restoreBackup(backupId, options)
    this.applyMutation(mutation)
    return this.load(options)
  }

  getDiagnostics(options: { signal?: AbortSignal } = {}): Promise<DiagnosticResponse> {
    return this.api.getDiagnostics(options)
  }

  async requestAllSites(options: { signal?: AbortSignal } = {}): Promise<OptionsSnapshot> {
    const granted = await this.access.requestOrigins(['<all_urls>'])
    if (!granted) throw new Error('PERMISSION_DENIED')
    await this.api.reconcileSiteAccess(false, options)
    return this.load(options)
  }

  async revokeAllSites(options: { signal?: AbortSignal } = {}): Promise<OptionsSnapshot> {
    const origins = await this.access.getGrantedOrigins()
    if (origins.length > 0) await this.access.removeOrigins(origins)
    await this.api.reconcileSiteAccess(false, options)
    return this.load(options)
  }

  private applyMutation(mutation: SettingsMutationResponse): OptionsSnapshot {
    const current = this.requireSnapshot()
    this.snapshot = {
      ...current,
      settings: {
        settings: mutation.settings,
        latestBackup: current.settings.latestBackup
      }
    }
    return this.snapshot
  }

  private requireSnapshot(): OptionsSnapshot {
    if (!this.snapshot) throw new Error('OPTIONS_NOT_LOADED')
    return this.snapshot
  }
}
