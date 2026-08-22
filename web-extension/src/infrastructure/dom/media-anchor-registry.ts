import type { MediaId } from '../../domain/media'
import { resolveViewportMediaSurface } from '../../shared/viewport-media-surface'
import { scanMediaTree } from './media-tree-scan'

export const MEDIA_ANCHOR_ATTRIBUTE = 'data-h5player-webext-media-id' as const

/**
 * A one-pixel sliver at the edge of a long scrolling feed is not a useful
 * visual anchor.  Keep a modest ratio requirement so controls do not mount on
 * the next/previous card while it is only barely visible.
 */
export const MIN_USABLE_MEDIA_ANCHOR_VISIBLE_RATIO = 0.1
export const MIN_USABLE_MEDIA_ANCHOR_VISIBLE_AREA = 2_048

export type MediaAnchorPlacement = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'
export type MediaAnchorSurface = 'element' | 'viewport-proxy'

export type MediaAnchor = Readonly<{
  mediaId: MediaId
  element: Element
  kind: 'video' | 'audio'
  surface: MediaAnchorSurface
  rect: DOMRectReadOnly | null
  placement: MediaAnchorPlacement
  compact: boolean
}>

export type MediaAnchorPoint = Readonly<{ x: number; y: number }>
export type MediaAnchorInsets = Readonly<{
  top: number
  right: number
  bottom: number
  left: number
}>

export type MediaAnchorRegistryOptions = Readonly<{
  root: Document
  onChanged?: (anchors: readonly MediaAnchor[]) => void
}>

export type MediaAnchorDiagnostics = Readonly<{
  anchors: number
  mutationObservers: number
  resizeObserver: boolean
  refreshQueued: boolean
}>

function viewportRect(width: number, height: number): DOMRectReadOnly {
  const value = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    width,
    height
  }
  return { ...value, toJSON: () => value }
}

function safeGeometry(
  element: HTMLMediaElement
): Readonly<{ rect: DOMRectReadOnly | null; surface: MediaAnchorSurface }> {
  try {
    const rect = element.getBoundingClientRect()
    if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) {
      return { rect: null, surface: 'element' }
    }
    if (rect.width > 0 && rect.height > 0) return { rect, surface: 'element' }
    const view = element.ownerDocument.defaultView
    const surface = resolveViewportMediaSurface({
      url: element.ownerDocument.URL,
      mediaKind: element.localName === 'audio' ? 'audio' : 'video',
      elementWidth: rect.width,
      elementHeight: rect.height,
      viewportWidth: view?.innerWidth ?? 0,
      viewportHeight: view?.innerHeight ?? 0
    })
    return surface === null
      ? { rect: null, surface: 'element' }
      : { rect: viewportRect(surface.width, surface.height), surface: 'viewport-proxy' }
  } catch {
    return { rect: null, surface: 'element' }
  }
}

function placementFor(rect: DOMRectReadOnly | null, view: Window | null): MediaAnchorPlacement {
  if (rect === null || view === null) return 'top-right'
  return rect.width >= 160 && rect.height >= 96 ? 'top-right' : 'top-left'
}

function isCompact(kind: MediaAnchor['kind'], rect: DOMRectReadOnly | null): boolean {
  return kind === 'audio' || rect === null || rect.width < 320 || rect.height < 180
}

export function mediaAnchorPoint(
  anchor: Pick<MediaAnchor, 'rect' | 'placement'>,
  view: Pick<Window, 'innerWidth' | 'innerHeight'>,
  edgeInset: number | Partial<MediaAnchorInsets> = 8
): MediaAnchorPoint | null {
  const rect = anchor.rect
  if (
    rect === null ||
    !Number.isFinite(view.innerWidth) ||
    !Number.isFinite(view.innerHeight) ||
    view.innerWidth <= 0 ||
    view.innerHeight <= 0
  ) {
    return null
  }
  const visibleLeft = Math.max(0, rect.left)
  const visibleRight = Math.min(view.innerWidth, rect.right)
  const visibleTop = Math.max(0, rect.top)
  const visibleBottom = Math.min(view.innerHeight, rect.bottom)
  if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) return null
  const insets: MediaAnchorInsets =
    typeof edgeInset === 'number'
      ? { top: edgeInset, right: edgeInset, bottom: edgeInset, left: edgeInset }
      : {
          top: edgeInset.top ?? 8,
          right: edgeInset.right ?? 8,
          bottom: edgeInset.bottom ?? 8,
          left: edgeInset.left ?? 8
        }
  if (
    !Object.values(insets).every((value) => Number.isFinite(value) && value >= 0) ||
    visibleTop + insets.top >= visibleBottom ||
    visibleLeft + insets.left >= visibleRight
  ) {
    return null
  }
  return {
    x: anchor.placement.endsWith('-right')
      ? visibleRight - insets.right
      : visibleLeft + insets.left,
    y: anchor.placement.startsWith('bottom-')
      ? visibleBottom - insets.bottom
      : visibleTop + insets.top
  }
}

export class MediaAnchorRegistry {
  private readonly anchors = new Map<MediaId, MediaAnchor>()
  private readonly mediaById = new Map<MediaId, HTMLMediaElement>()
  private readonly mutationObservers = new Map<Document | ShadowRoot, MutationObserver>()
  private resizeObserver: ResizeObserver | null = null
  private started = false
  private disposed = false
  private refreshQueued = false

