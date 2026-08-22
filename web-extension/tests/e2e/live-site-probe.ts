import type { BrowserContext, Frame, Page, TestInfo } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  mediaCommandResultResponseSchema,
  mediaPageStateSchema,
  type MediaPageState
} from '../../src/application/media'
import {
  MIN_CONTENT_VIDEO_AREA,
  MIN_CONTENT_VIDEO_HEIGHT,
  MIN_CONTENT_VIDEO_WIDTH
} from '../../src/domain/playback'
import { MIN_FOREGROUND_MEDIA_OPACITY } from '../../src/domain/media'
import { createRuntimeRequest, parseRuntimeResponse } from '../../src/shared/protocol'
import { createTabRequest, parseTabResponse } from '../../src/shared/tab-protocol'
import {
  viewportMediaOverlayInsetsForUrl,
  viewportMediaSurfaceKindForUrl
} from '../../src/shared/viewport-media-surface'
import { launchExtensionHarness, type ExtensionHarness } from './extension-harness'
import { LIVE_SITE_DEFINITIONS, type LiveSiteDefinition } from './live-site-catalog'
import {
  classifyExternalBlock,
  classifyPageAccessSignals,
  finiteNumberOrNull,
  groupVisualSlotCandidates,
  rateMatches,
  visualUiCoverageRatios,
  type LivePageAccessSignal
} from './live-site-assertions'
import {
  canHostVisibleShadowUi,
  readFrameOrGlobalState,
  shadowProbeStatusForFrameFailure,
  type ShadowProbeStatus
} from './live-site-probe-guards'

const MEDIA_ID_ATTRIBUTE = 'data-h5player-webext-media-id'
const MEDIA_HOST_SELECTOR = '[data-h5p-ext-media-host="ready"]'
const PAGE_FEEDBACK_HOST_SELECTOR = '[data-h5p-ext-page-feedback-host="ready"]'
const TARGET_RATE = 1.5
const ANCHOR_TOLERANCE_PX = 12
const MIN_HITBOX_EXPANSION_PX = 20
const MAX_MEDIA_COVERAGE_RATIO = 0.2
const FEEDBACK_SETTLE_MS = 2_250
const VIEWPORT = { width: 1440, height: 900 } as const
const LIVE_RUN_ID =
  process.env['H5PLAYER_LIVE_RUN_ID'] ??
  new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
const ARTIFACT_ROOT = path.resolve(
  process.env['H5PLAYER_LIVE_ARTIFACT_DIR'] ?? path.join('test-results', 'live-sites', LIVE_RUN_ID)
)

type BrowserChannel = 'chromium' | 'chrome' | 'msedge'
type LiveOutcome = 'passed' | 'blocked' | 'no-media' | 'failed'

type Rect = Readonly<{
  x: number
  y: number
  width: number
  height: number
  right: number
  bottom: number
}>

type Point = Readonly<{ x: number; y: number }>

type PointerHitTarget = Readonly<{
  tag: string
  id: string | null
  className: string | null
  pointerEvents: string
  zIndex: string
  mediaHost: boolean
}>

type PointerHitProbe = Readonly<{
  top: PointerHitTarget | null
  frame: PointerHitTarget | null
}>

type ErrorFingerprint = Readonly<{
  name: string
  messageHash: string
}>

type NavigationAttempt = Readonly<{
  requestedUrl: string
  finalUrl: string
  status: number | null
  externalBlock: string | null
  mediaObserved: boolean
  runtimeFrameCount: number
  accessSignals: readonly LivePageAccessSignal[]
  error?: ErrorFingerprint
}>

type MediaProbe = Readonly<{
  kind: 'video' | 'audio'
  surface: 'element' | 'viewport-proxy'
  mediaId: string | null
  connected: boolean
  hidden: boolean
  documentVisibility: DocumentVisibilityState
  display: string
  visibility: string
  opacity: number | null
  rect: Rect
  visibleArea: number
  visibleRatio: number
  readyState: number
  paused: boolean
  muted: boolean
  playbackRate: number
  nativePlaybackRate: number | null
  nativePaused: boolean | null
  duration: number | null
  currentTime: number
  controls: boolean
}>

type HostProbe = Readonly<{
  mediaId: string | null
  placement: string | null
  anchorSurface: string | null
  rect: Rect
  position: string
  visibility: string
  cssLeft: number | null
  cssTop: number | null
  expectedLeft: number | null
  expectedTop: number | null
  anchorDistance: number | null
}>

type CollisionProbe = Readonly<{
  category: 'subtitle' | 'danmaku' | 'controls' | 'advertising'
  rect: Rect
}>

type FrameDomProbe = Readonly<{
  url: string
  viewport: Readonly<{ width: number; height: number }>
  runtime: Readonly<Record<string, string | null>>
  media: readonly MediaProbe[]
  hosts: readonly HostProbe[]
  viewportMediaSurfaces: readonly Rect[]
  pageFeedbackHostCount: number
  collisions: readonly CollisionProbe[]
}>

type ShadowElementKind = 'tools' | 'hitbox' | 'trigger' | 'panel' | 'feedback'

type ShadowElementProbe = Readonly<{
  kind: ShadowElementKind
  mediaId: string | null
  rect: Rect
  ariaExpanded: string | null
  pageFeedback: boolean
  hasFeedback: boolean
}>

type MediaUiAssessment = Readonly<{
  mediaId: string
  shadowProbeStatus: ShadowProbeStatus
  anchorDistance: number | null
  toolsRect: Rect | null
  hitboxRect: Rect | null
  triggerRect: Rect | null
  panelRect: Rect | null
  feedbackRect: Rect | null
  mediaCoverageRatio: number
  visibleMediaCoverageRatio: number
  toolsViewportOverflow: boolean
  triggerViewportOverflow: boolean
  feedbackViewportOverflow: boolean
  feedbackInsideVisibleMedia: boolean
  collisionCategories: readonly CollisionProbe['category'][]
}>

type FrameReport = Readonly<{
  frameIndex: number
  dom: FrameDomProbe
  shadowElements: readonly ShadowElementProbe[]
  assessments: readonly MediaUiAssessment[]
  shadowProbeStatus: ShadowProbeStatus
  shadowProbeError?: ErrorFingerprint
}>

type InstanceUiSlotProbe = Readonly<{
  mediaIds: readonly string[]
  hostMediaIds: readonly string[]
  triggerMediaIds: readonly string[]
}>

type InstanceUiMappingProbe = Readonly<{
  frameIndex: number
  shadowProbeStatus: ShadowProbeStatus
  eligibleMediaIds: readonly string[]
  slots: readonly InstanceUiSlotProbe[]
  orphanHostMediaIds: readonly (string | null)[]
  unassignedHostMediaIds: readonly (string | null)[]
  duplicateHostMediaIds: readonly string[]
  duplicateTriggerMediaIds: readonly string[]
}>

type BrowserEvent = Readonly<{
  source: 'console' | 'pageerror' | 'requestfailed'
  level: string
  valueHash: string
}>

export type LiveSiteReport = {
  schemaVersion: 3
  runId: string
  site: Readonly<{
    id: LiveSiteDefinition['id']
    label: string
    source: LiveSiteDefinition['source']
    profile: LiveSiteDefinition['profile']
  }>
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  environment: Readonly<{
    os: string
    architecture: string
    browserChannel: BrowserChannel
    browserVersion: string | null
    headless: boolean
    viewport: typeof VIEWPORT
    extensionFingerprint: string
    extensionVersion: string
  }>
  navigationAttempts: NavigationAttempt[]
  selectedUrl: string | null
  outcome: LiveOutcome
  frames: FrameReport[]
  interactions: Record<string, unknown>
  browserEvents: BrowserEvent[]
  screenshots: string[]
  warnings: string[]
  violations: string[]
  terminalPhase?: string
  fatalError?: ErrorFingerprint
}

type ProbedFrame = Readonly<{ frame: Frame; report: FrameReport }>

type SelectedMedia = Readonly<{
  frame: Frame
  frameIndex: number
  media: MediaProbe
}>

type ActiveMediaSnapshot = MediaPageState['media'][number]

type PlaybackRateStabilityObservation = Readonly<{
  durationMs: number
  sampleCount: number
  stable: boolean
  mediaIds: readonly string[]
  rates: readonly number[]
  firstFailure: Readonly<{
    mediaId: string | null
    rate: number | null
  }> | null
}>

type TencentRateEvidence = Readonly<{
  top: Readonly<{
    sessionRate: string | null
    playerTimeText: string | null
    speedItems: readonly Readonly<{
      value: string | null
      className: string
      ariaChecked: string | null
      ariaSelected: string | null
    }>[]
  }>
  fakeFrames: readonly Readonly<{
    url: string
    referrerOrigin: string | null
    ancestorOrigins: readonly string[]
    playbackRate: number | null
    currentTime: number | null
    paused: boolean | null
    candidates: readonly Readonly<{
      index: number
      connected: boolean
      playbackRate: number | null
      currentTime: number | null
      paused: boolean | null
      readyState: number | null
      duration: number | null
      rect: Rect
    }>[]
  }>[]
}>

type CdpNode = Readonly<{
  nodeId: number
  backendNodeId: number
  nodeName: string
  attributes?: readonly string[]
  children?: readonly CdpNode[]
  shadowRoots?: readonly CdpNode[]
}>

type LocatedShadowNode = Readonly<{
  node: CdpNode
  kind: ShadowElementKind
  mediaId: string | null
  ariaExpanded: string | null
  pageFeedback: boolean
  hasFeedback: boolean
}>

function numericEnvironmentValue(key: string, fallback: number): number {
  const parsed = Number(process.env[key] ?? '')
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function browserChannel(): BrowserChannel {
  const value = process.env['H5PLAYER_LIVE_CHANNEL']
  return value === 'chrome' || value === 'msedge' ? value : 'chromium'
}

function isHeadless(): boolean {
  return process.env['H5PLAYER_LIVE_HEADLESS'] !== '0'
}

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function errorFingerprint(error: unknown): ErrorFingerprint {
  if (error instanceof Error) {
    return { name: error.name, messageHash: hashValue(error.message) }
  }
  return { name: 'UnknownError', messageHash: hashValue(String(error)) }
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value)
    if (/punish|captcha|challenge|verify/i.test(url.pathname)) {
      return `${url.origin}/[challenge]`
    }
    return `${url.origin}${url.pathname}`.slice(0, 320)
  } catch {
    return '[invalid-url]'
  }
}

async function collectTencentRateEvidence(page: Page): Promise<TencentRateEvidence | null> {
  if (page.url() === '' || new URL(page.url()).hostname.toLowerCase() !== 'v.qq.com') return null
  const top = await page.evaluate(() => ({
    sessionRate: globalThis.sessionStorage.getItem('playbackRate'),
    playerTimeText: document.querySelector<HTMLElement>('.txp_time_current')?.textContent ?? null,
    speedItems: [...document.querySelectorAll<HTMLElement>('.txp_menuitem[data-value]')].map(
      (item) => ({
        value: item.getAttribute('data-value'),
        className: item.className,
        ariaChecked: item.getAttribute('aria-checked'),
        ariaSelected: item.getAttribute('aria-selected')
      })
    )
  }))
  const fakeFrames = await Promise.all(
    page
      .frames()
      .filter(
        (frame) =>
          viewportMediaSurfaceKindForUrl(frame.url()) === 'tencent-video-fake-element-frame'
      )
      .map(async (frame) => {
        const state = await frame.evaluate(() => {
          type FakeVideoProbeTarget = HTMLElement & {
            playbackRate?: unknown
            currentTime?: unknown
            paused?: unknown
            readyState?: unknown
            duration?: unknown
          }
          type FakeVideoProbeProperty =
            'playbackRate' | 'currentTime' | 'paused' | 'readyState' | 'duration'
          const safeRead = (target: FakeVideoProbeTarget, property: FakeVideoProbeProperty) => {
            try {
              return target[property]
            } catch {
              return undefined
            }
          }
          const finite = (value: unknown): number | null =>
            typeof value === 'number' && Number.isFinite(value) ? value : null
          const candidates = [...document.querySelectorAll<HTMLElement>('fake-video')].map(
            (element, index) => {
              const target = element as FakeVideoProbeTarget
              const rect = element.getBoundingClientRect()
              const paused = safeRead(target, 'paused')
              return {
                index,
                connected: element.isConnected,
                playbackRate: finite(safeRead(target, 'playbackRate')),
                currentTime: finite(safeRead(target, 'currentTime')),
                paused: typeof paused === 'boolean' ? paused : null,
                readyState: finite(safeRead(target, 'readyState')),
                duration: finite(safeRead(target, 'duration')),
                rect: {
                  x: rect.x,
                  y: rect.y,
                  width: rect.width,
                  height: rect.height,
                  right: rect.right,
                  bottom: rect.bottom
                }
              }
            }
          )
          const media = candidates.at(-1) ?? null
          const referrerOrigin = (() => {
            try {
              return document.referrer === '' ? null : new URL(document.referrer).origin
            } catch {
              return null
            }
          })()
          return {
            referrerOrigin,
            ancestorOrigins: Array.from(globalThis.location.ancestorOrigins),
            playbackRate: media?.playbackRate ?? null,
            currentTime: media?.currentTime ?? null,
            paused: media?.paused ?? null,
            candidates
          }
        })
        return { url: sanitizeUrl(frame.url()), ...state }
      })
  )
  return { top, fakeFrames }
}

