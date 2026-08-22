import { expect, test, type CDPSession, type Page } from '@playwright/test'
import {
  mediaCommandResultResponseSchema,
  mediaPageStateSchema,
  type MediaPageState
} from '../../src/application/media'
import {
  settingsMutationResponseSchema,
  settingsSnapshotResponseSchema
} from '../../src/application/settings/contracts'
import type { MediaCommand } from '../../src/domain/command'
import { createRuntimeRequest, parseRuntimeResponse } from '../../src/shared/protocol'
import { launchExtensionHarness, type ExtensionHarness } from './extension-harness'

const CURRENT_FIXTURE_PERMISSION = 'http://127.0.0.1:47173/*'
const CROSS_ORIGIN_FIXTURE_PERMISSION = 'http://127.0.0.1:47174/*'

const configuredChurnDurationMs = (() => {
  const parsed = Number(process.env['H5PLAYER_CHURN_DURATION_MS'] ?? 0)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
})()

const mediaHostSelector = '[data-h5p-ext-media-host="ready"]'
const pageFeedbackHostSelector = '[data-h5p-ext-page-feedback-host="ready"]'

type HostileMediaFixtureWindow = Window & {
  hostileMediaFixture?: {
    ready: boolean
    attempts: Record<'playbackRate' | 'volume' | 'muted' | 'currentTime', number>
  }
}

type ChromiumExtensionError = Readonly<{
  message?: string
  source?: string
  stackTrace?: readonly Readonly<{ url?: string; lineNumber?: number }>[]
}>

type ChromiumExtensionInfo = Readonly<{
  manifestErrors?: readonly ChromiumExtensionError[]
  runtimeErrors?: readonly ChromiumExtensionError[]
}>

type ContentLifecycleDiagnostics = Readonly<{
  mediaUiHosts: number
  pendingMounts: number
  feedbackTimers: number
  pageFeedbackVisible: boolean
  downloadPromptOpen: boolean
  anchor: Readonly<{
    anchors: number
    mutationObservers: number
    resizeObserver: boolean
    refreshQueued: boolean
  }>
}>

type PageLifecycleDiagnostics = Readonly<{
  mediaRuntime: Readonly<{
    discovery: Readonly<{
      mediaRecords: number
      mutationObservers: number
      resizeObserver: boolean
      intersectionObserver: boolean
      presentationRefreshTimer: boolean
      pendingControllerChanges: number
      reconcileQueued: boolean
      controllerFlushQueued: boolean
    }>
    authority: Readonly<{
      bindings: number
      protectedBindings: number
      blockedWrites: number
      generation: number
    }> | null
    viewportController: boolean
  }> | null
  authority: Readonly<{
    bindings: number
    protectedBindings: number
    blockedWrites: number
    generation: number
  }>
  session: 'none' | 'ready'
}>

type LifecycleDiagnostics = Readonly<{
  content: ContentLifecycleDiagnostics
  page: PageLifecycleDiagnostics
}>

async function expectRuntimeAbsent(page: Page): Promise<void> {
  for (const attribute of [
    'data-h5player-webext-content',
    'data-h5player-webext-main',
    'data-h5player-webext-bridge',
    'data-h5player-webext-background',
    'data-h5player-webext-media'
  ]) {
    await expect(page.locator('html')).not.toHaveAttribute(attribute, /.+/)
  }
}

async function expectRuntimeReady(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-h5player-webext-content', 'ready')
  await expect(page.locator('html')).toHaveAttribute('data-h5player-webext-main', 'ready')
  await expect(page.locator('html')).toHaveAttribute('data-h5player-webext-bridge', 'ready')
  await expect(page.locator('html')).toHaveAttribute('data-h5player-webext-background', 'ready')
  await expect(page.locator('html')).toHaveAttribute('data-h5player-webext-media', 'ready')
}

async function clickPopupButton(popup: Page, targetPage: Page, name: string): Promise<void> {
  await targetPage.bringToFront()
  const button = popup.getByRole('button', { name, exact: true })
  await expect(button).toBeEnabled()
  await button.evaluate((element) => (element as HTMLButtonElement).click())
}