  constructor(private readonly options: MediaAnchorRegistryOptions) {}

  start(): () => void {
    if (this.disposed) return () => undefined
    if (!this.started) {
      this.started = true
      const view = this.options.root.defaultView
      if (view?.ResizeObserver !== undefined) {
        this.resizeObserver = new view.ResizeObserver(() => this.queueRefresh())
      }
      this.options.root.addEventListener('scroll', this.handleViewportChange, true)
      view?.addEventListener('resize', this.handleViewportChange, true)
      this.options.root.addEventListener('fullscreenchange', this.handleViewportChange, true)
      this.refresh()
    }
    return () => this.teardown()
  }

  current(): readonly MediaAnchor[] {
    return [...this.anchors.values()]
  }

  resolve(mediaId: MediaId): MediaAnchor | null {
    return this.anchors.get(mediaId) ?? null
  }

  diagnostics(): MediaAnchorDiagnostics {
    return Object.freeze({
      anchors: this.anchors.size,
      mutationObservers: this.mutationObservers.size,
      resizeObserver: this.resizeObserver !== null,
      refreshQueued: this.refreshQueued
    })
  }

  refresh(): void {
    if (!this.started || this.disposed) return
    const scan = scanMediaTree(this.options.root)
    this.syncMutationObservers(scan.roots)
    const discoveredIds = new Set<MediaId>()

    for (const element of scan.media) {
      const mediaId = element.getAttribute(MEDIA_ANCHOR_ATTRIBUTE)
      if (!mediaId) continue
      discoveredIds.add(mediaId)
      const previousElement = this.mediaById.get(mediaId)
      if (previousElement !== element) {
        if (previousElement !== undefined) this.resizeObserver?.unobserve(previousElement)
        this.mediaById.set(mediaId, element)
        this.resizeObserver?.observe(element)
      }
      const kind = element.localName === 'audio' ? 'audio' : 'video'
      const geometry = safeGeometry(element)
      const rect = geometry.rect
      this.anchors.set(mediaId, {
        mediaId,
        element,
        kind,
        surface: geometry.surface,
        rect,
        placement: placementFor(rect, this.options.root.defaultView),
        compact: isCompact(kind, rect)
      })
    }

    for (const mediaId of [...this.anchors.keys()]) {
      if (discoveredIds.has(mediaId)) continue
      const element = this.mediaById.get(mediaId)
      if (element !== undefined) this.resizeObserver?.unobserve(element)
      this.mediaById.delete(mediaId)
      this.anchors.delete(mediaId)
    }
    this.options.onChanged?.(this.current())
  }

  teardown(): void {
    if (this.disposed) return
    this.disposed = true
    this.started = false
    this.options.root.removeEventListener('scroll', this.handleViewportChange, true)
    this.options.root.defaultView?.removeEventListener('resize', this.handleViewportChange, true)
    this.options.root.removeEventListener('fullscreenchange', this.handleViewportChange, true)
    for (const observer of this.mutationObservers.values()) observer.disconnect()
    this.mutationObservers.clear()
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.anchors.clear()
    this.mediaById.clear()
  }

  private readonly handleViewportChange: EventListener = () => this.queueRefresh()

  private queueRefresh(): void {
    if (this.refreshQueued || this.disposed) return
    this.refreshQueued = true
    void Promise.resolve().then(() => {
      this.refreshQueued = false
      this.refresh()
    })
  }

  private syncMutationObservers(roots: ReadonlySet<Document | ShadowRoot>): void {
    for (const [root, observer] of this.mutationObservers) {
      if (roots.has(root)) continue
      observer.disconnect()
      this.mutationObservers.delete(root)
    }
    const MutationObserverConstructor =
      this.options.root.defaultView?.MutationObserver ?? globalThis.MutationObserver
    for (const root of roots) {
      if (this.mutationObservers.has(root)) continue
      const observer = new MutationObserverConstructor(() => this.queueRefresh())
      observer.observe(root, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: [MEDIA_ANCHOR_ATTRIBUTE, 'class', 'height', 'hidden', 'style', 'width']
      })
      this.mutationObservers.set(root, observer)
    }
  }
}

export function isUsableMediaAnchor(anchor: MediaAnchor): boolean {
  const rect = anchor.rect
  const view = anchor.element.ownerDocument.defaultView
  if (
    rect === null ||
    view === null ||
    !anchor.element.isConnected ||
    rect.bottom <= 0 ||
    rect.right <= 0 ||
    rect.top >= view.innerHeight ||
    rect.left >= view.innerWidth
  ) {
    return false
  }

  const visibleWidth = Math.max(0, Math.min(view.innerWidth, rect.right) - Math.max(0, rect.left))
  const visibleHeight = Math.max(0, Math.min(view.innerHeight, rect.bottom) - Math.max(0, rect.top))
  const visibleArea = visibleWidth * visibleHeight
  const totalArea = Math.max(0, rect.width) * Math.max(0, rect.height)
  if (visibleArea < MIN_USABLE_MEDIA_ANCHOR_VISIBLE_AREA) return false
  return totalArea <= 0 || visibleArea / totalArea >= MIN_USABLE_MEDIA_ANCHOR_VISIBLE_RATIO
}