function rounded(value: number, digits = 3): number {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function intersectionRect(left: Rect, right: Rect): Rect | null {
  const x = Math.max(left.x, right.x)
  const y = Math.max(left.y, right.y)
  const maxX = Math.min(left.right, right.right)
  const maxY = Math.min(left.bottom, right.bottom)
  if (maxX <= x || maxY <= y) return null
  return { x, y, width: maxX - x, height: maxY - y, right: maxX, bottom: maxY }
}

function intersects(left: Rect, right: Rect): boolean {
  return intersectionRect(left, right) !== null
}

function overflowsViewport(rect: Rect | null, viewport: FrameDomProbe['viewport']): boolean {
  return Boolean(
    rect !== null &&
    (rect.x < 0 || rect.y < 0 || rect.right > viewport.width || rect.bottom > viewport.height)
  )
}

function attributesOf(node: CdpNode): Readonly<Record<string, string>> {
  const entries: Array<[string, string]> = []
  const attributes = node.attributes ?? []
  for (let index = 0; index < attributes.length; index += 2) {
    const name = attributes[index]
    const value = attributes[index + 1]
    if (name !== undefined && value !== undefined) entries.push([name, value])
  }
  return Object.fromEntries(entries)
}

function shadowKind(attributes: Readonly<Record<string, string>>): ShadowElementKind | null {
  const classes = new Set((attributes['class'] ?? '').split(/\s+/).filter(Boolean))
  if (classes.has('media-tools')) return 'tools'
  if (classes.has('media-tools__trigger-hitbox')) return 'hitbox'
  if (classes.has('media-tools__trigger')) return 'trigger'
  if (classes.has('media-tools__panel')) return 'panel'
  if (classes.has('media-feedback')) return 'feedback'
  return null
}

function locateShadowNodes(root: CdpNode): readonly LocatedShadowNode[] {
  const located: LocatedShadowNode[] = []
  const visit = (node: CdpNode, shadowHost: Readonly<Record<string, string>> | null): void => {
    const attributes = attributesOf(node)
    const kind = shadowKind(attributes)
    if (kind !== null && shadowHost !== null) {
      const classes = new Set((attributes['class'] ?? '').split(/\s+/).filter(Boolean))
      located.push({
        node,
        kind,
        mediaId: shadowHost['data-media-id'] ?? null,
        ariaExpanded: attributes['aria-expanded'] ?? null,
        pageFeedback: shadowHost['data-h5p-ext-page-feedback-host'] === 'ready',
        hasFeedback: classes.has('has-feedback')
      })
    }
    for (const child of node.children ?? []) visit(child, shadowHost)
    for (const shadowRoot of node.shadowRoots ?? []) visit(shadowRoot, attributes)
  }
  visit(root, null)
  return located
}

function rectFromQuad(quad: readonly number[]): Rect | null {
  if (quad.length < 8) return null
  const xs = [quad[0], quad[2], quad[4], quad[6]].filter(
    (value): value is number => value !== undefined
  )
  const ys = [quad[1], quad[3], quad[5], quad[7]].filter(
    (value): value is number => value !== undefined
  )
  if (xs.length !== 4 || ys.length !== 4) return null
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  const right = Math.max(...xs)
  const bottom = Math.max(...ys)
  return {
    x: rounded(x),
    y: rounded(y),
    width: rounded(right - x),
    height: rounded(bottom - y),
    right: rounded(right),
    bottom: rounded(bottom)
  }
}

async function extensionEvidence(): Promise<Readonly<{ fingerprint: string; version: string }>> {
  const extensionPath = path.resolve('.output/chrome-mv3')
  const manifestText = await readFile(path.join(extensionPath, 'manifest.json'), 'utf8')
  const manifest = JSON.parse(manifestText) as { version?: unknown }
  const hash = createHash('sha256')
  for (const file of [
    'manifest.json',
    'background.js',
    'content-scripts/content.js',
    'content-scripts/page-main.js'
  ]) {
    hash.update(file)
    hash.update(await readFile(path.join(extensionPath, file)))
  }
  return {
    fingerprint: hash.digest('hex'),
    version: typeof manifest.version === 'string' ? manifest.version : 'unknown'
  }
}

async function probeFrameDom(frame: Frame): Promise<FrameDomProbe> {
  const viewportSurfaceKind = viewportMediaSurfaceKindForUrl(frame.url())
  const viewportOverlayInsets = viewportMediaOverlayInsetsForUrl(frame.url())
  return frame.evaluate(
    ({
      mediaIdAttribute,
      mediaHostSelector,
      pageFeedbackHostSelector,
      viewportSurfaceKind,
      viewportOverlayInsets
    }) => {
      type LocalRect = Rect
      const round = (value: number, digits = 3): number => {
        const scale = 10 ** digits
        return Math.round(value * scale) / scale
      }
      const viewport = { width: globalThis.innerWidth, height: globalThis.innerHeight }
      const viewportRect: LocalRect = {
        x: 0,
        y: 0,
        width: viewport.width,
        height: viewport.height,
        right: viewport.width,
        bottom: viewport.height
      }
      const roots: Array<Document | ShadowRoot> = [document]
      for (let index = 0; index < roots.length; index += 1) {
        const root = roots[index]
        if (root === undefined) continue
        for (const element of root.querySelectorAll('*')) {
          if (element.shadowRoot !== null) roots.push(element.shadowRoot)
        }
      }
      const selectAll = <ElementType extends Element>(selector: string): ElementType[] => {
        const values: ElementType[] = []
        for (const root of roots) values.push(...root.querySelectorAll<ElementType>(selector))
        return values
      }
      const rectFor = (element: Element): LocalRect => {
        const rect = element.getBoundingClientRect()
        return {
          x: round(rect.x),
          y: round(rect.y),
          width: round(rect.width),
          height: round(rect.height),
          right: round(rect.right),
          bottom: round(rect.bottom)
        }
      }
      const intersection = (left: LocalRect, right: LocalRect): LocalRect | null => {
        const x = Math.max(left.x, right.x)
        const y = Math.max(left.y, right.y)
        const maxX = Math.min(left.right, right.right)
        const maxY = Math.min(left.bottom, right.bottom)
        if (maxX <= x || maxY <= y) return null
        return { x, y, width: maxX - x, height: maxY - y, right: maxX, bottom: maxY }
      }
      const area = (rect: LocalRect | null): number =>
        rect === null ? 0 : Math.max(0, rect.width) * Math.max(0, rect.height)

      const elementMedia = selectAll<HTMLMediaElement>('video,audio').map((element): MediaProbe => {
        const kind = element.localName === 'audio' ? 'audio' : 'video'
        const elementRect = rectFor(element)
        const useViewportProxy =
          viewportSurfaceKind !== null &&
          kind === 'video' &&
          elementRect.width <= 0 &&
          elementRect.height <= 0 &&
          viewport.width > 0 &&
          viewport.height > 0
        const rect = useViewportProxy ? viewportRect : elementRect
        const style = getComputedStyle(element)
        const nativePlaybackRate = (() => {
          try {
            // eslint-disable-next-line @typescript-eslint/unbound-method -- Invoked with an explicit media receiver below.
            const getter = Object.getOwnPropertyDescriptor(
              HTMLMediaElement.prototype,
              'playbackRate'
            )?.get
            const value = getter?.call(element) as unknown
            return typeof value === 'number' && Number.isFinite(value) ? value : null
          } catch {
            return null
          }
        })()
        const nativePaused = (() => {
          try {
            // eslint-disable-next-line @typescript-eslint/unbound-method -- Invoked with an explicit media receiver below.
            const getter = Object.getOwnPropertyDescriptor(
              HTMLMediaElement.prototype,
              'paused'
            )?.get
            const value = getter?.call(element) as unknown
            return typeof value === 'boolean' ? value : null
          } catch {
            return null
          }
        })()
        const visibleArea = useViewportProxy
          ? area(viewportRect)
          : style.display === 'none' ||
              style.visibility === 'hidden' ||
              Number.parseFloat(style.opacity || '1') <= 0.01
            ? 0
            : area(intersection(rect, viewportRect))
        const ownArea = area(rect)
        return {
          kind,
          surface: useViewportProxy ? 'viewport-proxy' : 'element',
          mediaId: element.getAttribute(mediaIdAttribute),
          connected: element.isConnected,
          hidden: element.hidden,
          documentVisibility: document.visibilityState,
          display: style.display,
          visibility: style.visibility,
          opacity: Number.isFinite(Number.parseFloat(style.opacity || '1'))
            ? Number.parseFloat(style.opacity || '1')
            : null,
          rect,
          visibleArea: round(visibleArea),
          visibleRatio: ownArea > 0 ? round(visibleArea / ownArea, 4) : 0,
          readyState: element.readyState,
          paused: element.paused,
          muted: element.muted,
          playbackRate: element.playbackRate,
          nativePlaybackRate,
          nativePaused,
          duration: Number.isFinite(element.duration) ? element.duration : null,
          currentTime: element.currentTime,
          controls: element.controls
        }
      })
      const mediaById = new Map(
        elementMedia
          .filter((item): item is MediaProbe & { mediaId: string } => item.mediaId !== null)
          .map((item) => [item.mediaId, item])
      )
      const viewportMediaSurfaces = selectAll<HTMLIFrameElement>('iframe')
        .filter((element) => {
          try {
            const url = new URL(element.src)
            return (
              url.protocol === 'https:' &&
              url.hostname.toLowerCase() === 'vm.gtimg.cn' &&
              /^\/thumbplayer\/txv\/wasm\/[^/]+\/fake-video-element-iframe\.html$/.test(
                url.pathname
              )
            )
          } catch {
            return false
          }
        })
        .map(rectFor)
        .filter((rect) => rect.width > 0 && rect.height > 0 && intersection(rect, viewportRect))
        .sort((left, right) => area(right) - area(left))
      const hosts = selectAll<HTMLElement>(mediaHostSelector).map((element): HostProbe => {
        const mediaId = element.dataset['mediaId'] ?? null
        const placement = element.dataset['placement'] ?? null
        const anchorSurface = element.dataset['anchorSurface'] ?? null
        const style = getComputedStyle(element)
        const parsedLeft = Number.parseFloat(style.getPropertyValue('--h5-media-host-left'))
        const parsedTop = Number.parseFloat(style.getPropertyValue('--h5-media-host-top'))
        const cssLeft = Number.isFinite(parsedLeft) ? parsedLeft : null
        const cssTop = Number.isFinite(parsedTop) ? parsedTop : null
        const mediaItem = mediaId === null ? undefined : mediaById.get(mediaId)
        const routedSurface =
          mediaItem === undefined && anchorSurface === 'viewport-proxy'
            ? viewportMediaSurfaces[0]
            : undefined
        const anchorRect = mediaItem?.rect ?? routedSurface
        const visibleMediaRect =
          anchorRect === undefined ? null : intersection(anchorRect, viewportRect)
        let expectedLeft: number | null = null
        let expectedTop: number | null = null
        if (visibleMediaRect !== null && placement !== null) {
          const insets = viewportOverlayInsets ?? { top: 8, right: 8, bottom: 8, left: 8 }
          expectedLeft = placement.endsWith('-right')
            ? visibleMediaRect.right - insets.right
            : visibleMediaRect.x + insets.left
          expectedTop = placement.startsWith('bottom-')
            ? visibleMediaRect.bottom - insets.bottom
            : visibleMediaRect.y + insets.top
        }
        return {
          mediaId,
          placement,
          anchorSurface,
          rect: rectFor(element),
          position: style.position,
          visibility: style.visibility,
          cssLeft,
          cssTop,
          expectedLeft: expectedLeft === null ? null : round(expectedLeft),
          expectedTop: expectedTop === null ? null : round(expectedTop),
          anchorDistance:
            cssLeft === null || cssTop === null || expectedLeft === null || expectedTop === null
              ? null
              : round(Math.max(Math.abs(cssLeft - expectedLeft), Math.abs(cssTop - expectedTop)))
        }
      })
      const virtualMediaIds = new Set<string>()
      const virtualMedia = hosts.flatMap((host): MediaProbe[] => {
        if (
          host.mediaId === null ||
          host.anchorSurface !== 'viewport-proxy' ||
          mediaById.has(host.mediaId) ||
          virtualMediaIds.has(host.mediaId)
        ) {
          return []
        }
        const surface = viewportMediaSurfaces[0]
        if (surface === undefined) return []
        virtualMediaIds.add(host.mediaId)
        const visibleRect =
          host.visibility === 'hidden' ? null : intersection(surface, viewportRect)
        const visibleArea = area(visibleRect)
        const surfaceArea = area(surface)
        return [
          {
            kind: 'video',
            surface: 'viewport-proxy',
            mediaId: host.mediaId,
            connected: true,
            hidden: false,
            documentVisibility: document.visibilityState,
            display: 'block',
            visibility: host.visibility,
            opacity: 1,
            rect: surface,
            visibleArea: round(visibleArea),
            visibleRatio: surfaceArea > 0 ? round(visibleArea / surfaceArea, 4) : 0,
            readyState: 4,
            paused: false,
            muted: true,
            playbackRate: 1,
            nativePlaybackRate: null,
            nativePaused: null,
            duration: null,
            currentTime: 0,
            controls: false
          }
        ]
      })
      const media = [...elementMedia, ...virtualMedia]
      const collisionSelectors = [
        [
          'subtitle',
          '[class*="subtitle" i], [class*="caption" i], [aria-label*="subtitle" i], [aria-label*="字幕" i]'
        ],
        ['danmaku', '[class*="danmaku" i], [class*="danmu" i]'],
        ['controls', '[class*="control" i], [class*="toolbar" i], [role="toolbar"]'],
        ['advertising', '[class*="advert" i], [class*="ad-" i], [id*="ad-" i]']
      ] as const
      const collisionElements = new Map<Element, CollisionProbe['category']>()
      for (const [category, selector] of collisionSelectors) {
        try {
          for (const element of selectAll(selector)) {
            if (!collisionElements.has(element)) collisionElements.set(element, category)
          }
        } catch {
          // Site selector parsing must not abort the probe.
        }
      }
      const collisions = [...collisionElements.entries()]
        .map(([element, category]): CollisionProbe | null => {
          const rect = rectFor(element)
          const style = getComputedStyle(element)
          const visibleRect = intersection(rect, viewportRect)
          const visibleArea = area(visibleRect)
          const viewportArea = area(viewportRect)
          if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            Number.parseFloat(style.opacity || '1') <= 0.01 ||
            visibleArea < 16 ||
            (category !== 'advertising' && viewportArea > 0 && visibleArea / viewportArea > 0.35)
          ) {
            return null
          }
          return { category, rect }
        })
        .filter((value): value is CollisionProbe => value !== null)
        .slice(0, 80)

      return {
        url: `${location.origin}${location.pathname}`,
        viewport,
        runtime: Object.fromEntries(
          [
            'data-h5player-webext-content',
            'data-h5player-webext-main',
            'data-h5player-webext-bridge',
            'data-h5player-webext-background',
            'data-h5player-webext-media'
          ].map((name) => [name, document.documentElement.getAttribute(name)])
        ),
        media,
        hosts,
        viewportMediaSurfaces,
        pageFeedbackHostCount: selectAll(pageFeedbackHostSelector).length,
        collisions
      }
    },
    {
      mediaIdAttribute: MEDIA_ID_ATTRIBUTE,
      mediaHostSelector: MEDIA_HOST_SELECTOR,
      pageFeedbackHostSelector: PAGE_FEEDBACK_HOST_SELECTOR,
      viewportSurfaceKind,
      viewportOverlayInsets
    }
  )
}

async function probeClosedShadowUi(
  context: BrowserContext,
  frame: Frame,
  viewport?: FrameDomProbe['viewport']
): Promise<
  Readonly<{
    elements: readonly ShadowElementProbe[]
    status: ShadowProbeStatus
    error?: ErrorFingerprint
  }>
> {
  if (viewport !== undefined && !canHostVisibleShadowUi(viewport)) {
    return { elements: [], status: 'available' }
  }
  let session: Awaited<ReturnType<BrowserContext['newCDPSession']>> | null = null
  try {
    session = await context.newCDPSession(frame)
    const documentResult = (await session.send('DOM.getDocument', {
      depth: -1,
      pierce: true
    })) as unknown as { root: CdpNode }
    const elements: ShadowElementProbe[] = []
    for (const located of locateShadowNodes(documentResult.root)) {
      try {
        const box = (await session.send('DOM.getBoxModel', {
          nodeId: located.node.nodeId
        })) as unknown as { model: { border: readonly number[] } }
        const rect = rectFromQuad(box.model.border)
        if (rect === null) continue
        elements.push({
          kind: located.kind,
          mediaId: located.mediaId,
          rect,
          ariaExpanded: located.ariaExpanded,
          pageFeedback: located.pageFeedback,
          hasFeedback: located.hasFeedback
        })
      } catch {
        // Vue v-if nodes can disappear between document capture and box lookup.
      }
    }
    return { elements, status: 'available' }
  } catch (error) {
    return {
      elements: [],
      status: shadowProbeStatusForFrameFailure(error, frame.parentFrame() !== null),
      error: errorFingerprint(error)
    }
  } finally {
    await session?.detach().catch(() => undefined)
  }
}

