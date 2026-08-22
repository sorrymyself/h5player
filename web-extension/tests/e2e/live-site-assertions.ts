export type LiveRect = Readonly<{
  x: number
  y: number
  width: number
  height: number
  right: number
  bottom: number
}>

export type VisualSlotCandidate = Readonly<{
  mediaId: string
  rect: LiveRect
}>

export type VisualUiCoverage = Readonly<{
  mediaCoverageRatio: number
  visibleMediaCoverageRatio: number
}>

export const LIVE_RATE_TOLERANCE = 0.011
export const LIVE_VISUAL_SLOT_IOU_THRESHOLD = 0.85

export type LivePageAccessSignal =
  | 'anti-bot'
  | 'app-only'
  | 'geo-restricted'
  | 'login-required'
  | 'service-unavailable'
  | 'unsupported-browser'

export function classifyPageAccessSignals(
  title: string,
  bodyText: string
): readonly LivePageAccessSignal[] {
  const sample = `${title}\n${bodyText}`.replace(/\s+/g, ' ').slice(0, 80_000)
  const signals = new Set<LivePageAccessSignal>()

  if (
    /(?:captcha|verify (?:that )?you are human|security verification|unusual traffic|click (?:the )?(?:images?|pictures?)|请在下图(?:依次)?点击|安全验证|人机验证|验证码|访问过于频繁)/i.test(
      sample
    )
  ) {
    signals.add('anti-bot')
  }
  if (
    /(?:open (?:it )?in (?:the )?app|continue in (?:the )?app|watch in (?:the )?app|打开\s*app|在\s*app\s*(?:内|中)|下载\s*app\s*(?:观看|打开)|客户端内打开)/i.test(
      sample
    )
  ) {
    signals.add('app-only')
  }
  if (
    /(?:not available in your (?:country|region|location)|unavailable in your (?:country|region|location)|geo(?:graphically)? restricted|地区限制|所在(?:国家|地区).{0,16}(?:无法|不能|不可)|仅限.{0,12}(?:国家|地区))/i.test(
      sample
    )
  ) {
    signals.add('geo-restricted')
  }
  if (
    /(?:sign in (?:or sign up )?to (?:watch|continue|view|play|listen)|log in to (?:watch|continue|view|play|listen|telegram|instagram|facebook|twitter)|log into (?:telegram|instagram|facebook|twitter)|login required|(?:登录|登入)\s*(?:instagram|facebook|twitter)|请先登录.{0,16}(?:观看|播放|继续|收听)|登录后.{0,16}(?:观看|播放|继续|收听)|注册或登录.{0,16}(?:观看|播放|收听))/i.test(
      sample
    )
  ) {
    signals.add('login-required')
  }
  if (
    /(?:service (?:has been )?(?:discontinued|shut down)|this site is no longer available|page (?:was )?not found|video (?:was )?(?:removed|unavailable)|服务已停止|网站已关闭|页面不存在|视频已下架|内容不存在)/i.test(
      sample
    )
  ) {
    signals.add('service-unavailable')
  }
  if (
    /(?:browser (?:is )?not supported|unsupported browser|please (?:use|upgrade).{0,24}browser|浏览器(?:版本)?不支持|请升级浏览器)/i.test(
      sample
    )
  ) {
    signals.add('unsupported-browser')
  }

  return [...signals].sort()
}

