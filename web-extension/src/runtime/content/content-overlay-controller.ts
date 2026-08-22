import type { MediaCommand, CommandError } from '../../domain/command'
import type { MediaSnapshot } from '../../domain/media'
import type { CaptureArtifact } from '../../domain/capture'
import type { MediaCommandResultResponse } from '../../application/media'
import type { ContentRuntimeHandle, ContentRuntimeSnapshot } from './content-runtime'
import {
  OVERLAY_EVENT_VERSION,
  OVERLAY_VIEW_MODEL_VERSION,
  type OverlayControl,
  type OverlayEvent,
  type OverlayIntent,
  type OverlayLocale,
  type OverlayNoticeViewModel,
  type OverlayPlaybackState,
  type OverlayTheme,
  type OverlayViewModel
} from '../../ui/overlay'

const MIN_OVERLAY_ZOOM = 0.25
const MAX_OVERLAY_ZOOM = 4

export type ContentOverlayMediaPort = Pick<
  ContentRuntimeHandle,
  'getMediaState' | 'executeMediaCommand'
>

export type ContentOverlayControllerOptions = Readonly<{
  media: ContentOverlayMediaPort
  downloadCapture: (artifact: CaptureArtifact) => void
  resolveTheme: (theme: ContentRuntimeSnapshot['settings']['ui']['theme']) => OverlayTheme
  onModelChanged: (model: OverlayViewModel) => void
}>

function localized(locale: OverlayLocale, zhCN: string, enUS: string): string {
  return locale === 'zh-CN' ? zhCN : enUS
}

function mediaLabel(media: MediaSnapshot, locale: OverlayLocale): string {
  if (media.kind === 'audio') return localized(locale, '当前音频', 'Active audio')
  if (media.kind === 'custom-video') return localized(locale, '当前站点视频', 'Active site video')
  return localized(locale, '当前视频', 'Active video')
}

function playbackState(media: MediaSnapshot): OverlayPlaybackState {
  const duration = media.metrics.duration
  if (duration !== null && duration > 0 && media.metrics.currentTime >= duration - 0.25) {
    return 'ended'
  }
  if (media.state === 'active') return 'playing'
  if (media.state === 'paused') return 'paused'
  return 'buffering'
}

function commandNotice(
  error: Pick<CommandError, 'code'>,
  locale: OverlayLocale
): OverlayNoticeViewModel {
  const message = (() => {
    if (error.code === 'CAPTURE_NOT_READY') {
      return localized(
        locale,
        '视频画面尚未就绪，请稍后重试。',
        'The video frame is not ready yet.'
      )
    }
    if (error.code === 'CAPTURE_BLOCKED') {
      return localized(
        locale,
        '浏览器因跨域或受保护媒体限制阻止了截图。',
        'The browser blocked capture for cross-origin or protected media.'
      )
    }
    if (error.code === 'CAPTURE_TOO_LARGE') {
      return localized(
        locale,
        '当前画面超过安全截图大小限制。',
        'The frame exceeds capture limits.'
      )
    }
    if (error.code === 'DOWNLOAD_UNAVAILABLE') {
      return localized(
        locale,
        '当前媒体没有可下载数据。',
        'No downloadable media data is available.'
      )
    }
    if (error.code === 'DOWNLOAD_BLOCKED') {
      return localized(locale, '浏览器阻止了媒体下载。', 'The browser blocked the media download.')
    }
    if (error.code === 'DOWNLOAD_TOO_LARGE') {
      return localized(
        locale,
        '媒体缓存超过安全上限。',
        'The captured media exceeded the safety limit.'
      )
    }
    if (error.code === 'DOWNLOAD_FAILED') {
      return localized(locale, '媒体下载失败。', 'The media download failed.')
    }
    if (error.code === 'DOWNLOAD_CANCELLED') {
      return localized(
        locale,
        '已取消等待中的媒体下载。',
        'The pending media download was cancelled.'
      )
    }
    if (error.code === 'CAPABILITY_UNAVAILABLE') {
      return localized(locale, '当前媒体不支持此操作。', 'This media does not support the action.')
    }
    return localized(locale, '操作未完成，请稍后重试。', 'The operation could not be completed.')
  })()
  return { tone: 'warning', message }
}

function controlForIntent(intent: OverlayIntent): OverlayControl | null {
  switch (intent.type) {
    case 'media.play':
    case 'media.pause':
      return 'playback'
    case 'media.seek':
    case 'media.seek-to':
      return 'seek'
    case 'media.set-rate':
      return 'playback-rate'
    case 'media.set-volume':
    case 'media.toggle-mute':
      return 'volume'
    case 'visual.adjust-zoom':
    case 'visual.reset':
      return 'visual'
    case 'display.toggle-fullscreen':
      return 'fullscreen'
    case 'display.toggle-picture-in-picture':
      return 'picture-in-picture'
    case 'capture.request':
      return 'capture'
    case 'download.request':
      return 'download'
    default:
      return null
  }
}

