import * as z from 'zod/mini'
import { describe, expect, it } from 'vitest'
import { systemScheduler } from '../../src/infrastructure/time/system-time'
import {
  RuntimeRequestClient,
  RuntimeRequestError
} from '../../src/infrastructure/messaging/request-client'
import {
  createRuntimeError,
  createRuntimeSuccess,
  parseRuntimeRequest
} from '../../src/shared/protocol'
import { FakeTransport } from '../test-support/fakes'

const responseSchema = z.strictObject({ value: z.string() })

describe('runtime request client', () => {
  it('validates correlated responses', async () => {
    const transport = new FakeTransport((raw) => {
      const request = parseRuntimeRequest(raw)
      if (!request) return Promise.reject(new Error('invalid request'))
      return Promise.resolve(createRuntimeSuccess(request, { value: 'ok' }))
    })
    const client = new RuntimeRequestClient('popup', transport, systemScheduler)

    await expect(client.request('system.ping', {}, responseSchema)).resolves.toEqual({
      value: 'ok'
    })
  })

  it('reconnects once after a transport failure with a fresh request', async () => {
    let attempts = 0
    const transport = new FakeTransport((raw) => {
      attempts += 1
      if (attempts === 1) return Promise.reject(new Error('worker asleep'))
      const request = parseRuntimeRequest(raw)
      if (!request) return Promise.reject(new Error('invalid request'))
      return Promise.resolve(createRuntimeSuccess(request, { value: 'recovered' }))
    })
    const client = new RuntimeRequestClient('options', transport, systemScheduler)

    await expect(client.request('settings.get', {}, responseSchema)).resolves.toEqual({
      value: 'recovered'
    })
    expect(transport.reconnectCount).toBe(1)
    const requestIds = transport.sent
      .map(parseRuntimeRequest)
      .filter((request) => request?.type !== 'protocol.cancel')
      .map((request) => request?.requestId)
    expect(new Set(requestIds).size).toBe(2)
  })

  it('surfaces typed protocol errors', async () => {
    const transport = new FakeTransport((raw) => {
      const request = parseRuntimeRequest(raw)
      if (!request) return Promise.reject(new Error('invalid request'))
      return Promise.resolve(createRuntimeError(request, 'PERMISSION_DENIED', 'permission.denied'))
    })
    const client = new RuntimeRequestClient('popup', transport, systemScheduler)

    await expect(client.request('settings.get', {}, responseSchema)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      retryable: false
    })
  })

  it('times out and sends a scoped cancellation request', async () => {
    const transport = new FakeTransport(async (raw) => {
      const request = parseRuntimeRequest(raw)
      if (request?.type === 'protocol.cancel') {
        return createRuntimeSuccess(request, { cancelled: true })
      }
      return await new Promise<unknown>(() => undefined)
    })
    const client = new RuntimeRequestClient('popup', transport, systemScheduler)

    await expect(
      client.request('settings.get', {}, responseSchema, { timeoutMs: 5 })
    ).rejects.toBeInstanceOf(RuntimeRequestError)
    expect(
      transport.sent.map(parseRuntimeRequest).some((item) => item?.type === 'protocol.cancel')
    ).toBe(true)
  })

  it('honors an already-aborted signal without using the transport', async () => {
    const controller = new AbortController()
    controller.abort()
    const transport = new FakeTransport(() => Promise.resolve({ ignored: true }))
    const client = new RuntimeRequestClient('options', transport, systemScheduler)

    await expect(
      client.request('settings.get', {}, responseSchema, { signal: controller.signal })
    ).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' })
    expect(transport.sent).toEqual([])
  })
})
