import assert from 'node:assert/strict'
import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { firefox as playwrightFirefox } from '@playwright/test'
import { By, Key, Origin } from 'selenium-webdriver'
import type { WebElement } from 'selenium-webdriver'
import firefox from 'selenium-webdriver/firefox.js'
import { createServer, type ViteDevServer } from 'vite'
import { createRuntimeRequest, parseRuntimeResponse } from '../src/shared/protocol'

const FIREFOX_EXTENSION_ID = 'h5player-webext@example.invalid'
const FIREFOX_EXTENSION_UUID = '3b94c06a-3d88-4b51-a8c0-0d3e3d4f8be1'
const FIXTURE_HOST = '127.0.0.1'
const FIXTURE_PORT = 47_173
const FIXTURE_PERMISSION = `http://${FIXTURE_HOST}:${FIXTURE_PORT}/*`
const DEFAULT_TIMEOUT_MS = 15_000
const FEEDBACK_TIMEOUT_MS = 4_000
const MEDIA_HOST_SELECTOR = '[data-h5p-ext-media-host="ready"]'
const HEADLESS = process.env['H5PLAYER_FIREFOX_HEADLESS'] !== '0'
const ARTIFACT_ROOT = path.resolve(
  process.cwd(),
  process.env['H5PLAYER_FIREFOX_UX_ARTIFACT_DIR'] ?? 'test-results/firefox-headed-ux'
)

type ScriptResult = Readonly<{
  ok: boolean
  value?: unknown
  error?: string
}>

type MediaHostSnapshot = Readonly<{
  mediaId: string
  media: Readonly<{ left: number; top: number; right: number; bottom: number }>
  host: Readonly<{ left: number; top: number }>
  target: Readonly<{ x: number; y: number }>
  distance: number
  placement: string | null
  visibility: string
}>

type QuickControlSnapshot = Readonly<{
  expanded: boolean
  rateLabel: string | null
  triggerOpacity: number
  triggerRect: Readonly<{
    left: number
    top: number
    right: number
    bottom: number
    width: number
    height: number
  }> | null
  hitboxRect: Readonly<{
    left: number
    top: number
    right: number
    bottom: number
    width: number
    height: number
  }> | null
  panelRect: Readonly<{
    left: number
    top: number
    right: number
    bottom: number
    width: number
    height: number
  }> | null
}>

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function assertNumber(value: unknown, label: string): asserts value is number {
  assert.equal(typeof value, 'number', `${label} must be a number`)
}

function assertString(value: unknown, label: string): asserts value is string {
  assert.equal(typeof value, 'string', `${label} must be a string`)
}

function unwrapScriptResult(value: unknown, label: string): unknown {
  const result = asRecord(value)
  assert(result, `${label}: Firefox returned a non-object script result`)
  const detail = typeof result['error'] === 'string' ? result['error'] : 'unknown error'
  assert.equal(result['ok'], true, `${label}: ${detail}`)
  return result['value']
}

async function waitFor<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  label: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let lastValue: T | undefined
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      const value = await read()
      lastValue = value
      if (predicate(value)) return value
    } catch (error) {
      lastError = error
    }
    await delay(100)
  }

  const detail =
    lastError === undefined
      ? JSON.stringify(lastValue)
      : `${JSON.stringify(lastValue)}; last error: ${errorMessage(lastError)}`
  throw new Error(`${label} timed out after ${timeoutMs} ms (${detail})`)
}