async function setPopupToggle(
  popup: Page,
  targetPage: Page,
  name: string,
  checked: boolean
): Promise<void> {
  const checkbox = popup.getByRole('checkbox', { name, exact: true })
  if ((await checkbox.isChecked()) === checked) return
  await targetPage.bringToFront()
  await checkbox.evaluate((input) => (input as HTMLInputElement).click())
  if (checked) await expect(checkbox).toBeChecked()
  else await expect(checkbox).not.toBeChecked()
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

async function getMediaStateFromPopup(popup: Page, targetPage: Page): Promise<MediaPageState> {
  const request = createRuntimeRequest('popup', 'media.get-state', {})
  const response = parseRuntimeResponse(await sendPopupRuntimeRequest(popup, targetPage, request))
  if (
    response?.type !== 'protocol.response' ||
    response.requestId !== request.requestId ||
    response.payload.requestType !== request.type
  ) {
    throw new Error('Media state request failed during E2E')
  }
  return mediaPageStateSchema.parse(response.payload.data)
}

async function executeMediaFromPopup(
  popup: Page,
  targetPage: Page,
  command: MediaCommand,
  playbackRateScope?: 'site' | 'page' | 'media'
) {
  const request = createRuntimeRequest('popup', 'media.execute', {
    command,
    ...(playbackRateScope === undefined ? {} : { playbackRateScope })
  })
  const response = parseRuntimeResponse(await sendPopupRuntimeRequest(popup, targetPage, request))
  if (
    response?.type !== 'protocol.response' ||
    response.requestId !== request.requestId ||
    response.payload.requestType !== request.type
  ) {
    throw new Error('Media command failed during E2E')
  }
  return mediaCommandResultResponseSchema.parse(response.payload.data)
}

async function getSettingsRevision(popup: Page, targetPage: Page): Promise<number> {
  const request = createRuntimeRequest('popup', 'settings.get', {})
  const response = parseRuntimeResponse(await sendPopupRuntimeRequest(popup, targetPage, request))
  if (
    response?.type !== 'protocol.response' ||
    response.requestId !== request.requestId ||
    response.payload.requestType !== request.type
  ) {
    throw new Error('Settings request failed during E2E')
  }
  return settingsSnapshotResponseSchema.parse(response.payload.data).settings.revision
}

async function updateGlobalProtection(
  extensionPage: Page,
  targetPage: Page,
  expectedRevision: number,
  policies: Readonly<{
    protectPlaybackRate: boolean
    protectCurrentTime: boolean
    protectVolume: boolean
  }>
): Promise<number> {
  const request = createRuntimeRequest('options', 'settings.update', {
    patch: { global: { policies } },
    expectedRevision
  })
  const response = parseRuntimeResponse(
    await sendPopupRuntimeRequest(extensionPage, targetPage, request)
  )
  if (
    response?.type !== 'protocol.response' ||
    response.requestId !== request.requestId ||
    response.payload.requestType !== request.type
  ) {
    throw new Error('Protection policy update failed during E2E')
  }
  return settingsMutationResponseSchema.parse(response.payload.data).settings.revision
}

async function mediaIdFor(page: Page, selector: string): Promise<string> {
  const id = await page.locator(selector).getAttribute('data-h5player-webext-media-id')
  if (!id) throw new Error(`Media id unavailable for ${selector}`)
  return id
}

async function expectUniqueMediaHost(page: Page, selector: string): Promise<string> {
  const id = await mediaIdFor(page, selector)
  await expect(page.locator(`${mediaHostSelector}[data-media-id="${id}"]`)).toHaveCount(1)
  return id
}

async function expectHostAnchored(page: Page, selector: string): Promise<void> {
  const id = await mediaIdFor(page, selector)
  const host = page.locator(`${mediaHostSelector}[data-media-id="${id}"]`)
  await expect(host).toHaveCount(1)
  await expect(host).toHaveCSS('visibility', 'visible')
  await expect
    .poll(async () => {
      const geometry = await anchoredHostGeometry(page, selector, id)
      if (geometry === null) return Number.POSITIVE_INFINITY
      return geometry.distance
    })
    .toBeLessThanOrEqual(8)
}

async function anchoredHostGeometry(page: Page, selector: string, id: string) {
  return page.evaluate(
    ({ mediaSelector, hostSelector }) => {
      const media = document.querySelector(mediaSelector)
      const shadowHost = document.querySelector(hostSelector)
      if (!(media instanceof HTMLElement) || !(shadowHost instanceof HTMLElement)) return null
      const mediaRect = media.getBoundingClientRect()
      const hostRect = shadowHost.getBoundingClientRect()
      const targetX = mediaRect.x + mediaRect.width - 8
      const targetY = mediaRect.y + 8
      return {
        media: { x: mediaRect.x, y: mediaRect.y, width: mediaRect.width },
        host: {
          x: hostRect.x,
          y: hostRect.y,
          left: shadowHost.style.getPropertyValue('left'),
          top: shadowHost.style.getPropertyValue('top'),
          position: getComputedStyle(shadowHost).position
        },
        target: { x: targetX, y: targetY },
        distance: Math.max(Math.abs(hostRect.x - targetX), Math.abs(hostRect.y - targetY))
      }
    },
    { mediaSelector: selector, hostSelector: `${mediaHostSelector}[data-media-id="${id}"]` }
  )
}

async function grantedOrigins(extensionPage: Page): Promise<readonly string[]> {
  return extensionPage.evaluate(async () => {
    const api = (
      globalThis as unknown as {
        chrome: { permissions: { getAll(): Promise<{ origins?: string[] }> } }
      }
    ).chrome
    return (await api.permissions.getAll()).origins ?? []
  })
}

async function registeredContentScriptIds(extensionPage: Page): Promise<readonly string[]> {
  return extensionPage.evaluate(async () => {
    const api = (
      globalThis as unknown as {
        chrome: {
          scripting: {
            getRegisteredContentScripts(): Promise<readonly { id: string }[]>
          }
        }
      }
    ).chrome
    return (await api.scripting.getRegisteredContentScripts()).map((script) => script.id).sort()
  })
}

async function pageRuntimeListenerCount(session: CDPSession): Promise<number> {
  const evaluated = await session.send('Runtime.evaluate', { expression: 'window' })
  const objectId = evaluated.result.objectId
  if (!objectId) throw new Error('Unable to inspect page window listeners')
  try {
    const result = await session.send('DOMDebugger.getEventListeners', { objectId })
    const runtimeEvents = new Set(['message', 'pageshow', 'popstate', 'hashchange'])
    return result.listeners.filter((listener) => runtimeEvents.has(listener.type)).length
  } finally {
    await session.send('Runtime.releaseObject', { objectId })
  }
}

async function pageDocumentListenerCount(session: CDPSession): Promise<number> {
  const evaluated = await session.send('Runtime.evaluate', { expression: 'document' })
  const objectId = evaluated.result.objectId
  if (!objectId) throw new Error('Unable to inspect page document listeners')
  try {
    const result = await session.send('DOMDebugger.getEventListeners', { objectId })
    const runtimeEvents = new Set(['message', 'pageshow', 'popstate', 'hashchange', 'scroll'])
    return result.listeners.filter((listener) => runtimeEvents.has(listener.type)).length
  } finally {
    await session.send('Runtime.releaseObject', { objectId })
  }
}

async function extensionHostCount(page: Page): Promise<number> {
  return page
    .locator(
      [
        '[data-h5p-ext-media-host="ready"]',
        '[data-h5p-ext-page-feedback-host="ready"]',
        '[data-h5p-ext-download-prompt-host="ready"]'
      ].join(', ')
    )
    .count()
}

async function lifecycleDiagnostics(page: Page): Promise<LifecycleDiagnostics> {
  return page.evaluate(() => {
    const root = document.documentElement
    const content = root.dataset['h5playerWebextContentDiagnostics']
    const pageMain = root.dataset['h5playerWebextPageDiagnostics']
    if (!content || !pageMain) throw new Error('Extension lifecycle diagnostics are unavailable')
    return {
      content: JSON.parse(content) as ContentLifecycleDiagnostics,
      page: JSON.parse(pageMain) as PageLifecycleDiagnostics
    }
  })
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length
}

async function pageHeapSize(session: CDPSession): Promise<number> {
  await session.send('HeapProfiler.collectGarbage')
  const result = await session.send('Performance.getMetrics')
  return result.metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value ?? 0
}

async function restartExtensionWorkerAndWait(
  harness: ExtensionHarness,
  wakeWorker: () => Promise<unknown>
): Promise<
  Readonly<{
    previousTargetId: string
    nextTargetId: string
    previousGeneration: string
    nextGeneration: string
  }>
> {
  const before = (await harness.browserSession.send('Target.getTargets', {
    filter: [{ type: 'service_worker' }]
  })) as { targetInfos: Array<{ targetId: string; url: string }> }
  const previousWorker = before.targetInfos.find((target) =>
    target.url.includes(harness.extensionId)
  )
  if (!previousWorker) throw new Error('Extension service worker unavailable before restart')
  const worker = harness.context
    .serviceWorkers()
    .find((candidate) => candidate.url().includes(harness.extensionId))
  if (!worker) throw new Error('Extension worker execution context unavailable before restart')
  const generationKey = '__h5playerE2eWorkerGeneration'
  const previousGeneration = `${Date.now()}-${Math.random()}`
  await worker.evaluate(({ key, value }) => Reflect.set(globalThis, key, value), {
    key: generationKey,
    value: previousGeneration
  })
  await harness.browserSession.send('Target.closeTarget', {
    targetId: previousWorker.targetId
  })
  await wakeWorker().catch(() => undefined)
  let nextGeneration = previousGeneration
  await expect
    .poll(async () => {
      const activeWorker = harness.context
        .serviceWorkers()
        .find((candidate) => candidate.url().includes(harness.extensionId))
      if (!activeWorker) return previousGeneration
      try {
        const marker: unknown = await activeWorker.evaluate(
          (key) => (globalThis as unknown as Record<string, unknown>)[key],
          generationKey
        )
        if (marker === previousGeneration) return previousGeneration
        nextGeneration = `${Date.now()}-${Math.random()}`
        await activeWorker.evaluate(({ key, value }) => Reflect.set(globalThis, key, value), {
          key: generationKey,
          value: nextGeneration
        })
        return nextGeneration
      } catch {
        return previousGeneration
      }
    })
    .not.toBe(previousGeneration)
  const after = (await harness.browserSession.send('Target.getTargets', {
    filter: [{ type: 'service_worker' }]
  })) as { targetInfos: Array<{ targetId: string; url: string }> }
  const nextWorker = after.targetInfos.find((target) => target.url.includes(harness.extensionId))
  if (!nextWorker) throw new Error('Extension service worker unavailable after restart')
  return {
    previousTargetId: previousWorker.targetId,
    nextTargetId: nextWorker.targetId,
    previousGeneration,
    nextGeneration
  }
}

async function extensionRuntimeErrors(harness: ExtensionHarness): Promise<readonly string[]> {
  const errorsPage = await harness.context.newPage()
  try {
    await errorsPage.goto(`chrome://extensions/?errors=${harness.extensionId}`)
    return await errorsPage.evaluate(async (extensionId) => {
      const chromeApi = (
        globalThis as unknown as {
          chrome: {
            runtime: { lastError?: { message?: string } }
            developerPrivate?: {
              getExtensionInfo(id: string, callback: (info: ChromiumExtensionInfo) => void): void
            }
          }
        }
      ).chrome
      const developerPrivate = chromeApi.developerPrivate
      if (developerPrivate === undefined) {
        throw new Error('chrome.developerPrivate is unavailable on the extensions error page')
      }
      const info = await new Promise<ChromiumExtensionInfo>((resolve, reject) => {
        developerPrivate.getExtensionInfo(extensionId, (result) => {
          const runtimeError = chromeApi.runtime.lastError
          if (runtimeError?.message) {
            reject(new Error(runtimeError.message))
            return
          }
          resolve(result)
        })
      })
      return [...(info.manifestErrors ?? []), ...(info.runtimeErrors ?? [])].map((error) => {
        const location = error.stackTrace?.[0]
        const source = location?.url ?? error.source ?? ''
        const line = location?.lineNumber
        return [error.message ?? '', source, line === undefined ? '' : String(line)]
          .filter(Boolean)
          .join(' | ')
      })
    }, harness.extensionId)
  } finally {
    await errorsPage.close().catch(() => undefined)
  }
}

test('keeps pages untouched before authorization and reports denied or restricted access', async ({
  baseURL
}) => {
  const harness = await launchExtensionHarness({ denyPermissionRequests: true })
  try {
    const page = await harness.context.newPage()
    await page.goto(`${baseURL}/basic.html`)
    await expectRuntimeAbsent(page)

    const popup = await harness.openPopup(page)
    await expect(popup.getByTestId('phase-status')).toContainText('需要先授予当前站点权限')
    await expect(popup.getByRole('button', { name: '允许当前站点' })).toBeVisible()
    await page.bringToFront()
    await popup.getByRole('button', { name: '允许当前站点' }).click()
    await expect(popup.getByRole('alert')).toContainText('权限未授予')
    expect(await grantedOrigins(popup)).toEqual([])
    await expectRuntimeAbsent(page)
    await popup.close()

    const restricted = await harness.context.newPage()
    await restricted.goto('chrome://extensions/')
    const restrictedPopup = await harness.openPopup(restricted)
    await expect(restrictedPopup.getByTestId('phase-status')).toContainText(
      '浏览器保护页不允许扩展运行'
    )
  } finally {
    await harness.close()
  }
})

test('controls media, applies hotkey policies, recovers the worker and revokes current-site access', async ({
  baseURL
}) => {
  const harness = await launchExtensionHarness({
    grantedOrigins: [CURRENT_FIXTURE_PERMISSION]
  })
  try {
    const page = await harness.context.newPage()
    await page.goto(`${baseURL}/basic.html`)
    await expectRuntimeReady(page)

    let popup = await harness.openPopup(page)
    const initialRevision = await getSettingsRevision(popup, page)
    await expect(popup.getByTestId('phase-status')).toContainText('媒体控制已就绪')
    await expect(popup.getByTestId('active-media')).toContainText('视频 · 已暂停')

    await clickPopupButton(popup, page, '降低音量')
    await expect
      .poll(() => page.locator('video').evaluate((media) => (media as HTMLVideoElement).volume))
      .toBe(0.95)
    await clickPopupButton(popup, page, '加速')
    await expect
      .poll(() =>
        page.locator('video').evaluate((media) => (media as HTMLVideoElement).playbackRate)
      )
      .toBe(1.1)
    await expect(page.locator(mediaHostSelector)).toHaveCount(1)
    await clickPopupButton(popup, page, '临时隐藏本页控件')
    await expect.poll(() => page.locator(mediaHostSelector).count()).toBe(0)
    await page.bringToFront()
    await page.keyboard.press('KeyC')
    await expect
      .poll(() =>
        page.locator('video').evaluate((media) => (media as HTMLVideoElement).playbackRate)
      )
      .toBe(1.2)
    await clickPopupButton(popup, page, '恢复本页控件')
    await expect.poll(() => page.locator(mediaHostSelector).count()).toBe(1)
    await clickPopupButton(popup, page, '静音')
    await expect
      .poll(() => page.locator('video').evaluate((media) => (media as HTMLVideoElement).muted))
      .toBe(true)

    await page.bringToFront()
    await page.keyboard.press('ArrowRight')
    await expect
      .poll(() =>
        page.locator('video').evaluate((media) => (media as HTMLVideoElement).currentTime)
      )
      .toBe(5)

    await page.evaluate(() => {
      const input = document.createElement('input')
      input.id = 'hotkey-editable-fixture'
      document.body.append(input)
    })
    await page.locator('#hotkey-editable-fixture').focus()
    await page.keyboard.press('ArrowRight')
    await expect
      .poll(() =>
        page.locator('video').evaluate((media) => (media as HTMLVideoElement).currentTime)
      )
      .toBe(5)
    await page.locator('#hotkey-editable-fixture').evaluate((input) => input.remove())

    await clickPopupButton(popup, page, '本页临时停用')
    await expect(popup.getByTestId('phase-status')).toContainText('当前页面已临时停用')
    await page.bringToFront()
    await page.keyboard.press('ArrowRight')
    await expect
      .poll(() =>
        page.locator('video').evaluate((media) => (media as HTMLVideoElement).currentTime)
      )
      .toBe(5)
    await clickPopupButton(popup, page, '恢复本页运行')
    await expect(popup.getByTestId('phase-status')).toContainText('媒体控制已就绪')

    await setPopupToggle(popup, page, '在此站点运行', false)
    await expect(popup.getByTestId('phase-status')).toContainText('当前站点已停用')
    await page.bringToFront()
    await page.keyboard.press('ArrowRight')
    await expect
      .poll(() =>
        page.locator('video').evaluate((media) => (media as HTMLVideoElement).currentTime)
      )
      .toBe(5)
    await setPopupToggle(popup, page, '在此站点运行', true)

    await restartExtensionWorkerAndWait(harness, () => getSettingsRevision(popup, page))
    await popup.close()
    popup = await harness.openPopup(page)
    await expect(popup.getByTestId('phase-status')).toContainText('媒体控制已就绪')
    const persistedRevision = await getSettingsRevision(popup, page)
    expect(persistedRevision).toBeGreaterThan(initialRevision)
    await expect(popup.getByText('速度', { exact: true }).locator('..')).toContainText('1.2×')
    await expect(popup.getByText('已静音')).toBeVisible()

    await clickPopupButton(popup, page, '撤销当前站点权限')
    await expect(popup.getByTestId('phase-status')).toContainText('需要先授予当前站点权限')
    expect(await grantedOrigins(popup)).toEqual([])
    expect(await registeredContentScriptIds(popup)).toEqual([])
    await page.reload()
    await expectRuntimeAbsent(page)
  } finally {
    await harness.close()
  }
})

test('contains BFCache port closures and extension reload invalidation errors', async ({
  baseURL
}) => {
  const harness = await launchExtensionHarness({
    enableBackForwardCache: true,
    loadExtensionViaCdp: true,
    grantedOrigins: [CURRENT_FIXTURE_PERMISSION]
  })
  try {
    const page = await harness.context.newPage()
    await page.addInitScript(() => {
      Reflect.set(globalThis, '__h5playerBfcacheRestored', false)
      window.addEventListener('pageshow', (event) => {
        if (event.persisted) Reflect.set(globalThis, '__h5playerBfcacheRestored', true)
      })
    })
    await page.goto(`${baseURL}/basic.html`)
    await expectRuntimeReady(page)
    await expect(extensionRuntimeErrors(harness)).resolves.toEqual([])

    await page.goto(`${baseURL}/spa.html`)
    await expectRuntimeReady(page)
    await page.goBack({ waitUntil: 'commit' })
    await expect
      .poll(() =>
        page.evaluate(() => Reflect.get(globalThis, '__h5playerBfcacheRestored') === true)
      )
      .toBe(true)
    await expectRuntimeReady(page)
    await page.keyboard.press('KeyC')
    await expect
      .poll(() =>
        page.locator('video').evaluate((media) => (media as HTMLVideoElement).playbackRate)
      )
      .toBe(1.1)

    const afterBfcache = await extensionRuntimeErrors(harness)
    expect(afterBfcache.join('\n')).not.toMatch(/back\/forward cache|message channel is closed/i)

    await harness.reloadExtension()
    await expect.poll(() => page.locator(mediaHostSelector).count()).toBe(0)

    const afterReload = await extensionRuntimeErrors(harness)
    expect(afterReload.join('\n')).not.toMatch(/extension context invalidated/i)

    const extensionPage = await harness.context.newPage()
    await extensionPage.goto(`chrome-extension://${harness.extensionId}/popup.html`)
    await expect
      .poll(() => registeredContentScriptIds(extensionPage))
      .toEqual(['h5player-content-v3', 'h5player-page-main-v3'])
    await extensionPage.close()
    await page.reload()
    await expectRuntimeReady(page)
    const popup = await harness.openPopup(page)
    await expect(popup.getByTestId('phase-status')).toContainText('媒体控制已就绪')
  } finally {
    await harness.close()
  }
})

test('runs across lifecycle fixtures with all-sites access and revokes it from Options', async ({
  baseURL
}) => {
  const harness = await launchExtensionHarness({ grantedOrigins: ['<all_urls>'] })
  try {
    const page = await harness.context.newPage()
    await page.goto(`${baseURL}/multi-player.html`)
    await expectRuntimeReady(page)
    let popup = await harness.openPopup(page)
    await clickPopupButton(popup, page, '降低音量')
    await expect
      .poll(() => page.locator('#primary').evaluate((media) => (media as HTMLVideoElement).volume))
      .toBe(0.95)
    await expect
      .poll(() =>
        page.locator('#secondary').evaluate((media) => (media as HTMLVideoElement).volume)
      )
      .toBe(1)
    await popup.close()

    await page.goto(`${baseURL}/spa.html`)
    await expectRuntimeReady(page)
    popup = await harness.openPopup(page)
    await expect(popup.getByTestId('phase-status')).toContainText('当前页面没有可控制媒体')
    await popup.close()
    await page.getByRole('button', { name: 'Add media' }).click()
    popup = await harness.openPopup(page)
    await expect(popup.getByTestId('active-media')).toContainText('视频')
    await popup.close()
    await page.getByRole('button', { name: 'Remove media' }).click()

    await page.goto(`${baseURL}/shadow-dom.html`)
    await expectRuntimeReady(page)
    popup = await harness.openPopup(page)
    await clickPopupButton(popup, page, '静音')
    await expect
      .poll(() =>
        page.locator('media-shell').evaluate((host) => {
          const media = host.shadowRoot?.querySelector('video')
          return media?.muted ?? false
        })
      )
      .toBe(true)
    await popup.close()

    await page.goto(`${baseURL}/hostile-page.html`)
    await expectRuntimeReady(page)
    await page.goto(`${baseURL}/strict-csp.html`)
    await expectRuntimeReady(page)
    await page.goto(`${baseURL}/iframe.html`)
    await expectRuntimeReady(page)
    for (const frame of page.frames().filter((candidate) => candidate !== page.mainFrame())) {
      await expect
        .poll(() => frame.locator('html').getAttribute('data-h5player-webext-media'))
        .toBe('ready')
    }

    const options = await harness.context.newPage()
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#/sites`)
    await expect(options.getByRole('heading', { name: '站点规则' })).toBeVisible()
    await expect(options.getByText('<all_urls>')).toBeVisible()
    await options.getByRole('button', { name: '撤销所有站点权限' }).click()
    const dialog = options.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '撤销所有站点权限' }).click()
    await expect(options.getByText('尚未授予任何网页访问权限')).toBeVisible()
    expect(await grantedOrigins(options)).toEqual([])
    expect(await registeredContentScriptIds(options)).toEqual([])

    await page.reload()
    await expectRuntimeAbsent(page)
  } finally {
    await harness.close()
  }
})