function deriveAssessments(
  dom: FrameDomProbe,
  shadowElements: readonly ShadowElementProbe[],
  shadowProbeStatus: ShadowProbeStatus = 'available'
): readonly MediaUiAssessment[] {
  const viewportRect: Rect = {
    x: 0,
    y: 0,
    width: dom.viewport.width,
    height: dom.viewport.height,
    right: dom.viewport.width,
    bottom: dom.viewport.height
  }
  const mediaIds = new Set<string>([
    ...dom.media.flatMap((media) => (media.mediaId === null ? [] : [media.mediaId])),
    ...dom.hosts.flatMap((host) => (host.mediaId === null ? [] : [host.mediaId])),
    ...shadowElements.flatMap((element) => (element.mediaId === null ? [] : [element.mediaId]))
  ])
  return [...mediaIds].map((mediaId): MediaUiAssessment => {
    const media = dom.media.find((item) => item.mediaId === mediaId)
    const host = dom.hosts.find((item) => item.mediaId === mediaId)
    const elements = shadowElements.filter((item) => item.mediaId === mediaId)
    const toolsRect = elements.find((item) => item.kind === 'tools')?.rect ?? null
    const hitboxRect = elements.find((item) => item.kind === 'hitbox')?.rect ?? null
    const triggerRect = elements.find((item) => item.kind === 'trigger')?.rect ?? null
    const panelRect = elements.find((item) => item.kind === 'panel')?.rect ?? null
    const feedbackRect =
      elements.find((item) => item.kind === 'feedback')?.rect ??
      (elements.some((item) => item.kind === 'tools' && item.hasFeedback) ? triggerRect : null)
    const mediaRect =
      media?.rect ??
      (host?.anchorSurface === 'viewport-proxy' ? dom.viewportMediaSurfaces[0] : undefined) ??
      viewportRect
    const visibleMediaRect = intersectionRect(mediaRect, viewportRect)
    const coverage = visualUiCoverageRatios(mediaRect, visibleMediaRect, [
      triggerRect,
      panelRect,
      feedbackRect
    ])
    const collisionCategories = [
      ...new Set(
        dom.collisions
          .filter((candidate) => toolsRect !== null && intersects(candidate.rect, toolsRect))
          .map((candidate) => candidate.category)
      )
    ]
    return {
      mediaId,
      shadowProbeStatus,
      anchorDistance: host?.anchorDistance ?? null,
      toolsRect,
      hitboxRect,
      triggerRect,
      panelRect,
      feedbackRect,
      mediaCoverageRatio: rounded(coverage.mediaCoverageRatio, 4),
      visibleMediaCoverageRatio: rounded(coverage.visibleMediaCoverageRatio, 4),
      toolsViewportOverflow: overflowsViewport(toolsRect, dom.viewport),
      triggerViewportOverflow: overflowsViewport(triggerRect, dom.viewport),
      feedbackViewportOverflow: overflowsViewport(feedbackRect, dom.viewport),
      feedbackInsideVisibleMedia:
        feedbackRect !== null &&
        visibleMediaRect !== null &&
        intersectionRect(feedbackRect, visibleMediaRect) !== null,
      collisionCategories
    }
  })
}

function duplicateIds(values: readonly string[]): readonly string[] {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort()
}

function isContentVideoProbe(media: MediaProbe): media is MediaProbe & { mediaId: string } {
  return Boolean(
    media.kind === 'video' &&
    media.mediaId !== null &&
    (media.surface === 'element' || media.mediaId.endsWith('-tencent-viewport')) &&
    (media.opacity ?? 1) >= MIN_FOREGROUND_MEDIA_OPACITY &&
    media.visibleArea >= MIN_CONTENT_VIDEO_AREA &&
    media.rect.width >= MIN_CONTENT_VIDEO_WIDTH &&
    media.rect.height >= MIN_CONTENT_VIDEO_HEIGHT
  )
}

function instanceUiMapping(frame: FrameReport): InstanceUiMappingProbe {
  const eligibleMedia = frame.dom.media.filter(isContentVideoProbe)
  const eligibleMediaIds = eligibleMedia.map((media) => media.mediaId)
  const eligibleIdSet = new Set(eligibleMediaIds)
  const allMediaIds = new Set(
    frame.dom.media
      .map((media) => media.mediaId)
      .filter((mediaId): mediaId is string => mediaId !== null)
  )
  const visibleHosts = frame.dom.hosts.filter((host) => host.visibility !== 'hidden')
  const triggers = frame.shadowElements.filter((element) => element.kind === 'trigger')
  const slots = groupVisualSlotCandidates(
    eligibleMedia.map((media) => ({ mediaId: media.mediaId, rect: media.rect }))
  ).map((slot): InstanceUiSlotProbe => {
    const mediaIds = slot.map((item) => item.mediaId)
    const slotIds = new Set(mediaIds)
    return {
      mediaIds,
      hostMediaIds: visibleHosts
        .map((host) => host.mediaId)
        .filter((mediaId): mediaId is string => mediaId !== null && slotIds.has(mediaId)),
      triggerMediaIds: triggers
        .map((trigger) => trigger.mediaId)
        .filter((mediaId): mediaId is string => mediaId !== null && slotIds.has(mediaId))
    }
  })
  const hostIds = visibleHosts
    .map((host) => host.mediaId)
    .filter((mediaId): mediaId is string => mediaId !== null)
  const triggerIds = triggers
    .map((trigger) => trigger.mediaId)
    .filter((mediaId): mediaId is string => mediaId !== null)
  return {
    frameIndex: frame.frameIndex,
    shadowProbeStatus: frame.shadowProbeStatus,
    eligibleMediaIds,
    slots,
    orphanHostMediaIds: visibleHosts
      .map((host) => host.mediaId)
      .filter((mediaId) => mediaId === null || !allMediaIds.has(mediaId)),
    unassignedHostMediaIds: visibleHosts
      .map((host) => host.mediaId)
      .filter((mediaId) => mediaId === null || !eligibleIdSet.has(mediaId)),
    duplicateHostMediaIds: duplicateIds(hostIds),
    duplicateTriggerMediaIds: duplicateIds(triggerIds)
  }
}

async function probeFrame(
  context: BrowserContext,
  frame: Frame,
  frameIndex: number
): Promise<ProbedFrame> {
  const dom = await probeFrameDom(frame)
  const shadow = await probeClosedShadowUi(context, frame, dom.viewport)
  return {
    frame,
    report: {
      frameIndex,
      dom: { ...dom, url: sanitizeUrl(dom.url) },
      shadowElements: shadow.elements,
      assessments: deriveAssessments(dom, shadow.elements, shadow.status),
      shadowProbeStatus: shadow.status,
      ...(shadow.error === undefined ? {} : { shadowProbeError: shadow.error })
    }
  }
}

async function probeAllFrames(
  context: BrowserContext,
  page: Page
): Promise<readonly ProbedFrame[]> {
  const reports: ProbedFrame[] = []
  const frames = page.frames()
  for (const [frameIndex, frame] of frames.entries()) {
    try {
      reports.push(await probeFrame(context, frame, frameIndex))
    } catch (error) {
      reports.push({
        frame,
        report: {
          frameIndex,
          dom: {
            url: sanitizeUrl(frame.url()),
            viewport: { width: 0, height: 0 },
            runtime: {},
            media: [],
            hosts: [],
            viewportMediaSurfaces: [],
            pageFeedbackHostCount: 0,
            collisions: []
          },
          shadowElements: [],
          assessments: [],
          shadowProbeStatus: shadowProbeStatusForFrameFailure(error, frame.parentFrame() !== null),
          shadowProbeError: errorFingerprint(error)
        }
      })
    }
  }
  return reports
}

async function quickSignals(
  page: Page
): Promise<Readonly<{ mediaCount: number; runtimeFrames: number }>> {
  let mediaCount = 0
  let runtimeFrames = 0
  for (const frame of page.frames()) {
    try {
      const signal = await frame.evaluate(() => {
        const roots: Array<Document | ShadowRoot> = [document]
        for (let index = 0; index < roots.length; index += 1) {
          const root = roots[index]
          if (root === undefined) continue
          for (const element of root.querySelectorAll('*')) {
            if (element.shadowRoot !== null) roots.push(element.shadowRoot)
          }
        }
        return {
          mediaCount: roots.reduce(
            (count, root) => count + root.querySelectorAll('video,audio').length,
            0
          ),
          runtimeReady:
            document.documentElement.getAttribute('data-h5player-webext-media') === 'ready'
        }
      })
      mediaCount += signal.mediaCount
      if (signal.runtimeReady) runtimeFrames += 1
    } catch {
      // Detached and restricted frames are represented by the remaining signals.
    }
  }
  return { mediaCount, runtimeFrames }
}

async function waitForMedia(page: Page, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  do {
    if ((await quickSignals(page)).mediaCount > 0) return true
    await page.waitForTimeout(500)
  } while (Date.now() < deadline)
  return false
}

async function attemptSitePlay(page: Page, selectors: readonly string[]): Promise<void> {
  for (const frame of page.frames()) {
    for (const selector of selectors) {
      try {
        const target = frame.locator(selector).first()
        if ((await target.count()) === 0 || !(await target.isVisible())) continue
        await target.click({ timeout: 2_000 })
        return
      } catch {
        // Try the next known player control.
      }
    }
  }
}

function hostnamesForSite(site: LiveSiteDefinition): readonly string[] {
  const hostnames = new Set<string>(site.allowedHostnames ?? [])
  for (const candidate of urlsForSite(site)) {
    try {
      const hostname = new URL(candidate).hostname.toLowerCase()
      if (hostname.length === 0) continue
      hostnames.add(hostname)
      const labels = hostname.split('.').filter(Boolean)
      if (labels.length >= 2) {
        hostnames.add(labels.slice(-2).join('.'))
      }
    } catch {
      // Invalid overrides are ignored by urlsForSite and do not widen the allow-list.
    }
  }
  return [...hostnames]
}

async function pageAccessSignals(page: Page): Promise<readonly LivePageAccessSignal[]> {
  const [title, bodyText] = await Promise.all([
    page.title().catch(() => ''),
    page
      .locator('body')
      .innerText({ timeout: 2_000 })
      .then((value) => value.slice(0, 80_000))
      .catch(() => '')
  ])
  return classifyPageAccessSignals(title, bodyText)
}

function urlsForSite(site: LiveSiteDefinition): readonly string[] {
  const override = process.env[site.urlEnvironmentKey]
  return override && /^https?:\/\//.test(override) ? [override] : site.urls
}

async function navigateToMedia(
  page: Page,
  site: LiveSiteDefinition,
  attempts: NavigationAttempt[]
): Promise<string | null> {
  const navigationTimeoutMs = numericEnvironmentValue('H5PLAYER_LIVE_NAV_TIMEOUT_MS', 60_000)
  const mediaWaitMs = numericEnvironmentValue('H5PLAYER_LIVE_MEDIA_WAIT_MS', 20_000)
  const allowedHostnames = hostnamesForSite(site)
  for (const candidate of urlsForSite(site)) {
    let status: number | null = null
    let navigationError: ErrorFingerprint | undefined
    try {
      const response = await page.goto(candidate, {
        waitUntil: 'domcontentloaded',
        timeout: navigationTimeoutMs
      })
      status = response?.status() ?? null
    } catch (error) {
      navigationError = errorFingerprint(error)
    }
    const finalUrl = page.url()
    let externalBlock = classifyExternalBlock(status, finalUrl, allowedHostnames)
    let mediaObserved = false
    if (externalBlock === null) {
      mediaObserved = await waitForMedia(page, Math.min(4_000, mediaWaitMs))
      if (!mediaObserved) {
        await attemptSitePlay(page, site.playSelectors)
        mediaObserved = await waitForMedia(page, Math.max(1_000, mediaWaitMs - 4_000))
      }
    }
    const signals = await quickSignals(page)
    const accessSignals = await pageAccessSignals(page)
    const hardAccessSignal = accessSignals.find(
      (signal) =>
        signal === 'anti-bot' ||
        signal === 'geo-restricted' ||
        signal === 'service-unavailable' ||
        signal === 'unsupported-browser'
    )
    if (externalBlock === null && hardAccessSignal !== undefined) {
      externalBlock = `page-${hardAccessSignal}`
    }
    if (!mediaObserved && externalBlock === null) {
      externalBlock =
        accessSignals[0] === undefined
          ? navigationError === undefined
            ? null
            : 'navigation-error'
          : `page-${accessSignals[0]}`
    }
    attempts.push({
      requestedUrl: sanitizeUrl(candidate),
      finalUrl: sanitizeUrl(finalUrl),
      status,
      externalBlock,
      mediaObserved,
      runtimeFrameCount: signals.runtimeFrames,
      accessSignals,
      ...(navigationError === undefined ? {} : { error: navigationError })
    })
    if (mediaObserved && externalBlock === null) return candidate
  }
  return null
}

function chooseMedia(
  frames: readonly ProbedFrame[],
  preferredMediaId: string | null = null
): SelectedMedia | null {
  const candidates = frames.flatMap(({ frame, report }) =>
    report.dom.media
      .filter(isContentVideoProbe)
      .map((media) => ({ frame, frameIndex: report.frameIndex, media }))
  )
  const routedViewport = candidates.find((candidate) =>
    candidate.media.mediaId.endsWith('-tencent-viewport')
  )
  if (routedViewport !== undefined) return routedViewport
  const preferred = candidates.find((candidate) => candidate.media.mediaId === preferredMediaId)
  if (preferred !== undefined) return preferred
  return (
    candidates.sort(
      (left, right) =>
        Number(left.media.paused) - Number(right.media.paused) ||
        right.media.visibleArea - left.media.visibleArea ||
        right.media.readyState - left.media.readyState ||
        right.media.currentTime - left.media.currentTime
    )[0] ?? null
  )
}

function chooseAudio(
  frames: readonly ProbedFrame[],
  preferredMediaId: string | null = null
): SelectedMedia | null {
  const candidates = frames.flatMap(({ frame, report }) =>
    report.dom.media
      .filter(
        (media): media is MediaProbe & { mediaId: string } =>
          media.kind === 'audio' && media.mediaId !== null && media.connected
      )
      .map((media) => ({ frame, frameIndex: report.frameIndex, media }))
  )
  const preferred = candidates.find((candidate) => candidate.media.mediaId === preferredMediaId)
  if (preferred !== undefined) return preferred
  return (
    candidates.sort(
      (left, right) =>
        Number(left.media.paused) - Number(right.media.paused) ||
        right.media.readyState - left.media.readyState ||
        right.media.currentTime - left.media.currentTime
    )[0] ?? null
  )
}

function selectionForMedia(frames: readonly ProbedFrame[], mediaId: string): SelectedMedia | null {
  for (const { frame, report } of frames) {
    const media = report.dom.media.find(
      (candidate) => candidate.mediaId === mediaId && isContentVideoProbe(candidate)
    )
    if (media !== undefined) return { frame, frameIndex: report.frameIndex, media }
  }
  return null
}