async function grantOptionalOrigins(
  driver: firefox.Driver,
  extensionId: string,
  origins: readonly string[]
): Promise<void> {
  await driver.setContext(firefox.Context.CHROME)
  try {
    const rawResult = await driver.executeAsyncScript<unknown>(
      function (
        id: string,
        requestedOrigins: readonly string[],
        done: (value: ScriptResult) => void
      ): void {
        type FirefoxPermissionEmitter = Readonly<{
          emit(eventName: string, value: unknown): unknown
        }>
        type FirefoxExtensionPermissions = Readonly<{
          add(
            extensionId: string,
            permissions: Readonly<{
              origins: readonly string[]
              permissions: readonly string[]
              data_collection: readonly string[]
            }>,
            emitter?: FirefoxPermissionEmitter
          ): Promise<void>
          get(extensionId: string): Promise<Readonly<{ origins?: readonly string[] }>>
        }>
        type FirefoxChromeUtils = Readonly<{
          importESModule(uri: string): Readonly<{
            ExtensionPermissions: FirefoxExtensionPermissions
          }>
        }>
        type FirefoxWebExtensionPolicy = Readonly<{
          getByID(extensionId: string): Readonly<{ extension?: FirefoxPermissionEmitter }> | null
        }>
        const chromeGlobal = globalThis as unknown as {
          ChromeUtils?: FirefoxChromeUtils
          WebExtensionPolicy?: FirefoxWebExtensionPolicy
        }
        const chromeUtils = chromeGlobal.ChromeUtils
        const webExtensionPolicy = chromeGlobal.WebExtensionPolicy
        if (!chromeUtils || !webExtensionPolicy) {
          done({ ok: false, error: 'Firefox extension internals are unavailable' })
          return
        }
        void (async () => {
          const { ExtensionPermissions } = chromeUtils.importESModule(
            'resource://gre/modules/ExtensionPermissions.sys.mjs'
          )
          const extension = webExtensionPolicy.getByID(id)?.extension
          if (!extension) throw new Error('running Firefox extension instance was not found')
          await ExtensionPermissions.add(
            id,
            {
              origins: requestedOrigins,
              permissions: [],
              data_collection: []
            },
            extension
          )
          const granted = await ExtensionPermissions.get(id)
          done({ ok: true, value: granted.origins ?? [] })
        })().catch((error: unknown) => done({ ok: false, error: String(error) }))
      },
      extensionId,
      [...origins]
    )
    const granted = unwrapScriptResult(rawResult, 'Grant Firefox UX fixture permission')
    assert(Array.isArray(granted), 'Firefox optional origin result must be an array')
    for (const origin of origins) {
      assert(granted.includes(origin), `Firefox did not grant optional origin: ${origin}`)
    }
  } finally {
    await driver.setContext(firefox.Context.CONTENT)
  }
}

async function grantActiveTabPermission(
  driver: firefox.Driver,
  extensionId: string
): Promise<void> {
  await driver.setContext(firefox.Context.CHROME)
  try {
    const result = await driver.executeScript<ScriptResult>(function (id: string): ScriptResult {
      type FirefoxTabManager = Readonly<{
        addActiveTabPermission(): unknown
      }>
      type FirefoxExtensionPolicy = Readonly<{
        getByID(extensionId: string): Readonly<{
          extension: Readonly<{ tabManager: FirefoxTabManager }>
        }> | null
      }>
      const policy = (globalThis as unknown as { WebExtensionPolicy?: FirefoxExtensionPolicy })
        .WebExtensionPolicy
      if (!policy) return { ok: false, error: 'WebExtensionPolicy is unavailable' }
      const extension = policy.getByID(id)?.extension
      if (!extension)
        return { ok: false, error: 'running Firefox extension instance was not found' }
      extension.tabManager.addActiveTabPermission()
      return { ok: true }
    }, extensionId)
    unwrapScriptResult(result, 'Grant Firefox UX activeTab permission')
  } finally {
    await driver.setContext(firefox.Context.CONTENT)
  }
}

async function waitForRuntimeReady(driver: firefox.Driver): Promise<void> {
  await waitFor(
    async () =>
      driver.executeScript<unknown>(
        `return {
          background: document.documentElement.dataset.h5playerWebextBackground,
          bridge: document.documentElement.dataset.h5playerWebextBridge,
          content: document.documentElement.dataset.h5playerWebextContent,
          main: document.documentElement.dataset.h5playerWebextMain,
          media: document.documentElement.dataset.h5playerWebextMedia
        };`
      ),
    (value) => {
      const state = asRecord(value)
      return (
        state?.['background'] === 'ready' &&
        state['bridge'] === 'ready' &&
        state['content'] === 'ready' &&
        state['main'] === 'ready' &&
        state['media'] === 'ready'
      )
    },
    'Firefox UX page runtime readiness'
  )
}

