export type Teardown = () => void

export type StorageChange = {
  key: string
  oldValue: unknown
  newValue: unknown
}

export interface BrowserStoragePort {
  get(key: string): Promise<unknown>
  set(values: Readonly<Record<string, unknown>>): Promise<void>
  remove(keys: readonly string[]): Promise<void>
  subscribe(listener: (change: StorageChange) => void): Teardown
}

export interface RuntimeTransportPort {
  send(message: unknown): Promise<unknown>
  reconnect?(): Promise<void>
}

export type TabSummary = {
  id: number
  url?: string
}

export interface TabsPort {
  getActive(): Promise<TabSummary | null>
  list(): Promise<readonly TabSummary[]>
  send(tabId: number, message: unknown, frameId?: number): Promise<unknown>
}

export type PermissionRequest = {
  permissions?: readonly string[]
  origins?: readonly string[]
}

export interface PermissionsPort {
  contains(request: PermissionRequest): Promise<boolean>
  request(request: PermissionRequest): Promise<boolean>
  remove(request: PermissionRequest): Promise<boolean>
  getAll(): Promise<Readonly<{ permissions: readonly string[]; origins: readonly string[] }>>
}

export type ActiveTab = Readonly<{
  id: number
  url?: string
  title?: string
}>

export interface ActiveTabPort {
  getCurrent(): Promise<ActiveTab | null>
  requestOrigins(origins: readonly string[]): Promise<boolean>
  removeOrigins(origins: readonly string[]): Promise<boolean>
  containsOrigins(origins: readonly string[]): Promise<boolean>
  getGrantedOrigins(): Promise<readonly string[]>
}

export type ContentScriptRegistration = Readonly<{
  origins: readonly string[]
  bootstrapTabId?: number
}>

export interface ContentScriptRegistrationPort {
  reconcile(origins: readonly string[]): Promise<void>
  bootstrap(tabId: number): Promise<void>
  injectExperimentalMain(tabId: number, frameId: number): Promise<void>
  teardown(tabId: number): Promise<void>
}

export type RuntimeEnvironment = Readonly<{
  browserName: string
  browserVersion: string
  platform: string
}>

export interface RuntimeInfoPort {
  getEnvironment(): Promise<RuntimeEnvironment>
}

export interface SettingsChangeSourcePort {
  subscribe(listener: () => void): Teardown
}

export interface ClockPort {
  now(): number
}

export type TimeoutHandle = ReturnType<typeof globalThis.setTimeout>

export interface SchedulerPort {
  setTimeout(callback: () => void, delayMs: number): TimeoutHandle
  clearTimeout(handle: TimeoutHandle): void
}
