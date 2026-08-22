import { chromium, type BrowserContext, type CDPSession, type Page } from '@playwright/test'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

type ExtensionManifest = Readonly<Record<string, unknown>> & {
  optional_host_permissions?: readonly string[]
}

type TargetInfo = Readonly<{
  targetId: string
  type: string
  title: string
  url: string
  browserContextId?: string
  embedderData?: Readonly<{ tabActive?: boolean }>
}>

export type ExtensionHarnessOptions = Readonly<{
  grantedOrigins?: readonly string[]
  denyPermissionRequests?: boolean
  enableBackForwardCache?: boolean
  loadExtensionViaCdp?: boolean
  headless?: boolean
  channel?: 'chromium' | 'chrome' | 'msedge'
  viewport?: Readonly<{ width: number; height: number }>
  locale?: string
  timezoneId?: string
}>

export type ExtensionHarness = Readonly<{
  context: BrowserContext
  extensionId: string
  browserSession: CDPSession
  openPopup(targetPage: Page): Promise<Page>
  reloadExtension(): Promise<void>
  close(): Promise<void>
}>

const sourceExtensionPath = path.resolve('.output/chrome-mv3')

function launchArguments(
  extensionPath: string,
  includeExtension: boolean = true
): readonly string[] {
  const args = ['--enable-unsafe-extension-debugging', '--deny-permission-prompts']
  if (includeExtension) {
    args.push(`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`)
  }
  return args
}

function assertExtensionSideLoadChannel(channel: ExtensionHarnessOptions['channel']): void {
  if (channel === undefined || channel === 'chromium') return
  throw new Error(
    `Playwright extension E2E requires the bundled Chromium channel; ${channel} does not expose the command-line flags needed to side-load extensions. Use H5PLAYER_LIVE_CHANNEL=chromium for real-site runs.`
  )
}

async function waitForServiceWorker(
  context: BrowserContext,
  expectedExtensionId: string | null = null
) {
  const existing = context
    .serviceWorkers()
    .find(
      (worker) => expectedExtensionId === null || new URL(worker.url()).host === expectedExtensionId
    )
  if (existing !== undefined) return existing
  if (expectedExtensionId === null) return await context.waitForEvent('serviceworker')

  const workerPromise = context.waitForEvent('serviceworker', {
    predicate: (worker) => new URL(worker.url()).host === expectedExtensionId
  })
  const wakePage = await context.newPage()
  try {
    await wakePage.goto(`chrome-extension://${expectedExtensionId}/popup.html`, {
      waitUntil: 'domcontentloaded'
    })
    return await workerPromise
  } finally {
    await wakePage.close().catch(() => undefined)
  }
}

async function seedGrantedOrigins(
  userDataDir: string,
  extensionPath: string,
  origins: readonly string[]
): Promise<string> {
  const manifestPath = path.join(extensionPath, 'manifest.json')
  const originalText = await readFile(manifestPath, 'utf8')
  const original = JSON.parse(originalText) as ExtensionManifest
  const seeded = {
    ...original,
    host_permissions: [...new Set(origins)]
  }
  await writeFile(manifestPath, JSON.stringify(seeded))

  let seedContext: BrowserContext | null = null
  try {
    seedContext = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: true,
      args: [...launchArguments(extensionPath)]
    })
    const worker = await waitForServiceWorker(seedContext)
    const extensionId = new URL(worker.url()).host
    const granted = await worker.evaluate(async () => {
      const api = (
        globalThis as unknown as {
          chrome: {
            permissions: {
              getAll(): Promise<{ origins?: string[]; permissions?: string[] }>
            }
          }
        }
      ).chrome
      return await api.permissions.getAll()
    })
    for (const origin of origins) {
      if (!granted.origins?.includes(origin)) {
        throw new Error(`Failed to seed extension host permission: ${origin}`)
      }
    }
    return extensionId
  } finally {
    await seedContext?.close().catch(() => undefined)
    await writeFile(manifestPath, originalText)
  }
}