async function openTrustedBackgroundTab(driver: firefox.Driver, url: string): Promise<string> {
  const existingHandles = new Set(await driver.getAllWindowHandles())
  await driver.setContext(firefox.Context.CHROME)
  try {
    const opened = await driver.executeScript<boolean>(
      `const tab = window.gBrowser.addTab(arguments[0], {
        inBackground: true,
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
      });
      return Boolean(tab);`,
      url
    )
    assert.equal(opened, true, `Firefox failed to open trusted background tab: ${url}`)
  } finally {
    await driver.setContext(firefox.Context.CONTENT)
  }
  const popupHandle = await waitFor(
    async () => {
      const handles = await driver.getAllWindowHandles()
      return handles.find((handle) => !existingHandles.has(handle)) ?? null
    },
    (handle): handle is string => handle !== null,
    'Firefox UX popup handle'
  )
  assertString(popupHandle, 'Firefox UX popup handle')
  return popupHandle
}

async function reconcileSiteAccess(
  driver: firefox.Driver,
  popupHandle: string,
  targetTabId: number
): Promise<void> {
  await driver.switchTo().window(popupHandle)
  const request = createRuntimeRequest('popup', 'site.reconcile', {
    bootstrapCurrentTab: true
  })
  const rawResult = await driver.executeAsyncScript<unknown>(
    function (tabId: number, message: unknown, done: (value: ScriptResult) => void): void {
      type ExtensionBrowser = Readonly<{
        tabs: Readonly<{
          update(tabId: number, update: Readonly<{ active: boolean }>): Promise<unknown>
        }>
        runtime: Readonly<{ sendMessage(value: unknown): Promise<unknown> }>
      }>
      const browserApi = (globalThis as unknown as { browser?: ExtensionBrowser }).browser
      if (!browserApi) {
        done({ ok: false, error: 'browser API is unavailable in Firefox UX popup' })
        return
      }
      void (async () => {
        await browserApi.tabs.update(tabId, { active: true })
        done({ ok: true, value: await browserApi.runtime.sendMessage(message) })
      })().catch((error: unknown) => done({ ok: false, error: String(error) }))
    },
    targetTabId,
    request
  )
  const response = parseRuntimeResponse(
    unwrapScriptResult(rawResult, 'Reconcile Firefox UX site access')
  )
  assert(response, 'Firefox UX site reconcile response did not match protocol schema')
  assert.equal(response.type, 'protocol.response')
  assert.equal(response.requestId, request.requestId)
  assert.equal(response.payload.requestType, request.type)
  const data = asRecord(response.payload.data)
  assert(data, 'Firefox UX site reconcile payload must be an object')
  assert.equal(data['registeredOrigins'], 1)
  assert.equal(data['bootstrapped'], true)
}

async function currentTargetTabId(driver: firefox.Driver, popupHandle: string): Promise<number> {
  await driver.switchTo().window(popupHandle)
  const rawResult = await driver.executeAsyncScript<unknown>(function (
    done: (value: ScriptResult) => void
  ): void {
    type ExtensionBrowser = Readonly<{
      tabs: Readonly<{
        getCurrent(): Promise<Readonly<{ id?: number }> | undefined>
        query(
          query: Readonly<{ currentWindow: boolean }>
        ): Promise<readonly Readonly<{ id?: number }>[]>
      }>
    }>
    const browserApi = (globalThis as unknown as { browser?: ExtensionBrowser }).browser
    if (!browserApi) {
      done({ ok: false, error: 'browser API is unavailable in Firefox UX popup' })
      return
    }
    void (async () => {
      const current = await browserApi.tabs.getCurrent()
      const tabs = await browserApi.tabs.query({ currentWindow: true })
      const target = tabs.find((tab) => tab.id !== undefined && tab.id !== current?.id)
      if (target?.id === undefined) throw new Error('Firefox UX target tab was not found')
      done({ ok: true, value: target.id })
    })().catch((error: unknown) => done({ ok: false, error: String(error) }))
  })
  const value = unwrapScriptResult(rawResult, 'Resolve Firefox UX target tab')
  assertNumber(value, 'Firefox UX target tab ID')
  return value
}

