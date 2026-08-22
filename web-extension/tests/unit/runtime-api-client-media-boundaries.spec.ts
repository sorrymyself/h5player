import { describe, expect, it } from 'vitest'
import { commandSuccess } from '../../src/domain/command'
import { createMediaCapabilities, type MediaSnapshot } from '../../src/domain/media'
import { RuntimeApiClient } from '../../src/infrastructure/messaging/runtime-api-client'
import { RuntimeRequestClient } from '../../src/infrastructure/messaging/request-client'
import { systemScheduler } from '../../src/infrastructure/time/system-time'
import { createRuntimeSuccess, parseRuntimeRequest } from '../../src/shared/protocol'
import { FakeTransport } from '../test-support/fakes'

function snapshot(): MediaSnapshot {
  return {
    id: 'media-1',
    frameId: 0,
    kind: 'video',
    state: 'paused',
    metrics: {
      width: 640,
      height: 360,
      duration: 60,
      currentTime: 5,
      volume: 0.5,
      playbackRate: 1,
      muted: false,
      visible: true
    },
    capabilities: createMediaCapabilities({
      playback: true,
      seek: true,
      playbackRate: true,
      volume: true,
      mute: true
    }),
    adapterId: 'generic',
    updatedAt: 10
  }
}

function state() {
  const media = snapshot()
  return {
    frameId: 0,
    revision: 3,
    activeMediaId: media.id,
    media: [media],
    observedAt: 11
  }
}

describe('RuntimeApiClient media boundaries', () => {
  it('maps media state and command methods to typed runtime requests', async () => {
    const mediaState = state()
    const command = { type: 'media.seek', mediaId: 'media-1', deltaSeconds: 5 } as const
    const transport = new FakeTransport((raw) => {
      const request = parseRuntimeRequest(raw)
      if (!request) return Promise.reject(new Error('invalid request'))
      if (request.type === 'media.get-state') {
        return Promise.resolve(createRuntimeSuccess(request, mediaState))
      }
      if (request.type === 'media.execute') {
        return Promise.resolve(
          createRuntimeSuccess(request, {
            result: commandSuccess(command, snapshot(), true),
            state: mediaState
          })
        )
      }
      return Promise.reject(new Error('unexpected request'))
    })
    const api = new RuntimeApiClient(new RuntimeRequestClient('popup', transport, systemScheduler))
    const controller = new AbortController()

    await expect(api.getMediaState()).resolves.toEqual(mediaState)
    await expect(
      api.executeMediaCommand(command, { signal: controller.signal })
    ).resolves.toMatchObject({
      result: { ok: true, value: { commandType: 'media.seek', changed: true } },
      state: { revision: 3 }
    })
    await expect(
      api.executeMediaCommand(
        { type: 'media.adjust-rate', mediaId: 'media-1', delta: 0.1 },
        { playbackRateScope: 'media' }
      )
    ).resolves.toMatchObject({ result: { ok: true } })

    const requests = transport.sent.map(parseRuntimeRequest)
    expect(requests.map((request) => request?.type)).toEqual([
      'media.get-state',
      'media.execute',
      'media.execute'
    ])
    expect(requests[0]?.payload).toEqual({})
    expect(requests[1]?.payload).toEqual({ command })
    expect(requests[2]?.payload).toEqual({
      command: { type: 'media.adjust-rate', mediaId: 'media-1', delta: 0.1 },
      playbackRateScope: 'media'
    })
  })

  it('uses the media response schemas and propagates cancellation options', async () => {
    let responseCount = 0
    const transport = new FakeTransport((raw) => {
      const request = parseRuntimeRequest(raw)
      if (!request) return Promise.reject(new Error('invalid request'))
      responseCount += 1
      return Promise.resolve(createRuntimeSuccess(request, { invalid: true }))
    })
    const api = new RuntimeApiClient(
      new RuntimeRequestClient('content', transport, systemScheduler)
    )

    await expect(api.getMediaState()).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD',
      retryable: false
    })
    await expect(
      api.executeMediaCommand({ type: 'media.play', mediaId: 'media-1' })
    ).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD',
      retryable: false
    })

    const controller = new AbortController()
    controller.abort()
    await expect(
      api.executeMediaCommand(
        { type: 'media.pause', mediaId: 'media-1' },
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({
      code: 'REQUEST_CANCELLED',
      retryable: false
    })
    expect(responseCount).toBe(2)
  })
})
