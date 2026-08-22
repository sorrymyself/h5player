import type { RuntimeRequestEnvelope } from '../../shared/protocol'
import { failure, success, type Result } from '../../shared/result'
import { viewportMediaSiteOriginForFrame } from '../../shared/viewport-media-surface'
import { normalizeSiteOrigin } from '../../domain/settings'

export type RuntimeSenderMetadata = {
  id?: string
  url?: string
  tabUrl?: string
  tabId?: number
  frameId?: number
}

export type AuthorizedSender = {
  scope: string
  tabId?: number
  frameId?: number
  sessionId?: string
  siteOrigin?: string
}

const allowedRequestTypes = {
  content: new Set([
    'protocol.cancel',
    'system.ping',
    'settings.get',
    'playback.set-site-intent',
    'site.set-page-ui-hidden',
    'site.report-frame-state',
    'experimental.ensure-main',
    'media.get-state',
    'media.execute',
    'media.picture-in-picture.presence',
    'media.picture-in-picture.get-state',
    'media.picture-in-picture.execute',
    'media.cross-tab.publish',
    'progress.read',
    'progress.save',
    'progress.delete',
    'progress.toggle-restore',
    'progress.prune'
  ]),
  popup: new Set([
    'protocol.cancel',
    'system.ping',
    'settings.get',
    'settings.update',
    'settings.reset',
    'site.get-context',
    'site.set-temporary-disabled',
    'site.set-page-ui-hidden',
    'site.reconcile',
    'diagnostics.get',
    'media.get-state',
    'media.execute'
  ]),
  options: new Set([
    'protocol.cancel',
    'system.ping',
    'settings.get',
    'settings.update',
    'settings.export',
    'settings.import',
    'settings.restore-backup',
    'settings.reset',
    'site.get-context',
    'site.set-temporary-disabled',
    'site.reconcile',
    'diagnostics.get'
  ])
} as const

function extensionPageMatches(source: 'popup' | 'options', urlValue: string | undefined): boolean {
  if (!urlValue) return false
  try {
    const url = new URL(urlValue)
    return (
      (url.protocol === 'chrome-extension:' || url.protocol === 'moz-extension:') &&
      url.pathname === `/${source}.html`
    )
  } catch {
    return false
  }
}

export function authorizeRuntimeSender(
  request: RuntimeRequestEnvelope,
  sender: RuntimeSenderMetadata,
  extensionId: string
): Result<AuthorizedSender, 'UNAUTHORIZED_SOURCE'> {
  if (sender.id !== extensionId || !allowedRequestTypes[request.source].has(request.type)) {
    return failure('UNAUTHORIZED_SOURCE')
  }

  if (request.tabId !== undefined && request.tabId !== sender.tabId) {
    return failure('UNAUTHORIZED_SOURCE')
  }
  if (request.frameId !== undefined && request.frameId !== sender.frameId) {
    return failure('UNAUTHORIZED_SOURCE')
  }
  if (request.nonce !== undefined) return failure('UNAUTHORIZED_SOURCE')

  if (request.source === 'content') {
    if (
      sender.tabId === undefined ||
      sender.frameId === undefined ||
      request.sessionId === undefined
    ) {
      return failure('UNAUTHORIZED_SOURCE')
    }
    const normalized = sender.url ? normalizeSiteOrigin(sender.url) : null
    const delegatedSiteOrigin =
      sender.url === undefined || sender.tabUrl === undefined
        ? null
        : viewportMediaSiteOriginForFrame(sender.url, sender.tabUrl)
    return success({
      scope: `content:${sender.tabId}:${sender.frameId}:${request.sessionId}`,
      tabId: sender.tabId,
      frameId: sender.frameId,
      sessionId: request.sessionId,
      ...(delegatedSiteOrigin !== null
        ? { siteOrigin: delegatedSiteOrigin }
        : normalized?.ok
          ? { siteOrigin: normalized.value }
          : {})
    })
  }

  if (
    request.tabId !== undefined ||
    request.frameId !== undefined ||
    request.sessionId !== undefined ||
    !extensionPageMatches(request.source, sender.url)
  ) {
    return failure('UNAUTHORIZED_SOURCE')
  }
  return success({
    scope: `${request.source}:${sender.url ?? ''}:${sender.tabId ?? 'extension'}:${sender.frameId ?? 0}`
  })
}