test('keeps iframe-only media ownership, page controls and registry lifecycle coherent', async ({
  baseURL
}) => {
  const harness = await launchExtensionHarness({ grantedOrigins: [CURRENT_FIXTURE_PERMISSION] })
  try {
    const page = await harness.context.newPage()
    await page.goto(`${baseURL}/iframe-only.html`)
    await expectRuntimeReady(page)
    await expect(page.locator(mediaHostSelector)).toHaveCount(0)

    const child = page.frames().find((frame) => frame !== page.mainFrame())
    if (!child) throw new Error('iframe-only child frame unavailable')
    await expect
      .poll(() => child.locator('html').getAttribute('data-h5player-webext-media'))
      .toBe('ready')
    await expect(child.locator(mediaHostSelector)).toHaveCount(1)

    let popup = await harness.openPopup(page)
    await expect(popup.getByTestId('phase-status')).toContainText('媒体位于嵌入式播放器中')
    await expect(popup.getByTestId('active-media')).toContainText('视频')
    const childState = await getMediaStateFromPopup(popup, page)
    const childMedia = childState.media.find((media) => media.id === childState.activeMediaId)
    if (!childMedia) throw new Error('iframe-only active media unavailable')
    expect(childMedia.frameId).not.toBe(0)
    const routedCommand = await executeMediaFromPopup(popup, page, {
      type: 'media.adjust-rate',
      mediaId: childMedia.id,
      delta: 0.1
    })
    expect(routedCommand.result.ok).toBe(true)

    await clickPopupButton(popup, page, '临时隐藏本页控件')
    await expect.poll(() => child.locator(mediaHostSelector).count()).toBe(0)
    await clickPopupButton(popup, page, '恢复本页控件')
    await expect.poll(() => child.locator(mediaHostSelector).count()).toBe(1)

    await clickPopupButton(popup, page, '本页临时停用')
    await expect.poll(() => child.locator(mediaHostSelector).count()).toBe(0)
    await clickPopupButton(popup, page, '恢复本页运行')
    await expect.poll(() => child.locator(mediaHostSelector).count()).toBe(1)

    await page.getByRole('button', { name: 'Reload frame' }).click()
    await expect
      .poll(() => page.frames().filter((frame) => frame !== page.mainFrame()).length)
      .toBe(1)
    await popup.close()
    popup = await harness.openPopup(page)
    await expect(popup.getByTestId('phase-status')).toContainText('媒体位于嵌入式播放器中')
    await expect(popup.getByTestId('active-media')).toContainText('视频')

    await page.getByRole('button', { name: 'Remove frame' }).click()
    await expect
      .poll(() => page.frames().filter((frame) => frame !== page.mainFrame()).length)
      .toBe(0)
    await popup.close()
    popup = await harness.openPopup(page)
    await expect(popup.getByTestId('phase-status')).toContainText('当前页面没有可控制媒体')

    await page.getByRole('button', { name: 'Restore frame' }).click()
    await expect
      .poll(() => page.frames().filter((frame) => frame !== page.mainFrame()).length)
      .toBe(1)
    await restartExtensionWorkerAndWait(harness, () => getSettingsRevision(popup, page))
    await popup.close()
    popup = await harness.openPopup(page)
    await expect(popup.getByTestId('phase-status')).toContainText('媒体位于嵌入式播放器中')
    await expect(popup.getByTestId('active-media')).toContainText('视频')
  } finally {
    await harness.close()
  }
})