async function waitForSelectedMedia(
  context: BrowserContext,
  page: Page,
  timeoutMs: number,
  preferredMediaId: string | null = null
): Promise<Readonly<{ selection: SelectedMedia; frames: readonly ProbedFrame[] }> | null> {
  const deadline = Date.now() + timeoutMs
  do {
    const frames = await probeAllFrames(context, page)
    const selection = chooseMedia(frames, preferredMediaId)
    if (selection !== null) return { selection, frames }
    await page.waitForTimeout(250)
  } while (Date.now() < deadline)
  return null
}

async function waitForSelectedAudio(
  context: BrowserContext,
  page: Page,
  timeoutMs: number,
  preferredMediaId: string | null = null
): Promise<Readonly<{ selection: SelectedMedia; frames: readonly ProbedFrame[] }> | null> {
  const deadline = Date.now() + timeoutMs
  do {
    const frames = await probeAllFrames(context, page)
    const selection = chooseAudio(frames, preferredMediaId)
    if (selection !== null) return { selection, frames }
    await page.waitForTimeout(250)
  } while (Date.now() < deadline)
  return null
}

async function waitForReloadedAudio(
  context: BrowserContext,
  page: Page,
  site: LiveSiteDefinition,
  timeoutMs: number
): Promise<
  | Readonly<{ selection: SelectedMedia; frames: readonly ProbedFrame[] }>
  | Readonly<{ externalBlock: string }>
  | null
> {
  const deadline = Date.now() + timeoutMs
  let attemptedPlay = false
  const allowedHostnames = hostnamesForSite(site)
  do {
    const externalBlock = classifyExternalBlock(null, page.url(), allowedHostnames)
    if (externalBlock !== null) return { externalBlock }
    const frames = await probeAllFrames(context, page)
    const selection = chooseAudio(frames)
    if (selection !== null) return { selection, frames }
    if (!attemptedPlay) {
      attemptedPlay = true
      await attemptSitePlay(page, site.playSelectors)
    }
    await page.waitForTimeout(300)
  } while (Date.now() < deadline)
  return null
}

async function waitForReloadedMedia(
  context: BrowserContext,
  page: Page,
  site: LiveSiteDefinition,
  timeoutMs: number
): Promise<
  | Readonly<{ selection: SelectedMedia; frames: readonly ProbedFrame[] }>
  | Readonly<{ externalBlock: string }>
  | null
> {
  const deadline = Date.now() + timeoutMs
  let attemptedPlay = false
  const allowedHostnames = hostnamesForSite(site)
  do {
    const externalBlock = classifyExternalBlock(null, page.url(), allowedHostnames)
    if (externalBlock !== null) return { externalBlock }
    const frames = await probeAllFrames(context, page)
    const selection = chooseMedia(frames)
    if (selection !== null) return { selection, frames }
    if (!attemptedPlay) {
      attemptedPlay = true
      await attemptSitePlay(page, site.playSelectors)
    }
    await page.waitForTimeout(300)
  } while (Date.now() < deadline)
  return null
}

async function scrollAndStartMedia(selection: SelectedMedia): Promise<void> {
  const mediaId = selection.media.mediaId
  if (mediaId === null || !/^[a-z0-9-]+$/i.test(mediaId)) return
  const locator = selection.frame.locator(`[${MEDIA_ID_ATTRIBUTE}="${mediaId}"]`).first()
  await locator.scrollIntoViewIfNeeded({ timeout: 8_000 }).catch(() => undefined)
  await locator
    .evaluate((element) => {
      const media = element as HTMLMediaElement
      media.muted = true
      if (!media.paused) return
      try {
        void media.play().catch(() => undefined)
      } catch {
        // Synthetic media proxies can expose a play promise that never settles.
      }
    })
    .catch(() => undefined)
}

function assessmentFor(frame: FrameReport, mediaId: string): MediaUiAssessment | null {
  return frame.assessments.find((assessment) => assessment.mediaId === mediaId) ?? null
}

async function uiFrameForMedia(
  context: BrowserContext,
  selection: SelectedMedia,
  mediaId: string
): Promise<ProbedFrame> {
  const deadline = Date.now() + 1_500
  let localCandidate: ProbedFrame | null = null
  do {
    const frames = await probeAllFrames(context, selection.frame.page())
    const candidates = frames.filter(
      (candidate) => assessmentFor(candidate.report, mediaId)?.triggerRect != null
    )
    const topFrameCandidate = candidates.find(
      (candidate) => candidate.report.frameIndex === 0 && candidate.frame.parentFrame() === null
    )
    if (topFrameCandidate !== undefined) return topFrameCandidate
    localCandidate ??=
      candidates.find((candidate) => candidate.report.frameIndex === selection.frameIndex) ?? null
    if (Date.now() >= deadline) break
    await selection.frame.page().waitForTimeout(100)
  } while (Date.now() < deadline)
  return localCandidate ?? (await probeFrame(context, selection.frame, selection.frameIndex))
}

async function activateShadowTrigger(
  context: BrowserContext,
  frame: Frame,
  mediaId: string,
  action: 'hover' | 'click' | 'dom' = 'click'
): Promise<
  Readonly<{
    activated: boolean
    method: 'hover' | 'pointer' | 'dom' | 'none'
    hitTarget: PointerHitProbe | null
    activationPoint: Point | null
    usedTransparentHitboxEdge: boolean
  }>
> {
  let session: Awaited<ReturnType<BrowserContext['newCDPSession']>> | null = null
  try {
    session = await context.newCDPSession(frame)
    const documentResult = (await session.send('DOM.getDocument', {
      depth: -1,
      pierce: true
    })) as unknown as { root: CdpNode }
    const shadowNodes = locateShadowNodes(documentResult.root)
    const trigger = shadowNodes.find((node) => node.kind === 'trigger' && node.mediaId === mediaId)
    const hitbox = shadowNodes.find((node) => node.kind === 'hitbox' && node.mediaId === mediaId)
    if (trigger === undefined) {
      return {
        activated: false,
        method: 'none',
        hitTarget: null,
        activationPoint: null,
        usedTransparentHitboxEdge: false
      }
    }
    try {
      if (action === 'dom') throw new Error('DOM activation requested')
      const triggerBox = (await session.send('DOM.getBoxModel', {
        nodeId: trigger.node.nodeId
      })) as unknown as { model: { border: readonly number[] } }
      const triggerRect = rectFromQuad(triggerBox.model.border)
      const hitboxRect =
        hitbox === undefined
          ? null
          : rectFromQuad(
              (
                (await session.send('DOM.getBoxModel', {
                  nodeId: hitbox.node.nodeId
                })) as unknown as { model: { border: readonly number[] } }
              ).model.border
            )
      if (triggerRect !== null) {
        const transparentEdgePoint =
          action === 'hover' && hitboxRect !== null
            ? transparentPointInsideHitbox(hitboxRect, triggerRect)
            : null
        const framePoint = transparentEdgePoint ?? {
          x: triggerRect.x + triggerRect.width / 2,
          y: triggerRect.y + triggerRect.height / 2
        }
        const pagePoint = await pagePointForFramePoint(frame, framePoint)
        const describeHitTarget = ({ x, y }: Point): PointerHitTarget | null => {
          const element = document.elementFromPoint(x, y)
          if (!(element instanceof HTMLElement)) return null
          const style = getComputedStyle(element)
          return {
            tag: element.localName,
            id: element.id || null,
            className: typeof element.className === 'string' ? element.className || null : null,
            pointerEvents: style.pointerEvents,
            zIndex: style.zIndex,
            mediaHost: element.hasAttribute('data-h5p-ext-media-host')
          }
        }
        const [topHit, frameHit] = await Promise.all([
          frame.page().evaluate(describeHitTarget, pagePoint),
          frame.evaluate(describeHitTarget, framePoint)
        ])
        const hitTarget = { top: topHit, frame: frameHit }
        await frame.page().mouse.move(pagePoint.x, pagePoint.y)
        if (action === 'hover') {
          return {
            activated: true,
            method: 'hover',
            hitTarget,
            activationPoint: framePoint,
            usedTransparentHitboxEdge: transparentEdgePoint !== null
          }
        }
        await frame.page().mouse.click(pagePoint.x, pagePoint.y)
        return {
          activated: true,
          method: 'pointer',
          hitTarget,
          activationPoint: framePoint,
          usedTransparentHitboxEdge: false
        }
      }
    } catch {
      // Fall back to a user-gesture DOM invocation when frame-local input is unavailable.
    }
    const resolved = (await session.send('DOM.resolveNode', {
      nodeId: trigger.node.nodeId
    })) as unknown as { object: { objectId?: string } }
    const objectId = resolved.object.objectId
    if (objectId === undefined) {
      return {
        activated: false,
        method: 'none',
        hitTarget: null,
        activationPoint: null,
        usedTransparentHitboxEdge: false
      }
    }
    await session.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: 'function () { this.click() }',
      userGesture: true,
      awaitPromise: true
    })
    return {
      activated: true,
      method: 'dom',
      hitTarget: null,
      activationPoint: null,
      usedTransparentHitboxEdge: false
    }
  } catch {
    return {
      activated: false,
      method: 'none',
      hitTarget: null,
      activationPoint: null,
      usedTransparentHitboxEdge: false
    }
  } finally {
    await session?.detach().catch(() => undefined)
  }
}

function pointInsideRect(point: Point, rect: Rect): boolean {
  return point.x > rect.x && point.x < rect.right && point.y > rect.y && point.y < rect.bottom
}

function transparentPointInsideHitbox(hitbox: Rect, trigger: Rect): Point | null {
  const inset = 2
  const candidates: Point[] = [
    { x: hitbox.x + inset, y: trigger.y + trigger.height / 2 },
    { x: hitbox.right - inset, y: trigger.y + trigger.height / 2 },
    { x: trigger.x + trigger.width / 2, y: hitbox.y + inset },
    { x: trigger.x + trigger.width / 2, y: hitbox.bottom - inset }
  ]
  return (
    candidates.find(
      (candidate) => pointInsideRect(candidate, hitbox) && !pointInsideRect(candidate, trigger)
    ) ?? null
  )
}

async function pagePointForFramePoint(frame: Frame, point: Point): Promise<Point> {
  if (frame.parentFrame() === null) return point
  const frameElement = await frame.frameElement()
  try {
    const [box, metrics] = await Promise.all([
      frameElement.boundingBox(),
      frameElement.evaluate((element) => {
        const frame = element as HTMLIFrameElement
        return {
          clientLeft: frame.clientLeft,
          clientTop: frame.clientTop,
          offsetWidth: frame.offsetWidth,
          offsetHeight: frame.offsetHeight
        }
      })
    ])
    if (
      box === null ||
      metrics.offsetWidth <= 0 ||
      metrics.offsetHeight <= 0 ||
      !Number.isFinite(box.width) ||
      !Number.isFinite(box.height)
    ) {
      throw new Error('Frame element has no usable page geometry')
    }
    const scaleX = box.width / metrics.offsetWidth
    const scaleY = box.height / metrics.offsetHeight
    return {
      x: box.x + (metrics.clientLeft + point.x) * scaleX,
      y: box.y + (metrics.clientTop + point.y) * scaleY
    }
  } finally {
    await frameElement.dispose().catch(() => undefined)
  }
}

async function ensurePanelState(
  context: BrowserContext,
  selection: SelectedMedia,
  expanded: boolean
): Promise<
  Readonly<{
    frame: FrameReport
    method: string
    hitTarget: PointerHitProbe | null
    activationPoint: Point | null
    usedTransparentHitboxEdge: boolean
  }>
> {
  const mediaId = selection.media.mediaId
  if (mediaId === null) throw new Error('Selected media has no stable id')
  let uiFrame = await uiFrameForMedia(context, selection, mediaId)
  let current = uiFrame.report
  const isExpanded = assessmentFor(current, mediaId)?.panelRect != null
  if (isExpanded === expanded) {
    return {
      frame: current,
      method: 'none',
      hitTarget: null,
      activationPoint: null,
      usedTransparentHitboxEdge: false
    }
  }
  if (!expanded) {
    await selection.frame.page().mouse.move(1, 1)
    await selection.frame.waitForTimeout(250)
    uiFrame = await uiFrameForMedia(context, selection, mediaId)
    current = uiFrame.report
    if (assessmentFor(current, mediaId)?.panelRect == null) {
      return {
        frame: current,
        method: 'pointer-leave',
        hitTarget: null,
        activationPoint: null,
        usedTransparentHitboxEdge: false
      }
    }
  }
  const activation = await activateShadowTrigger(
    context,
    uiFrame.frame,
    mediaId,
    expanded ? 'hover' : 'dom'
  )
  await uiFrame.frame.waitForTimeout(250)
  current = (await probeFrame(context, uiFrame.frame, uiFrame.report.frameIndex)).report
  if (
    (assessmentFor(current, mediaId)?.panelRect != null) !== expanded &&
    activation.method !== 'dom'
  ) {
    const fallback = await activateShadowTrigger(context, uiFrame.frame, mediaId, 'dom')
    await uiFrame.frame.waitForTimeout(250)
    current = (await probeFrame(context, uiFrame.frame, uiFrame.report.frameIndex)).report
    return {
      frame: current,
      method: `${activation.method}+${fallback.method}`,
      hitTarget: activation.hitTarget,
      activationPoint: activation.activationPoint,
      usedTransparentHitboxEdge: activation.usedTransparentHitboxEdge
    }
  }
  return {
    frame: current,
    method: activation.method,
    hitTarget: activation.hitTarget,
    activationPoint: activation.activationPoint,
    usedTransparentHitboxEdge: activation.usedTransparentHitboxEdge
  }
}

async function verifyLayoutAfterChange(
  context: BrowserContext,
  page: Page,
  selection: SelectedMedia,
  mediaId: string,
  report: LiveSiteReport,
  phase: 'resize' | 'scroll'
): Promise<SelectedMedia | null> {
  const frames = await waitForInstanceUiMapping(context, page)
  addInstanceUiMappingViolations(report, frames, phase)
  const currentSelection = selectionForMedia(frames, mediaId)
  const currentFrame =
    currentSelection === null
      ? undefined
      : frames.find((frame) => frame.report.frameIndex === currentSelection.frameIndex)?.report
  const assessment = currentFrame === undefined ? null : assessmentFor(currentFrame, mediaId)
  addAssessmentViolations(report, assessment, phase)
  report.interactions[`${phase}Layout`] = {
    mediaId,
    viewport: currentFrame?.dom.viewport ?? null,
    assessment
  }
  return currentSelection ?? selection
}

async function sendPopupRuntimeRequest(
  popup: Page,
  targetPage: Page,
  request: ReturnType<typeof createRuntimeRequest>
): Promise<unknown> {
  await targetPage.bringToFront()
  return popup.evaluate(async (message) => {
    const runtime = (
      globalThis as unknown as {
        chrome: { runtime: { sendMessage: (value: unknown) => Promise<unknown> } }
      }
    ).chrome.runtime
    return runtime.sendMessage(message)
  }, request)
}

