import type { ClockPort } from '../../application/ports/browser'
import type {
  DiagnosticLoggerPort,
  LogRecord,
  RuntimeContext
} from '../../application/ports/logging'

const REDACTED = '[redacted]'
const SENSITIVE_KEYS =
  /(?:authorization|cookie|token|secret|password|query|fragment|title|text|media.*src|url)$/i

function sanitizeString(value: string): string {
  const truncated = value.length > 512 ? `${value.slice(0, 509)}...` : value
  return truncated.replace(/https?:\/\/[^\s"']+/gi, (match) => {
    try {
      const url = new URL(match)
      return url.hostname
    } catch {
      return REDACTED
    }
  })
}

function sanitizeDetails(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet()
): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') return sanitizeString(value)
  if (typeof value !== 'object') return `[${typeof value}]`
  if (depth >= 4 || seen.has(value)) return '[truncated]'
  seen.add(value)

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeDetails(item, depth + 1, seen))
  }

  const sanitized: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value).slice(0, 50)) {
    sanitized[key] = SENSITIVE_KEYS.test(key) ? REDACTED : sanitizeDetails(entry, depth + 1, seen)
  }
  return sanitized
}

export class StructuredLogger implements DiagnosticLoggerPort {
  private readonly records: LogRecord[] = []

  constructor(
    private readonly context: RuntimeContext,
    private readonly clock: ClockPort,
    private readonly capacity = 200
  ) {}

  log(record: Omit<LogRecord, 'timestamp' | 'context'>): void {
    const sanitized: LogRecord = {
      timestamp: this.clock.now(),
      context: this.context,
      level: record.level,
      module: sanitizeString(record.module),
      eventCode: sanitizeString(record.eventCode)
    }
    if (record.correlationId) sanitized.correlationId = sanitizeString(record.correlationId)
    if (record.details !== undefined) sanitized.details = sanitizeDetails(record.details)

    this.records.push(sanitized)
    if (this.records.length > this.capacity) {
      this.records.splice(0, this.records.length - this.capacity)
    }
  }

  snapshot(): readonly LogRecord[] {
    return this.records.map((record) => ({ ...record }))
  }

  clear(): void {
    this.records.length = 0
  }
}
