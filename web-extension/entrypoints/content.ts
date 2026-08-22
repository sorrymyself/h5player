/* eslint-disable vue/one-component-per-file -- closed-shadow render shells are entrypoint-local. */
import { browser } from 'wxt/browser'
import { createApp, defineComponent, h, shallowRef } from 'vue'
import {
  containExtensionContextInvalidation,
  consumeChromeRuntimeLastError,
  isExtensionContextInvalidatedError,
  subscribeExtensionContextInvalidationBoundary,
  subscribeRuntimeReconnect
} from '../src/infrastructure/browser/runtime-reconnect'
import { SETTINGS_STORAGE_KEY } from '../src/infrastructure/storage/settings-storage-keys'
import { downloadCaptureArtifact } from '../src/ui/files/download-capture'
import {
  MediaDownloadCoordinator,
  type MediaDownloadPromptRequest
} from '../src/ui/files/download-media'
import { MediaDownloadPromptQueue } from '../src/ui/files/media-download-prompt-queue'
import { MediaDownloadPrompt, MediaFeedbackPresenter, MediaQuickControls } from '../src/ui/media'
import quickControlsCss from '../src/ui/media/MediaQuickControls.css?inline'
import downloadPromptCss from '../src/ui/media/MediaDownloadPrompt.css?inline'
import {
  startContentRuntime,
  type ContentRuntimeHandle,
  type ContentRuntimeSnapshot
} from '../src/runtime/content/content-runtime'
import {
  isUsableMediaAnchor,
  findTencentViewportMediaSurface,
  mediaAnchorPoint,
  MediaAnchorRegistry,
  MouseLongPressController,
  selectMediaOverlayOwners,
  type MediaAnchor
} from '../src/infrastructure/dom'
import {
  MediaFeedbackStore,
  retargetMediaFeedbackEvent,
  type MediaFeedbackEvent
} from '../src/application/feedback'
import type { MediaId, MediaSnapshot } from '../src/domain/media'
import { classifyPlaybackMedia } from '../src/domain/playback'
import type { PlaybackRateWriteScope } from '../src/application/playback'
import type { MediaCommand } from '../src/domain/command'
import {
  viewportMediaOverlayInsetsForUrl,
  viewportMediaSiteOriginForFrame,
  tencentVideoSiteOriginForUrl
} from '../src/shared/viewport-media-surface'

const MEDIA_EDGE_INSET_PX = 8
const PANEL_ESTIMATED_WIDTH_PX = 232

function setImportant(element: HTMLElement, property: string, value: string): void {
  element.style.setProperty(property, value, 'important')
}

function resetMediaHost(shadowHost: HTMLElement, uiContainer: HTMLElement): void {
  shadowHost.dataset['h5pExtMediaHost'] = 'ready'
  shadowHost.style.setProperty('--h5-media-host-left', '0px')
  shadowHost.style.setProperty('--h5-media-host-top', '0px')
  shadowHost.style.setProperty('--h5-media-host-visibility', 'hidden')
  shadowHost.dataset['panelOutside'] = 'false'
  uiContainer.classList.add('h5p-ext-media-container')
  setImportant(uiContainer, 'position', 'absolute')
  setImportant(uiContainer, 'pointer-events', 'none')
}

function positionMediaHost(
  shadowHost: HTMLElement,
  uiContainer: HTMLElement,
  anchor: MediaAnchor
): void {
  const rect = anchor.rect
  const view = anchor.element.ownerDocument.defaultView
  if (
    rect === null ||
    view === null ||
    !anchor.element.isConnected ||
    !isUsableMediaAnchor(anchor)
  ) {
    shadowHost.style.setProperty('--h5-media-host-visibility', 'hidden')
    return
  }

  const placement = anchor.placement
  const alignRight = placement.endsWith('-right')
  const alignBottom = placement.startsWith('bottom-')
  const point = mediaAnchorPoint(
    anchor,
    view,
    viewportMediaOverlayInsetsForUrl(anchor.element.ownerDocument.URL) ?? MEDIA_EDGE_INSET_PX
  )
  if (point === null) {
    shadowHost.style.setProperty('--h5-media-host-visibility', 'hidden')
    return
  }
  const { x, y } = point
  shadowHost.style.setProperty('--h5-media-host-left', `${Math.round(x)}px`)
  shadowHost.style.setProperty('--h5-media-host-top', `${Math.round(y)}px`)
  shadowHost.style.setProperty('--h5-media-host-visibility', 'visible')
  shadowHost.dataset['placement'] = placement
  shadowHost.dataset['mediaId'] = String(anchor.mediaId)
  shadowHost.dataset['anchorSurface'] = anchor.surface
  const visibleRight = Math.min(view.innerWidth, rect.right)
  const availableRight = Math.max(0, view.innerWidth - visibleRight)
  shadowHost.dataset['panelOutside'] = String(
    placement.endsWith('-right') && availableRight >= PANEL_ESTIMATED_WIDTH_PX + MEDIA_EDGE_INSET_PX
  )

  for (const property of ['top', 'right', 'bottom', 'left']) {
    setImportant(uiContainer, property, 'auto')
  }
  setImportant(uiContainer, alignBottom ? 'bottom' : 'top', '0')
  setImportant(uiContainer, alignRight ? 'right' : 'left', '0')
}