async function getMediaState(popup: Page, targetPage: Page): Promise<MediaPageState> {
  const request = createRuntimeRequest('popup', 'media.get-state', {})
  const response = parseRuntimeResponse(await sendPopupRuntimeRequest(popup, targetPage, request))
  if (
    response?.type !== 'protocol.response' ||
    response.requestId !== request.requestId ||
    response.payload.requestType !== request.type
  ) {
    throw new Error('Live media state request failed')
  }
  return mediaPageStateSchema.parse(response.payload.data)
}

function frameIdForMediaId(mediaId: string): number | null {
  const value = /^media-(\d+)-/.exec(mediaId)?.[1]
  if (value === undefined) return null
  const frameId = Number(value)
  return Number.isInteger(frameId) && frameId >= 0 ? frameId : null
}

async function getFrameMediaState(
  popup: Page,
  targetPage: Page,
  frameId: number
): Promise<MediaPageState> {
  const request = createTabRequest('media.get-state', {})
  await targetPage.bringToFront()
  const rawResponse = await popup.evaluate(
    async ({ message, targetFrameId }) => {
      const tabs = (
        globalThis as unknown as {
          chrome: {
            tabs: {
              query: (query: {
                active: boolean
                currentWindow: boolean
              }) => Promise<readonly { id?: number }[]>
              sendMessage: (
                tabId: number,
                value: unknown,
                options: { frameId: number }
              ) => Promise<unknown>
            }
          }
        }
      ).chrome.tabs
      const tabId = (await tabs.query({ active: true, currentWindow: true }))[0]?.id
      if (tabId === undefined) throw new Error('Active tab unavailable')
      return tabs.sendMessage(tabId, message, { frameId: targetFrameId })
    },
    { message: request, targetFrameId: frameId }
  )
  const response = parseTabResponse(rawResponse)
  if (
    response?.type !== 'protocol.response' ||
    response.requestId !== request.requestId ||
    response.payload.requestType !== request.type
  ) {
    throw new Error(`Live media state request failed for frame ${frameId}`)
  }
  return mediaPageStateSchema.parse(response.payload.data)
}

function readTargetMediaState(
  popup: Page,
  targetPage: Page,
  frameId: number
): Promise<MediaPageState> {
  return readFrameOrGlobalState(
    frameId,
    (targetFrameId) => getFrameMediaState(popup, targetPage, targetFrameId),
    () => getMediaState(popup, targetPage)
  )
}

async function setSiteRate(popup: Page, targetPage: Page, mediaId: string, value: number) {
  const request = createRuntimeRequest('popup', 'media.execute', {
    command: { type: 'media.set-rate', mediaId, value },
    playbackRateScope: 'site'
  })
  const response = parseRuntimeResponse(await sendPopupRuntimeRequest(popup, targetPage, request))
  if (
    response?.type !== 'protocol.response' ||
    response.requestId !== request.requestId ||
    response.payload.requestType !== request.type
  ) {
    throw new Error('Live media rate command failed')
  }
  return mediaCommandResultResponseSchema.parse(response.payload.data)
}

async function setFrameSiteRate(
  popup: Page,
  targetPage: Page,
  frameId: number,
  mediaId: string,
  value: number
) {
  const request = createTabRequest('media.execute', {
    command: { type: 'media.set-rate', mediaId, value },
    playbackRateScope: 'site'
  })
  await targetPage.bringToFront()
  const rawResponse = await popup.evaluate(
    async ({ message, targetFrameId }) => {
      const tabs = (
        globalThis as unknown as {
          chrome: {
            tabs: {
              query: (query: {
                active: boolean
                currentWindow: boolean
              }) => Promise<readonly { id?: number }[]>
              sendMessage: (
                tabId: number,
                value: unknown,
                options: { frameId: number }
              ) => Promise<unknown>
            }
          }
        }
      ).chrome.tabs
      const tabId = (await tabs.query({ active: true, currentWindow: true }))[0]?.id
      if (tabId === undefined) throw new Error('Active tab unavailable')
      return tabs.sendMessage(tabId, message, { frameId: targetFrameId })
    },
    { message: request, targetFrameId: frameId }
  )
  const response = parseTabResponse(rawResponse)
  if (
    response?.type !== 'protocol.response' ||
    response.requestId !== request.requestId ||
    response.payload.requestType !== request.type
  ) {
    throw new Error(`Live media rate command failed for frame ${frameId}`)
  }
  return mediaCommandResultResponseSchema.parse(response.payload.data)
}

function setScopedSiteRate(
  popup: Page,
  targetPage: Page,
  mediaId: string,
  value: number,
  frameId: number
) {
  return frameId === 0
    ? setSiteRate(popup, targetPage, mediaId, value)
    : setFrameSiteRate(popup, targetPage, frameId, mediaId, value)
}

function activeMedia(state: MediaPageState, preferredMediaId: string | null = null) {
  const foregroundVideos = state.media.filter(
    (media) =>
      media.kind !== 'audio' &&
      media.metrics.visible &&
      (media.metrics.opacity ?? 1) >= MIN_FOREGROUND_MEDIA_OPACITY
  )
  const foregroundIds = new Set(foregroundVideos.map((media) => media.id))
  const preferred = state.media.find((media) => media.id === preferredMediaId)
  if (
    preferred !== undefined &&
    (preferred.kind === 'audio' || foregroundIds.has(preferred.id) || foregroundVideos.length === 0)
  ) {
    return preferred
  }
  const explicit = state.media.find((media) => media.id === state.activeMediaId)
  if (
    explicit !== undefined &&
    (explicit.kind === 'audio' || foregroundIds.has(explicit.id) || foregroundVideos.length === 0)
  ) {
    return explicit
  }
  const visibleVideo = [...foregroundVideos].sort(
    (left, right) =>
      Number(right.state === 'active') - Number(left.state === 'active') ||
      right.metrics.width * right.metrics.height - left.metrics.width * left.metrics.height
  )[0]
  return (
    visibleVideo ??
    state.media.find((media) => media.kind === 'audio' && media.metrics.visible) ??
    state.media.find((media) => media.metrics.visible) ??
    state.media[0] ??
    null
  )
}

function mediaForId(
  state: MediaPageState,
  mediaId: string
): MediaPageState['media'][number] | null {
  return state.media.find((media) => media.id === mediaId) ?? null
}

async function waitForRate(
  popup: Page,
  targetPage: Page,
  mediaId: string,
  predicate: (rate: number) => boolean,
  timeoutMs = 4_000,
  frameId = 0
): Promise<MediaPageState> {
  const deadline = Date.now() + timeoutMs
  let state = await readTargetMediaState(popup, targetPage, frameId)
  while (
    !predicate(mediaForId(state, mediaId)?.metrics.playbackRate ?? Number.NaN) &&
    Date.now() < deadline
  ) {
    await targetPage.waitForTimeout(150)
    state = await readTargetMediaState(popup, targetPage, frameId)
  }
  return state
}

async function waitForActiveMedia(
  popup: Page,
  targetPage: Page,
  predicate: (media: ActiveMediaSnapshot) => boolean,
  timeoutMs = 8_000
): Promise<Readonly<{ state: MediaPageState; media: ActiveMediaSnapshot }> | null> {
  const deadline = Date.now() + timeoutMs
  do {
    const state = await getMediaState(popup, targetPage)
    const media = activeMedia(state)
    if (media !== null && predicate(media)) return { state, media }
    await targetPage.waitForTimeout(150)
  } while (Date.now() < deadline)
  return null
}

async function observeActivePlaybackRate(
  popup: Page,
  targetPage: Page,
  predicate: (media: ActiveMediaSnapshot) => boolean,
  durationMs: number
): Promise<PlaybackRateStabilityObservation> {
  const startedAt = Date.now()
  const deadline = startedAt + Math.max(1, durationMs)
  const mediaIds = new Set<string>()
  const rates = new Set<number>()
  let sampleCount = 0
  let firstFailure: PlaybackRateStabilityObservation['firstFailure'] = null

  do {
    const state = await getMediaState(popup, targetPage)
    const media = activeMedia(state)
    const rate = finiteNumberOrNull(media?.metrics.playbackRate)
    sampleCount += 1
    if (media !== null) mediaIds.add(String(media.id))
    if (rate !== null) rates.add(rate)
    if (media === null || rate === null || !predicate(media)) {
      firstFailure = { mediaId: media === null ? null : String(media.id), rate }
      break
    }
    if (Date.now() >= deadline) break
    await targetPage.waitForTimeout(Math.min(250, Math.max(1, deadline - Date.now())))
  } while (Date.now() < deadline)

  return {
    durationMs: Date.now() - startedAt,
    sampleCount,
    stable: firstFailure === null && sampleCount >= 2,
    mediaIds: [...mediaIds],
    rates: [...rates].sort((left, right) => left - right),
    firstFailure
  }
}

async function clickFirstVisible(page: Page, selectors: readonly string[]): Promise<string | null> {
  for (const selector of selectors) {
    const target = page.locator(selector).first()
    try {
      if ((await target.count()) === 0 || !(await target.isVisible())) continue
      await target.click({ timeout: 5_000 })
      return selector
    } catch {
      // Try the next site-specific transition selector.
    }
  }
  return null
}

async function feedbackSnapshot(
  context: BrowserContext,
  page: Page,
  mediaId: string
): Promise<
  Readonly<{
    visible: boolean
    elements: readonly ShadowElementProbe[]
    probeStatus: ShadowProbeStatus
  }>
> {
  const elements: ShadowElementProbe[] = []
  let probeStatus: ShadowProbeStatus = 'available'
  for (const frame of page.frames()) {
    const result = await probeClosedShadowUi(context, frame)
    if (result.status === 'unknown') probeStatus = 'unknown'
    else if (result.status === 'probe-limited' && probeStatus === 'available') {
      probeStatus = 'probe-limited'
    }
    elements.push(
      ...result.elements.filter(
        (element) =>
          !element.pageFeedback &&
          element.mediaId === mediaId &&
          (element.kind === 'feedback' || (element.kind === 'tools' && element.hasFeedback))
      )
    )
  }
  return { visible: elements.length > 0, elements, probeStatus }
}

async function waitForFeedback(
  context: BrowserContext,
  page: Page,
  mediaId: string,
  visible: boolean,
  timeoutMs: number
): Promise<
  Readonly<{
    visible: boolean
    elements: readonly ShadowElementProbe[]
    probeStatus: ShadowProbeStatus
  }>
> {
  const deadline = Date.now() + timeoutMs
  let current = await feedbackSnapshot(context, page, mediaId)
  while (current.visible !== visible && Date.now() < deadline) {
    await page.waitForTimeout(100)
    current = await feedbackSnapshot(context, page, mediaId)
  }
  return current
}

async function pageFeedbackSnapshot(
  context: BrowserContext,
  page: Page,
  mediaId: string
): Promise<Readonly<{ visible: boolean; elements: readonly ShadowElementProbe[] }>> {
  const elements: ShadowElementProbe[] = []
  for (const frame of page.frames()) {
    const result = await probeClosedShadowUi(context, frame)
    elements.push(
      ...result.elements.filter(
        (element) =>
          (element.kind === 'feedback' || (element.kind === 'tools' && element.hasFeedback)) &&
          (element.pageFeedback || element.mediaId === mediaId)
      )
    )
  }
  return { visible: elements.length > 0, elements }
}

async function waitForPageFeedback(
  context: BrowserContext,
  page: Page,
  mediaId: string,
  visible: boolean,
  timeoutMs: number
): Promise<Readonly<{ visible: boolean; elements: readonly ShadowElementProbe[] }>> {
  const deadline = Date.now() + timeoutMs
  let current = await pageFeedbackSnapshot(context, page, mediaId)
  while (current.visible !== visible && Date.now() < deadline) {
    await page.waitForTimeout(100)
    current = await pageFeedbackSnapshot(context, page, mediaId)
  }
  return current
}

async function captureScreenshot(
  page: Page,
  testInfo: TestInfo,
  artifactDirectory: string,
  siteId: string,
  stage: string
): Promise<string> {
  const filePath = path.join(artifactDirectory, `${stage}.png`)
  try {
    await page.screenshot({
      path: filePath,
      fullPage: false,
      animations: 'disabled',
      timeout: 8_000
    })
  } catch {
    const session = await page.context().newCDPSession(page)
    try {
      const captured = await session.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false
      })
      await writeFile(filePath, Buffer.from(captured.data, 'base64'))
    } finally {
      await session.detach().catch(() => undefined)
    }
  }
  await testInfo.attach(`${siteId}-${stage}`, { path: filePath, contentType: 'image/png' })
  return path.relative(process.cwd(), filePath)
}

function pushBrowserEvent(
  target: BrowserEvent[],
  source: BrowserEvent['source'],
  level: string,
  value: string
): void {
  if (target.length >= 80) return
  target.push({ source, level, valueHash: hashValue(value) })
}

async function writeReport(
  report: LiveSiteReport,
  testInfo: TestInfo,
  artifactDirectory: string
): Promise<void> {
  const reportPath = path.join(artifactDirectory, 'report.json')
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  await testInfo.attach(`${report.site.id}-report`, {
    path: reportPath,
    contentType: 'application/json'
  })
}

function addAssessmentViolations(
  report: LiveSiteReport,
  assessment: MediaUiAssessment | null,
  phase: string
): void {
  if (assessment === null) {
    report.violations.push(`${phase}: media host assessment missing`)
    return
  }
  if (assessment.anchorDistance === null || assessment.anchorDistance > ANCHOR_TOLERANCE_PX) {
    report.violations.push(`${phase}: media host is not anchored to the visible media edge`)
  }
  if (assessment.triggerRect === null && assessment.panelRect === null) {
    const probeLimited = assessment.shadowProbeStatus !== 'available'
    if (probeLimited) {
      report.warnings.push(
        `${phase}: closed-shadow UI probe is ${assessment.shadowProbeStatus}; trigger visibility is unverified`
      )
    } else {
      report.violations.push(`${phase}: quick-control trigger is missing`)
    }
  } else if (assessment.triggerRect === null) {
    report.warnings.push(
      `${phase}: quick-control trigger geometry is unavailable while panel is observable`
    )
  } else if (assessment.triggerViewportOverflow) {
    report.violations.push(`${phase}: quick-control trigger overflows the viewport`)
  }
  const hitboxRect = assessment.hitboxRect
  const triggerRect = assessment.triggerRect
  if (hitboxRect === null && triggerRect !== null) {
    report.violations.push(`${phase}: quick-control transparent hover target is missing`)
  } else if (
    hitboxRect !== null &&
    triggerRect !== null &&
    (hitboxRect.width < triggerRect.width + MIN_HITBOX_EXPANSION_PX ||
      hitboxRect.height < triggerRect.height + MIN_HITBOX_EXPANSION_PX)
  ) {
    report.violations.push(
      `${phase}: quick-control transparent hover target does not extend beyond the visible trigger`
    )
  }
}