async function waitForMediaHost(driver: firefox.Driver): Promise<MediaHostSnapshot> {
  const snapshot = await waitFor(
    () => readMediaHost(driver),
    (value) => value !== null && value.visibility === 'visible' && value.distance <= 8,
    'Firefox media host anchor'
  )
  assert(snapshot !== null, 'Firefox media host snapshot is unavailable')
  return snapshot
}

async function readMediaHost(driver: firefox.Driver): Promise<MediaHostSnapshot | null> {
  const raw = await driver.executeScript<unknown>(
    `const media = document.querySelector('video');
    const host = document.querySelector(arguments[0]);
    if (!(media instanceof HTMLVideoElement) || !(host instanceof HTMLElement)) return null;
    const mediaId = media.getAttribute('data-h5player-webext-media-id');
    if (!mediaId || host.dataset.mediaId !== mediaId) return null;
    const mediaRect = media.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const target = { x: mediaRect.right - 8, y: mediaRect.top + 8 };
    return {
      mediaId,
      media: {
        left: mediaRect.left,
        top: mediaRect.top,
        right: mediaRect.right,
        bottom: mediaRect.bottom
      },
      host: { left: hostRect.left, top: hostRect.top },
      target,
      distance: Math.max(Math.abs(hostRect.left - target.x), Math.abs(hostRect.top - target.y)),
      placement: host.dataset.placement ?? null,
      visibility: getComputedStyle(host).visibility
    };`,
    MEDIA_HOST_SELECTOR
  )
  if (raw === null) return null
  const record = asRecord(raw)
  assert(record, 'Firefox media host snapshot must be an object')
  const media = asRecord(record['media'])
  const host = asRecord(record['host'])
  const target = asRecord(record['target'])
  assert(media && host && target, 'Firefox media host geometry must be objects')
  const mediaLeft = media['left']
  const mediaTop = media['top']
  const mediaRight = media['right']
  const mediaBottom = media['bottom']
  const hostLeft = host['left']
  const hostTop = host['top']
  const targetX = target['x']
  const targetY = target['y']
  const distance = record['distance']
  const mediaId = record['mediaId']
  const visibility = record['visibility']
  assertNumber(mediaLeft, 'Firefox media.left')
  assertNumber(mediaTop, 'Firefox media.top')
  assertNumber(mediaRight, 'Firefox media.right')
  assertNumber(mediaBottom, 'Firefox media.bottom')
  assertNumber(hostLeft, 'Firefox host.left')
  assertNumber(hostTop, 'Firefox host.top')
  assertNumber(targetX, 'Firefox target.x')
  assertNumber(targetY, 'Firefox target.y')
  assertNumber(distance, 'Firefox distance')
  assertString(mediaId, 'Firefox media host mediaId')
  assertString(visibility, 'Firefox media host visibility')
  return {
    mediaId,
    media: {
      left: mediaLeft,
      top: mediaTop,
      right: mediaRight,
      bottom: mediaBottom
    },
    host: { left: hostLeft, top: hostTop },
    target: { x: targetX, y: targetY },
    distance,
    placement: typeof record['placement'] === 'string' ? record['placement'] : null,
    visibility
  }
}

async function elementViewportRect(
  driver: firefox.Driver,
  element: WebElement
): Promise<QuickControlSnapshot['triggerRect']> {
  const raw = await driver.executeScript<unknown>(
    `const value = arguments[0].getBoundingClientRect();
    return {
      left: value.left,
      top: value.top,
      right: value.right,
      bottom: value.bottom,
      width: value.width,
      height: value.height
    };`,
    element
  )
  const rect = asRecord(raw)
  assert(rect, 'Firefox element viewport rect must be an object')
  const left = rect['left']
  const top = rect['top']
  const right = rect['right']
  const bottom = rect['bottom']
  const width = rect['width']
  const height = rect['height']
  assertNumber(left, 'Firefox element rect.left')
  assertNumber(top, 'Firefox element rect.top')
  assertNumber(right, 'Firefox element rect.right')
  assertNumber(bottom, 'Firefox element rect.bottom')
  assertNumber(width, 'Firefox element rect.width')
  assertNumber(height, 'Firefox element rect.height')
  return { left, top, right, bottom, width, height }
}

