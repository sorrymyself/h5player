import { viewportMediaSurfaceKindForUrl } from '../../shared/viewport-media-surface'

export type TencentViewportMediaSurface = Readonly<{
  element: HTMLIFrameElement
  rect: DOMRectReadOnly
}>

export type TencentViewportMediaSurfaceOptions = Readonly<{
  expectedWidth: number
  expectedHeight: number
}>

type SurfaceCandidate = TencentViewportMediaSurface &
  Readonly<{
    dimensionError: number
    visibleArea: number
    order: number
  }>

function positiveFinite(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null
}

function visibleArea(rect: DOMRectReadOnly, view: Window): number {
  const width = Math.max(0, Math.min(rect.right, view.innerWidth) - Math.max(rect.left, 0))
  const height = Math.max(0, Math.min(rect.bottom, view.innerHeight) - Math.max(rect.top, 0))
  return width * height
}

function relativeDimensionError(
  rect: DOMRectReadOnly,
  options: TencentViewportMediaSurfaceOptions
): number {
  const expectedWidth = positiveFinite(options.expectedWidth)
  const expectedHeight = positiveFinite(options.expectedHeight)
  if (expectedWidth === null || expectedHeight === null) return 0
  return (
    Math.abs(rect.width - expectedWidth) / expectedWidth +
    Math.abs(rect.height - expectedHeight) / expectedHeight
  )
}

function openRoots(root: Document): readonly (Document | ShadowRoot)[] {
  const roots: Array<Document | ShadowRoot> = [root]
  for (let index = 0; index < roots.length; index += 1) {
    const current = roots[index]
    if (current === undefined) continue
    for (const element of current.querySelectorAll('*')) {
      if (element.shadowRoot !== null) roots.push(element.shadowRoot)
    }
  }
  return roots
}

/**
 * Finds the top-frame iframe that owns Tencent's synthetic media viewport.
 * The media id lives inside the cross-origin frame, so geometry and dimensions
 * are the only stable, non-invasive signals available to the top-frame UI.
 */
export function findTencentViewportMediaSurface(
  root: Document,
  options: TencentViewportMediaSurfaceOptions
): TencentViewportMediaSurface | null {
  const view = root.defaultView
  if (view === null) return null

  const frames = openRoots(root).flatMap((current) => [
    ...current.querySelectorAll<HTMLIFrameElement>('iframe')
  ])
  const candidates = frames.flatMap((element, order): readonly SurfaceCandidate[] => {
    if (
      !element.isConnected ||
      viewportMediaSurfaceKindForUrl(element.src) !== 'tencent-video-fake-element-frame'
    ) {
      return []
    }
    let rect: DOMRectReadOnly
    try {
      rect = element.getBoundingClientRect()
    } catch {
      return []
    }
    if (
      positiveFinite(rect.width) === null ||
      positiveFinite(rect.height) === null ||
      ![rect.top, rect.right, rect.bottom, rect.left].every(Number.isFinite)
    ) {
      return []
    }
    const area = visibleArea(rect, view)
    if (area <= 0) return []
    return [
      {
        element,
        rect,
        dimensionError: relativeDimensionError(rect, options),
        visibleArea: area,
        order
      }
    ]
  })

  const selected = candidates.sort((left, right) => {
    if (left.dimensionError !== right.dimensionError) {
      return left.dimensionError - right.dimensionError
    }
    if (left.visibleArea !== right.visibleArea) return right.visibleArea - left.visibleArea
    return left.order - right.order
  })[0]
  return selected === undefined ? null : { element: selected.element, rect: selected.rect }
}
