import { describe, expect, it } from 'vitest'
import { CrossTabMediaEventService, crossTabEventPayloadSchema } from '../../src/application/media'
import { parseTabRequest } from '../../src/shared/tab-protocol'
import { FakeClock, FakeTabsPort } from '../test-support/fakes'

describe('cross-tab media event service', () => {
  it('broadcasts a bounded advisory event to every other tab', async () => {
    const tabs = new FakeTabsPort()
    tabs.tabs = [{ id: 1 }, { id: 2 }, { id: 3 }]
    const clock = new FakeClock(1_000)
    const service = new CrossTabMediaEventService(tabs, clock)

    const result = await service.publish(
      { kind: 'playback-started', mediaKey: 'source:fnv1a64:01234567', observedAt: 900 },
      { tabId: 1, frameId: 7 }
    )

    expect(result).toMatchObject({ attemptedTabs: 2, deliveredTabs: 2 })
    expect(result.event).toMatchObject({
      kind: 'playback-started',
      mediaKey: 'source:fnv1a64:01234567',
      sourceTabId: 1,
      sourceFrameId: 7,
      observedAt: 900
    })
    expect(tabs.sent.map(({ tabId, frameId }) => ({ tabId, frameId }))).toEqual([
      { tabId: 2, frameId: 0 },
      { tabId: 3, frameId: 0 }
    ])
    for (const sent of tabs.sent) {
      const request = parseTabRequest(sent.message)
      expect(request?.type).toBe('media.cross-tab.event')
      expect(crossTabEventPayloadSchema.parse(request?.payload).event).toEqual(result.event)
    }
  })

  it('isolates delivery failures and clamps future timestamps to the background clock', async () => {
    const tabs = new FakeTabsPort()
    tabs.tabs = [{ id: 1 }, { id: 2 }, { id: 3 }]
    tabs.handler = (_message, tabId) =>
      tabId === 2 ? Promise.reject(new Error('no content runtime')) : Promise.resolve(null)
    const service = new CrossTabMediaEventService(tabs, new FakeClock(250))

    const result = await service.publish(
      { kind: 'progress-saved', mediaKey: 'source:fnv1a64:89abcdef', observedAt: 9_999 },
      { tabId: 1, frameId: 0 }
    )

    expect(result).toMatchObject({
      attemptedTabs: 2,
      deliveredTabs: 1,
      event: { observedAt: 250 }
    })
  })

  it('returns an empty delivery result when no other tabs exist', async () => {
    const tabs = new FakeTabsPort()
    tabs.tabs = [{ id: 4 }]
    const service = new CrossTabMediaEventService(tabs, new FakeClock(-100))

    const result = await service.publish(
      { kind: 'playback-paused', mediaKey: 'source:fnv1a64:fedcba98', observedAt: 0 },
      { tabId: 4, frameId: 0 }
    )

    expect(result).toMatchObject({
      attemptedTabs: 0,
      deliveredTabs: 0,
      event: { observedAt: 0 }
    })
    expect(tabs.sent).toEqual([])
  })
})
