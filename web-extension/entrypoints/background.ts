import { browser } from 'wxt/browser'
import { SettingsService } from '../src/application/settings/settings-service'
import { DiagnosticsService } from '../src/application/diagnostics/diagnostics-service'
import { SiteAccessService } from '../src/application/site/site-access-service'
import { FrameRuntimeRegistry } from '../src/application/site/frame-runtime-registry'
import { CrossTabMediaEventService, PictureInPictureControlService } from '../src/application/media'
import { ProgressService } from '../src/application/progress'
import {
  WxtContentScriptRegistrationPort,
  WxtPermissionsPort,
  WxtRuntimeInfoPort,
  WxtStoragePort,
  WxtTabsPort
} from '../src/infrastructure/browser/wxt-browser-ports'
import { consumeChromeRuntimeLastError } from '../src/infrastructure/browser/runtime-reconnect'
import { StructuredLogger } from '../src/infrastructure/logging/structured-logger'
import { ReplayGuard } from '../src/infrastructure/messaging/replay-guard'
import { SettingsRepository } from '../src/infrastructure/storage/settings-repository'
import { systemClock } from '../src/infrastructure/time/system-time'
import { BackgroundRuntime } from '../src/runtime/background/background-runtime'
import type { RuntimeSenderMetadata } from '../src/runtime/background/sender-policy'
import { CURRENT_EXTENSION_PHASE } from '../src/shared/protocol'

const FRAME_RUNTIME_PORT_PREFIX = 'h5player-frame-runtime:'

function senderMetadata(
  sender: Parameters<Parameters<typeof browser.runtime.onMessage.addListener>[0]>[1]
): RuntimeSenderMetadata {
  const metadata: RuntimeSenderMetadata = {}
  if (sender.id) metadata.id = sender.id
  if (sender.url) metadata.url = sender.url
  if (sender.tab?.url) metadata.tabUrl = sender.tab.url
  if (sender.tab?.id !== undefined) metadata.tabId = sender.tab.id
  if (sender.frameId !== undefined) metadata.frameId = sender.frameId
  return metadata
}

export default defineBackground(() => {
  const logger = new StructuredLogger('background', systemClock)
  const repository = new SettingsRepository(new WxtStoragePort(), systemClock, logger)
  const settings = new SettingsService(repository)
  const progress = new ProgressService(repository)
  const tabs = new WxtTabsPort()
  const permissions = new WxtPermissionsPort()
  const frameRegistry = new FrameRuntimeRegistry({ now: () => systemClock.now() })
  const pictureInPicture = new PictureInPictureControlService(tabs, systemClock, {
    frameIds: (tabId) => frameRegistry.frameIds(tabId)
  })
  const siteAccess = new SiteAccessService(
    settings,
    tabs,
    permissions,
    new WxtContentScriptRegistrationPort(),
    frameRegistry
  )
  const crossTab = new CrossTabMediaEventService(tabs, systemClock)
  const buildValue = (import.meta.env as unknown as { ['VITE_BUILD_SHA']?: unknown })[
    'VITE_BUILD_SHA'
  ]
  const diagnostics = new DiagnosticsService({
    extensionVersion: browser.runtime.getManifest().version,
    buildId: typeof buildValue === 'string' && buildValue.length > 0 ? buildValue : 'local',
    clock: systemClock,
    runtimeInfo: new WxtRuntimeInfoPort(),
    permissions,
    settings,
    siteAccess,
    logger
  })
  const runtime = new BackgroundRuntime({
    extensionId: browser.runtime.id,
    extensionVersion: browser.runtime.getManifest().version,
    settings,
    replayGuard: new ReplayGuard(systemClock),
    logger,
    tabs,
    siteAccess,
    frameRegistry,
    diagnostics,
    crossTab,
    pictureInPicture,
    progress
  })

  void runtime.initialize()

  browser.runtime.onInstalled.addListener(() => {
    void browser.storage.local.set({
      'h5player.extension.version': browser.runtime.getManifest().version,
      'h5player.extension.phase': CURRENT_EXTENSION_PHASE,
      'h5player.extension.protocol': 1,
      'h5player.extension.settings-schema': 2
    })
  })

  browser.runtime.onMessage.addListener((rawMessage, sender, sendResponse): boolean => {
    void runtime.handle(rawMessage, senderMetadata(sender)).then(sendResponse)
    return true
  })

  browser.runtime.onConnect.addListener((port) => {
    if (!port.name.startsWith(FRAME_RUNTIME_PORT_PREFIX)) return
    const sessionId = port.name.slice(FRAME_RUNTIME_PORT_PREFIX.length)
    const tabId = port.sender?.tab?.id
    const frameId = port.sender?.frameId
    if (sessionId.length < 16 || tabId === undefined || frameId === undefined) {
      port.disconnect()
      return
    }
    frameRegistry.connect({ tabId, frameId, sessionId })
    port.onDisconnect.addListener(() => {
      consumeChromeRuntimeLastError()
      frameRegistry.remove({ tabId, frameId, sessionId })
      pictureInPicture.removeFrame({ tabId, frameId, sessionId })
    })
  })

  browser.permissions.onAdded.addListener(() => {
    void siteAccess.reconcile(false)
  })
  browser.permissions.onRemoved.addListener(() => {
    void siteAccess.reconcile(false)
  })
  browser.tabs.onRemoved.addListener((tabId) => {
    frameRegistry.removeTab(tabId)
    pictureInPicture.removeTab(tabId)
    siteAccess.clearTabRuntimeState(tabId)
  })
})
