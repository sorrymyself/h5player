import {
  createProductionAdapterRegistry,
  GenericAdapter,
  createTencentViewportMediaController,
  type ExperimentalMediaDownloadPort,
  type TencentViewportMediaController
} from '../../adapters'
import { createMediaCommandRegistry } from '../../application/commands'
import {
  siteAdapterPageActionResponseSchema,
  type SiteAdapterPageAction,
  type SiteAdapterPageActionResponse
} from '../../application/adapter/contracts'
import {
  mediaCommandResultResponseSchema,
  mediaPageStateSchema,
  mediaPageStateSummarySchema,
  type MediaCommandResultResponse,
  type MediaPageState,
  type MediaPageStateSummary
} from '../../application/media'
import type { MediaCommand } from '../../domain/command'
import type { MediaDownloadEvent, MediaDownloadPreparation } from '../../domain/download'
import { createDomMediaDiscoveryService, type MediaDiscoveryUpdate } from '../../infrastructure/dom'
import { viewportMediaSurfaceKindForUrl } from '../../shared/viewport-media-surface'
import { installOpenShadowRootHook } from './shadow-root-hook'
import type { MediaControlAuthority } from './media-control-authority'
import type { MediaAuthorityDiagnostics } from './media-control-authority'

export type PageMediaRuntimeDiagnostics = Readonly<{
  discovery: ReturnType<MediaPageRuntime['discovery']['diagnostics']>
  authority: MediaAuthorityDiagnostics | null
  viewportController: boolean
}>

export class MediaPageRuntime {
  private readonly adapters
  private readonly discovery
  private readonly commands
  private readonly viewportController: TencentViewportMediaController | null
  private latestUpdate: MediaDiscoveryUpdate
  private readonly teardownDiscoverySubscription: () => void
  private readonly teardownViewportSubscription: () => void
  private readonly teardownShadowHook: () => void
  private readonly stateListeners = new Set<(summary: MediaPageStateSummary) => void>()
  private readonly downloadListeners = new Set<(event: MediaDownloadEvent) => void>()
  private readonly resolveMediaController
  private readonly teardownDownloadSubscription: () => void
  private readonly viewportMediaFrame: boolean
  private viewportRevision = 0
  private disposed = false

  constructor(
    private readonly currentWindow: Window,
    private readonly currentDocument: Document,
    private readonly frameId: number,
    private readonly now: () => number = Date.now,
    private readonly authority: MediaControlAuthority | null = null,
    private readonly siteOrigin: string | undefined = undefined,
    private readonly experimentalDownload: ExperimentalMediaDownloadPort | null = null
  ) {
    this.authority?.install()
    this.viewportMediaFrame = viewportMediaSurfaceKindForUrl(currentWindow.location.href) !== null
    this.adapters = createProductionAdapterRegistry({
      url: () => currentWindow.location.href,
      ...(this.experimentalDownload === null
        ? {}
        : { fallback: new GenericAdapter(this.experimentalDownload) })
    })
    this.viewportController = createTencentViewportMediaController(
      currentWindow,
      currentDocument,
      frameId,
      now,
      this.authority === null
        ? undefined
        : {
            attachCustomPlaybackRate: (target, mediaId) =>
              this.authority?.attachCustomPlaybackRate(target, mediaId) ?? (() => undefined),
            writeCustomPlaybackRate: (target, mediaId, value) =>
              this.authority?.writeCustomPlaybackRate(target, mediaId, value) ?? false
          },
      siteOrigin
    )
    if (this.viewportController !== null) this.viewportRevision = 1
    this.discovery = createDomMediaDiscoveryService({
      root: currentDocument,
      adapter: this.adapters,
      frameId,
      now,
      ...(this.authority === null
        ? {}
        : {
            bindMediaAuthority: (element: HTMLMediaElement, mediaId: string) =>
              this.authority?.attach(element, mediaId) ?? (() => undefined)
          })
    })
    this.latestUpdate = {
      revision: 0,
      current: Object.freeze([]),
      active: null,
      added: Object.freeze([]),
      updated: Object.freeze([]),
      removed: Object.freeze([])
    }
    this.teardownDiscoverySubscription = this.discovery.subscribe((update) => {
      this.latestUpdate = update
      this.notifyStateChanged()
    })
    this.teardownViewportSubscription =
      this.viewportController?.subscribe(() => {
        this.viewportRevision += 1
        this.notifyStateChanged()
      }) ?? (() => undefined)
    this.resolveMediaController = (mediaId: string) =>
      this.viewportController?.mediaId === mediaId
        ? this.viewportController
        : this.viewportMediaFrame
          ? undefined
          : this.discovery.resolve(mediaId)
    this.commands = createMediaCommandRegistry({ resolve: this.resolveMediaController })
    this.teardownDownloadSubscription =
      this.experimentalDownload?.subscribe((event) => {
        for (const listener of [...this.downloadListeners]) {
          try {
            listener(event)
          } catch {
            // Download observers are isolated from media lifecycle.
          }
        }
      }) ?? (() => undefined)
    this.teardownShadowHook = installOpenShadowRootHook(currentWindow, () => {
      this.discovery.refresh()
    })
    currentWindow.addEventListener('pageshow', this.handlePageContextChange, true)
    currentWindow.addEventListener('popstate', this.handlePageContextChange, true)
    currentWindow.addEventListener('hashchange', this.handlePageContextChange, true)
  }

