import * as z from 'zod/mini'
import type { ClockPort, TabsPort } from '../ports/browser'
import { createRequestId } from '../../shared/ids'
import { createTabRequest } from '../../shared/tab-protocol'

const mediaKeySchema = z.string().check(z.minLength(8), z.maxLength(128))
const timestampSchema = z.number().check(z.nonnegative())

export const crossTabMediaEventKindSchema = z.enum([
  'playback-started',
  'playback-paused',
  'progress-saved'
])

export const crossTabPublishPayloadSchema = z.strictObject({
  kind: crossTabMediaEventKindSchema,
  mediaKey: mediaKeySchema,
  observedAt: timestampSchema
})

export const crossTabMediaEventSchema = z.strictObject({
  eventId: z.string().check(z.minLength(16), z.maxLength(128)),
  kind: crossTabMediaEventKindSchema,
  mediaKey: mediaKeySchema,
  sourceTabId: z.int().check(z.nonnegative()),
  sourceFrameId: z.int().check(z.nonnegative()),
  observedAt: timestampSchema
})
export const crossTabEventPayloadSchema = z.strictObject({
  event: crossTabMediaEventSchema
})

export const crossTabPublishResponseSchema = z.strictObject({
  event: crossTabMediaEventSchema,
  attemptedTabs: z.int().check(z.nonnegative()),
  deliveredTabs: z.int().check(z.nonnegative())
})

export type CrossTabPublishPayload = z.infer<typeof crossTabPublishPayloadSchema>
export type CrossTabMediaEvent = z.infer<typeof crossTabMediaEventSchema>
export type CrossTabPublishResponse = z.infer<typeof crossTabPublishResponseSchema>

export class CrossTabMediaEventService {
  constructor(
    private readonly tabs: TabsPort,
    private readonly clock: ClockPort
  ) {}

  async publish(
    payload: CrossTabPublishPayload,
    source: Readonly<{ tabId: number; frameId: number }>
  ): Promise<CrossTabPublishResponse> {
    const parsed = crossTabPublishPayloadSchema.parse(payload)
    const event = crossTabMediaEventSchema.parse({
      eventId: createRequestId(),
      kind: parsed.kind,
      mediaKey: parsed.mediaKey,
      sourceTabId: source.tabId,
      sourceFrameId: source.frameId,
      observedAt: Math.min(Math.max(0, parsed.observedAt), Math.max(0, this.clock.now()))
    })
    const candidates = (await this.tabs.list()).filter((tab) => tab.id !== source.tabId)
    let deliveredTabs = 0
    await Promise.all(
      candidates.map(async (tab) => {
        try {
          await this.tabs.send(
            tab.id,
            createTabRequest('media.cross-tab.event', crossTabEventPayloadSchema.parse({ event })),
            0
          )
          deliveredTabs += 1
        } catch {
          // Tabs without an authorized content runtime are expected and ignored.
        }
      })
    )
    return crossTabPublishResponseSchema.parse({
      event,
      attemptedTabs: candidates.length,
      deliveredTabs
    })
  }
}