async function readQuickControls(driver: firefox.Driver): Promise<QuickControlSnapshot | null> {
  const hosts = await driver.findElements(By.css(MEDIA_HOST_SELECTOR))
  const host = hosts[0]
  if (!host || hosts.length !== 1) return null
  try {
    const root = await host.getShadowRoot()
    const tools = (await root.findElements(By.css('.media-tools')))[0]
    const trigger = (await root.findElements(By.css('.media-tools__trigger')))[0]
    const hitbox = (await root.findElements(By.css('[data-testid="media-rate-hitbox"]')))[0]
    if (!tools || !trigger || !hitbox) return null
    const panel = (await root.findElements(By.css('.media-tools__panel')))[0]
    const rateLabel = (await root.findElements(By.css('.media-tools__rate-label')))[0]
    const opacity = Number(await trigger.getCssValue('opacity'))
    assert(Number.isFinite(opacity), 'Firefox trigger opacity must be finite')
    const toolsClass = (await tools.getAttribute('class')) ?? ''
    return {
      expanded: toolsClass.split(/\s+/).includes('is-expanded'),
      rateLabel: rateLabel ? (await rateLabel.getText()).trim() || null : null,
      triggerOpacity: opacity,
      triggerRect: await elementViewportRect(driver, trigger),
      hitboxRect: await elementViewportRect(driver, hitbox),
      panelRect: panel ? await elementViewportRect(driver, panel) : null
    }
  } catch {
    return null
  }
}

async function hoverQuickControl(driver: firefox.Driver): Promise<QuickControlSnapshot> {
  const controls = await waitFor(
    () => readQuickControls(driver),
    (snapshot) => snapshot !== null && snapshot.hitboxRect !== null,
    'Firefox quick-control hitbox'
  )
  assert(controls !== null, 'Firefox quick controls are unavailable')
  assert(controls.hitboxRect, 'Firefox quick-control hitbox geometry is unavailable')
  const x = Math.round((controls.hitboxRect.left + controls.hitboxRect.right) / 2)
  const y = Math.round((controls.hitboxRect.top + controls.hitboxRect.bottom) / 2)
  await driver.actions({ async: true }).move({ x, y, origin: Origin.VIEWPORT }).perform()
  const expanded = await waitFor(
    () => readQuickControls(driver),
    (snapshot) => snapshot !== null && snapshot.expanded && snapshot.panelRect !== null,
    'Firefox quick-control pointer expansion'
  )
  assert(expanded !== null, 'Firefox expanded quick controls are unavailable')
  return expanded
}

async function pressMediaKey(driver: firefox.Driver, key: string): Promise<void> {
  const media = await driver.findElement(By.css('video'))
  await media.click()
  await media.sendKeys(key === Key.SPACE ? Key.SPACE : key)
}

async function readPlaybackRate(driver: firefox.Driver): Promise<number> {
  const value = await driver.executeScript<unknown>(
    `const media = document.querySelector('video');
    return media instanceof HTMLVideoElement ? media.playbackRate : null;`
  )
  assertNumber(value, 'Firefox playback rate')
  return value
}

async function readPaused(driver: firefox.Driver): Promise<boolean> {
  const value = await driver.executeScript<unknown>(
    `const media = document.querySelector('video');
    return media instanceof HTMLVideoElement ? media.paused : null;`
  )
  assert.equal(typeof value, 'boolean', 'Firefox paused state must be a boolean')
  if (typeof value !== 'boolean') throw new Error('Firefox paused state must be a boolean')
  return value
}