test('inherits tab UI state in late same-origin and cross-origin iframe-only players', async ({
  baseURL
}) => {
  const harness = await launchExtensionHarness({
    grantedOrigins: [CURRENT_FIXTURE_PERMISSION, CROSS_ORIGIN_FIXTURE_PERMISSION]
  })
  try {
    const page = await harness.context.newPage()
    await page.goto(`${baseURL}/iframe-only.html`)
    await expectRuntimeReady(page)

    let popup = await harness.openPopup(page)
    await clickPopupButton(popup, page, '临时隐藏本页控件')
    await page.getByRole('button', { name: 'Remove frame' }).click()
    await page.getByRole('button', { name: 'Restore frame' }).click()

    let child = page.frames().find((frame) => frame !== page.mainFrame())
    if (!child) throw new Error('late same-origin child frame unavailable')
    const sameOriginChild = child
    await expect
      .poll(() => sameOriginChild.locator('html').getAttribute('data-h5player-webext-media'))
      .toBe('ready')
    await expect.poll(() => sameOriginChild.locator(mediaHostSelector).count()).toBe(0)

    await clickPopupButton(popup, page, '恢复本页控件')
    await expect.poll(() => sameOriginChild.locator(mediaHostSelector).count()).toBe(1)
    await clickPopupButton(popup, page, '本页临时停用')
    await page.getByRole('button', { name: 'Use cross-origin frame' }).click()

    await expect
      .poll(() =>
        page
          .frames()
          .some((frame) => frame.url().startsWith('http://127.0.0.1:47174/cross-origin-frame.html'))
      )
      .toBe(true)
    child = page
      .frames()
      .find((frame) => frame.url().startsWith('http://127.0.0.1:47174/cross-origin-frame.html'))
    if (!child) throw new Error('cross-origin child frame unavailable')
    const crossOriginChild = child
    await expect
      .poll(() => crossOriginChild.locator('html').getAttribute('data-h5player-webext-media'))
      .toBe('ready')
    await expect.poll(() => crossOriginChild.locator(mediaHostSelector).count()).toBe(0)

    await popup.close()
    popup = await harness.openPopup(page)
    await expect(popup.getByTestId('phase-status')).toContainText('当前页面已临时停用')
    await clickPopupButton(popup, page, '恢复本页运行')
    await expect.poll(() => crossOriginChild.locator(mediaHostSelector).count()).toBe(1)

    await restartExtensionWorkerAndWait(harness, () => getSettingsRevision(popup, page))
    await popup.close()
    popup = await harness.openPopup(page)
    await expect(popup.getByTestId('phase-status')).toContainText('媒体位于嵌入式播放器中')
  } finally {
    await harness.close()
  }
})

