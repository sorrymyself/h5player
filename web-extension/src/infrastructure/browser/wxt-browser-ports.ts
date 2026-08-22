import { browser } from 'wxt/browser'
import type {
  BrowserStoragePort,
  ActiveTabPort,
  ContentScriptRegistrationPort,
  PermissionRequest,
  PermissionsPort,
  RuntimeTransportPort,
  RuntimeInfoPort,
  SettingsChangeSourcePort,
  TabsPort
} from '../../application/ports/browser'
import { createTabRequest } from '../../shared/tab-protocol'
import { SETTINGS_STORAGE_KEY } from '../storage/settings-storage-keys'

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export class WxtStoragePort implements BrowserStoragePort {
  async get(key: string): Promise<unknown> {
    const stored: unknown = await browser.storage.local.get(key)
    return toRecord(stored)?.[key]
  }

  async set(values: Readonly<Record<string, unknown>>): Promise<void> {
    await browser.storage.local.set({ ...values })
  }

  async remove(keys: readonly string[]): Promise<void> {
    await browser.storage.local.remove([...keys])
  }

  subscribe(listener: Parameters<BrowserStoragePort['subscribe']>[0]): () => void {
    const onChanged = (
      changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
      area: string
    ) => {
      if (area !== 'local') return
      for (const [key, change] of Object.entries(changes)) {
        listener({ key, oldValue: change.oldValue, newValue: change.newValue })
      }
    }
    browser.storage.onChanged.addListener(onChanged)
    return () => {
      try {
        browser.storage.onChanged.removeListener(onChanged)
      } catch {
        // The old content context may outlive an extension reload.
      }
    }
  }
}

export class WxtRuntimeTransport implements RuntimeTransportPort {
  send(message: unknown): Promise<unknown> {
    return browser.runtime.sendMessage(message)
  }

  async reconnect(): Promise<void> {
    await browser.runtime.getPlatformInfo()
  }
}

export class WxtTabsPort implements TabsPort {
  async getActive(): Promise<{ id: number; url?: string } | null> {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true })
    const tab = tabs[0]
    if (!tab || tab.id === undefined) return null
    return tab.url ? { id: tab.id, url: tab.url } : { id: tab.id }
  }

  async list(): Promise<readonly { id: number; url?: string }[]> {
    const tabs = await browser.tabs.query({})
    return tabs.flatMap((tab) => {
      if (tab.id === undefined) return []
      return [tab.url ? { id: tab.id, url: tab.url } : { id: tab.id }]
    })
  }

  send(tabId: number, message: unknown, frameId?: number): Promise<unknown> {
    return frameId === undefined
      ? browser.tabs.sendMessage(tabId, message)
      : browser.tabs.sendMessage(tabId, message, { frameId })
  }
}

function toBrowserPermissions(request: PermissionRequest): {
  permissions?: readonly string[]
  origins?: readonly string[]
} {
  const converted: { permissions?: readonly string[]; origins?: readonly string[] } = {}
  if (request.permissions) converted.permissions = [...request.permissions]
  if (request.origins) converted.origins = [...request.origins]
  return converted
}

export class WxtPermissionsPort implements PermissionsPort {
  contains(request: PermissionRequest): Promise<boolean> {
    return browser.permissions.contains(
      toBrowserPermissions(request) as Parameters<typeof browser.permissions.contains>[0]
    )
  }

  request(request: PermissionRequest): Promise<boolean> {
    return browser.permissions.request(
      toBrowserPermissions(request) as Parameters<typeof browser.permissions.request>[0]
    )
  }

  remove(request: PermissionRequest): Promise<boolean> {
    return browser.permissions.remove(
      toBrowserPermissions(request) as Parameters<typeof browser.permissions.remove>[0]
    )
  }

  async getAll(): Promise<
    Readonly<{ permissions: readonly string[]; origins: readonly string[] }>
  > {
    const result = await browser.permissions.getAll()
    return {
      permissions: result.permissions ?? [],
      origins: result.origins ?? []
    }
  }
}

function normalizeGrantedMatchPattern(origin: string): string | null {
  if (origin === '<all_urls>') return origin
  if (/^(?:http|https):\/\/[^/]+\/\*$/.test(origin)) return origin
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return `${url.protocol}//${url.host}/*`
  } catch {
    return null
  }
}