async function startPlayback(driver: firefox.Driver): Promise<void> {
  const rawResult = await driver.executeAsyncScript<unknown>(`
    const done = arguments[0];
    void (async () => {
      const media = document.querySelector('video')
      if (!(media instanceof HTMLVideoElement)) throw new Error('target video was not found')
      // Firefox keeps playbackRate at 1 for MediaStream-backed media. Use a
      // tiny looping PCM WAV instead so the headed contract exercises the
      // same rate setter path as a real site-owned media resource.
      const sampleRate = 8_000
      const sampleCount = sampleRate
      const buffer = new ArrayBuffer(44 + sampleCount * 2)
      const view = new DataView(buffer)
      const writeAscii = (offset, value) => {
        for (let index = 0; index < value.length; index += 1) {
          view.setUint8(offset + index, value.charCodeAt(index))
        }
      }
      writeAscii(0, 'RIFF')
      view.setUint32(4, 36 + sampleCount * 2, true)
      writeAscii(8, 'WAVE')
      writeAscii(12, 'fmt ')
      view.setUint32(16, 16, true)
      view.setUint16(20, 1, true)
      view.setUint16(22, 1, true)
      view.setUint32(24, sampleRate, true)
      view.setUint32(28, sampleRate * 2, true)
      view.setUint16(32, 2, true)
      view.setUint16(34, 16, true)
      writeAscii(36, 'data')
      view.setUint32(40, sampleCount * 2, true)
      const url = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }))
      globalThis.__h5playerFirefoxUx = { url }
      media.srcObject = null
      media.src = url
      media.loop = true
      media.load()
      await new Promise((resolve, reject) => {
        const onCanPlay = () => {
          media.removeEventListener('canplay', onCanPlay)
          media.removeEventListener('error', onError)
          resolve()
        }
        const onError = () => {
          media.removeEventListener('canplay', onCanPlay)
          media.removeEventListener('error', onError)
          reject(new Error('WAV fixture failed to load'))
        }
        media.addEventListener('canplay', onCanPlay, { once: true })
        media.addEventListener('error', onError, { once: true })
      })
      await media.play()
      done({ ok: true })
    })().catch((error) => done({ ok: false, error: String(error) }));
  `)
  unwrapScriptResult(rawResult, 'Start Firefox UX playback')
  await waitFor(
    () => readPaused(driver),
    (paused) => !paused,
    'Firefox UX playback start'
  )
}

async function saveScreenshot(driver: firefox.Driver, name: string): Promise<string> {
  await mkdir(ARTIFACT_ROOT, { recursive: true })
  const target = path.join(ARTIFACT_ROOT, `${name}.png`)
  await writeFile(target, Buffer.from(await driver.takeScreenshot(), 'base64'))
  return path.relative(process.cwd(), target)
}

async function reconcileAndReload(
  driver: firefox.Driver,
  extensionId: string,
  url: string
): Promise<void> {
  await grantOptionalOrigins(driver, extensionId, [FIXTURE_PERMISSION])
  const targetHandle = await driver.getWindowHandle()
  await driver.get(url)
  await grantActiveTabPermission(driver, extensionId)
  const popupUrl = `moz-extension://${FIREFOX_EXTENSION_UUID}/popup.html`
  const popupHandle = await openTrustedBackgroundTab(driver, popupUrl)
  await delay(1_500)
  const targetTabId = await currentTargetTabId(driver, popupHandle)
  await reconcileSiteAccess(driver, popupHandle, targetTabId)
  await driver.switchTo().window(popupHandle)
  await driver.close()
  await driver.switchTo().window(targetHandle)
  await waitForRuntimeReady(driver)
  assert.equal(await driver.getCurrentUrl(), url)
}

async function reconcileCurrentTab(driver: firefox.Driver, extensionId: string): Promise<void> {
  await grantOptionalOrigins(driver, extensionId, [FIXTURE_PERMISSION])
  const targetHandle = await driver.getWindowHandle()
  await grantActiveTabPermission(driver, extensionId)
  const popupUrl = `moz-extension://${FIREFOX_EXTENSION_UUID}/popup.html`
  const popupHandle = await openTrustedBackgroundTab(driver, popupUrl)
  await delay(1_500)
  const targetTabId = await currentTargetTabId(driver, popupHandle)
  await reconcileSiteAccess(driver, popupHandle, targetTabId)
  await driver.switchTo().window(popupHandle)
  await driver.close()
  await driver.switchTo().window(targetHandle)
}

async function closeServer(server: ViteDevServer | null): Promise<void> {
  if (server) await server.close()
}

const extensionRoot = process.cwd()
const extensionPath = path.resolve(extensionRoot, '.output/firefox-mv3')
const fixtureRoot = path.resolve(extensionRoot, 'tests/fixtures/pages')
const mediaAnchorUrl = `http://${FIXTURE_HOST}:${FIXTURE_PORT}/media-anchor.html`
const iframeOnlyUrl = `http://${FIXTURE_HOST}:${FIXTURE_PORT}/iframe-only.html`
const firefoxBinary = process.env['H5PLAYER_FIREFOX_BINARY'] ?? playwrightFirefox.executablePath()

