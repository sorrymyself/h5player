import { ReplayGuard } from '../../infrastructure/messaging/replay-guard'
import type { MediaPageStateSummary } from '../../application/media'
import {
  createPageMediaNotification,
  createPageMediaDownloadNotification,
  createPageMediaResponse,
  parsePageMediaMessage,
  type PageMediaMessage,
  type PageMediaPayloadByType,
  type PageMediaResponseType
} from '../../infrastructure/messaging/page-media-protocol'
import { systemClock } from '../../infrastructure/time/system-time'
import { createBridgeMessage, parseBridgeMessage } from '../../shared/protocol'
import { defaultMediaAuthorityPolicy, MediaControlAuthority } from './media-control-authority'
import { MediaPageRuntime } from './media-page-runtime'
import { ExperimentalMediaDownloadManager } from '../../adapters/generic/experimental-media-download'

const RUNTIME_KEY = Symbol.for('h5player.web-extension.page-runtime.v1')
const RUNTIME_BRAND = 'h5player.web-extension.page-runtime'

type RuntimeMarker = {
  readonly brand: string
  readonly version: 1
}

function installRuntimeMarker(currentWindow: Window): RuntimeMarker | null {
  const existing = Object.getOwnPropertyDescriptor(currentWindow, RUNTIME_KEY)
  if (existing !== undefined) return null

  const marker: RuntimeMarker = Object.freeze({ brand: RUNTIME_BRAND, version: 1 })
  try {
    Object.defineProperty(currentWindow, RUNTIME_KEY, {
      configurable: true,
      enumerable: false,
      writable: false,
      value: marker
    })
    return marker
  } catch {
    return marker
  }
}

