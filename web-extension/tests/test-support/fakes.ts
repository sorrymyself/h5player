import type {
  ActiveTab,
  ActiveTabPort,
  BrowserStoragePort,
  ClockPort,
  ContentScriptRegistrationPort,
  PermissionRequest,
  PermissionsPort,
  RuntimeEnvironment,
  RuntimeInfoPort,
  RuntimeTransportPort,
  SettingsChangeSourcePort,
  StorageChange,
  TabsPort,
  Teardown
} from '../../src/application/ports/browser'
import type {
  DiagnosticLoggerPort,
  LoggerPort,
  LogRecord
} from '../../src/application/ports/logging'

export class FakeClock implements ClockPort {
  constructor(private current = 1_700_000_000_000) {}

  now(): number {
    return this.current
  }

  advance(milliseconds: number): void {
    this.current += milliseconds
  }
}

export class FakeLogger implements LoggerPort {
  readonly records: Array<Omit<LogRecord, 'timestamp' | 'context'>> = []

  log(record: Omit<LogRecord, 'timestamp' | 'context'>): void {
    this.records.push(record)
  }
}

export class FakeDiagnosticLogger implements DiagnosticLoggerPort {
  readonly records: LogRecord[] = []

  constructor(
    private readonly context: LogRecord['context'] = 'background',
    private readonly clock: ClockPort = new FakeClock()
  ) {}

  log(record: Omit<LogRecord, 'timestamp' | 'context'>): void {
    this.records.push({ ...record, timestamp: this.clock.now(), context: this.context })
  }

  snapshot(): readonly LogRecord[] {
    return this.records.map((record) => ({ ...record }))
  }

  clear(): void {
    this.records.length = 0
  }
}

export class FakeStoragePort implements BrowserStoragePort {
  private readonly values = new Map<string, unknown>()
  private readonly listeners = new Set<(change: StorageChange) => void>()
  failReads = false
  failWrites = false
  writeDelayMs = 0

  constructor(initial: Readonly<Record<string, unknown>> = {}) {
    for (const [key, value] of Object.entries(initial)) this.values.set(key, value)
  }

  get(key: string): Promise<unknown> {
    if (this.failReads) return Promise.reject(new Error('read failed'))
    return Promise.resolve(this.values.get(key))
  }

  async set(values: Readonly<Record<string, unknown>>): Promise<void> {
    if (this.failWrites) throw new Error('write failed')
    if (this.writeDelayMs > 0) {
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, this.writeDelayMs))
    }
    for (const [key, value] of Object.entries(values)) {
      const oldValue = this.values.get(key)
      this.values.set(key, value)
      for (const listener of this.listeners) listener({ key, oldValue, newValue: value })
    }
  }

  remove(keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      const oldValue = this.values.get(key)
      this.values.delete(key)
      for (const listener of this.listeners) {
        listener({ key, oldValue, newValue: undefined })
      }
    }
    return Promise.resolve()
  }

  subscribe(listener: (change: StorageChange) => void): Teardown {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot(): Readonly<Record<string, unknown>> {
    return Object.fromEntries(this.values)
  }
}

export class FakeTransport implements RuntimeTransportPort {
  readonly sent: unknown[] = []
  reconnectCount = 0

  constructor(private readonly handler: (message: unknown) => Promise<unknown>) {}

  send(message: unknown): Promise<unknown> {
    this.sent.push(message)
    return this.handler(message)
  }

  reconnect(): Promise<void> {
    this.reconnectCount += 1
    return Promise.resolve()
  }
}

export class FakeTabsPort implements TabsPort {
  activeTab: { id: number; url?: string } | null = { id: 1, url: 'https://example.com/' }
  tabs: Array<{ id: number; url?: string }> = [{ id: 1, url: 'https://example.com/' }]
  readonly sent: Array<{ tabId: number; message: unknown; frameId?: number }> = []
  handler: (message: unknown, tabId: number, frameId?: number) => Promise<unknown> = () =>
    Promise.resolve(null)

  getActive(): Promise<{ id: number; url?: string } | null> {
    return Promise.resolve(this.activeTab)
  }

  list(): Promise<readonly { id: number; url?: string }[]> {
    return Promise.resolve([...this.tabs])
  }