function addFeedbackAssessmentViolations(
  report: LiveSiteReport,
  assessment: MediaUiAssessment | null,
  phase: string
): void {
  if (assessment?.feedbackRect === null || assessment === null) {
    if (
      assessment?.shadowProbeStatus !== undefined &&
      assessment.shadowProbeStatus !== 'available'
    ) {
      report.warnings.push(
        `${phase}: closed-shadow UI probe is ${assessment.shadowProbeStatus}; media feedback geometry is unverified`
      )
    } else {
      report.violations.push(`${phase}: media-scoped feedback is missing for the target instance`)
    }
    return
  }
  if (assessment.feedbackViewportOverflow || !assessment.feedbackInsideVisibleMedia) {
    report.violations.push(`${phase}: media feedback left the visible media safe area`)
  }
  if (assessment.feedbackRect.height > 48) {
    report.violations.push(`${phase}: media feedback wrapped into an oversized vertical block`)
  }
}

function instanceUiMappingIsValid(mapping: InstanceUiMappingProbe): boolean {
  if (mapping.shadowProbeStatus !== 'available') {
    return Boolean(
      mapping.orphanHostMediaIds.length === 0 &&
      mapping.unassignedHostMediaIds.length === 0 &&
      mapping.duplicateHostMediaIds.length === 0
    )
  }
  return Boolean(
    mapping.orphanHostMediaIds.length === 0 &&
    mapping.unassignedHostMediaIds.length === 0 &&
    mapping.duplicateHostMediaIds.length === 0 &&
    mapping.duplicateTriggerMediaIds.length === 0 &&
    mapping.slots.every(
      (slot) =>
        slot.hostMediaIds.length === 1 &&
        slot.triggerMediaIds.length === 1 &&
        slot.hostMediaIds[0] === slot.triggerMediaIds[0]
    )
  )
}

async function waitForInstanceUiMapping(
  context: BrowserContext,
  page: Page,
  timeoutMs = 3_000
): Promise<readonly ProbedFrame[]> {
  const deadline = Date.now() + timeoutMs
  let frames = await probeAllFrames(context, page)
  while (
    !frames
      .map((frame) => instanceUiMapping(frame.report))
      .filter((mapping) => mapping.slots.length > 0)
      .every(instanceUiMappingIsValid) &&
    Date.now() < deadline
  ) {
    await page.waitForTimeout(150)
    frames = await probeAllFrames(context, page)
  }
  return frames
}

function addInstanceUiMappingViolations(
  report: LiveSiteReport,
  frames: readonly ProbedFrame[],
  phase: string
): readonly InstanceUiMappingProbe[] {
  const mappings = frames.map((frame) => instanceUiMapping(frame.report))
  report.interactions[`${phase}InstanceUiMapping`] = mappings
  for (const mapping of mappings) {
    const prefix = `${phase}: frame ${mapping.frameIndex}`
    if (phase === 'baseline' && mapping.slots.length > 1) {
      report.warnings.push(
        `${prefix} exposes quick controls on ${mapping.slots.length} distinct content-media slots; active/background media UX requires manual review`
      )
    }
    if (mapping.orphanHostMediaIds.length > 0) {
      report.violations.push(`${prefix} has media hosts without a matching DOM media instance`)
    }
    if (mapping.unassignedHostMediaIds.length > 0) {
      report.violations.push(`${prefix} has visible media hosts outside a content-video slot`)
    }
    if (mapping.duplicateHostMediaIds.length > 0) {
      report.violations.push(`${prefix} mounted duplicate hosts for the same media instance`)
    }
    if (mapping.duplicateTriggerMediaIds.length > 0) {
      report.violations.push(`${prefix} mounted duplicate triggers for the same media instance`)
    }
    if (mapping.shadowProbeStatus !== 'available') {
      if (mapping.slots.length > 0) {
        report.warnings.push(
          `${prefix} closed-shadow UI probe is ${mapping.shadowProbeStatus}; trigger mapping is unverified`
        )
      }
      continue
    }
    for (const [slotIndex, slot] of mapping.slots.entries()) {
      if (slot.hostMediaIds.length !== 1) {
        report.violations.push(
          `${prefix} visual slot ${slotIndex} has ${slot.hostMediaIds.length} visible media hosts`
        )
      }
      if (slot.triggerMediaIds.length !== 1) {
        report.violations.push(
          `${prefix} visual slot ${slotIndex} has ${slot.triggerMediaIds.length} quick-control triggers`
        )
      }
      if (
        slot.hostMediaIds.length === 1 &&
        slot.triggerMediaIds.length === 1 &&
        slot.hostMediaIds[0] !== slot.triggerMediaIds[0]
      ) {
        report.violations.push(
          `${prefix} visual slot ${slotIndex} host and trigger target different media instances`
        )
      }
    }
  }
  return mappings
}

export function liveSmokeEnabled(): boolean {
  return process.env['H5PLAYER_LIVE_SMOKE'] === '1'
}

export function liveSmokeStrict(): boolean {
  return process.env['H5PLAYER_LIVE_STRICT'] !== '0'
}

export function selectedLiveSites(): readonly LiveSiteDefinition[] {
  const selected = new Set(
    (process.env['H5PLAYER_LIVE_SITES'] ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  )
  if (selected.size === 0) return LIVE_SITE_DEFINITIONS.filter((site) => site.tier === 1)
  return LIVE_SITE_DEFINITIONS.filter((site) => selected.has(site.id))
}

async function runAudioMediaFlow(
  site: LiveSiteDefinition,
  report: LiveSiteReport,
  harness: ExtensionHarness,
  page: Page,
  testInfo: TestInfo,
  artifactDirectory: string,
  mediaWaitMs: number
): Promise<void> {
  const initialAudio = await waitForSelectedAudio(harness.context, page, mediaWaitMs)
  if (initialAudio === null) {
    report.outcome = 'no-media'
    report.violations.push(
      'An audio element was observed but no controllable audio instance returned'
    )
    report.frames = (await probeAllFrames(harness.context, page)).map((item) => item.report)
    return
  }

  let selection = initialAudio.selection
  let popup = await harness.openPopup(page)
  let state = await getMediaState(popup, page)
  const initialActive = activeMedia(state, selection.media.mediaId)
  if (initialActive !== null) {
    const currentFrames = await probeAllFrames(harness.context, page)
    selection = chooseAudio(currentFrames, initialActive.id) ?? selection
  }
  await scrollAndStartMedia(selection)
  await page.waitForTimeout(500)
  const initialFrameId = frameIdForMediaId(selection.media.mediaId ?? '')
  if (initialFrameId === null) throw new Error('Selected audio id does not identify its frame')
  state = await readTargetMediaState(popup, page, initialFrameId)
  const selected = activeMedia(state, selection.media.mediaId)
  if (selected === null || selected.kind !== 'audio') {
    throw new Error('Popup did not resolve the selected audio instance')
  }
  const mediaId = selected.id
  report.interactions['audioBaseline'] = {
    mediaId,
    mediaState: selected.state,
    rate: selected.metrics.playbackRate
  }
  report.screenshots.push(
    await captureScreenshot(page, testInfo, artifactDirectory, site.id, 'audio-baseline')
  )

  const rateBeforeHotkey = selected.metrics.playbackRate
  const expectedHotkeyRate = rateBeforeHotkey + 0.1
  await page.bringToFront()
  await page.keyboard.press('KeyC')
  const frameId = frameIdForMediaId(mediaId)
  if (frameId === null) throw new Error('Selected audio id does not identify its frame')
  state = await waitForRate(
    popup,
    page,
    mediaId,
    (rate) => rateMatches(rate, expectedHotkeyRate),
    4_000,
    frameId
  )
  const rateAfterHotkey = finiteNumberOrNull(mediaForId(state, mediaId)?.metrics.playbackRate)
  const hotkeyFeedback = await waitForPageFeedback(harness.context, page, mediaId, true, 1_200)
  report.interactions['audioHotkeyRateUp'] = {
    mediaId,
    before: rateBeforeHotkey,
    after: rateAfterHotkey,
    applied: rateMatches(rateAfterHotkey, expectedHotkeyRate),
    feedbackVisible: hotkeyFeedback.visible,
    feedback: hotkeyFeedback.elements
  }
  if (!rateMatches(rateAfterHotkey, expectedHotkeyRate)) {
    report.violations.push('audio hotkey: KeyC did not increase the target rate by 0.1')
  }
  if (!hotkeyFeedback.visible) {
    report.violations.push('audio hotkey: page-scoped feedback was not visible')
  }
  await page.waitForTimeout(FEEDBACK_SETTLE_MS)
  const expiredFeedback = await waitForPageFeedback(harness.context, page, mediaId, false, 750)
  if (expiredFeedback.visible) {
    report.violations.push('audio hotkey: feedback did not expire within the expected window')
  }

  const rateResult = await setScopedSiteRate(popup, page, mediaId, TARGET_RATE, frameId)
  state = await waitForRate(
    popup,
    page,
    mediaId,
    (rate) => rateMatches(rate, TARGET_RATE),
    4_000,
    frameId
  )
  const rateAfterPopup = finiteNumberOrNull(mediaForId(state, mediaId)?.metrics.playbackRate)
  const popupFeedback = await waitForPageFeedback(harness.context, page, mediaId, true, 1_200)
  report.interactions['audioPopupSiteRate'] = {
    mediaId,
    commandOk: rateResult.result.ok,
    target: TARGET_RATE,
    actual: rateAfterPopup,
    feedbackVisible: popupFeedback.visible,
    feedback: popupFeedback.elements
  }
  if (!rateResult.result.ok || !rateMatches(rateAfterPopup, TARGET_RATE)) {
    report.violations.push('audio popup: site-scoped playback rate did not reach the target')
  }
  if (!popupFeedback.visible) {
    report.violations.push('audio popup: page-scoped feedback was not visible')
  }
  report.screenshots.push(
    await captureScreenshot(page, testInfo, artifactDirectory, site.id, 'audio-rate-feedback')
  )
  await popup.close()

  await page.reload({ waitUntil: 'domcontentloaded' })
  const reloaded = await waitForReloadedAudio(harness.context, page, site, mediaWaitMs)
  if (reloaded === null || 'externalBlock' in reloaded) {
    const externalBlock =
      reloaded !== null && 'externalBlock' in reloaded
        ? reloaded.externalBlock
        : classifyExternalBlock(null, page.url(), hostnamesForSite(site))
    report.interactions['audioReloadInheritance'] = {
      target: TARGET_RATE,
      actual: null,
      inherited: false,
      mediaReturned: false,
      externalBlock
    }
    if (externalBlock !== null) {
      report.warnings.push(`audio reload: external site block (${externalBlock})`)
    } else {
      report.violations.push('audio reload: controllable audio did not return')
    }
  } else {
    await scrollAndStartMedia(reloaded.selection)
    await page.waitForTimeout(500)
    const reloadMediaId = reloaded.selection.media.mediaId
    if (reloadMediaId === null) throw new Error('Reloaded audio lost its stable id')
    const reloadFrameId = frameIdForMediaId(reloadMediaId)
    if (reloadFrameId === null) throw new Error('Reloaded audio id does not identify its frame')
    popup = await harness.openPopup(page)
    const reloadedState = await waitForRate(
      popup,
      page,
      reloadMediaId,
      (rate) => rateMatches(rate, TARGET_RATE),
      6_000,
      reloadFrameId
    )
    const inheritedRate = finiteNumberOrNull(
      mediaForId(reloadedState, reloadMediaId)?.metrics.playbackRate
    )
    const inherited = rateMatches(inheritedRate, TARGET_RATE)
    report.interactions['audioReloadInheritance'] = {
      mediaId: reloadMediaId,
      target: TARGET_RATE,
      actual: inheritedRate,
      inherited
    }
    if (!inherited) report.violations.push('audio reload: site-scoped rate was not inherited')
    await popup.close()
    report.screenshots.push(
      await captureScreenshot(
        page,
        testInfo,
        artifactDirectory,
        site.id,
        'audio-reload-inheritance'
      )
    )
  }

  report.frames = (await probeAllFrames(harness.context, page)).map((item) => item.report)
  report.outcome = report.violations.length === 0 ? 'passed' : 'failed'
}

async function runDiscoveryFlow(
  site: LiveSiteDefinition,
  report: LiveSiteReport,
  harness: ExtensionHarness,
  page: Page,
  testInfo: TestInfo,
  artifactDirectory: string
): Promise<void> {
  const frames = await probeAllFrames(harness.context, page)
  const mappings = addInstanceUiMappingViolations(report, frames, 'discovery')
  const media = frames.flatMap((item) => item.report.dom.media)
  const eligibleSlots = mappings.reduce((count, mapping) => count + mapping.slots.length, 0)
  report.interactions['discoverySummary'] = {
    evidenceLevel: 'media-discovery',
    mediaCount: media.length,
    videoCount: media.filter((item) => item.kind === 'video').length,
    audioCount: media.filter((item) => item.kind === 'audio').length,
    assignedMediaCount: media.filter((item) => item.mediaId !== null).length,
    eligibleVideoSlotCount: eligibleSlots,
    runtimeFrameCount: frames.filter(
      (item) => item.report.dom.runtime['data-h5player-webext-media'] === 'ready'
    ).length,
    accessSignals: report.navigationAttempts.flatMap((attempt) => attempt.accessSignals)
  }
  if (eligibleSlots === 0) {
    report.warnings.push(
      'discovery: media exists, but no visible content-video slot was available for anchored UI validation'
    )
  }
  report.frames = frames.map((item) => item.report)
  report.screenshots.push(
    await captureScreenshot(page, testInfo, artifactDirectory, site.id, 'media-discovery')
  )
  report.outcome = report.violations.length === 0 ? 'passed' : 'failed'
}

async function runSiteTransitionFlow(
  site: LiveSiteDefinition,
  report: LiveSiteReport,
  harness: ExtensionHarness,
  page: Page,
  popup: Page,
  testInfo: TestInfo,
  artifactDirectory: string
): Promise<void> {
  const transition = site.transition
  if (transition === undefined) return

  const before = await waitForActiveMedia(popup, page, (media) => media.metrics.visible)
  if (before === null) {
    report.violations.push('transition: no active media before segment switch')
    return
  }

  const clickedSelector = await clickFirstVisible(page, transition.selectors)
  if (clickedSelector === null) {
    report.violations.push('transition: configured segment selector was not clickable')
    return
  }
  let urlMatched = true
  try {
    await page.waitForURL(new RegExp(transition.targetUrlPattern), { timeout: 20_000 })
  } catch {
    urlMatched = false
  }
  await page.waitForTimeout(1_000)

  const transitionedSelection = await waitForReloadedMedia(harness.context, page, site, 20_000)
  if (transitionedSelection === null || 'externalBlock' in transitionedSelection) {
    report.violations.push('transition: no controllable media returned after segment switch')
    report.interactions['siteTransition'] = {
      clickedSelector,
      urlMatched,
      mediaReturned: false
    }
    return
  }
  await scrollAndStartMedia(transitionedSelection.selection)
  const inherited = await waitForActiveMedia(
    popup,
    page,
    (media) => rateMatches(media.metrics.playbackRate, TARGET_RATE),
    10_000
  )
  if (inherited === null) {
    report.violations.push('transition: site-scoped rate was not inherited by the new segment')
    report.interactions['siteTransition'] = {
      clickedSelector,
      urlMatched,
      mediaReturned: true,
      inherited: false
    }
    return
  }

  const transitionFrames = await waitForInstanceUiMapping(harness.context, page)
  addInstanceUiMappingViolations(report, transitionFrames, 'transition')
  const transitionMediaId = inherited.media.id
  const transitionSelection =
    selectionForMedia(transitionFrames, transitionMediaId) ?? transitionedSelection.selection
  const transitionFrame = transitionFrames.find(
    (candidate) => candidate.report.frameIndex === transitionSelection.frameIndex
  )?.report
  const transitionAssessment =
    transitionFrame === undefined ? null : assessmentFor(transitionFrame, transitionMediaId)

  await page.bringToFront()
  const focusBeforeHotkey = await page.evaluate(() => {
    const active = document.activeElement
    return active === null
      ? null
      : {
          tagName: active.tagName.toLowerCase(),
          id: active.id || null,
          className: active.getAttribute('class')
        }
  })
  const keyObservationPromise = page.evaluate(
    () =>
      new Promise<Readonly<{ defaultPrevented: boolean; targetTag: string | null }> | null>(
        (resolve) => {
          const timeout = window.setTimeout(() => resolve(null), 2_000)
          document.addEventListener(
            'keydown',
            (event) => {
              if (event.code !== 'Digit2') return
              window.clearTimeout(timeout)
              queueMicrotask(() =>
                resolve({
                  defaultPrevented: event.defaultPrevented,
                  targetTag:
                    event.target instanceof Element ? event.target.tagName.toLowerCase() : null
                })
              )
            },
            { capture: false, once: true }
          )
        }
      )
  )
  const earlyFeedbackPromise = waitForFeedback(
    harness.context,
    page,
    transitionMediaId,
    true,
    4_000
  )
  await page.keyboard.press('Digit2')
  const [hotkeyApplied, keyObservation, earlyFeedback] = await Promise.all([
    // The Tencent facade can be destroyed while the shortcut command is in
    // flight. Keep this observation window longer than the runtime's staged
    // intent recovery window so a legitimate child-to-top authority migration
    // is not reported as a failed shortcut.
    waitForActiveMedia(popup, page, (media) => rateMatches(media.metrics.playbackRate, 2), 15_000),
    keyObservationPromise,
    earlyFeedbackPromise
  ])
  const hotkeyMediaId = hotkeyApplied?.media.id ?? transitionMediaId
  const hotkeyFeedback = await waitForFeedback(harness.context, page, hotkeyMediaId, true, 1_500)
  const feedbackVisible = earlyFeedback.visible || hotkeyFeedback.visible
  const feedbackElements = hotkeyFeedback.visible ? hotkeyFeedback.elements : earlyFeedback.elements
  const stabilityWindowMs = numericEnvironmentValue('H5PLAYER_LIVE_STABILITY_MS', 3_000)
  const stabilityObservation = await observeActivePlaybackRate(
    popup,
    page,
    (media) =>
      media.adapterId === 'tencent-video' &&
      media.metrics.visible &&
      rateMatches(media.metrics.playbackRate, 2),
    stabilityWindowMs
  )
  const evidence = await collectTencentRateEvidence(page)
  const stateAfterInitialHotkey = hotkeyApplied?.state ?? (await getMediaState(popup, page))
  await page.bringToFront()
  await page.keyboard.press('KeyC')
  const delayedHotkeyApplied = await waitForActiveMedia(
    popup,
    page,
    (media) => rateMatches(media.metrics.playbackRate, 2.1),
    8_000
  )
  const stateAfterDelayedHotkey = delayedHotkeyApplied?.state ?? (await getMediaState(popup, page))
  const transitionFrameId = frameIdForMediaId(transitionMediaId)
  const frameDiagnostic =
    hotkeyApplied === null && transitionFrameId !== null
      ? await setFrameSiteRate(popup, page, transitionFrameId, transitionMediaId, 2).catch(
          (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) })
        )
      : null
  const directDiagnostic =
    hotkeyApplied === null ? await setSiteRate(popup, page, transitionMediaId, 2) : null
  report.interactions['siteTransition'] = {
    clickedSelector,
    urlMatched,
    mediaReturned: true,
    mediaId: transitionMediaId,
    inherited: true,
    inheritedRate: inherited.media.metrics.playbackRate,
    hotkeyTarget: 2,
    hotkeyMediaId,
    focusBeforeHotkey,
    keyObservation,
    earlyFeedback,
    stateAfterInitialHotkey,
    hotkeyApplied: hotkeyApplied !== null,
    stabilityWindowMs,
    stabilityObservation,
    stableAfterSitePolling: stabilityObservation.stable,
    delayedHotkeyTarget: 2.1,
    delayedHotkeyApplied: delayedHotkeyApplied !== null,
    delayedHotkeyMediaId: delayedHotkeyApplied?.media.id ?? null,
    stateAfterDelayedHotkey,
    frameDiagnosticResult: frameDiagnostic,
    directDiagnosticResult: directDiagnostic?.result ?? null,
    feedbackVisible,
    feedback: feedbackElements,
    feedbackOwner: hotkeyFeedback.visible ? hotkeyMediaId : transitionMediaId,
    tencentRateEvidence: evidence,
    assessment: transitionAssessment
  }
  if (!urlMatched) report.violations.push('transition: target segment URL did not become active')
  if (hotkeyApplied === null) {
    report.violations.push('transition: keyboard rate command did not apply to the new segment')
  }
  if (!stabilityObservation.stable) {
    report.violations.push('transition: site polling reset the keyboard-selected rate')
  }
  if (delayedHotkeyApplied === null) {
    report.violations.push('transition: delayed keyboard rate command did not remain responsive')
  }
  if (!feedbackVisible) {
    report.violations.push('transition: keyboard rate feedback was not visible')
  }
  report.screenshots.push(
    await captureScreenshot(page, testInfo, artifactDirectory, site.id, 'segment-transition')
  )

  // Restore the baseline site intent so the following full reload assertion
  // remains independent of this transition-specific command.
  const latestForRestore = await waitForActiveMedia(popup, page, (media) => media.metrics.visible)
  const restoreMediaId = latestForRestore?.media.id ?? transitionMediaId
  const restore = await setSiteRate(popup, page, restoreMediaId, TARGET_RATE)
  if (!restore.result.ok) {
    report.violations.push(
      `transition: failed to restore the baseline site rate (${restore.result.error.code})`
    )
    return
  }
  await waitForActiveMedia(
    popup,
    page,
    (media) => rateMatches(media.metrics.playbackRate, TARGET_RATE),
    6_000
  )
}

