export type ViewportMediaSurfaceKind = 'tencent-video-fake-element-frame'

export type ViewportMediaSurface = Readonly<{
  kind: ViewportMediaSurfaceKind
  width: number
  height: number
}>

export type ViewportMediaOverlayInsets = Readonly<{
  top: number
  right: number
  bottom: number
  left: number
}>

export type ViewportMediaSurfaceInput = Readonly<{
  url: string
  mediaKind: 'video' | 'audio'
  elementWidth: number
  elementHeight: number
  viewportWidth: number
  viewportHeight: number
}>

const TENCENT_FAKE_VIDEO_FRAME_PATH =
  /^\/thumbplayer\/txv\/wasm\/[^/]+\/fake-video-element-iframe\.html$/
const TENCENT_VIDEO_SITE_HOSTS = new Set(['v.qq.com', 'sports.qq.com'])
const TENCENT_VIDEO_OVERLAY_INSETS: ViewportMediaOverlayInsets = Object.freeze({
  top: 104,
  right: 8,
  bottom: 8,
  left: 8
})

function positiveFinite(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null
}

export function viewportMediaSurfaceKindForUrl(value: string): ViewportMediaSurfaceKind | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' &&
      url.hostname.toLowerCase() === 'vm.gtimg.cn' &&
      TENCENT_FAKE_VIDEO_FRAME_PATH.test(url.pathname)
      ? 'tencent-video-fake-element-frame'
      : null
  } catch {
    return null
  }
}

export function tencentVideoSiteOriginForUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && TENCENT_VIDEO_SITE_HOSTS.has(url.hostname.toLowerCase())
      ? url.origin.toLowerCase()
      : null
  } catch {
    return null
  }
}

export function resolveViewportMediaSurface(
  input: ViewportMediaSurfaceInput
): ViewportMediaSurface | null {
  const kind = viewportMediaSurfaceKindForUrl(input.url)
  if (kind === null || input.mediaKind !== 'video') return null
  if (positiveFinite(input.elementWidth) !== null || positiveFinite(input.elementHeight) !== null) {
    return null
  }
  const width = positiveFinite(input.viewportWidth)
  const height = positiveFinite(input.viewportHeight)
  if (width === null || height === null) return null
  return Object.freeze({ kind, width, height })
}

export function viewportMediaOverlayInsetsForUrl(value: string): ViewportMediaOverlayInsets | null {
  if (viewportMediaSurfaceKindForUrl(value) === 'tencent-video-fake-element-frame') {
    return TENCENT_VIDEO_OVERLAY_INSETS
  }
  try {
    return tencentVideoSiteOriginForUrl(value) !== null ? TENCENT_VIDEO_OVERLAY_INSETS : null
  } catch {
    return null
  }
}

export function viewportMediaSiteOriginForFrame(
  frameUrl: string,
  topLevelUrl: string
): string | null {
  if (viewportMediaSurfaceKindForUrl(frameUrl) === null) return null
  return tencentVideoSiteOriginForUrl(topLevelUrl)
}