  send(tabId: number, message: unknown, frameId?: number): Promise<unknown> {
    const sent: { tabId: number; message: unknown; frameId?: number } = { tabId, message }
    if (frameId !== undefined) sent.frameId = frameId
    this.sent.push(sent)
    return this.handler(message, tabId, frameId)
  }
}

function requestValues(request: PermissionRequest): readonly string[] {
  return [...(request.permissions ?? []), ...(request.origins ?? [])]
}

export class FakePermissionsPort implements PermissionsPort {
  readonly permissions = new Set(['storage', 'activeTab', 'scripting'])
  readonly origins = new Set<string>()
  requestResult = true
  removeResult = true

  contains(request: PermissionRequest): Promise<boolean> {
    const hasAllSites = this.origins.has('<all_urls>')
    const allowed = requestValues(request).every((value) => {
      if (request.permissions?.includes(value)) return this.permissions.has(value)
      return this.origins.has(value) || hasAllSites
    })
    return Promise.resolve(allowed)
  }

  request(request: PermissionRequest): Promise<boolean> {
    if (!this.requestResult) return Promise.resolve(false)
    for (const permission of request.permissions ?? []) this.permissions.add(permission)
    for (const origin of request.origins ?? []) this.origins.add(origin)
    return Promise.resolve(true)
  }

  remove(request: PermissionRequest): Promise<boolean> {
    if (!this.removeResult) return Promise.resolve(false)
    for (const permission of request.permissions ?? []) this.permissions.delete(permission)
    for (const origin of request.origins ?? []) this.origins.delete(origin)
    return Promise.resolve(true)
  }

  getAll(): Promise<Readonly<{ permissions: readonly string[]; origins: readonly string[] }>> {
    return Promise.resolve({
      permissions: [...this.permissions],
      origins: [...this.origins]
    })
  }
}

export class FakeActiveTabPort implements ActiveTabPort {
  current: ActiveTab | null = { id: 1, url: 'https://example.com/watch', title: 'Fixture' }
  readonly permissions = new FakePermissionsPort()

  getCurrent(): Promise<ActiveTab | null> {
    return Promise.resolve(this.current)
  }

  requestOrigins(origins: readonly string[]): Promise<boolean> {
    return this.permissions.request({ origins })
  }

  removeOrigins(origins: readonly string[]): Promise<boolean> {
    return this.permissions.remove({ origins })
  }

  containsOrigins(origins: readonly string[]): Promise<boolean> {
    return this.permissions.contains({ origins })
  }

  async getGrantedOrigins(): Promise<readonly string[]> {
    return (await this.permissions.getAll()).origins
  }
}

export class FakeContentScriptRegistrationPort implements ContentScriptRegistrationPort {
  readonly reconciled: (readonly string[])[] = []
  readonly bootstrapped: number[] = []
  readonly experimentalMainInjected: Array<{ tabId: number; frameId: number }> = []
  readonly tornDown: number[] = []
  failReconcile = false

  reconcile(origins: readonly string[]): Promise<void> {
    if (this.failReconcile) return Promise.reject(new Error('registration failed'))
    this.reconciled.push([...origins])
    return Promise.resolve()
  }

  bootstrap(tabId: number): Promise<void> {
    this.bootstrapped.push(tabId)
    return Promise.resolve()
  }

  injectExperimentalMain(tabId: number, frameId: number): Promise<void> {
    this.experimentalMainInjected.push({ tabId, frameId })
    return Promise.resolve()
  }

  teardown(tabId: number): Promise<void> {
    this.tornDown.push(tabId)
    return Promise.resolve()
  }
}

export class FakeRuntimeInfoPort implements RuntimeInfoPort {
  environment: RuntimeEnvironment = {
    browserName: 'Chromium',
    browserVersion: '140.0',
    platform: 'mac/arm64'
  }

  getEnvironment(): Promise<RuntimeEnvironment> {
    return Promise.resolve(this.environment)
  }
}

export class FakeSettingsChangeSourcePort implements SettingsChangeSourcePort {
  private readonly listeners = new Set<() => void>()

  subscribe(listener: () => void): Teardown {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(): void {
    for (const listener of this.listeners) listener()
  }
}