function resetPageFeedbackHost(shadowHost: HTMLElement, uiContainer: HTMLElement): void {
  shadowHost.dataset['h5pExtPageFeedbackHost'] = 'ready'
  setImportant(uiContainer, 'position', 'absolute')
  setImportant(uiContainer, 'right', '0')
  setImportant(uiContainer, 'bottom', '0')
  setImportant(uiContainer, 'pointer-events', 'none')
}

type MountedVueUi = Awaited<ReturnType<typeof createShadowRootUi<ReturnType<typeof createApp>>>>

type MediaUiRecord = {
  readonly mediaId: MediaId
  readonly anchorElement: Element
  readonly anchorSurface: MediaAnchor['surface']
  readonly mountTarget: HTMLElement
  readonly model: ReturnType<typeof shallowRef<MediaUiModel | null>>
  readonly ui: MountedVueUi
  readonly shadowHost: HTMLElement
  readonly uiContainer: HTMLElement
}

type MediaUiModel = Readonly<{
  anchor: MediaAnchor
  runtime: ContentRuntimeSnapshot
  feedback: MediaFeedbackEvent | null
  controlsVisible: boolean
}>

type PageFeedbackModel = Readonly<{
  event: MediaFeedbackEvent
  locale: 'zh-CN' | 'en-US'
  theme: 'system' | 'light' | 'dark'
}>

type ContentLifecycleDiagnostics = Readonly<{
  mediaUiHosts: number
  pendingMounts: number
  feedbackTimers: number
  pageFeedbackVisible: boolean
  downloadPromptOpen: boolean
  anchor: ReturnType<MediaAnchorRegistry['diagnostics']>
}>

function mediaUiMountTarget(anchor: MediaAnchor): HTMLElement {
  const ownerDocument = anchor.element.ownerDocument
  const fullscreenElement = ownerDocument.fullscreenElement
  if (fullscreenElement instanceof HTMLElement && fullscreenElement.contains(anchor.element)) {
    return fullscreenElement
  }
  return ownerDocument.documentElement
}

function routedTencentViewportAnchor(document: Document, media: MediaSnapshot): MediaAnchor | null {
  if (
    media.kind !== 'video' ||
    media.frameId === 0 ||
    document.defaultView?.top !== document.defaultView ||
    tencentVideoSiteOriginForUrl(document.URL) === null
  ) {
    return null
  }
  const surface = findTencentViewportMediaSurface(document, {
    expectedWidth: media.metrics.width,
    expectedHeight: media.metrics.height
  })
  if (surface === null) return null
  return {
    mediaId: media.id,
    element: surface.element,
    kind: 'video',
    surface: 'viewport-proxy',
    rect: surface.rect,
    placement: 'top-right',
    compact: false
  }
}

function isPlaybackRateFeedback(event: MediaFeedbackEvent): boolean {
  return (
    event.commandId === 'media.set-rate' ||
    event.commandId === 'media.adjust-rate' ||
    event.commandId === 'playback.policy' ||
    event.messageKey.startsWith('feedback.playback-rate')
  )
}

function feedbackMatchesPlaybackRate(event: MediaFeedbackEvent, media: MediaSnapshot): boolean {
  return (
    typeof event.value === 'number' &&
    Number.isFinite(event.value) &&
    Math.abs(media.metrics.playbackRate - event.value) < 0.01
  )
}

function subscribeSettingsChanges(listener: () => void): () => void {
  const onChanged = (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
    area: string
  ): void => {
    if (area === 'local' && SETTINGS_STORAGE_KEY in changes) listener()
  }
  browser.storage.onChanged.addListener(onChanged)
  return () => {
    try {
      browser.storage.onChanged.removeListener(onChanged)
    } catch {
      // The old content context may outlive an extension reload.
    }
  }
}

