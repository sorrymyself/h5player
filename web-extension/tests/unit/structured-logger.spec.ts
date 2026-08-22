import { describe, expect, it } from 'vitest'
import { StructuredLogger } from '../../src/infrastructure/logging/structured-logger'
import { FakeClock } from '../test-support/fakes'

describe('structured logger', () => {
  it('redacts sensitive fields, strips URL query data and enforces capacity', () => {
    const clock = new FakeClock(10)
    const logger = new StructuredLogger('background', clock, 2)

    logger.log({
      level: 'warn',
      module: 'settings',
      eventCode: 'FIRST',
      correlationId: 'request-1',
      details: {
        url: 'https://example.com/watch?token=secret#account',
        nested: { token: 'secret', origin: 'https://example.com/path?q=private' }
      }
    })
    const redacted = JSON.stringify(logger.snapshot())
    expect(redacted).not.toContain('secret')
    expect(redacted).not.toContain('?q=private')
    expect(redacted).not.toContain('/path')
    expect(redacted).toContain('[redacted]')

    clock.advance(1)
    logger.log({ level: 'info', module: 'settings', eventCode: 'SECOND' })
    logger.log({ level: 'error', module: 'settings', eventCode: 'THIRD' })

    const records = logger.snapshot()
    expect(records).toHaveLength(2)
    expect(records[0]?.eventCode).toBe('SECOND')
    logger.clear()
    expect(logger.snapshot()).toEqual([])
  })
})