async function disableOptionalHostPermissions(extensionPath: string): Promise<void> {
  const manifestPath = path.join(extensionPath, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ExtensionManifest
  await writeFile(
    manifestPath,
    JSON.stringify({
      ...manifest,
      optional_host_permissions: []
    })
  )
}

async function currentTargetIds(browserSession: CDPSession): Promise<ReadonlySet<string>> {
  const result = (await browserSession.send('Target.getTargets', {
    filter: [{ type: 'page' }]
  })) as { targetInfos: TargetInfo[] }
  return new Set(result.targetInfos.map((target) => target.targetId))
}

async function closeTriggeredPopup(
  browserSession: CDPSession,
  extensionId: string,
  previousTargetIds: ReadonlySet<string>
): Promise<void> {
  const popupUrl = `chrome-extension://${extensionId}/popup.html`
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = (await browserSession.send('Target.getTargets', {
      filter: [{ type: 'page' }]
    })) as { targetInfos: TargetInfo[] }
    const popupTarget = result.targetInfos.find(
      (target) => target.url === popupUrl && !previousTargetIds.has(target.targetId)
    )
    if (popupTarget) {
      await browserSession.send('Target.closeTarget', { targetId: popupTarget.targetId })
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

async function tabTargetForPage(browserSession: CDPSession, page: Page): Promise<TargetInfo> {
  await page.bringToFront()
  const pageUrl = page.url()
  const title = await page.title()
  const result = (await browserSession.send('Target.getTargets', {
    filter: [{ type: 'tab' }]
  })) as { targetInfos: TargetInfo[] }
  // A production SPA can update its title between `page.title()` and the CDP
  // snapshot (Douyin does this while hydrating the player). URL is the stable
  // identity of the tab; title is only a fallback disambiguator. Requiring an
  // exact title here made popup opening fail before media assertions ran.
  const exactUrl = result.targetInfos.filter((target) => target.url === pageUrl)
  const titleMatches = result.targetInfos.filter(
    (target) => target.url === pageUrl && target.title === title
  )
  const matches = titleMatches.length > 0 ? titleMatches : exactUrl
  const active = matches.find((target) => target.embedderData?.tabActive)
  const target = active ?? matches[0]
  if (!target) throw new Error(`Unable to resolve Chromium tab target for ${page.url()}`)
  return target
}

export async function launchExtensionHarness(
  options: ExtensionHarnessOptions = {}
): Promise<ExtensionHarness> {
  const grantedOrigins = [...new Set(options.grantedOrigins ?? [])]
  const denyPermissionRequests = options.denyPermissionRequests ?? false
  const enableBackForwardCache = options.enableBackForwardCache ?? false
  const loadExtensionViaCdp = options.loadExtensionViaCdp ?? false
  const headless = options.headless ?? true
  const channel = options.channel ?? 'chromium'
  assertExtensionSideLoadChannel(channel)
  let temporaryRoot: string | null = null
  let extensionPath = sourceExtensionPath
  let userDataDir = ''
  let seededExtensionId: string | null = null

  if (grantedOrigins.length > 0 || denyPermissionRequests) {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'h5player-webext-e2e-'))
    extensionPath = path.join(temporaryRoot, 'extension')
    userDataDir = path.join(temporaryRoot, 'profile')
    await cp(sourceExtensionPath, extensionPath, { recursive: true })
    if (grantedOrigins.length > 0) {
      seededExtensionId = await seedGrantedOrigins(userDataDir, extensionPath, grantedOrigins)
    }
    if (denyPermissionRequests) await disableOptionalHostPermissions(extensionPath)
  }

  let context: BrowserContext | null = null
  try {
    const ignoredDefaultArgs = [
      ...(enableBackForwardCache ? ['--disable-back-forward-cache'] : []),
      ...(loadExtensionViaCdp
        ? ['--disable-extensions', '--disable-component-extensions-with-background-pages']
        : [])
    ]
    context = await chromium.launchPersistentContext(userDataDir, {
      channel,
      headless,
      ...(ignoredDefaultArgs.length > 0 ? { ignoreDefaultArgs: ignoredDefaultArgs } : {}),
      ...(options.viewport === undefined ? {} : { viewport: options.viewport }),
      ...(options.locale === undefined ? {} : { locale: options.locale }),
      ...(options.timezoneId === undefined ? {} : { timezoneId: options.timezoneId }),
      args: [...launchArguments(extensionPath, !loadExtensionViaCdp)]
    })
    const activeContext = context
    const browser = activeContext.browser()
    if (!browser) throw new Error('Chromium browser handle is unavailable')
    const browserSession = await browser.newBrowserCDPSession()
    let extensionId: string
    let worker: Awaited<ReturnType<typeof waitForServiceWorker>>
    if (loadExtensionViaCdp) {
      const loaded = await browserSession.send('Extensions.loadUnpacked', {
        path: extensionPath
      })
      extensionId = loaded.id
      worker = await waitForServiceWorker(activeContext, extensionId)
    } else {
      worker = await waitForServiceWorker(activeContext, seededExtensionId)
      extensionId = new URL(worker.url()).host
    }

    if (grantedOrigins.length > 0) {
      const granted = await worker.evaluate(async () => {
        const api = (
          globalThis as unknown as {
            chrome: {
              permissions: {
                getAll(): Promise<{ origins?: string[]; permissions?: string[] }>
              }
            }
          }
        ).chrome
        return await api.permissions.getAll()
      })
      for (const origin of grantedOrigins) {
        if (!granted.origins?.includes(origin)) {
          throw new Error(`Seeded host permission did not survive manifest restore: ${origin}`)
        }
      }
    }

    return {
      context: activeContext,
      extensionId,
      browserSession,
      async openPopup(targetPage: Page): Promise<Page> {
        const target = await tabTargetForPage(browserSession, targetPage)
        const previousTargetIds = await currentTargetIds(browserSession)
        await browserSession.send('Extensions.triggerAction', {
          id: extensionId,
          targetId: target.targetId
        })
        await closeTriggeredPopup(browserSession, extensionId, previousTargetIds)

        const popup = await activeContext.newPage()
        await targetPage.bringToFront()
        await popup.goto(`chrome-extension://${extensionId}/popup.html`)
        await popup.getByRole('heading', { name: 'H5Player 控制台' }).waitFor()
        return popup
      },
      async reloadExtension(): Promise<void> {
        if (!loadExtensionViaCdp) {
          throw new Error('Extension reload requires loadExtensionViaCdp')
        }
        const manifestPath = path.join(extensionPath, 'manifest.json')
        const originalManifest = await readFile(manifestPath, 'utf8')
        try {
          await browserSession.send('Extensions.uninstall', { id: extensionId })
          const manifest = JSON.parse(originalManifest) as ExtensionManifest
          await writeFile(
            manifestPath,
            JSON.stringify({ ...manifest, host_permissions: grantedOrigins })
          )
          const loaded = await browserSession.send('Extensions.loadUnpacked', {
            path: extensionPath
          })
          if (loaded.id !== extensionId) {
            throw new Error(`Reloaded extension id changed from ${extensionId} to ${loaded.id}`)
          }
        } finally {
          await writeFile(manifestPath, originalManifest)
        }
        await waitForServiceWorker(activeContext, extensionId)
      },
      async close(): Promise<void> {
        await browserSession.detach().catch(() => undefined)
        await activeContext.close().catch(() => undefined)
        if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
      }
    }
  } catch (error) {
    await context?.close().catch(() => undefined)
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
    throw error
  }
}