  getState(): MediaPageState {
    this.assertActive()
    const viewportMedia = this.viewportController?.getSnapshot() ?? null
    const discoveredMedia = this.viewportMediaFrame ? [] : [...this.latestUpdate.current]
    const state = {
      frameId: this.frameId,
      revision: viewportMedia === null ? this.latestUpdate.revision : this.viewportRevision,
      activeMediaId:
        viewportMedia?.id ??
        (this.viewportMediaFrame ? null : (this.latestUpdate.active?.id ?? null)),
      media: viewportMedia === null ? discoveredMedia : [viewportMedia],
      adapters: this.adapters.getDiagnostics(),
      observedAt: Math.max(0, this.now())
    }
    return mediaPageStateSchema.parse(state)
  }

  getStateSummary(): MediaPageStateSummary {
    this.assertActive()
    const viewportMedia = this.viewportController?.getSnapshot() ?? null
    return mediaPageStateSummarySchema.parse({
      frameId: this.frameId,
      revision: viewportMedia === null ? this.latestUpdate.revision : this.viewportRevision,
      activeMediaId:
        viewportMedia?.id ??
        (this.viewportMediaFrame ? null : (this.latestUpdate.active?.id ?? null)),
      mediaCount:
        viewportMedia === null
          ? this.viewportMediaFrame
            ? 0
            : this.latestUpdate.current.length
          : 1,
      adapters: this.adapters.getDiagnostics(),
      observedAt: Math.max(0, this.now())
    })
  }

  diagnostics(): PageMediaRuntimeDiagnostics {
    return Object.freeze({
      discovery: this.discovery.diagnostics(),
      authority: this.authority?.diagnosticsSummary() ?? null,
      viewportController: this.viewportController !== null
    })
  }

  subscribeStateChanged(listener: (summary: MediaPageStateSummary) => void): () => void {
    this.assertActive()
    this.stateListeners.add(listener)
    this.notifyListener(listener)
    return () => this.stateListeners.delete(listener)
  }

  async execute(command: MediaCommand): Promise<MediaCommandResultResponse> {
    this.assertActive()
    const result = await this.commands.execute(command)
    if (result.ok) this.authority?.recordCommand(command, result.value.snapshot)
    this.discovery.refresh()
    return mediaCommandResultResponseSchema.parse({ result, state: this.getState() })
  }

  prepareDownload(mediaId: string, intentId: string): Promise<MediaDownloadPreparation> {
    this.assertActive()
    const controller = this.resolveMediaController(mediaId)
    const prepareDownload: unknown =
      controller === undefined
        ? undefined
        : (controller as { prepareDownload?: unknown }).prepareDownload
    if (typeof prepareDownload !== 'function') {
      throw new Error('Experimental media download is unavailable')
    }
    const typedPrepareDownload = prepareDownload as (
      this: unknown,
      value: string
    ) => Promise<MediaDownloadPreparation>
    return typedPrepareDownload.call(controller, intentId)
  }

  cancelDownload(mediaId: string): boolean {
    this.assertActive()
    const controller = this.resolveMediaController(mediaId)
    const cancelDownload: unknown =
      controller === undefined
        ? undefined
        : (controller as { cancelDownload?: unknown }).cancelDownload
    if (typeof cancelDownload !== 'function') return false
    return (cancelDownload as (this: unknown) => boolean).call(controller)
  }

  subscribeDownloadEvents(listener: (event: MediaDownloadEvent) => void): () => void {
    this.assertActive()
    this.downloadListeners.add(listener)
    return () => this.downloadListeners.delete(listener)
  }

  executePageAction(action: SiteAdapterPageAction): SiteAdapterPageActionResponse {
    this.assertActive()
    return siteAdapterPageActionResponseSchema.parse(
      this.adapters.executePageAction(action, this.currentDocument)
    )
  }

  refresh(): void {
    if (!this.disposed) this.discovery.refresh()
  }

  teardown(): void {
    if (this.disposed) return
    this.disposed = true
    this.currentWindow.removeEventListener('pageshow', this.handlePageContextChange, true)
    this.currentWindow.removeEventListener('popstate', this.handlePageContextChange, true)
    this.currentWindow.removeEventListener('hashchange', this.handlePageContextChange, true)
    this.teardownShadowHook()
    this.teardownDiscoverySubscription()
    this.teardownViewportSubscription()
    this.teardownDownloadSubscription()
    this.downloadListeners.clear()
    this.viewportController?.teardown()
    this.discovery.teardown()
    this.stateListeners.clear()
  }

  private readonly handlePageContextChange: EventListener = () => {
    this.refresh()
  }

  private notifyStateChanged(): void {
    if (this.disposed || this.stateListeners.size === 0) return
    for (const listener of [...this.stateListeners]) this.notifyListener(listener)
  }

  private notifyListener(listener: (summary: MediaPageStateSummary) => void): void {
    try {
      listener(this.getStateSummary())
    } catch {
      // State observers are isolated from the media discovery lifecycle.
    }
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Media page runtime is disposed')
  }
}