export class ContentOverlayController {
  private runtimeState: ContentRuntimeSnapshot | null = null
  private dismissed = false
  private readonly busyControls = new Set<OverlayControl>()
  private notice: OverlayNoticeViewModel | null = null

  constructor(private readonly options: ContentOverlayControllerOptions) {}

  updateRuntime(state: ContentRuntimeSnapshot): void {
    this.runtimeState = state
    this.publish()
  }

  async handle(event: OverlayEvent): Promise<void> {
    if (event.version !== OVERLAY_EVENT_VERSION) return
    const intent = event.intent
    if (intent.type === 'overlay.close' || intent.type === 'overlay.dismiss') {
      this.dismissed = true
      this.publish()
      return
    }
    if (intent.type === 'overlay.retry') {
      await this.refresh()
      return
    }
    if (intent.type === 'download.request') {
      // Download follows the same typed command path as every other media action.
    }

    const control = controlForIntent(intent)
    if (control === null || this.busyControls.has(control)) return
    this.busyControls.add(control)
    this.notice = null
    this.publish()
    try {
      await this.executeIntent(intent)
    } catch {
      this.notice = {
        tone: 'warning',
        message: localized(this.locale, '媒体运行时暂不可用。', 'The media runtime is unavailable.')
      }
    } finally {
      this.busyControls.delete(control)
      this.publish()
    }
  }

  currentModel(): OverlayViewModel {
    const state = this.runtimeState
    const locale = state?.settings.ui.locale ?? 'zh-CN'
    const theme = this.options.resolveTheme(state?.settings.ui.theme ?? 'system')
    const open = Boolean(
      state?.siteEnabled &&
      state.settings.ui.overlayEnabled &&
      !state.temporaryDisabled &&
      !this.dismissed
    )
    const active = state?.mediaState?.media.find(
      (media) => media.id === state.mediaState?.activeMediaId
    )
    const viewState =
      !state || (state.mediaReady && state.mediaState === null)
        ? 'loading'
        : !state.mediaReady
          ? 'error'
          : active === undefined
            ? 'empty'
            : active.state === 'error' || active.state === 'removed'
              ? 'unsupported'
              : 'ready'

    return {
      version: OVERLAY_VIEW_MODEL_VERSION,
      open,
      locale,
      theme,
      state: viewState,
      media:
        active === undefined
          ? null
          : {
              id: active.id,
              label: mediaLabel(active, locale),
              kind: active.kind,
              playbackState: playbackState(active),
              currentTimeSeconds: active.metrics.currentTime,
              durationSeconds: active.metrics.duration,
              playbackRate: active.metrics.playbackRate,
              volume: active.metrics.volume,
              muted: active.metrics.muted,
              zoom: active.visual?.zoom ?? 1,
              fullscreen: (active.presentation?.fullscreen ?? 'none') !== 'none',
              pictureInPicture: active.presentation?.pictureInPicture ?? false
            },
      capabilities: {
        playback: active?.capabilities.playback ?? false,
        seek: active?.capabilities.seek ?? false,
        playbackRate: active?.capabilities.playbackRate ?? false,
        volume: active?.capabilities.volume ?? false,
        mute: active?.capabilities.mute ?? false,
        visual: active?.capabilities.visual ?? false,
        fullscreen: active?.capabilities.fullscreen ?? false,
        pictureInPicture: active?.capabilities.pictureInPicture ?? false,
        capture: active?.capabilities.capture ?? false,
        download:
          Boolean(active?.capabilities.downloadExperimental) &&
          Boolean(state?.settings.policies.allowExperimental) &&
          Boolean(state?.settings.download.enabled)
      },
      busyControls: [...this.busyControls],
      statusDetail:
        viewState === 'error'
          ? localized(locale, '页面媒体桥接暂不可用。', 'The page media bridge is unavailable.')
          : null,
      notice: this.notice
    }
  }

  private get locale(): OverlayLocale {
    return this.runtimeState?.settings.ui.locale ?? 'zh-CN'
  }

  private publish(): void {
    this.options.onModelChanged(this.currentModel())
  }

  private activeMedia(mediaId: string): MediaSnapshot | null {
    return this.runtimeState?.mediaState?.media.find((media) => media.id === mediaId) ?? null
  }

