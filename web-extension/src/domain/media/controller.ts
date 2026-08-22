import type { FullscreenMode, VisualState } from '../visual'
import type { CaptureArtifact, CaptureOptions } from '../capture'
import type { MediaDownloadPreparation } from '../download'
import type { MediaCapabilities, MediaId, MediaSnapshot } from './model'

/**
 * DOM-free control boundary. Page-main adapters own the underlying media object;
 * domain and application code see only this port and serializable snapshots.
 */
export interface MediaController {
  readonly mediaId: MediaId
  readonly capabilities: MediaCapabilities
  getSnapshot(): MediaSnapshot
  play(): Promise<void>
  pause(): Promise<void>
  seekTo(seconds: number): Promise<void>
  setPlaybackRate(value: number): Promise<void>
  setVolume(value: number): Promise<void>
  /** Optional Web Audio gain port; values are perceived volume multipliers. */
  setGain?(value: number): Promise<void>
  setMuted(value: boolean): Promise<void>
  /** Optional for compatibility with non-visual/site-specific controllers. */
  setVisualState?(state: VisualState): Promise<void>
  /** Optional presentation ports are guarded by explicit snapshot capabilities. */
  toggleFullscreen?(mode: FullscreenMode): Promise<void>
  togglePictureInPicture?(): Promise<void>
  captureFrame?(options: CaptureOptions): Promise<CaptureArtifact>
  prepareDownload?(intentId: string): Promise<MediaDownloadPreparation>
  cancelDownload?(): boolean
  playNext?(): Promise<void>
}

export interface MediaControllerResolver {
  resolve(mediaId: MediaId): MediaController | undefined
}
