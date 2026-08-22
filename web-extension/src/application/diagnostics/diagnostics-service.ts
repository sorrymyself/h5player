import type { ClockPort, PermissionsPort, RuntimeInfoPort } from '../ports/browser'
import type { DiagnosticLoggerPort } from '../ports/logging'
import type { SettingsService } from '../settings/settings-service'
import type { SiteAccessService } from '../site/site-access-service'
import {
  diagnosticSummarySchema,
  type DiagnosticResponse,
  type DiagnosticSummary
} from './contracts'
import { CURRENT_EXTENSION_PHASE } from '../../shared/protocol'
import { SETTINGS_SCHEMA_VERSION } from '../../domain/settings'

const MAX_DIAGNOSTIC_BYTES = 1_048_576

export class DiagnosticsService {
  constructor(
    private readonly options: Readonly<{
      extensionVersion: string
      buildId: string
      clock: ClockPort
      runtimeInfo: RuntimeInfoPort
      permissions: PermissionsPort
      settings: SettingsService
      siteAccess: SiteAccessService
      logger: DiagnosticLoggerPort
    }>
  ) {}

  async get(): Promise<DiagnosticResponse> {
    const [environment, permissions, settings] = await Promise.all([
      this.options.runtimeInfo.getEnvironment(),
      this.options.permissions.getAll(),
      this.options.settings.getSnapshot()
    ])
    if (!settings.ok) throw new Error(settings.error.code)

    const site = await this.options.siteAccess.getContext().catch(() => null)
    const selectedAdapters = site?.adapters?.filter((adapter) => adapter.selected) ?? []
    const summary: DiagnosticSummary = diagnosticSummarySchema.parse({
      generatedAt: this.options.clock.now(),
      extensionVersion: this.options.extensionVersion,
      build: this.options.buildId,
      phase: CURRENT_EXTENSION_PHASE,
      protocolVersion: 1,
      settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
      browser: {
        name: environment.browserName,
        version: environment.browserVersion,
        platform: environment.platform
      },
      permissions: {
        required: [...permissions.permissions].sort(),
        origins: [...permissions.origins].sort()
      },
      site: {
        hostname: site?.tab?.hostname ?? null,
        frameCount: site?.runtime === 'ready' ? 1 : 0,
        mediaCount: site?.mediaCount ?? 0,
        activeMedia: site?.activeMedia ?? false
      },
      settings: {
        revision: settings.value.settings.revision,
        enabled: settings.value.settings.data.global.enabled,
        siteRuleCount: Object.keys(settings.value.settings.data.sites).length,
        progressCount: Object.keys(settings.value.settings.data.progress).length,
        latestBackupReason: settings.value.latestBackup?.reason ?? null
      },
      modules: [
        'background-runtime',
        'settings-repository',
        'content-script-registration',
        'generic-media-adapter',
        'hotkey-interpreter',
        'content-overlay',
        'progress-repository',
        'cross-tab-media-events'
      ],
      adapters:
        selectedAdapters.length > 0
          ? selectedAdapters.map((adapter) => adapter.id)
          : site?.mediaCount
            ? ['generic']
            : [],
      adapterHealth: site?.adapters ?? [],
      recentEvents: this.options.logger.snapshot(),
      notes: [
        'URLs are reduced to hostname only.',
        'Titles, media sources, page text, cookies and tokens are excluded.',
        'Diagnostics remain local until the user explicitly exports the file.'
      ]
    })

    let json = JSON.stringify(summary, null, 2)
    if (new TextEncoder().encode(json).byteLength > MAX_DIAGNOSTIC_BYTES) {
      const reduced = { ...summary, recentEvents: summary.recentEvents.slice(-50) }
      json = JSON.stringify(reduced, null, 2)
      return { summary: diagnosticSummarySchema.parse(reduced), json }
    }
    return { summary, json }
  }
}