test('anchors a unique media host through scroll, resize, replacement and removal', async ({
  baseURL
}) => {
  const harness = await launchExtensionHarness({ grantedOrigins: [CURRENT_FIXTURE_PERMISSION] })
  try {
    const page = await harness.context.newPage()
    await page.goto(`${baseURL}/media-anchor.html`)
    await expectRuntimeReady(page)

    await expectUniqueMediaHost(page, '#anchored-video')
    await expectHostAnchored(page, '#anchored-video')
    // Keep the media in the viewport while exercising scroll-following. A fully
    // clipped media intentionally hides its host, so it is not an anchor case.
    await page.evaluate(() => globalThis.scrollTo(0, 160))
    await expectHostAnchored(page, '#anchored-video')
    await page.getByRole('button', { name: 'Resize media' }).click()
    await expectHostAnchored(page, '#anchored-video')
    await page.evaluate(() => {
      const media = document.querySelector('#anchored-video')
      if (!(media instanceof HTMLVideoElement)) throw new Error('anchored media missing')
      media.style.position = 'fixed'
      media.style.left = `${globalThis.innerWidth - media.clientWidth - 240}px`
      media.style.top = '120px'
      media.style.margin = '0'
    })
    const outsidePanelMediaId = await mediaIdFor(page, '#anchored-video')
    await expect(
      page.locator(`${mediaHostSelector}[data-media-id="${outsidePanelMediaId}"]`)
    ).toHaveAttribute('data-panel-outside', 'true')
    await page.getByRole('button', { name: 'Replace media' }).click()
    await expect.poll(() => page.locator(mediaHostSelector).count()).toBe(1)
    await expectHostAnchored(page, '#anchored-video')
    await page.getByRole('button', { name: 'Remove media' }).click()
    await expect.poll(() => page.locator(mediaHostSelector).count()).toBe(0)
  } finally {
    await harness.close()
  }
})