export default defineContentScript({
  matches: [],
  registration: 'runtime',
  allFrames: true,
  runAt: 'document_start',
  cssInjectionMode: 'ui',
  async main(ctx) {
    const runtimeKey = Symbol.for('h5player.web-extension.content-runtime.v3')
    let cleanupInvalidatedContext: (() => void) | null = null
    await containExtensionContextInvalidation(
      async () => {
        if (Reflect.get(globalThis, runtimeKey) === true) return
        Reflect.set(globalThis, runtimeKey, true)

        let runtime: ContentRuntimeHandle | null = null
        let invalidated = false
        let invalidationBoundaryTeardown: (() => void) | null = null
        let invalidationProbe: number | null = null
        let pageUiHidden = false
        let latestRuntimeState: ContentRuntimeSnapshot | null = null
        const mediaUis = new Map<MediaId, MediaUiRecord>()
        const pendingMediaIds = new Set<MediaId>()
        const hiddenMedia = new Set<MediaId>()
        const feedback = new MediaFeedbackStore()
        const feedbackTimers = new Map<MediaId, ReturnType<typeof globalThis.setTimeout>>()
        const pageFeedbackModel = shallowRef<PageFeedbackModel | null>(null)
        const downloadPromptModel = shallowRef<MediaDownloadPromptRequest | null>(null)
        let downloadPromptShadowHost: HTMLElement | null = null
        const publishContentDiagnostics = (): void => {
          const root = document.documentElement
          if (root === null) return
          const diagnostics: ContentLifecycleDiagnostics = {
            mediaUiHosts: mediaUis.size,
            pendingMounts: pendingMediaIds.size,
            feedbackTimers: feedbackTimers.size,
            pageFeedbackVisible: pageFeedbackModel.value !== null,
            downloadPromptOpen: downloadPromptModel.value !== null,
            anchor: anchorRegistry.diagnostics()
          }
          try {
            root.dataset['h5playerWebextContentDiagnostics'] = JSON.stringify(diagnostics)
          } catch {
            // Diagnostics are best effort and must never affect page control.
          }
        }

        const downloadPromptQueue = new MediaDownloadPromptQueue({
          onChanged: (request) => {
            downloadPromptModel.value = request
            if (downloadPromptShadowHost !== null) {
              downloadPromptShadowHost.dataset['h5pExtDownloadPromptOpen'] = String(
                request !== null
              )
            }
          }
        })
        const downloadCoordinator = new MediaDownloadCoordinator({
          confirm: downloadPromptQueue.request
        })

        const downloadPromptUi = await createShadowRootUi(ctx, {
          name: 'h5p-download-prompt',
          position: 'inline',
          anchor: () => document.body ?? document.documentElement,
          append: 'last',
          css: downloadPromptCss,
          mode: 'closed',
          inheritStyles: false,
          isolateEvents: true,
          onMount(uiContainer, _shadow, shadowHost) {
            downloadPromptShadowHost = shadowHost
            shadowHost.dataset['h5pExtDownloadPromptHost'] = 'ready'
            shadowHost.dataset['h5pExtDownloadPromptOpen'] = String(
              downloadPromptModel.value !== null
            )
            setImportant(uiContainer, 'position', 'fixed')
            setImportant(uiContainer, 'inset', '0')
            setImportant(uiContainer, 'pointer-events', 'auto')
            const root = defineComponent({
              name: 'H5PlayerDownloadPromptRoot',
              setup: () => () => {
                const request = downloadPromptModel.value
                const state = latestRuntimeState
                return request === null
                  ? null
                  : h(MediaDownloadPrompt, {
                      request,
                      locale: state?.settings.ui.locale ?? 'zh-CN',
                      theme: state?.settings.ui.theme ?? 'system',
                      onConfirm: (result: { readonly filenames: readonly string[] }) => {
                        downloadPromptQueue.resolveCurrent(result)
                      },
                      onCancel: () => {
                        downloadPromptQueue.resolveCurrent(null)
                      }
                    })
              }
            })
            const app = createApp(root)
            app.mount(uiContainer)
            return app
          },
          onRemove(app) {
            downloadPromptShadowHost = null
            app?.unmount()
          }
        })
        if (invalidated || ctx.isInvalid) {
          downloadPromptQueue.teardown()
          downloadCoordinator.clearHistory()
          downloadPromptUi.remove()
          Reflect.deleteProperty(globalThis, runtimeKey)
          return
        }
        downloadPromptUi.mount()

        const pageFeedbackUi = await createShadowRootUi(ctx, {
          name: 'h5p-page-feedback',
          position: 'inline',
          anchor: () => document.body ?? document.documentElement,
          append: 'last',
          css: quickControlsCss,
          mode: 'closed',
          inheritStyles: false,
          isolateEvents: true,
          onMount(uiContainer, _shadow, shadowHost) {
            resetPageFeedbackHost(shadowHost, uiContainer)
            const root = defineComponent({
              name: 'H5PlayerPageFeedbackRoot',
              setup: () => () => {
                const model = pageFeedbackModel.value
                return model === null
                  ? null
                  : h(MediaFeedbackPresenter, {
                      event: model.event,
                      locale: model.locale,
                      variant: 'page',
                      theme: model.theme
                    })
              }
            })
            const app = createApp(root)
            app.mount(uiContainer)
            return app
          },
          onRemove(app) {
            app?.unmount()
          }
        })
        if (invalidated || ctx.isInvalid) {
          pageFeedbackUi.remove()
          downloadPromptQueue.teardown()
          downloadCoordinator.clearHistory()
          downloadPromptUi.remove()
          Reflect.deleteProperty(globalThis, runtimeKey)
          return
        }
        pageFeedbackUi.mount()

        const executeMedia = async (
          command: MediaCommand,
          playbackRateScope?: PlaybackRateWriteScope
        ): Promise<void> => {
          try {
            await runtime?.executeMediaCommand(command, {
              source: 'overlay',
              ...(playbackRateScope === undefined ? {} : { playbackRateScope })
            })
          } catch {
            // The runtime feedback/error path owns user-visible failure semantics.
          }
        }

        const removeMediaUi = (mediaId: MediaId): void => {
          mediaUis.get(mediaId)?.ui.remove()
          mediaUis.delete(mediaId)
          publishContentDiagnostics()
        }

        const clearFeedbackTimer = (mediaId: MediaId): void => {
          const timer = feedbackTimers.get(mediaId)
          if (timer !== undefined) globalThis.clearTimeout(timer)
          feedbackTimers.delete(mediaId)
          publishContentDiagnostics()
        }

        const scheduleFeedbackExpiry = (event: MediaFeedbackEvent): void => {
          clearFeedbackTimer(event.mediaId)
          feedbackTimers.set(
            event.mediaId,
            globalThis.setTimeout(
              () => {
                feedbackTimers.delete(event.mediaId)
                updateMediaUiModels()
              },
              Math.max(0, event.expiresAt - Date.now()) + 16
            )
          )
          publishContentDiagnostics()
        }

        const cleanupRemovedMedia = (mediaId: MediaId): void => {
          removeMediaUi(mediaId)
          clearFeedbackTimer(mediaId)
          feedback.remove(mediaId)
          hiddenMedia.delete(mediaId)
          publishContentDiagnostics()
        }

        const anchorsForState = (state: ContentRuntimeSnapshot): readonly MediaAnchor[] => {
          const localAnchors = anchorRegistry.current()
          const active = state.mediaState?.media.find(
            (media) => media.id === state.mediaState?.activeMediaId
          )
          const routedAnchor =
            active === undefined ? null : routedTencentViewportAnchor(document, active)
          return routedAnchor === null ? localAnchors : [...localAnchors, routedAnchor]
        }

        const resolveAnchorForState = (
          state: ContentRuntimeSnapshot,
          mediaId: MediaId
        ): MediaAnchor | null =>
          anchorsForState(state).find((anchor) => anchor.mediaId === mediaId) ?? null

        const mountMediaUi = async (
          anchor: MediaAnchor,
          state: ContentRuntimeSnapshot,
          controlsVisible: boolean,
          currentFeedback: MediaFeedbackEvent | null
        ): Promise<void> => {
          if (
            mediaUis.has(anchor.mediaId) ||
            pendingMediaIds.has(anchor.mediaId) ||
            hiddenMedia.has(anchor.mediaId) ||
            pageUiHidden
          ) {
            return
          }
          pendingMediaIds.add(anchor.mediaId)
          let pendingUi: Readonly<{ remove(): void }> | null = null
          try {
            const mountTarget = mediaUiMountTarget(anchor)
            const model = shallowRef<MediaUiModel | null>({
              anchor,
              runtime: state,
              feedback: currentFeedback,
              controlsVisible
            })
            let mountedHost: HTMLElement | null = null
            let mountedContainer: HTMLElement | null = null
            const ui = await createShadowRootUi(ctx, {
              name: `h5p-media-${anchor.mediaId.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`,
              position: 'inline',
              anchor: () => mountTarget,
              append: 'last',
              css: quickControlsCss,
              mode: 'closed',
              inheritStyles: false,
              isolateEvents: true,
              onMount(uiContainer, _shadow, shadowHost) {
                mountedHost = shadowHost
                mountedContainer = uiContainer
                resetMediaHost(shadowHost, uiContainer)
                const root = defineComponent({
                  name: 'H5PlayerMediaQuickControlsRoot',
                  setup: () => () => {
                    const current = model.value
                    if (current === null) return null
                    const media = current.runtime.mediaState?.media.find(
                      (item) => item.id === current.anchor.mediaId
                    )
                    if (media === undefined) return null
                    return h(MediaQuickControls, {
                      media,
                      compact: current.anchor.compact,
                      controlsVisible: current.controlsVisible,
                      audioGainEnabled:
                        current.runtime.settings.policies.allowAcousticGain === true,
                      policy: current.runtime.playbackPolicies[media.id] ?? null,
                      feedback: current.feedback,
                      locale: current.runtime.settings.ui.locale,
                      theme: current.runtime.settings.ui.theme,
                      onCommand: (command: MediaCommand, scope?: PlaybackRateWriteScope) => {
                        void executeMedia(command, scope)
                      },
                      onCancelDownload: () => {
                        void runtime?.cancelMediaDownload(media.id)
                      },
                      onHideMedia: (focusTarget: HTMLMediaElement | null) => {
                        hiddenMedia.add(media.id)
                        removeMediaUi(media.id)
                        focusTarget?.focus({ preventScroll: true })
                      },
                      onHidePage: (focusTarget: HTMLMediaElement | null) => {
                        void runtime?.setPageUiHidden(true).catch(() => undefined)
                        focusTarget?.focus({ preventScroll: true })
                      }
                    })
                  }
                })
                const app = createApp(root)
                app.mount(uiContainer)
                return app
              },
              onRemove(app) {
                app?.unmount()
              }
            })
            pendingUi = ui
            if (
              invalidated ||
              pageUiHidden ||
              hiddenMedia.has(anchor.mediaId) ||
              !anchor.element.isConnected ||
              (latestRuntimeState === null
                ? null
                : resolveAnchorForState(latestRuntimeState, anchor.mediaId)?.element) !==
                anchor.element ||
              latestRuntimeState?.mediaState?.media.some((media) => media.id === anchor.mediaId) !==
                true
            ) {
              ui.remove()
              return
            }
            ui.mount()
            if (mountedHost === null || mountedContainer === null) {
              ui.remove()
              return
            }
            const record: MediaUiRecord = {
              mediaId: anchor.mediaId,
              anchorElement: anchor.element,
              anchorSurface: anchor.surface,
              mountTarget,
              model,
              ui,
              shadowHost: mountedHost,
              uiContainer: mountedContainer
            }
            mediaUis.set(anchor.mediaId, record)
            pendingUi = null
            positionMediaHost(record.shadowHost, record.uiContainer, anchor)
          } catch (error) {
            pendingUi?.remove()
            if (isExtensionContextInvalidatedError(error)) teardownContent()
          } finally {
            pendingMediaIds.delete(anchor.mediaId)
            publishContentDiagnostics()
          }
        }

        const updateMediaUiModels = (): void => {
          const state = latestRuntimeState
          if (state === null || !state.ready || pageUiHidden) {
            for (const mediaId of [...mediaUis.keys()]) removeMediaUi(mediaId)
            pageFeedbackModel.value = null
            publishContentDiagnostics()
            return
          }

          const mediaItems = state.mediaState?.media ?? []
          const activeMediaId = state.mediaState?.activeMediaId ?? null
          const anchors = anchorsForState(state)
          const anchorByMediaId = new Map(anchors.map((anchor) => [anchor.mediaId, anchor]))
          const overlayOwnerIds = selectMediaOverlayOwners(mediaItems, activeMediaId, anchors)
          const currentIds = new Set(mediaItems.map((media) => media.id))
          for (const mediaId of new Set([...mediaUis.keys(), ...hiddenMedia])) {
            if (!currentIds.has(mediaId)) cleanupRemovedMedia(mediaId)
          }

          const fallbackEvents: MediaFeedbackEvent[] = []
          for (const media of mediaItems) {
            const currentFeedback = feedback.current(media.id)
            const anchor = anchorByMediaId.get(media.id) ?? null
            const eligibility = classifyPlaybackMedia(media, activeMediaId)
            const ownsOverlaySlot = overlayOwnerIds.has(media.id)
            const controlsVisible =
              state.settings.ui.overlayEnabled &&
              eligibility.eligible &&
              ownsOverlaySlot &&
              media.kind !== 'audio' &&
              !hiddenMedia.has(media.id)
            const videoFeedbackVisible =
              currentFeedback !== null &&
              media.metrics.visible &&
              ownsOverlaySlot &&
              !hiddenMedia.has(media.id)
            const feedbackVisible =
              media.kind === 'audio'
                ? currentFeedback !== null && !hiddenMedia.has(media.id)
                : videoFeedbackVisible

            if (media.kind === 'audio') {
              removeMediaUi(media.id)
              if (feedbackVisible && currentFeedback !== null) fallbackEvents.push(currentFeedback)
              continue
            }
            if (!ownsOverlaySlot && currentFeedback !== null && !hiddenMedia.has(media.id)) {
              fallbackEvents.push(currentFeedback)
            }
            if (!controlsVisible && !feedbackVisible) {
              removeMediaUi(media.id)
              continue
            }
            if (anchor === null || !isUsableMediaAnchor(anchor)) {
              removeMediaUi(media.id)
              if (feedbackVisible && currentFeedback !== null) fallbackEvents.push(currentFeedback)
              continue
            }

            const record = mediaUis.get(media.id)
            if (
              record !== undefined &&
              (record.anchorElement !== anchor.element ||
                record.anchorSurface !== anchor.surface ||
                record.mountTarget !== mediaUiMountTarget(anchor))
            ) {
              removeMediaUi(media.id)
              void mountMediaUi(anchor, state, controlsVisible, currentFeedback)
              continue
            }
            if (record !== undefined) {
              record.model.value = {
                anchor,
                runtime: state,
                feedback: currentFeedback,
                controlsVisible
              }
              positionMediaHost(record.shadowHost, record.uiContainer, anchor)
              continue
            }
            void mountMediaUi(anchor, state, controlsVisible, currentFeedback)
          }

          const fallback = fallbackEvents.sort((left, right) => right.createdAt - left.createdAt)[0]
          pageFeedbackModel.value =
            fallback === undefined
              ? null
              : {
                  event: fallback,
                  locale: state.settings.ui.locale,
                  theme: state.settings.ui.theme
                }
          publishContentDiagnostics()
        }

        const migrateTencentPlaybackRateFeedback = (
          previous: ContentRuntimeSnapshot | null,
          current: ContentRuntimeSnapshot
        ): void => {
          if (tencentVideoSiteOriginForUrl(document.URL) === null) return
          const previousState = previous?.mediaState
          const currentState = current.mediaState
          if (
            previousState === null ||
            previousState === undefined ||
            currentState === null ||
            previousState.activeMediaId === null ||
            currentState.activeMediaId === null ||
            previousState.activeMediaId === currentState.activeMediaId
          ) {
            return
          }
          const previousMedia = previousState.media.find(
            (media) => media.id === previousState.activeMediaId
          )
          const currentMedia = currentState.media.find(
            (media) => media.id === currentState.activeMediaId
          )
          if (
            previousMedia?.adapterId !== 'tencent-video' ||
            currentMedia?.adapterId !== 'tencent-video' ||
            !currentMedia.metrics.visible
          ) {
            return
          }
          const event = feedback.current(previousMedia.id)
          if (
            event === null ||
            !isPlaybackRateFeedback(event) ||
            !feedbackMatchesPlaybackRate(event, currentMedia)
          ) {
            return
          }
          clearFeedbackTimer(previousMedia.id)
          const moved = feedback.move(previousMedia.id, currentMedia.id)
          if (moved !== null) scheduleFeedbackExpiry(moved)
        }

        const canonicalTencentFeedbackOwner = (event: MediaFeedbackEvent): MediaFeedbackEvent => {
          const state = latestRuntimeState?.mediaState
          if (
            state === null ||
            state === undefined ||
            state.media.some((media) => media.id === event.mediaId) ||
            tencentVideoSiteOriginForUrl(document.URL) === null ||
            !isPlaybackRateFeedback(event)
          ) {
            return event
          }
          const active = state.media.find((media) => media.id === state.activeMediaId)
          if (
            active?.adapterId !== 'tencent-video' ||
            !active.metrics.visible ||
            !feedbackMatchesPlaybackRate(event, active)
          ) {
            return event
          }
          return retargetMediaFeedbackEvent(event, active.id)
        }

        const anchorRegistry = new MediaAnchorRegistry({
          root: document,
          onChanged: () => {
            updateMediaUiModels()
            runtime?.reportFrameState()
            publishContentDiagnostics()
          }
        })
        anchorRegistry.start()
        publishContentDiagnostics()
        const mouseLongPress = new MouseLongPressController({
          root: document,
          resolveTarget: (event) => {
            const eventFromExtensionUi = event
              .composedPath()
              .some(
                (target) =>
                  target instanceof HTMLElement &&
                  (target.dataset['h5pExtMediaHost'] === 'ready' ||
                    target.dataset['h5pExtPageFeedbackHost'] === 'ready')
              )
            if (eventFromExtensionUi) return null
            const state = latestRuntimeState?.mediaState
            if (state === null || state === undefined) return null
            const candidates = state.media
              .filter(
                (media) =>
                  media.kind === 'video' &&
                  media.capabilities.playbackRate &&
                  (media.state === 'active' || media.state === 'paused')
              )
              .flatMap((media) => {
                const anchor =
                  anchorRegistry.resolve(media.id) ?? routedTencentViewportAnchor(document, media)
                if (anchor === null || !isUsableMediaAnchor(anchor) || anchor.rect === null) {
                  return []
                }
                const rect = anchor.rect
                if (
                  event.clientX < rect.left ||
                  event.clientX > rect.right ||
                  event.clientY < rect.top ||
                  event.clientY > rect.bottom
                ) {
                  return []
                }
                return [{ media, anchor }]
              })
              .sort((left, right) => {
                const leftActive = left.media.id === state.activeMediaId ? 1 : 0
                const rightActive = right.media.id === state.activeMediaId ? 1 : 0
                if (leftActive !== rightActive) return rightActive - leftActive
                const leftArea = (left.anchor.rect?.width ?? 0) * (left.anchor.rect?.height ?? 0)
                const rightArea = (right.anchor.rect?.width ?? 0) * (right.anchor.rect?.height ?? 0)
                return leftArea - rightArea
              })
            const selected = candidates[0]
            return selected === undefined
              ? null
              : { mediaId: selected.media.id, element: selected.anchor.element }
          },
          getSnapshot: (mediaId) =>
            latestRuntimeState?.mediaState?.media.find((media) => media.id === mediaId) ?? null,
          setPlaybackRate: async (mediaId, value) => {
            if (runtime === null) return false
            const response = await runtime.executeMediaCommand(
              { type: 'media.set-rate', mediaId, value },
              { source: 'shortcut', playbackRateScope: 'media' }
            )
            return response.result.ok
          },
          setPlaybackState: async (mediaId, state) => {
            if (runtime === null) return false
            const response = await runtime.executeMediaCommand(
              {
                type: state === 'active' ? 'media.play' : 'media.pause',
                mediaId
              },
              { source: 'lifecycle' }
            )
            return response.result.ok
          }
        })
        if (ctx.isInvalid) {
          mouseLongPress.teardown()
          anchorRegistry.teardown()
          pageFeedbackUi.remove()
          downloadPromptQueue.teardown()
          downloadCoordinator.clearHistory()
          downloadPromptUi.remove()
          Reflect.deleteProperty(globalThis, runtimeKey)
          return
        }

        const onMessage = (
          rawMessage: unknown,
          sender: Parameters<Parameters<typeof browser.runtime.onMessage.addListener>[0]>[1],
          sendResponse: (response?: unknown) => void
        ): boolean => {
          if (!runtime) return false
          const metadata = sender.id ? { id: sender.id } : {}
          void runtime
            .handleTabMessage(rawMessage, metadata)
            .then((response) => {
              if (invalidated) return
              try {
                sendResponse(response)
              } catch {
                // The requesting channel may close while the asynchronous handler completes.
              }
            })
            .catch((error: unknown) => {
              if (isExtensionContextInvalidatedError(error)) teardownContent()
            })
          return true
        }
        let runtimeMessageListenerRegistered = false
        const teardownContent = (): void => {
          if (invalidated) return
          invalidated = true
          invalidationBoundaryTeardown?.()
          invalidationBoundaryTeardown = null
          if (invalidationProbe !== null) globalThis.clearInterval(invalidationProbe)
          invalidationProbe = null
          if (runtimeMessageListenerRegistered) {
            try {
              browser.runtime.onMessage.removeListener(onMessage)
            } catch {
              // Browser APIs are already unavailable after extension reload/update.
            }
            runtimeMessageListenerRegistered = false
          }
          for (const timer of feedbackTimers.values()) globalThis.clearTimeout(timer)
          feedbackTimers.clear()
          downloadPromptQueue.teardown()
          downloadPromptUi.remove()
          for (const mediaId of [...mediaUis.keys()]) removeMediaUi(mediaId)
          pageFeedbackUi.remove()
          mouseLongPress.teardown()
          anchorRegistry.teardown()
          feedback.clear()
          try {
            delete document.documentElement?.dataset['h5playerWebextContentDiagnostics']
          } catch {
            // The page may have replaced the dataset implementation.
          }
          try {
            runtime?.teardown()
          } catch {
            // Teardown must finish even when browser-owned listeners were invalidated first.
          }
          Reflect.deleteProperty(globalThis, runtimeKey)
        }
        cleanupInvalidatedContext = teardownContent
        invalidationBoundaryTeardown = subscribeExtensionContextInvalidationBoundary(
          window,
          teardownContent
        )
        try {
          browser.runtime.onMessage.addListener(onMessage)
          runtimeMessageListenerRegistered = true
        } catch {
          teardownContent()
          return
        }

        ctx.onInvalidated(teardownContent)
        invalidationProbe = ctx.setInterval(() => {
          try {
            if (ctx.isInvalid) teardownContent()
          } catch {
            teardownContent()
          }
        }, 250)

        let extensionId: string
        try {
          extensionId = browser.runtime.id
        } catch {
          teardownContent()
          return
        }

        runtime = await startContentRuntime({
          window,
          document,
          siteOrigin:
            viewportMediaSiteOriginForFrame(window.location.href, document.referrer) ??
            window.location.origin,
          extensionId,
          transport: {
            send: (message) => browser.runtime.sendMessage(message),
            reconnect: async () => {
              await browser.runtime.getPlatformInfo()
            }
          },
          injectPageMain: () => Promise.resolve(),
          subscribeSettings: subscribeSettingsChanges,
          subscribeRuntimeReconnect: (sessionId, listener) => {
            // Every established lifetime port is a frame-state handshake. This
            // includes the first connection: a frame can finish starting while an
            // MV3 worker is being replaced, after its earlier one-shot reports
            // were delivered to the terminating worker.
            return subscribeRuntimeReconnect({
              connect: () => {
                if (ctx.isInvalid) throw new Error('Extension context invalidated.')
                const port = browser.runtime.connect({
                  name: `h5player-frame-runtime:${sessionId}`
                })
                return {
                  onDisconnect: port.onDisconnect,
                  disconnect: () => port.disconnect(),
                  consumeDisconnectError: consumeChromeRuntimeLastError
                }
              },
              onConnected: listener,
              onContextInvalidated: teardownContent
            })
          },
          pageUi: {
            getState: () => ({
              hidden: pageUiHidden,
              hiddenMediaCount: hiddenMedia.size
            }),
            setHidden: (hidden) => {
              pageUiHidden = hidden
              if (!hidden) hiddenMedia.clear()
              updateMediaUiModels()
              return { hidden: pageUiHidden, hiddenMediaCount: hiddenMedia.size }
            }
          },
          onRuntimeStateChanged: (state) => {
            const previousState = latestRuntimeState
            latestRuntimeState = state
            pageUiHidden = state.pageUiHidden
            mouseLongPress.update({
              enabled: state.settings.policies.allowMouseLongPress === true,
              delayMs: state.settings.policies.mouseLongPressMs ?? 600
            })
            migrateTencentPlaybackRateFeedback(previousState, state)
            anchorRegistry.refresh()
            updateMediaUiModels()
          },
          onFeedback: (event) => {
            const canonicalEvent = canonicalTencentFeedbackOwner(event)
            feedback.push(canonicalEvent)
            updateMediaUiModels()
            scheduleFeedbackExpiry(canonicalEvent)
          },
          onCaptureArtifact: (artifact) => downloadCaptureArtifact(artifact),
          onMediaDownloadArtifacts: (artifacts) => downloadCoordinator.download(artifacts),
          getAnchoredMediaCount: () => anchorRegistry.current().filter(isUsableMediaAnchor).length
        })
        if (invalidated) {
          try {
            runtime.teardown()
          } catch {
            // Browser APIs are unavailable after the context is invalidated.
          }
          Reflect.deleteProperty(globalThis, runtimeKey)
        }
      },
      () => {
        cleanupInvalidatedContext?.()
        Reflect.deleteProperty(globalThis, runtimeKey)
      }
    )
  }
})
