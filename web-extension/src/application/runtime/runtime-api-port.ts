import type { SettingsPatch } from '../../domain/settings'
import type { MediaCommand } from '../../domain/command'
import type { MediaCommandResultResponse, MediaPageState } from '../media'
import type { PlaybackRateWriteScope } from '../playback'
import type {
  SettingsMutationResponse,
  SettingsSnapshotResponse,
  SystemPingResponse
} from '../settings/contracts'
import type { DiagnosticResponse } from '../diagnostics/contracts'
import type {
  SiteContextResponse,
  SitePageUiVisibilityResponse,
  SiteReconcileResponse,
  SiteTemporaryDisableResponse
} from '../site/contracts'

export interface RuntimeApiPort {
  ping(options?: { signal?: AbortSignal }): Promise<SystemPingResponse>
  getMediaState(options?: { signal?: AbortSignal }): Promise<MediaPageState>
  executeMediaCommand(
    command: MediaCommand,
    options?: { signal?: AbortSignal; playbackRateScope?: PlaybackRateWriteScope }
  ): Promise<MediaCommandResultResponse>
  getSettings(options?: { signal?: AbortSignal }): Promise<SettingsSnapshotResponse>
  updateSettings(
    patch: SettingsPatch,
    expectedRevision?: number,
    options?: { signal?: AbortSignal }
  ): Promise<SettingsMutationResponse>
  exportSettings(options?: { signal?: AbortSignal }): Promise<string>
  importSettings(
    content: string,
    expectedRevision?: number,
    options?: { signal?: AbortSignal }
  ): Promise<SettingsMutationResponse>
  restoreBackup(
    backupId: string,
    options?: { signal?: AbortSignal }
  ): Promise<SettingsMutationResponse>
  resetSettings(
    scope: 'all' | 'global' | 'sites' | 'progress',
    options?: { signal?: AbortSignal }
  ): Promise<SettingsMutationResponse>
  getSiteContext(options?: { signal?: AbortSignal }): Promise<SiteContextResponse>
  setTemporarySiteDisabled(
    disabled: boolean,
    options?: { signal?: AbortSignal }
  ): Promise<SiteTemporaryDisableResponse>
  setPageUiHidden(
    hidden: boolean,
    options?: { signal?: AbortSignal }
  ): Promise<SitePageUiVisibilityResponse>
  reconcileSiteAccess(
    bootstrapCurrentTab: boolean,
    options?: { signal?: AbortSignal }
  ): Promise<SiteReconcileResponse>
  getDiagnostics(options?: { signal?: AbortSignal }): Promise<DiagnosticResponse>
}