export function classifyExternalBlock(
  status: number | null,
  finalUrl: string,
  allowedHostnames: readonly string[] = []
): string | null {
  if (
    status !== null &&
    ([401, 403, 404, 406, 409, 410, 412, 418, 429, 451].includes(status) || status >= 500)
  ) {
    return `http-${status}`
  }
  if (/punish|captcha|challenge|verify/i.test(finalUrl)) return 'anti-bot-challenge'
  if (/\/(?:i\/flow\/login|login|signin)(?:[/?#]|$)/i.test(finalUrl)) {
    return 'login-required'
  }
  if (/passport\.weibo\.com\/visitor\//i.test(finalUrl)) return 'login-required'
  if (allowedHostnames.length > 0) {
    try {
      const hostname = new URL(finalUrl).hostname.toLowerCase()
      const allowed = allowedHostnames.some(
        (allowedHostname) =>
          hostname === allowedHostname || hostname.endsWith(`.${allowedHostname}`)
      )
      if (!allowed) return 'external-navigation'
    } catch {
      // about:blank and browser-internal URLs are handled as ordinary no-media pages.
    }
  }
  return null
}

export function finiteNumberOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function rateMatches(
  actual: number | null | undefined,
  expected: number,
  tolerance = LIVE_RATE_TOLERANCE
): boolean {
  const normalized = finiteNumberOrNull(actual)
  return normalized !== null && Math.abs(normalized - expected) <= tolerance
}

function rectArea(rect: LiveRect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height)
}

function unionArea(rects: readonly LiveRect[]): number {
  const valid = rects.filter((rect) => rect.width > 0 && rect.height > 0)
  if (valid.length === 0) return 0
  const xs = [...new Set(valid.flatMap((rect) => [rect.x, rect.right]))].sort(
    (left, right) => left - right
  )
  const ys = [...new Set(valid.flatMap((rect) => [rect.y, rect.bottom]))].sort(
    (top, bottom) => top - bottom
  )
  let area = 0
  for (let xIndex = 0; xIndex < xs.length - 1; xIndex += 1) {
    const left = xs[xIndex]
    const right = xs[xIndex + 1]
    if (left === undefined || right === undefined || right <= left) continue
    for (let yIndex = 0; yIndex < ys.length - 1; yIndex += 1) {
      const top = ys[yIndex]
      const bottom = ys[yIndex + 1]
      if (top === undefined || bottom === undefined || bottom <= top) continue
      const centerX = (left + right) / 2
      const centerY = (top + bottom) / 2
      if (
        valid.some(
          (rect) =>
            centerX >= rect.x &&
            centerX <= rect.right &&
            centerY >= rect.y &&
            centerY <= rect.bottom
        )
      ) {
        area += (right - left) * (bottom - top)
      }
    }
  }
  return area
}

export function visualUiCoverageRatios(
  mediaRect: LiveRect,
  visibleMediaRect: LiveRect | null,
  uiRects: readonly (LiveRect | null)[]
): VisualUiCoverage {
  const rects = uiRects.filter((rect): rect is LiveRect => rect !== null)
  const mediaArea = rectArea(mediaRect)
  const clippedRects = rects.flatMap((rect) => {
    const left = Math.max(rect.x, mediaRect.x)
    const top = Math.max(rect.y, mediaRect.y)
    const right = Math.min(rect.right, mediaRect.right)
    const bottom = Math.min(rect.bottom, mediaRect.bottom)
    return right > left && bottom > top
      ? [{ x: left, y: top, width: right - left, height: bottom - top, right, bottom }]
      : []
  })
  return {
    mediaCoverageRatio: mediaArea === 0 ? 0 : unionArea(clippedRects) / mediaArea,
    visibleMediaCoverageRatio:
      visibleMediaRect === null || rectArea(visibleMediaRect) === 0
        ? 0
        : unionArea(
            rects.flatMap((rect) => {
              const left = Math.max(rect.x, visibleMediaRect.x)
              const top = Math.max(rect.y, visibleMediaRect.y)
              const right = Math.min(rect.right, visibleMediaRect.right)
              const bottom = Math.min(rect.bottom, visibleMediaRect.bottom)
              return right > left && bottom > top
                ? [{ x: left, y: top, width: right - left, height: bottom - top, right, bottom }]
                : []
            })
          ) / rectArea(visibleMediaRect)
  }
}

function visualSlotOverlap(left: LiveRect, right: LiveRect): number {
  const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.x, right.x))
  const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.y, right.y))
  const intersection = width * height
  if (intersection <= 0) return 0
  const union = rectArea(left) + rectArea(right) - intersection
  return union <= 0 ? 0 : intersection / union
}

export function groupVisualSlotCandidates(
  candidates: readonly VisualSlotCandidate[],
  threshold = LIVE_VISUAL_SLOT_IOU_THRESHOLD
): readonly (readonly VisualSlotCandidate[])[] {
  const groups: VisualSlotCandidate[][] = []
  for (const candidate of candidates) {
    const overlapping = groups
      .map((group, index) =>
        group.some((item) => visualSlotOverlap(item.rect, candidate.rect) >= threshold) ? index : -1
      )
      .filter((index) => index >= 0)
    const firstIndex = overlapping[0]
    if (firstIndex === undefined) {
      groups.push([candidate])
      continue
    }
    const target = groups[firstIndex]
    if (target === undefined) continue
    target.push(candidate)
    for (const index of overlapping.slice(1).sort((left, right) => right - left)) {
      const merged = groups[index]
      if (merged === undefined) continue
      target.push(...merged)
      groups.splice(index, 1)
    }
  }
  return groups
}