export async function runLiveSiteSmoke(
  site: LiveSiteDefinition,
  testInfo: TestInfo
): Promise<LiveSiteReport> {
  const startedAt = new Date()
  const evidence = await extensionEvidence()
  const channel = browserChannel()
  const artifactDirectory = path.join(ARTIFACT_ROOT, site.id)
  await mkdir(artifactDirectory, { recursive: true })
  const report: LiveSiteReport = {
    schemaVersion: 3,
    runId: LIVE_RUN_ID,
    site: {
      id: site.id,
      label: site.label,
      source: site.source,
      profile: site.profile
    },
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    durationMs: null,
    environment: {
      os: `${os.platform()} ${os.release()}`,
      architecture: os.arch(),
      browserChannel: channel,
      browserVersion: null,
      headless: isHeadless(),
      viewport: VIEWPORT,
      extensionFingerprint: evidence.fingerprint,
      extensionVersion: evidence.version
    },
    navigationAttempts: [],
    selectedUrl: null,
    outcome: 'failed',
    frames: [],
    interactions: {},
    browserEvents: [],
    screenshots: [],
    warnings: [],
    violations: []
  }
  let harness: ExtensionHarness | null = null
  let page: Page | null = null
  let traceStarted = false
  let reloadExternallyBlocked = false
  let currentPhase = 'launch-extension'
  try {
    harness = await launchExtensionHarness({
      grantedOrigins: ['<all_urls>'],
      headless: isHeadless(),
      channel,
      viewport: VIEWPORT,
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai'
    })
    report.environment = {
      ...report.environment,
      browserVersion: harness.context.browser()?.version() ?? null
    }
    if (process.env['H5PLAYER_LIVE_TRACE'] === '1') {
      await harness.context.tracing.start({ screenshots: true, snapshots: true, sources: true })
      traceStarted = true
    }
    currentPhase = 'create-target-page'
    page = await harness.context.newPage()
    page.on('console', (message) => {
      if (message.type() === 'warning' || message.type() === 'error') {
        pushBrowserEvent(report.browserEvents, 'console', message.type(), message.text())
      }
    })
    page.on('pageerror', (error) => {
      pushBrowserEvent(report.browserEvents, 'pageerror', error.name, error.message)
    })
    page.on('requestfailed', (request) => {
      pushBrowserEvent(
        report.browserEvents,
        'requestfailed',
        request.resourceType(),
        `${request.failure()?.errorText ?? 'unknown'}:${sanitizeUrl(request.url())}`
      )
    })

    currentPhase = 'navigate-and-discover-media'
    const selectedUrl = await navigateToMedia(page, site, report.navigationAttempts)
    report.selectedUrl = selectedUrl === null ? null : sanitizeUrl(selectedUrl)
    if (selectedUrl === null) {
      const externallyBlocked = report.navigationAttempts.some(
        (attempt) => attempt.externalBlock !== null
      )
      report.outcome = externallyBlocked ? 'blocked' : 'no-media'
      const requireMedia = process.env['H5PLAYER_LIVE_REQUIRE_MEDIA'] === '1'
      if (requireMedia)
        report.violations.push('No controllable media was available on any candidate URL')
      report.frames = (await probeAllFrames(harness.context, page)).map((item) => item.report)
      report.screenshots.push(
        await captureScreenshot(page, testInfo, artifactDirectory, site.id, 'blocked-or-no-media')
      )
      return report
    }

    const mediaWaitMs = numericEnvironmentValue('H5PLAYER_LIVE_MEDIA_WAIT_MS', 20_000)
    if (site.profile === 'audio') {
      currentPhase = 'audio-command-and-lifecycle-flow'
      await runAudioMediaFlow(site, report, harness, page, testInfo, artifactDirectory, mediaWaitMs)
      return report
    }
    if (site.profile === 'discovery') {
      currentPhase = 'media-discovery-flow'
      await runDiscoveryFlow(site, report, harness, page, testInfo, artifactDirectory)
      return report
    }
    currentPhase = 'select-visible-video'
    const initialMedia = await waitForSelectedMedia(harness.context, page, mediaWaitMs)
    if (initialMedia === null) {
      report.outcome = 'no-media'
      report.violations.push(
        'A media element was observed but no visible content-media instance became selectable'
      )
      report.frames = (await probeAllFrames(harness.context, page)).map((item) => item.report)
      return report
    }

    currentPhase = 'open-popup-and-resolve-active-media'
    let probedFrames = initialMedia.frames
    let selection = initialMedia.selection
    let popup = await harness.openPopup(page)
    let state = await getMediaState(popup, page)
    const initialActive = activeMedia(state)
    if (initialActive !== null) {
      selection = selectionForMedia(probedFrames, initialActive.id) ?? selection
    }
    await scrollAndStartMedia(selection)
    await page.waitForTimeout(500)
    state = await getMediaState(popup, page)
    probedFrames = await waitForInstanceUiMapping(harness.context, page)
    const activeAfterStart = activeMedia(state, selection.media.mediaId)
    selection =
      (activeAfterStart === null ? null : selectionForMedia(probedFrames, activeAfterStart.id)) ??
      chooseMedia(probedFrames, selection.media.mediaId) ??
      selection
    const mediaId = selection.media.mediaId
    if (mediaId === null) throw new Error('Selected live media lost its stable id')
    currentPhase = 'baseline-instance-ui-mapping'
    addInstanceUiMappingViolations(report, probedFrames, 'baseline')
    const baselineFrame = probedFrames.find(
      (item) => item.report.frameIndex === selection?.frameIndex
    )?.report
    if (baselineFrame === undefined) throw new Error('Selected live frame disappeared')
    const baselineAssessment = assessmentFor(baselineFrame, mediaId)
    addAssessmentViolations(report, baselineAssessment, 'baseline')
    const baselineMedia = baselineFrame.dom.media.find((media) => media.mediaId === mediaId)
    if (baselineMedia?.paused === false && baselineAssessment?.panelRect != null) {
      report.violations.push('baseline: expanded panel remained open while media was playing')
    }
    report.screenshots.push(
      await captureScreenshot(page, testInfo, artifactDirectory, site.id, 'baseline')
    )

    currentPhase = 'resize-layout'
    const originalViewport = page.viewportSize() ?? VIEWPORT
    const resizedViewport = {
      width: Math.max(960, originalViewport.width - 160),
      height: Math.max(640, originalViewport.height - 100)
    }
    await page.setViewportSize(resizedViewport)
    await page.waitForTimeout(350)
    selection =
      (await verifyLayoutAfterChange(
        harness.context,
        page,
        selection,
        mediaId,
        report,
        'resize'
      )) ?? selection
    await page.setViewportSize(originalViewport)
    await page.waitForTimeout(350)

    currentPhase = 'scroll-layout'
    const originalScroll = await page.evaluate(() => ({
      x: globalThis.scrollX,
      y: globalThis.scrollY
    }))
    const scrollTarget = await page.evaluate(() => {
      const maximum = Math.max(0, document.documentElement.scrollHeight - globalThis.innerHeight)
      const down = Math.min(maximum, globalThis.scrollY + 120)
      if (down !== globalThis.scrollY) return down
      return Math.max(0, globalThis.scrollY - 120)
    })
    if (scrollTarget !== originalScroll.y) {
      await page.evaluate((y) => globalThis.scrollTo(globalThis.scrollX, y), scrollTarget)
      await page.waitForTimeout(350)
      selection =
        (await verifyLayoutAfterChange(
          harness.context,
          page,
          selection,
          mediaId,
          report,
          'scroll'
        )) ?? selection
      await page.evaluate(({ x, y }) => globalThis.scrollTo(x, y), {
        x: originalScroll.x,
        y: originalScroll.y
      })
      await page.waitForTimeout(350)
    } else {
      report.warnings.push('scroll: page had no usable scroll distance for anchor verification')
    }

    currentPhase = 'quick-controls-collapsed'
    const collapsed = await ensurePanelState(harness.context, selection, false)
    const collapsedAssessment = assessmentFor(collapsed.frame, mediaId)
    addAssessmentViolations(report, collapsedAssessment, 'collapsed')
    report.interactions['quickControlsCollapsed'] = {
      method: collapsed.method,
      assessment: collapsedAssessment
    }
    report.screenshots.push(
      await captureScreenshot(
        page,
        testInfo,
        artifactDirectory,
        site.id,
        'quick-controls-collapsed'
      )
    )

    currentPhase = 'quick-controls-expanded'
    const expanded = await ensurePanelState(harness.context, selection, true)
    const expandedAssessment = assessmentFor(expanded.frame, mediaId)
    addAssessmentViolations(report, expandedAssessment, 'expanded')
    if (expandedAssessment?.panelRect === null) {
      if (expandedAssessment.shadowProbeStatus === 'available') {
        report.violations.push('expanded: quick-control panel did not open')
      } else {
        report.warnings.push(
          `expanded: closed-shadow UI probe is ${expandedAssessment.shadowProbeStatus}; panel visibility is unverified`
        )
      }
    }
    if (
      expandedAssessment !== null &&
      expandedAssessment.visibleMediaCoverageRatio > MAX_MEDIA_COVERAGE_RATIO
    ) {
      report.violations.push('expanded: quick controls cover more than 20% of visible media')
    }
    if (expandedAssessment?.toolsViewportOverflow) {
      report.violations.push('expanded: quick controls overflow the viewport')
    }
    if ((expandedAssessment?.collisionCategories.length ?? 0) > 0) {
      report.warnings.push(
        'expanded: potential native control, subtitle, danmaku or ad collision detected'
      )
    }
    if (expanded.method.includes('dom')) {
      report.warnings.push(
        'expanded: real pointer interaction did not open quick controls; DOM fallback required'
      )
    }
    if (!expanded.usedTransparentHitboxEdge) {
      if (expandedAssessment?.shadowProbeStatus === 'available' || expandedAssessment === null) {
        report.violations.push(
          'expanded: transparent hover edge did not open the quick-control panel'
        )
      } else {
        report.warnings.push(
          `expanded: closed-shadow UI probe is ${expandedAssessment.shadowProbeStatus}; transparent hover edge is unverified`
        )
      }
    }
    report.interactions['quickControlsExpanded'] = {
      method: expanded.method,
      hitTarget: expanded.hitTarget,
      activationPoint: expanded.activationPoint,
      usedTransparentHitboxEdge: expanded.usedTransparentHitboxEdge,
      assessment: expandedAssessment
    }
    report.screenshots.push(
      await captureScreenshot(page, testInfo, artifactDirectory, site.id, 'quick-controls-expanded')
    )
    await ensurePanelState(harness.context, selection, false)

    currentPhase = 'hotkey-rate-and-feedback'
    state = await getMediaState(popup, page)
    const activeBeforeHotkey = activeMedia(state)
    if (activeBeforeHotkey === null)
      throw new Error('Popup did not resolve an active media instance')
    const hotkeyMediaId = activeBeforeHotkey.id
    const rateBeforeHotkey = activeBeforeHotkey.metrics.playbackRate
    const expectedHotkeyRate = rateBeforeHotkey + 0.1
    await page.bringToFront()
    await page.keyboard.press('KeyC')
    state = await waitForRate(popup, page, hotkeyMediaId, (rate) =>
      rateMatches(rate, expectedHotkeyRate)
    )
    const hotkeyMedia = mediaForId(state, hotkeyMediaId)
    const rateAfterHotkey = finiteNumberOrNull(hotkeyMedia?.metrics.playbackRate)
    const stateAfterHotkey = hotkeyMedia?.state ?? null
    const hotkeyFeedback = await waitForFeedback(harness.context, page, hotkeyMediaId, true, 1_200)
    const hotkeyFrames = await probeAllFrames(harness.context, page)
    const hotkeySelection = selectionForMedia(hotkeyFrames, hotkeyMediaId)
    const hotkeyFrame =
      hotkeySelection === null
        ? undefined
        : hotkeyFrames.find((frame) => frame.report.frameIndex === hotkeySelection.frameIndex)
            ?.report
    const hotkeyAssessment =
      hotkeyFrame === undefined ? null : assessmentFor(hotkeyFrame, hotkeyMediaId)
    const hotkeyApplied = rateMatches(rateAfterHotkey, expectedHotkeyRate)
    report.interactions['hotkeyRateUp'] = {
      mediaId: hotkeyMediaId,
      before: rateBeforeHotkey,
      after: rateAfterHotkey,
      mediaState: stateAfterHotkey,
      applied: hotkeyApplied,
      feedbackVisible: hotkeyFeedback.visible,
      feedbackProbeStatus: hotkeyFeedback.probeStatus,
      feedback: hotkeyFeedback.elements,
      assessment: hotkeyAssessment
    }
    if (!hotkeyApplied) {
      report.violations.push('hotkey: KeyC did not increase the active media rate by 0.1')
    }
    if (!hotkeyFeedback.visible) {
      if (hotkeyFeedback.probeStatus === 'available') {
        report.violations.push('hotkey: media feedback was not visible')
      } else {
        report.warnings.push(
          `hotkey: closed-shadow UI probe is ${hotkeyFeedback.probeStatus}; feedback visibility is unverified`
        )
      }
    }
    if (stateAfterHotkey === 'active' && hotkeyAssessment?.panelRect != null) {
      report.violations.push('hotkey: quick-control panel reopened during passive feedback')
    }
    addFeedbackAssessmentViolations(report, hotkeyAssessment, 'hotkey')
    await page.waitForTimeout(FEEDBACK_SETTLE_MS)
    const expiredHotkeyFeedback = await waitForFeedback(
      harness.context,
      page,
      hotkeyMediaId,
      false,
      750
    )
    if (expiredHotkeyFeedback.visible) {
      report.violations.push('hotkey: media feedback did not expire within the expected window')
    }

    currentPhase = 'popup-site-rate-and-feedback'
    state = await getMediaState(popup, page)
    const activeForRate = activeMedia(state)
    if (activeForRate === null)
      throw new Error('Active media disappeared before the site-rate command')
    const popupMediaId = activeForRate.id
    const rateResult = await setSiteRate(popup, page, popupMediaId, TARGET_RATE)
    state = await waitForRate(popup, page, popupMediaId, (rate) => rateMatches(rate, TARGET_RATE))
    const popupMedia = mediaForId(state, popupMediaId)
    const rateAfterPopup = finiteNumberOrNull(popupMedia?.metrics.playbackRate)
    const stateAfterPopup = popupMedia?.state ?? null
    const popupFeedback = await waitForFeedback(harness.context, page, popupMediaId, true, 1_200)
    const popupFrames = await probeAllFrames(harness.context, page)
    const popupSelection = selectionForMedia(popupFrames, popupMediaId)
    const popupFrame =
      popupSelection === null
        ? undefined
        : popupFrames.find((frame) => frame.report.frameIndex === popupSelection.frameIndex)?.report
    const popupAssessment =
      popupFrame === undefined ? null : assessmentFor(popupFrame, popupMediaId)
    report.interactions['popupSiteRate'] = {
      mediaId: popupMediaId,
      commandOk: rateResult.result.ok,
      target: TARGET_RATE,
      actual: rateAfterPopup,
      mediaState: stateAfterPopup,
      feedbackVisible: popupFeedback.visible,
      feedbackProbeStatus: popupFeedback.probeStatus,
      feedback: popupFeedback.elements,
      assessment: popupAssessment
    }
    if (site.id === 'tencent-video') {
      report.interactions['popupTencentRateEvidence'] = await collectTencentRateEvidence(page)
      report.interactions['popupTencentAdapters'] = state.adapters
    }
    if (!rateResult.result.ok || !rateMatches(rateAfterPopup, TARGET_RATE)) {
      report.violations.push('popup: site-scoped playback rate did not reach the requested value')
    }
    if (!popupFeedback.visible) {
      if (popupFeedback.probeStatus === 'available') {
        report.violations.push('popup: media feedback was not visible')
      } else {
        report.warnings.push(
          `popup: closed-shadow UI probe is ${popupFeedback.probeStatus}; feedback visibility is unverified`
        )
      }
    }
    if (stateAfterPopup === 'active' && popupAssessment?.panelRect != null) {
      report.violations.push('popup: quick-control panel reopened during passive feedback')
    }
    addFeedbackAssessmentViolations(report, popupAssessment, 'popup')
    report.screenshots.push(
      await captureScreenshot(page, testInfo, artifactDirectory, site.id, 'rate-feedback')
    )
    currentPhase = 'site-segment-transition'
    await runSiteTransitionFlow(site, report, harness, page, popup, testInfo, artifactDirectory)
    await popup.close()

    currentPhase = 'reload-rate-inheritance'
    await page.reload({ waitUntil: 'domcontentloaded' })
    const reloadedMedia = await waitForReloadedMedia(harness.context, page, site, mediaWaitMs)
    if (reloadedMedia === null || 'externalBlock' in reloadedMedia) {
      const reloadExternalBlock =
        reloadedMedia !== null && 'externalBlock' in reloadedMedia
          ? reloadedMedia.externalBlock
          : classifyExternalBlock(null, page.url(), hostnamesForSite(site))
      report.interactions['reloadInheritance'] = {
        target: TARGET_RATE,
        actual: null,
        inherited: false,
        mediaReturned: false,
        externalBlock: reloadExternalBlock
      }
      if (reloadExternalBlock !== null) {
        reloadExternallyBlocked = true
        report.warnings.push(`reload: external site block (${reloadExternalBlock})`)
      } else {
        report.violations.push(
          'reload: visible content media did not return for playback-rate inheritance validation'
        )
      }
      report.screenshots.push(
        await captureScreenshot(page, testInfo, artifactDirectory, site.id, 'reload-unavailable')
      )
    } else {
      let reloadSelection = reloadedMedia.selection
      await scrollAndStartMedia(reloadSelection)
      await page.waitForTimeout(500)
      const initialReloadMediaId = reloadSelection.media.mediaId
      if (initialReloadMediaId === null) {
        throw new Error('Reloaded live media lost its stable id')
      }
      const initialReloadFrameId = frameIdForMediaId(initialReloadMediaId)
      if (initialReloadFrameId === null) {
        throw new Error('Reloaded live media id does not identify its frame')
      }
      popup = await harness.openPopup(page)
      let reloadedState = await readTargetMediaState(popup, page, initialReloadFrameId)
      probedFrames = await waitForInstanceUiMapping(harness.context, page)
      const activeAfterReload = activeMedia(reloadedState, reloadSelection.media.mediaId)
      reloadSelection =
        (activeAfterReload === null
          ? null
          : selectionForMedia(probedFrames, activeAfterReload.id)) ??
        chooseMedia(probedFrames, reloadSelection.media.mediaId) ??
        reloadSelection
      const reloadMediaId = reloadSelection.media.mediaId
      if (reloadMediaId === null) {
        throw new Error('Reloaded live media lost its stable id')
      }
      const reloadFrameId = frameIdForMediaId(reloadMediaId)
      if (reloadFrameId === null) {
        throw new Error('Reloaded live media id does not identify its frame')
      }
      reloadedState = await waitForRate(
        popup,
        page,
        reloadMediaId,
        (rate) => rateMatches(rate, TARGET_RATE),
        6_000,
        reloadFrameId
      )
      const inheritedRate = finiteNumberOrNull(
        mediaForId(reloadedState, reloadMediaId)?.metrics.playbackRate
      )
      const inherited = rateMatches(inheritedRate, TARGET_RATE)
      report.interactions['reloadRuntimeMedia'] = mediaForId(reloadedState, reloadMediaId)
      if (site.id === 'tencent-video') {
        report.interactions['reloadTencentRateEvidence'] = await collectTencentRateEvidence(page)
        report.interactions['reloadTencentAdapters'] = reloadedState.adapters
      }
      report.interactions['reloadInheritance'] = {
        mediaId: reloadMediaId,
        target: TARGET_RATE,
        actual: inheritedRate,
        inherited
      }
      if (!inherited) {
        report.violations.push('reload: the site-scoped playback rate was not inherited')
      }
      addInstanceUiMappingViolations(report, probedFrames, 'reload')
      const reloadFrame = probedFrames.find(
        (frame) => frame.report.frameIndex === reloadSelection.frameIndex
      )?.report
      const reloadAssessment =
        reloadFrame === undefined ? null : assessmentFor(reloadFrame, reloadMediaId)
      addAssessmentViolations(report, reloadAssessment, 'reload')

      const reloadExpanded = await ensurePanelState(harness.context, reloadSelection, true)
      const reloadExpandedAssessment = assessmentFor(reloadExpanded.frame, reloadMediaId)
      report.interactions['reloadQuickControlsExpanded'] = {
        method: reloadExpanded.method,
        hitTarget: reloadExpanded.hitTarget,
        activationPoint: reloadExpanded.activationPoint,
        usedTransparentHitboxEdge: reloadExpanded.usedTransparentHitboxEdge,
        assessment: reloadExpandedAssessment
      }
      if (reloadExpandedAssessment?.panelRect === null) {
        if (reloadExpandedAssessment.shadowProbeStatus === 'available') {
          report.violations.push('reload: quick-control panel did not open')
        } else {
          report.warnings.push(
            `reload: closed-shadow UI probe is ${reloadExpandedAssessment.shadowProbeStatus}; panel visibility is unverified`
          )
        }
      }
      if (reloadExpanded.method.includes('dom')) {
        report.warnings.push(
          'reload: real pointer interaction did not open quick controls; DOM fallback required'
        )
      }
      if (!reloadExpanded.usedTransparentHitboxEdge) {
        if (
          reloadExpandedAssessment?.shadowProbeStatus === 'available' ||
          reloadExpandedAssessment === null
        ) {
          report.violations.push(
            'reload: transparent hover edge did not open the quick-control panel'
          )
        } else {
          report.warnings.push(
            `reload: closed-shadow UI probe is ${reloadExpandedAssessment.shadowProbeStatus}; transparent hover edge is unverified`
          )
        }
      }
      report.screenshots.push(
        await captureScreenshot(
          page,
          testInfo,
          artifactDirectory,
          site.id,
          'reload-quick-controls-expanded'
        )
      )
      await ensurePanelState(harness.context, reloadSelection, false)
      await popup.close()
      report.screenshots.push(
        await captureScreenshot(page, testInfo, artifactDirectory, site.id, 'reload-inheritance')
      )
    }

    report.frames = (await probeAllFrames(harness.context, page)).map((item) => item.report)
    report.outcome =
      reloadExternallyBlocked && report.violations.length === 0
        ? 'blocked'
        : report.violations.length === 0
          ? 'passed'
          : 'failed'
  } catch (error) {
    report.terminalPhase = currentPhase
    report.fatalError = errorFingerprint(error)
    report.violations.push(`fatal: ${report.fatalError.name}`)
    report.outcome = 'failed'
    if (page !== null && !page.isClosed()) {
      const fatalScreenshot = await captureScreenshot(
        page,
        testInfo,
        artifactDirectory,
        site.id,
        'fatal'
      ).catch(() => null)
      if (fatalScreenshot !== null) report.screenshots.push(fatalScreenshot)
      if (report.frames.length === 0) {
        report.frames = (await probeAllFrames(harness?.context ?? page.context(), page)).map(
          (item) => item.report
        )
      }
    }
  } finally {
    if (traceStarted && harness !== null) {
      const tracePath = path.join(artifactDirectory, 'trace.zip')
      const traceWritten = await harness.context.tracing
        .stop({ path: tracePath })
        .then(() => true)
        .catch(() => false)
      if (traceWritten) {
        await testInfo.attach(`${site.id}-trace`, {
          path: tracePath,
          contentType: 'application/zip'
        })
      }
    }
    await page?.close().catch(() => undefined)
    await harness?.close().catch(() => undefined)
    const finishedAt = new Date()
    report.finishedAt = finishedAt.toISOString()
    report.durationMs = finishedAt.getTime() - startedAt.getTime()
    if (report.outcome === 'failed' && report.violations.length === 0) {
      report.violations.push('Live smoke ended without a terminal outcome')
    }
    await writeReport(report, testInfo, artifactDirectory)
  }
  return report
}