test('excludes hidden and small media, and falls back to page feedback for audio', async ({
  baseURL
}) => {
  const harness = await launchExtensionHarness({ grantedOrigins: [CURRENT_FIXTURE_PERMISSION] })
  try {
    const page = await harness.context.newPage()
    await page.goto(`${baseURL}/media-obscured.html`)
    await expectRuntimeReady(page)

    const primaryId = await expectUniqueMediaHost(page, '#primary')
    const secondaryId = await expectUniqueMediaHost(page, '#secondary')
    expect(primaryId).not.toBe(secondaryId)
    const adId = await mediaIdFor(page, '#ad')
    const hiddenId = await mediaIdFor(page, '#hidden')
    const audioId = await mediaIdFor(page, '#background-audio')
    await expect(page.locator(`${mediaHostSelector}[data-media-id="${adId}"]`)).toHaveCount(0)
    await expect(page.locator(`${mediaHostSelector}[data-media-id="${hiddenId}"]`)).toHaveCount(0)
    await expect(page.locator(`${mediaHostSelector}[data-media-id="${audioId}"]`)).toHaveCount(0)

    await page.goto(`${baseURL}/audio-only.html`)
    await expectRuntimeReady(page)
    const popup = await harness.openPopup(page)
    await expect(popup.getByTestId('active-media')).toContainText('音频')
    const state = await getMediaStateFromPopup(popup, page)
    if (!state.activeMediaId) throw new Error('Audio media id unavailable')
    const result = await executeMediaFromPopup(popup, page, {
      type: 'media.set-rate',
      mediaId: state.activeMediaId,
      value: 1.5
    })
    expect(result.result.ok).toBe(true)
    await expect(page.locator(mediaHostSelector)).toHaveCount(0)
    await expect(page.locator(pageFeedbackHostSelector)).toHaveCount(1)
    await popup.close()
  } finally {
    await harness.close()
  }
})

test('keeps user media intent ahead of hostile rate, volume and seek polling', async ({
  baseURL
}) => {
  test.setTimeout(45_000)
  const harness = await launchExtensionHarness({ grantedOrigins: [CURRENT_FIXTURE_PERMISSION] })
  try {
    const page = await harness.context.newPage()
    await page.goto(`${baseURL}/authority-hostile.html`)
    await expectRuntimeReady(page)
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean((window as HostileMediaFixtureWindow).hostileMediaFixture?.ready)
        )
      )
      .toBe(true)

    const popup = await harness.openPopup(page)
    const options = await harness.context.newPage()
    await options.goto(`chrome-extension://${harness.extensionId}/options.html`)
    let revision = await getSettingsRevision(popup, page)
    revision = await updateGlobalProtection(options, page, revision, {
      protectPlaybackRate: true,
      protectCurrentTime: true,
      protectVolume: true
    })
    await page.waitForTimeout(250)

    const state = await getMediaStateFromPopup(popup, page)
    if (!state.activeMediaId) throw new Error('Hostile fixture media id unavailable')
    const mediaId = state.activeMediaId
    const rateResult = await executeMediaFromPopup(
      popup,
      page,
      { type: 'media.set-rate', mediaId, value: 1.75 },
      'media'
    )
    const volumeResult = await executeMediaFromPopup(popup, page, {
      type: 'media.set-volume',
      mediaId,
      value: 0.65
    })
    const seekResult = await executeMediaFromPopup(popup, page, {
      type: 'media.seek',
      mediaId,
      deltaSeconds: 10
    })
    expect(rateResult.result.ok).toBe(true)
    expect(volumeResult.result.ok).toBe(true)
    expect(seekResult.result.ok).toBe(true)
    if (!rateResult.result.ok) throw new Error('Hostile fixture rate update failed')
    if (!seekResult.result.ok) throw new Error('Hostile fixture seek failed')
    const expectedRate = rateResult.result.value.snapshot.metrics.playbackRate
    const expectedSeekTime = seekResult.result.value.snapshot.metrics.currentTime

    await expect
      .poll(() =>
        page.locator('#hostile-video').evaluate((element) => {
          const media = element as HTMLVideoElement
          return {
            rate: media.playbackRate,
            volume: media.volume,
            muted: media.muted,
            currentTime: media.currentTime
          }
        })
      )
      .toMatchObject({ rate: expectedRate, volume: 0.65, muted: false })
    await expect
      .poll(() =>
        page
          .locator('#hostile-video')
          .evaluate(
            (element, expected) => Math.abs((element as HTMLVideoElement).currentTime - expected),
            expectedSeekTime
          )
      )
      .toBeLessThan(0.5)

    const attempts = await page.evaluate(() => ({
      ...(window as HostileMediaFixtureWindow).hostileMediaFixture?.attempts
    }))
    expect(attempts.playbackRate).toBeGreaterThan(5)
    expect(attempts.volume).toBeGreaterThan(5)
    expect(attempts.currentTime).toBeGreaterThan(5)

    await expect
      .poll(
        () =>
          page
            .locator('#hostile-video')
            .evaluate((element) => (element as HTMLVideoElement).currentTime),
        { timeout: 3_000 }
      )
      .toBeCloseTo(30, 0)

    await updateGlobalProtection(options, page, revision, {
      protectPlaybackRate: false,
      protectCurrentTime: false,
      protectVolume: false
    })
    await expect
      .poll(() =>
        page.locator('#hostile-video').evaluate((element) => {
          const media = element as HTMLVideoElement
          return { rate: media.playbackRate, volume: media.volume, muted: media.muted }
        })
      )
      .toMatchObject({ rate: 0.75, volume: 0.2, muted: true })

    await options.close()
    await popup.close()
  } finally {
    await harness.close()
  }
})