  private async refresh(): Promise<void> {
    this.notice = null
    this.publish()
    try {
      const mediaState = await this.options.media.getMediaState()
      if (this.runtimeState !== null) {
        this.runtimeState = { ...this.runtimeState, ready: true, mediaState }
      }
    } catch {
      this.notice = {
        tone: 'warning',
        message: localized(this.locale, '暂时无法重新连接媒体。', 'Unable to reconnect to media.')
      }
    }
    this.publish()
  }

  private async executeIntent(
    intent: Exclude<OverlayIntent, { type: `overlay.${string}` }>
  ): Promise<void> {
    if (intent.type === 'display.toggle-fullscreen') {
      await this.toggleFullscreen(intent.mediaId)
      return
    }

    const media = this.activeMedia(intent.mediaId)
    if (media === null) throw new Error('Active media is unavailable')
    let command: MediaCommand
    switch (intent.type) {
      case 'media.play':
      case 'media.pause':
      case 'media.seek':
      case 'media.set-rate':
      case 'media.set-volume':
      case 'media.toggle-mute':
        command =
          intent.type === 'media.seek'
            ? { type: intent.type, mediaId: intent.mediaId, deltaSeconds: intent.deltaSeconds }
            : intent.type === 'media.set-rate' || intent.type === 'media.set-volume'
              ? { type: intent.type, mediaId: intent.mediaId, value: intent.value }
              : { type: intent.type, mediaId: intent.mediaId }
        break
      case 'media.seek-to':
        command = {
          type: 'media.seek',
          mediaId: intent.mediaId,
          deltaSeconds: intent.valueSeconds - media.metrics.currentTime
        }
        break
      case 'visual.adjust-zoom':
        command = {
          type: 'media.set-zoom',
          mediaId: intent.mediaId,
          value: Math.min(
            Math.max((media.visual?.zoom ?? 1) + intent.delta, MIN_OVERLAY_ZOOM),
            MAX_OVERLAY_ZOOM
          )
        }
        break
      case 'visual.reset':
        command = { type: 'media.reset-visual', mediaId: intent.mediaId }
        break
      case 'display.toggle-picture-in-picture':
        command = { type: 'media.toggle-picture-in-picture', mediaId: intent.mediaId }
        break
      case 'capture.request':
        command = { type: 'media.capture', mediaId: intent.mediaId, mimeType: 'image/png' }
        break
      case 'download.request':
        command = { type: 'media.download', mediaId: intent.mediaId }
        break
    }
    const response = await this.options.media.executeMediaCommand(command)
    this.applyResponse(response)
    if (intent.type === 'download.request' && response.result.ok) {
      this.notice = {
        tone: 'success',
        message: localized(
          this.locale,
          response.result.value.changed ? '下载已开始。' : '媒体结束后将自动下载。',
          response.result.value.changed
            ? 'The download has started.'
            : 'The download will start when the media ends.'
        )
      }
    }
    if (response.result.ok && response.result.value.artifact !== undefined) {
      try {
        this.options.downloadCapture(response.result.value.artifact)
        this.notice = {
          tone: 'success',
          message: localized(this.locale, '截图已保存到本地下载。', 'The capture was downloaded.')
        }
      } catch {
        this.notice = {
          tone: 'warning',
          message: localized(
            this.locale,
            '截图生成成功，但本地下载失败。',
            'Capture download failed.'
          )
        }
      }
    }
  }

  private async toggleFullscreen(mediaId: string): Promise<void> {
    const media = this.activeMedia(mediaId)
    if (media === null) throw new Error('Active media is unavailable')
    const currentMode = media.presentation?.fullscreen ?? 'none'
    const primaryMode =
      currentMode !== 'none' ? currentMode : media.capabilities.fullscreenNative ? 'native' : 'web'
    const primary = await this.options.media.executeMediaCommand({
      type: 'media.toggle-fullscreen',
      mediaId,
      mode: primaryMode
    })
    this.applyResponse(primary)
    if (primary.result.ok) return
    if (currentMode === 'none' && primaryMode === 'native' && media.capabilities.fullscreenWeb) {
      const fallback = await this.options.media.executeMediaCommand({
        type: 'media.toggle-fullscreen',
        mediaId,
        mode: 'web'
      })
      this.applyResponse(fallback)
    }
  }

  private applyResponse(response: MediaCommandResultResponse): void {
    if (this.runtimeState !== null) {
      this.runtimeState = { ...this.runtimeState, ready: true, mediaState: response.state }
    }
    this.notice = response.result.ok ? null : commandNotice(response.result.error, this.locale)
  }
}