export function startPageMainRuntime(window: Window, document: Document): () => void {
  const root = document.documentElement
  if (root) root.dataset['h5playerWebextMain'] = 'ready'

  const marker = installRuntimeMarker(window)
  if (marker === null) return () => undefined

  const authority = new MediaControlAuthority(window, document)
  authority.install()
  const experimentalDownload = new ExperimentalMediaDownloadManager(window, document)
  const replayGuard = new ReplayGuard(systemClock)
  let session: { sessionId: string; nonce: string; origin: string } | null = null
  let mediaRuntime: MediaPageRuntime | null = null
  let mediaStateSubscription: (() => void) | null = null
  let mediaDownloadSubscription: (() => void) | null = null
  let mediaFrameId = 0
  let stopped = false

  const publishDiagnostics = (): void => {
    if (root === null) return
    try {
      root.dataset['h5playerWebextPageDiagnostics'] = JSON.stringify({
        mediaRuntime: mediaRuntime?.diagnostics() ?? null,
        authority: authority.diagnosticsSummary(),
        session: session === null ? 'none' : 'ready'
      })
    } catch {
      // Diagnostics are best effort and must never affect page control.
    }
  }

  const teardown = (): void => {
    if (stopped) return
    stopped = true
    window.removeEventListener('message', onMessage)
    mediaRuntime?.teardown()
    mediaStateSubscription?.()
    mediaStateSubscription = null
    mediaDownloadSubscription?.()
    mediaDownloadSubscription = null
    mediaRuntime = null
    authority.teardown()
    experimentalDownload.teardown()
    session = null
    try {
      delete root?.dataset['h5playerWebextPageDiagnostics']
    } catch {
      // The page may have replaced the dataset implementation.
    }
    const descriptor = Object.getOwnPropertyDescriptor(window, RUNTIME_KEY)
    if (descriptor?.value === marker) {
      try {
        delete (window as unknown as Record<PropertyKey, unknown>)[RUNTIME_KEY]
      } catch {
        // A hostile page may make the marker non-configurable after startup.
      }
    }
  }

  const postLifecycle = (
    type: 'bridge.ready' | 'bridge.pong',
    requestId: string,
    activeSession: { sessionId: string; nonce: string; origin: string }
  ): void => {
    window.postMessage(
      createBridgeMessage(
        type,
        'page-main',
        activeSession.sessionId,
        activeSession.nonce,
        requestId
      ),
      activeSession.origin
    )
  }

  const postMedia = <T extends PageMediaResponseType>(
    type: T,
    requestId: string,
    payload: PageMediaPayloadByType[T],
    activeSession: { sessionId: string; nonce: string; origin: string }
  ): void => {
    try {
      const message = createPageMediaResponse(
        type,
        activeSession.sessionId,
        activeSession.nonce,
        payload,
        requestId
      )
      window.postMessage(message, activeSession.origin)
    } catch {
      // Invalid page data is contained at the page boundary.
    }
  }

  const postMediaError = (
    request: PageMediaMessage,
    code: 'INVALID_PAYLOAD' | 'RUNTIME_UNAVAILABLE' | 'INTERNAL_ERROR',
    messageKey: string
  ): void => {
    if (!session) return
    postMedia(
      'media.error',
      request.requestId,
      {
        requestType:
          request.type === 'media.context' ||
          request.type === 'media.configure-authority' ||
          request.type === 'media.configure-experimental' ||
          request.type === 'media.get-state' ||
          request.type === 'media.prepare-download' ||
          request.type === 'media.cancel-download' ||
          request.type === 'media.execute' ||
          request.type === 'media.execute-page-action'
            ? request.type
            : 'media.get-state',
        code,
        messageKey
      },
      session
    )
  }

  const postMediaStateChanged = (
    summary: MediaPageStateSummary,
    activeSession: { sessionId: string; nonce: string; origin: string }
  ): void => {
    try {
      window.postMessage(
        createPageMediaNotification(activeSession.sessionId, activeSession.nonce, summary),
        activeSession.origin
      )
    } catch {
      // Invalid page data is contained at the page boundary.
    }
  }

  const postMediaDownloadEvent = (
    event: Parameters<typeof createPageMediaDownloadNotification>[2],
    activeSession: { sessionId: string; nonce: string; origin: string }
  ): void => {
    try {
      window.postMessage(
        createPageMediaDownloadNotification(activeSession.sessionId, activeSession.nonce, event),
        activeSession.origin
      )
    } catch {
      // Invalid page data is contained at the page boundary.
    }
  }

  const handleMediaMessage = (message: PageMediaMessage): void => {
    if (!session) return
    const scope = `content:${session.sessionId}`
    if (!replayGuard.accept(scope, message.requestId)) return

    if (message.type === 'media.context') {
      if (mediaRuntime !== null && mediaFrameId !== message.payload.frameId) {
        mediaStateSubscription?.()
        mediaStateSubscription = null
        mediaDownloadSubscription?.()
        mediaDownloadSubscription = null
        mediaRuntime.teardown()
        mediaRuntime = null
      }
      try {
        mediaRuntime ??= new MediaPageRuntime(
          window,
          document,
          message.payload.frameId,
          Date.now,
          authority,
          message.payload.siteOrigin,
          experimentalDownload
        )
        mediaFrameId = message.payload.frameId
        if (mediaStateSubscription === null) {
          const runtime = mediaRuntime
          const subscribe = Reflect.get(runtime, 'subscribeStateChanged') as unknown
          if (typeof subscribe === 'function') {
            mediaStateSubscription = Reflect.apply(subscribe, runtime, [
              (summary: MediaPageStateSummary) => {
                publishDiagnostics()
                if (session) postMediaStateChanged(summary, session)
              }
            ]) as () => void
          }
        }
        if (mediaDownloadSubscription === null) {
          mediaDownloadSubscription = mediaRuntime.subscribeDownloadEvents((event) => {
            if (session) postMediaDownloadEvent(event, session)
          })
        }
        publishDiagnostics()
        postMedia('media.context-ready', message.requestId, {}, session)
      } catch {
        postMediaError(message, 'INTERNAL_ERROR', 'media.error.runtime-init')
      }
      return
    }

    if (message.type === 'media.configure-authority') {
      try {
        authority.configure(message.payload.policy)
        publishDiagnostics()
        postMedia(
          'media.authority-configured',
          message.requestId,
          { policy: message.payload.policy },
          session
        )
      } catch {
        postMediaError(message, 'INTERNAL_ERROR', 'media.error.authority-configure-failed')
      }
      return
    }

    if (message.type === 'media.configure-experimental') {
      try {
        // The isolated content runtime has already passed the background
        // experiment policy gate before this typed request reaches MAIN.
        experimentalDownload.configure(message.payload.policy.mediaDownload)
        mediaRuntime?.refresh()
        publishDiagnostics()
        postMedia(
          'media.experimental-configured',
          message.requestId,
          { policy: message.payload.policy },
          session
        )
      } catch {
        postMediaError(message, 'INTERNAL_ERROR', 'media.error.experimental-configure-failed')
      }
      return
    }

    if (mediaRuntime === null) {
      postMediaError(message, 'RUNTIME_UNAVAILABLE', 'media.error.runtime-unavailable')
      return
    }

    if (message.type === 'media.get-state') {
      try {
        postMedia('media.state', message.requestId, { state: mediaRuntime.getState() }, session)
      } catch {
        postMediaError(message, 'INTERNAL_ERROR', 'media.error.state-failed')
      }
      return
    }

    if (message.type === 'media.prepare-download') {
      void mediaRuntime
        .prepareDownload(message.payload.mediaId, message.payload.intentId)
        .then((preparation) => {
          if (session) {
            postMedia('media.download-prepared', message.requestId, { preparation }, session)
          }
        })
        .catch(() =>
          postMediaError(message, 'INTERNAL_ERROR', 'media.error.download-prepare-failed')
        )
      return
    }

    if (message.type === 'media.cancel-download') {
      try {
        postMedia(
          'media.download-cancelled',
          message.requestId,
          { cancelled: mediaRuntime.cancelDownload(message.payload.mediaId) },
          session
        )
      } catch {
        postMediaError(message, 'INTERNAL_ERROR', 'media.error.download-cancel-failed')
      }
      return
    }

    if (message.type === 'media.execute') {
      if (message.payload.command.type === 'media.download') {
        postMediaError(message, 'INVALID_PAYLOAD', 'media.error.download-route-required')
        return
      }
      void mediaRuntime
        .execute(message.payload.command)
        .then((response) => {
          publishDiagnostics()
          if (session) postMedia('media.command-result', message.requestId, response, session)
        })
        .catch(() => postMediaError(message, 'INTERNAL_ERROR', 'media.error.command-failed'))
      return
    }

    if (message.type === 'media.execute-page-action') {
      try {
        postMedia(
          'media.page-action-result',
          message.requestId,
          mediaRuntime.executePageAction(message.payload.action),
          session
        )
      } catch {
        postMediaError(message, 'INTERNAL_ERROR', 'media.error.page-action-failed')
      }
    }
  }

  const onMessage = (event: MessageEvent<unknown>): void => {
    if (stopped || event.source !== window || event.origin !== window.location.origin) return

    const lifecycle = parseBridgeMessage(event.data)
    if (lifecycle && lifecycle.source === 'content') {
      if (lifecycle.type === 'bridge.init') {
        if (
          session &&
          (session.sessionId !== lifecycle.sessionId || session.nonce !== lifecycle.nonce)
        ) {
          mediaStateSubscription?.()
          mediaStateSubscription = null
          mediaDownloadSubscription?.()
          mediaDownloadSubscription = null
          mediaRuntime?.teardown()
          mediaRuntime = null
          mediaFrameId = 0
          authority.configure(defaultMediaAuthorityPolicy())
          experimentalDownload.configure(false)
          session = null
          publishDiagnostics()
        }
        session ??= {
          sessionId: lifecycle.sessionId,
          nonce: lifecycle.nonce,
          origin: event.origin
        }
        if (!replayGuard.accept(`content:${session.sessionId}`, lifecycle.requestId)) return
        postLifecycle('bridge.ready', lifecycle.requestId, session)
        return
      }

      if (
        !session ||
        lifecycle.sessionId !== session.sessionId ||
        lifecycle.nonce !== session.nonce ||
        !replayGuard.accept(`content:${session.sessionId}`, lifecycle.requestId)
      ) {
        return
      }

      if (lifecycle.type === 'bridge.ping')
        postLifecycle('bridge.pong', lifecycle.requestId, session)
      if (lifecycle.type === 'bridge.dispose') teardown()
      return
    }

    const media = parsePageMediaMessage(event.data)
    if (
      !media ||
      media.source !== 'content' ||
      !session ||
      media.sessionId !== session.sessionId ||
      media.nonce !== session.nonce
    ) {
      return
    }
    handleMediaMessage(media)
  }

  window.addEventListener('message', onMessage)
  publishDiagnostics()
  return teardown
}