test('configured media churn remains bounded across worker restarts', async ({ baseURL }) => {
  test.skip(configuredChurnDurationMs === 0, 'Nightly churn duration is not configured')
  test.setTimeout(configuredChurnDurationMs + 60_000)
  const harness = await launchExtensionHarness({
    grantedOrigins: [CURRENT_FIXTURE_PERMISSION]
  })

  try {
    const page = await harness.context.newPage()
    await page.goto(`${baseURL}/spa.html`)
    await expectRuntimeReady(page)
    const popup = await harness.openPopup(page)
    const cdp = await harness.context.newCDPSession(page)
    await cdp.send('Performance.enable')

    const baselineWindowListeners = await pageRuntimeListenerCount(cdp)
    const baselineDocumentListeners = await pageDocumentListenerCount(cdp)
    const baselineListeners = baselineWindowListeners + baselineDocumentListeners
    const baselineHosts = await extensionHostCount(page)
    const baselineHeap = await pageHeapSize(cdp)
    const baselineDiagnostics = await lifecycleDiagnostics(page)
    expect(baselineDiagnostics.content).toMatchObject({
      mediaUiHosts: 0,
      pendingMounts: 0,
      feedbackTimers: 0,
      pageFeedbackVisible: false,
      downloadPromptOpen: false,
      anchor: { anchors: 0, refreshQueued: false }
    })
    expect(baselineDiagnostics.page).toMatchObject({
      session: 'ready',
      authority: { bindings: 0, protectedBindings: 0 },
      mediaRuntime: {
        discovery: {
          mediaRecords: 0,
          presentationRefreshTimer: false,
          pendingControllerChanges: 0,
          reconcileQueued: false,
          controllerFlushQueued: false
        }
      }
    })
    let maximumListeners = baselineListeners
    let maximumHosts = baselineHosts
    let cycles = 0
    let workerRestarts = 0
    let populatedWorkerRestarts = 0
    let emptyWorkerRestarts = 0
    const workerTargetTransitions: Array<
      Readonly<{
        previousTargetId: string
        nextTargetId: string
        previousGeneration: string
        nextGeneration: string
      }>
    > = []
    const heapSamples = [baselineHeap]
    await page.evaluate(() => {
      const key = '__h5playerChurnLongTasks'
      const state = { count: 0, duration: 0 }
      Object.defineProperty(globalThis, key, { configurable: true, value: state })
      const PerformanceObserverConstructor = globalThis.PerformanceObserver
      if (PerformanceObserverConstructor === undefined) return
      const observer = new PerformanceObserverConstructor((list) => {
        for (const entry of list.getEntries()) {
          state.count += 1
          state.duration += entry.duration
        }
      })
      try {
        observer.observe({ type: 'longtask', buffered: true })
        Object.defineProperty(state, 'disconnect', {
          configurable: true,
          value: () => observer.disconnect()
        })
      } catch {
        observer.disconnect()
      }
    })
    const startedAt = Date.now()

    while (Date.now() - startedAt < configuredChurnDurationMs) {
      await page.evaluate((cycle) => {
        const mount = document.querySelector('#mount')
        if (!mount) throw new Error('SPA fixture mount is unavailable')
        for (let index = 0; index < 4; index += 1) {
          const media = document.createElement(index % 2 === 0 ? 'video' : 'audio')
          media.dataset['churn'] = `${cycle}-${index}`
          media.setAttribute('width', String(index === 0 ? 640 : 160 + index * 20))
          media.setAttribute('height', String(index === 0 ? 360 : 90 + index * 10))
          mount.append(media)
        }
      }, cycles)

      await expect
        .poll(async () => (await getMediaStateFromPopup(popup, page)).media.length)
        .toBe(4)
      await expect.poll(() => page.locator(mediaHostSelector).count()).toBe(1)
      const populatedHosts = await extensionHostCount(page)
      maximumHosts = Math.max(maximumHosts, populatedHosts)
      expect(populatedHosts).toBe(baselineHosts + 1)
      const populated = await getMediaStateFromPopup(popup, page)
      if (!populated.activeMediaId) throw new Error('Churn fixture has no active media')
      const command: MediaCommand =
        cycles % 2 === 0
          ? {
              type: 'media.adjust-rate',
              mediaId: populated.activeMediaId,
              delta: 0.1
            }
          : { type: 'media.toggle-mute', mediaId: populated.activeMediaId }
      const commandResult = await executeMediaFromPopup(popup, page, command)
      expect(commandResult.result.ok).toBe(true)

      await expect
        .poll(async () => {
          const diagnostics = await lifecycleDiagnostics(page)
          return {
            contentHosts: diagnostics.content.mediaUiHosts,
            pendingMounts: diagnostics.content.pendingMounts,
            anchorCount: diagnostics.content.anchor.anchors,
            mediaRecords: diagnostics.page.mediaRuntime?.discovery.mediaRecords ?? -1,
            authorityBindings: diagnostics.page.authority.bindings,
            presentationTimer:
              diagnostics.page.mediaRuntime?.discovery.presentationRefreshTimer ?? false
          }
        })
        .toEqual({
          contentHosts: 1,
          pendingMounts: 0,
          anchorCount: 4,
          mediaRecords: 4,
          authorityBindings: 4,
          presentationTimer: true
        })

      // Restart once while four media records are still populated, then at a
      // bounded cadence during long churn runs.
      if (cycles === 0 || (cycles + 1) % 100 === 50) {
        const transition = await restartExtensionWorkerAndWait(harness, async () => {
          const wakePage = await harness.context.newPage()
          try {
            await wakePage.goto(`chrome-extension://${harness.extensionId}/popup.html`, {
              waitUntil: 'domcontentloaded'
            })
          } finally {
            await wakePage.close().catch(() => undefined)
          }
        })
        workerTargetTransitions.push(transition)
        workerRestarts += 1
        populatedWorkerRestarts += 1
        await expect
          .poll(async () => (await getMediaStateFromPopup(popup, page)).media.length)
          .toBe(4)
      }

      await page.evaluate(() => {
        for (const media of document.querySelectorAll('[data-churn]')) media.remove()
      })
      await expect
        .poll(async () => (await getMediaStateFromPopup(popup, page)).media.length)
        .toBe(0)
      await expect.poll(() => page.locator(mediaHostSelector).count()).toBe(0)

      const emptyHosts = await extensionHostCount(page)
      maximumHosts = Math.max(maximumHosts, emptyHosts)
      expect(emptyHosts).toBe(baselineHosts)
      await expect
        .poll(async () => {
          const diagnostics = await lifecycleDiagnostics(page)
          return {
            contentHosts: diagnostics.content.mediaUiHosts,
            pendingMounts: diagnostics.content.pendingMounts,
            feedbackTimers: diagnostics.content.feedbackTimers,
            pageFeedbackVisible: diagnostics.content.pageFeedbackVisible,
            anchors: diagnostics.content.anchor.anchors,
            anchorObservers: diagnostics.content.anchor.mutationObservers,
            anchorRefreshQueued: diagnostics.content.anchor.refreshQueued,
            mediaRecords: diagnostics.page.mediaRuntime?.discovery.mediaRecords ?? -1,
            discoveryObservers: diagnostics.page.mediaRuntime?.discovery.mutationObservers ?? -1,
            presentationTimer:
              diagnostics.page.mediaRuntime?.discovery.presentationRefreshTimer ?? true,
            pendingControllerChanges:
              diagnostics.page.mediaRuntime?.discovery.pendingControllerChanges ?? -1,
            reconcileQueued: diagnostics.page.mediaRuntime?.discovery.reconcileQueued ?? true,
            controllerFlushQueued:
              diagnostics.page.mediaRuntime?.discovery.controllerFlushQueued ?? true,
            authorityBindings: diagnostics.page.authority.bindings,
            protectedBindings: diagnostics.page.authority.protectedBindings
          }
        })
        .toEqual({
          contentHosts: 0,
          pendingMounts: 0,
          feedbackTimers: 0,
          pageFeedbackVisible: false,
          anchors: 0,
          anchorObservers: baselineDiagnostics.content.anchor.mutationObservers,
          anchorRefreshQueued: false,
          mediaRecords: 0,
          discoveryObservers:
            baselineDiagnostics.page.mediaRuntime?.discovery.mutationObservers ?? 0,
          presentationTimer: false,
          pendingControllerChanges: 0,
          reconcileQueued: false,
          controllerFlushQueued: false,
          authorityBindings: 0,
          protectedBindings: 0
        })
      const listenerCount =
        (await pageRuntimeListenerCount(cdp)) + (await pageDocumentListenerCount(cdp))
      maximumListeners = Math.max(maximumListeners, listenerCount)
      expect(listenerCount).toBeLessThanOrEqual(baselineListeners + 1)
      cycles += 1

      if (cycles % 100 === 0) {
        const transition = await restartExtensionWorkerAndWait(harness, async () => {
          const wakePage = await harness.context.newPage()
          try {
            await wakePage.goto(`chrome-extension://${harness.extensionId}/popup.html`, {
              waitUntil: 'domcontentloaded'
            })
          } finally {
            await wakePage.close().catch(() => undefined)
          }
        })
        workerTargetTransitions.push(transition)
        workerRestarts += 1
        emptyWorkerRestarts += 1
        expect((await getMediaStateFromPopup(popup, page)).media).toHaveLength(0)
      }

      if (cycles % 25 === 0) heapSamples.push(await pageHeapSize(cdp))
    }

    if (emptyWorkerRestarts === 0) {
      const transition = await restartExtensionWorkerAndWait(harness, async () => {
        const wakePage = await harness.context.newPage()
        try {
          await wakePage.goto(`chrome-extension://${harness.extensionId}/popup.html`, {
            waitUntil: 'domcontentloaded'
          })
        } finally {
          await wakePage.close().catch(() => undefined)
        }
      })
      workerTargetTransitions.push(transition)
      workerRestarts += 1
      emptyWorkerRestarts += 1
      expect((await getMediaStateFromPopup(popup, page)).media).toHaveLength(0)
    }

    const finalHeap = await pageHeapSize(cdp)
    heapSamples.push(finalHeap)
    const allowedHeap = Math.max(baselineHeap * 3, baselineHeap + 32 * 1024 * 1024)
    expect(cycles).toBeGreaterThan(0)
    expect(maximumHosts).toBe(baselineHosts + 1)
    expect(finalHeap).toBeLessThanOrEqual(allowedHeap)
    expect(heapSamples.every((sample) => sample <= allowedHeap)).toBe(true)
    if (cycles >= 50) {
      const positiveHeapSteps = heapSamples.slice(1).filter((sample, index) => {
        const previous = heapSamples[index]
        return previous !== undefined && sample > previous
      }).length
      expect(positiveHeapSteps).toBeLessThan(heapSamples.length - 1)
    }
    const heapTrend = (() => {
      if (heapSamples.length < 6) return null
      const windowSize = Math.max(2, Math.floor(heapSamples.length / 4))
      const previous = heapSamples.slice(-windowSize * 2, -windowSize)
      const latest = heapSamples.slice(-windowSize)
      return { previousMean: mean(previous), latestMean: mean(latest), windowSize }
    })()
    if (heapTrend !== null) {
      const trendAllowance = Math.max(8 * 1024 * 1024, heapTrend.previousMean * 0.2)
      expect(heapTrend.latestMean).toBeLessThanOrEqual(heapTrend.previousMean + trendAllowance)
    }
    const longTasks = await page.evaluate(() => {
      const state = Reflect.get(globalThis, '__h5playerChurnLongTasks') as
        { count?: unknown; duration?: unknown } | undefined
      return {
        count: typeof state?.count === 'number' ? state.count : 0,
        duration: typeof state?.duration === 'number' ? state.duration : 0
      }
    })
    console.log(
      JSON.stringify({
        event: 'MEDIA_CHURN_RESULT',
        durationMs: Date.now() - startedAt,
        cycles,
        workerRestarts,
        populatedWorkerRestarts,
        emptyWorkerRestarts,
        workerTargetTransitions,
        baselineWindowListeners,
        baselineDocumentListeners,
        baselineListeners,
        maximumListeners,
        baselineHosts,
        maximumHosts,
        baselineHeap,
        finalHeap,
        heapSamples,
        heapTrend,
        baselineDiagnostics,
        longTasks
      })
    )
  } finally {
    await harness.close()
  }
})