await access(firefoxBinary)
await access(path.join(extensionPath, 'manifest.json'))

let server: ViteDevServer | null = null
let driver: firefox.Driver | null = null

try {
  server = await createServer({
    configFile: false,
    logLevel: 'error',
    root: fixtureRoot,
    server: {
      host: FIXTURE_HOST,
      port: FIXTURE_PORT,
      strictPort: true
    }
  })
  await server.listen()

  const options = new firefox.Options()
    .setBinary(firefoxBinary)
    .setPreference(
      'extensions.webextensions.uuids',
      JSON.stringify({ [FIREFOX_EXTENSION_ID]: FIREFOX_EXTENSION_UUID })
    )
    .setPreference('media.autoplay.default', 0)
    .setPreference('media.autoplay.blocking_policy', 0)
  if (HEADLESS) options.addArguments('-headless')
  const service = new firefox.ServiceBuilder().addArguments('--allow-system-access').build()
  const session = firefox.Driver.createSession(options, service)
  driver = session
  await session.manage().setTimeouts({ script: DEFAULT_TIMEOUT_MS, pageLoad: 30_000 })
  await session.manage().window().setRect({ width: 1440, height: 900 })

  const installedId = await session.installAddon(extensionPath, true)
  assert.equal(installedId, FIREFOX_EXTENSION_ID)

  await session.get(mediaAnchorUrl)
  await reconcileAndReload(session, installedId, mediaAnchorUrl)
  const baselineAnchor = await waitForMediaHost(session)
  assert.equal(baselineAnchor.placement, 'top-right')
  const baselineControls = await waitFor(
    () => readQuickControls(session),
    (snapshot) => snapshot !== null,
    'Firefox baseline quick controls'
  )
  assert(baselineControls !== null, 'Firefox baseline quick controls are unavailable')
  assert.equal(baselineControls.expanded, false)
  const baselineScreenshot = await saveScreenshot(session, '01-baseline')

  await session.executeScript('globalThis.scrollTo(0, 160)')
  const scrolledAnchor = await waitForMediaHost(session)
  assert.equal(scrolledAnchor.mediaId, baselineAnchor.mediaId)

  await session.findElement(By.id('resize')).click()
  const resizedAnchor = await waitForMediaHost(session)
  assert.equal(resizedAnchor.mediaId, baselineAnchor.mediaId)

  const expandedControls = await hoverQuickControl(session)
  assert(expandedControls.hitboxRect && expandedControls.triggerRect)
  assert(expandedControls.hitboxRect.width > expandedControls.triggerRect.width)
  assert(expandedControls.hitboxRect.height > expandedControls.triggerRect.height)
  const expandedScreenshot = await saveScreenshot(session, '02-pointer-expanded')

  await session.actions({ async: true }).move({ x: 1, y: 1, origin: Origin.VIEWPORT }).perform()
  await startPlayback(session)
  await delay(3_100)
  const dormantControls = await waitFor(
    () => readQuickControls(session),
    (snapshot) => snapshot !== null && !snapshot.expanded && snapshot.triggerOpacity === 0,
    'Firefox dormant playback trigger'
  )
  assert(dormantControls !== null, 'Firefox dormant quick controls are unavailable')

  const rateBefore = await readPlaybackRate(session)
  const feedbackStartedAt = performance.now()
  await pressMediaKey(session, 'c')
  await waitFor(
    () => readPlaybackRate(session),
    (value) => Math.abs(value - (rateBefore + 0.1)) < 0.01,
    'Firefox shortcut playback-rate update'
  )
  const feedbackControls = await waitFor(
    () => readQuickControls(session),
    (snapshot) =>
      snapshot !== null &&
      !snapshot.expanded &&
      snapshot.triggerOpacity === 1 &&
      snapshot.rateLabel?.includes('1.1') === true,
    'Firefox shortcut feedback visibility'
  )
  assert(feedbackControls !== null, 'Firefox shortcut feedback controls are unavailable')
  const feedbackLatencyMs = performance.now() - feedbackStartedAt
  const feedbackScreenshot = await saveScreenshot(session, '03-shortcut-feedback')
  await waitFor(
    () => readQuickControls(session),
    (snapshot) => snapshot !== null && snapshot.triggerOpacity === 0,
    'Firefox shortcut feedback expiry',
    FEEDBACK_TIMEOUT_MS
  )

  await hoverQuickControl(session)
  await pressMediaKey(session, Key.SPACE)
  await waitFor(
    () => readPaused(session),
    (paused) => paused,
    'Firefox shortcut pause'
  )
  const pausedControls = await waitFor(
    () => readQuickControls(session),
    (snapshot) => snapshot !== null && !snapshot.expanded,
    'Firefox pause forced collapse'
  )
  assert(pausedControls !== null, 'Firefox paused quick controls are unavailable')
  const pausedScreenshot = await saveScreenshot(session, '04-paused-collapsed')

  await session.get(iframeOnlyUrl)
  await reconcileAndReload(session, installedId, iframeOnlyUrl)
  await waitForRuntimeReady(session)
  const iframe = await waitFor(
    async () => session.findElements(By.css('iframe')),
    (frames) => frames.length === 1,
    'Firefox iframe fixture mount'
  )
  const mountedFrame = iframe[0]
  assert(mountedFrame, 'Firefox iframe fixture is unavailable')
  await session.switchTo().frame(mountedFrame)
  await waitForRuntimeReady(session)
  await waitForMediaHost(session)
  await session.switchTo().defaultContent()
  await session.findElement(By.id('remove-frame')).click()
  await waitFor(
    async () => (await session.findElements(By.css('iframe'))).length,
    (count) => count === 0,
    'Firefox iframe teardown'
  )
  await session.findElement(By.id('restore-frame')).click()
  const restoredFrame = await waitFor(
    async () => session.findElements(By.css('iframe')),
    (frames) => frames.length === 1,
    'Firefox iframe restore'
  )
  const restoredFrameElement = restoredFrame[0]
  assert(restoredFrameElement, 'Firefox restored iframe is unavailable')
  await reconcileCurrentTab(session, installedId)
  await waitFor(
    () =>
      session.executeScript<unknown>(
        `const frame = document.querySelector('iframe');
        const root = frame instanceof HTMLIFrameElement ? frame.contentDocument?.documentElement : null;
        return root?.dataset.h5playerWebextContent ?? null;`
      ),
    (marker) => marker === 'ready',
    'Firefox restored iframe runtime injection'
  )
  await session.switchTo().frame(restoredFrameElement)
  await waitForRuntimeReady(session)
  await waitForMediaHost(session)
  const iframeScreenshot = await saveScreenshot(session, '05-iframe-restored')
  await session.switchTo().defaultContent()

  const capabilities = await session.getCapabilities()
  const result = {
    event: 'FIREFOX_HEADED_UX_RESULT',
    browserVersion: capabilities.getBrowserVersion(),
    extensionId: installedId,
    headless: HEADLESS,
    viewport: { width: 1440, height: 900 },
    assertions: {
      anchorDistance: {
        baseline: baselineAnchor.distance,
        scroll: scrolledAnchor.distance,
        resize: resizedAnchor.distance
      },
      pointerExpanded: expandedControls.expanded,
      hitboxExpandedBeyondTrigger:
        (expandedControls.hitboxRect?.width ?? 0) > (expandedControls.triggerRect?.width ?? 0) &&
        (expandedControls.hitboxRect?.height ?? 0) > (expandedControls.triggerRect?.height ?? 0),
      playbackDormantOpacity: dormantControls.triggerOpacity,
      shortcutRate: feedbackControls.rateLabel,
      feedbackLatencyMs,
      feedbackExpired: true,
      pauseCollapsed: !pausedControls.expanded,
      iframeTeardownAndRestore: true
    },
    screenshots: [
      baselineScreenshot,
      expandedScreenshot,
      feedbackScreenshot,
      pausedScreenshot,
      iframeScreenshot
    ]
  }
  await mkdir(ARTIFACT_ROOT, { recursive: true })
  await writeFile(path.join(ARTIFACT_ROOT, 'report.json'), `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify(result))
} finally {
  if (driver) await driver.quit().catch(() => undefined)
  await closeServer(server)
}
