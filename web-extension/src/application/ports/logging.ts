export type LogLevel = 'error' | 'warn' | 'info' | 'debug'
export type RuntimeContext = 'background' | 'content' | 'page-main' | 'popup' | 'options'

export type LogRecord = {
  timestamp: number
  level: LogLevel
  context: RuntimeContext
  module: string
  eventCode: string
  correlationId?: string
  details?: unknown
}

export interface LoggerPort {
  log(record: Omit<LogRecord, 'timestamp' | 'context'>): void
}

export interface DiagnosticLoggerPort extends LoggerPort {
  snapshot(): readonly LogRecord[]
  clear(): void
}