export class WxtActiveTabPort implements ActiveTabPort {
  async getCurrent(): Promise<{ id: number; url?: string; title?: string } | null> {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true })
    const tab = tabs[0]
    if (!tab || tab.id === undefined) return null
    const result: { id: number; url?: string; title?: string } = { id: tab.id }
    if (tab.url !== undefined) result.url = tab.url
    if (tab.title !== undefined) result.title = tab.title
    return result
  }

  async requestOrigins(origins: readonly string[]): Promise<boolean> {
    try {
      return await browser.permissions.request({ origins: [...origins] })
    } catch {
      return false
    }
  }

  removeOrigins(origins: readonly string[]): Promise<boolean> {
    return browser.permissions.remove({ origins: [...origins] })
  }

  containsOrigins(origins: readonly string[]): Promise<boolean> {
    return browser.permissions.contains({ origins: [...origins] })
  }

  async getGrantedOrigins(): Promise<readonly string[]> {
    const permissions = await browser.permissions.getAll()
    return permissions.origins ?? []
  }
}

const CONTENT_SCRIPT_IDS = {
  isolated: 'h5player-content-v3',
  main: 'h5player-page-main-v3'
} as const

const CONTENT_SCRIPT_FILES = {
  isolated: '/content-scripts/content.js',
  main: '/content-scripts/page-main.js',
  experimentalMain: '/content-scripts/experimental-main.js'
} as const

export class WxtContentScriptRegistrationPort implements ContentScriptRegistrationPort {
  async reconcile(origins: readonly string[]): Promise<void> {
    const patterns = [
      ...new Set(
        origins
          .map(normalizeGrantedMatchPattern)
          .filter((pattern): pattern is string => pattern !== null)
      )
    ]
    const scripting = browser.scripting
    const existing = await scripting.getRegisteredContentScripts()
    const registeredIds = existing
      .map((script) => script.id)
      .filter((id) => id === CONTENT_SCRIPT_IDS.isolated || id === CONTENT_SCRIPT_IDS.main)
    if (registeredIds.length > 0) await scripting.unregisterContentScripts({ ids: registeredIds })
    if (patterns.length === 0) return

    await scripting.registerContentScripts([
      {
        id: CONTENT_SCRIPT_IDS.isolated,
        matches: patterns,
        js: [CONTENT_SCRIPT_FILES.isolated],
        runAt: 'document_start',
        allFrames: true,
        persistAcrossSessions: true
      },
      {
        id: CONTENT_SCRIPT_IDS.main,
        matches: patterns,
        js: [CONTENT_SCRIPT_FILES.main],
        runAt: 'document_start',
        allFrames: true,
        world: 'MAIN',
        persistAcrossSessions: true
      }
    ])
  }

  async bootstrap(tabId: number): Promise<void> {
    await browser.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: [CONTENT_SCRIPT_FILES.main],
      world: 'MAIN'
    })
    await browser.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: [CONTENT_SCRIPT_FILES.isolated]
    })
  }

  async injectExperimentalMain(tabId: number, frameId: number): Promise<void> {
    await browser.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      files: [CONTENT_SCRIPT_FILES.experimentalMain],
      world: 'MAIN'
    })
  }

  async teardown(tabId: number): Promise<void> {
    await browser.tabs
      .sendMessage(tabId, createTabRequest('site.permission-revoked', {}))
      .catch(() => undefined)
  }
}

function parseUserAgent(userAgent: string): { name: string; version: string } {
  const candidates = [
    { name: 'Firefox', pattern: /Firefox\/([0-9.]+)/ },
    { name: 'Edge', pattern: /Edg\/([0-9.]+)/ },
    { name: 'Chrome', pattern: /Chrome\/([0-9.]+)/ }
  ] as const
  for (const candidate of candidates) {
    const match = candidate.pattern.exec(userAgent)
    if (match?.[1]) return { name: candidate.name, version: match[1] }
  }
  return { name: 'Unknown', version: 'unknown' }
}

export class WxtRuntimeInfoPort implements RuntimeInfoPort {
  async getEnvironment(): Promise<{
    browserName: string
    browserVersion: string
    platform: string
  }> {
    const parsed = parseUserAgent(globalThis.navigator?.userAgent ?? '')
    const platform = await browser.runtime.getPlatformInfo()
    return {
      browserName: parsed.name,
      browserVersion: parsed.version,
      platform: `${platform.os}/${platform.arch}`
    }
  }
}

export class WxtSettingsChangeSourcePort implements SettingsChangeSourcePort {
  subscribe(listener: () => void): () => void {
    const onChanged = (changes: Record<string, unknown>, area: string): void => {
      if (area === 'local' && SETTINGS_STORAGE_KEY in changes) listener()
    }
    browser.storage.onChanged.addListener(onChanged)
    return () => {
      try {
        browser.storage.onChanged.removeListener(onChanged)
      } catch {
        // The old extension context has already released this listener.
      }
    }
  }
}
