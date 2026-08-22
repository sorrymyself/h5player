import * as z from 'zod/mini'
import type { ClockPort, TabsPort } from '../ports/browser'
import { mediaCommandSchema } from '../../domain/command'
import { mediaIdSchema, type MediaId } from '../../domain/media'
import { createTabRequest } from '../../shared/tab-protocol'
import { mediaPageStateSchema } from './contracts'

const tabIdSchema = z.int().check(z.nonnegative())
const frameIdSchema = z.int().check(z.nonnegative())
const generationSchema = z.int().check(z.nonnegative())
const timestampSchema = z.number().check(z.nonnegative())

export const pictureInPicturePresencePayloadSchema = z.union([
  z.strictObject({
    state: z.literal('active'),
    mediaId: mediaIdSchema,
    observedAt: timestampSchema
  }),
  z.strictObject({
    state: z.literal('inactive'),
    mediaId: mediaIdSchema,
    observedAt: timestampSchema
  })
])

export const pictureInPictureOwnerLeaseSchema = z.strictObject({
  tabId: tabIdSchema,
  frameId: frameIdSchema,
  mediaId: mediaIdSchema,
  state: z.enum(['active', 'grace']),
  generation: generationSchema,
  observedAt: timestampSchema,
  expiresAt: timestampSchema
})

export const pictureInPictureOwnerSnapshotSchema = z.strictObject({
  owner: z.nullable(pictureInPictureOwnerLeaseSchema)
})

export const pictureInPictureControlStateSchema = z.strictObject({
  owner: z.nullable(pictureInPictureOwnerLeaseSchema),
  state: z.nullable(mediaPageStateSchema)
})

export const pictureInPictureExecutePayloadSchema = z.strictObject({
  command: mediaCommandSchema,
  generation: generationSchema,
  playbackRateScope: z.optional(z.union([z.literal('site'), z.literal('page'), z.literal('media')]))
})

export type PictureInPicturePresencePayload = z.infer<typeof pictureInPicturePresencePayloadSchema>
export type PictureInPictureOwnerLease = z.infer<typeof pictureInPictureOwnerLeaseSchema>
export type PictureInPictureOwnerSnapshot = z.infer<typeof pictureInPictureOwnerSnapshotSchema>
export type PictureInPictureControlState = z.infer<typeof pictureInPictureControlStateSchema>
export type PictureInPictureExecutePayload = z.infer<typeof pictureInPictureExecutePayloadSchema>

export type PictureInPictureOwnerSource = Readonly<{
  tabId: number
  frameId: number
  sessionId: string
}>

type InternalOwnerLease = PictureInPictureOwnerLease &
  Readonly<{
    sessionId: string
  }>

export type PictureInPictureControlServiceOptions = Readonly<{
  activeLeaseMs?: number
  graceLeaseMs?: number
  frameIds?: (tabId: number) => readonly number[]
}>

const DEFAULT_ACTIVE_LEASE_MS = 3_500
const DEFAULT_GRACE_LEASE_MS = 15_000

export class PictureInPictureControlService {
  private owner: InternalOwnerLease | null = null
  private generation = 0
  private readonly activeLeaseMs: number
  private readonly graceLeaseMs: number
  private readonly frameIds: (tabId: number) => readonly number[]

  constructor(
    private readonly tabs: TabsPort,
    private readonly clock: ClockPort,
    options: PictureInPictureControlServiceOptions = {}
  ) {
    this.activeLeaseMs = Math.max(500, options.activeLeaseMs ?? DEFAULT_ACTIVE_LEASE_MS)
    this.graceLeaseMs = Math.max(0, options.graceLeaseMs ?? DEFAULT_GRACE_LEASE_MS)
    this.frameIds = options.frameIds ?? (() => [0])
  }

  report(
    payload: PictureInPicturePresencePayload,
    source: PictureInPictureOwnerSource
  ): PictureInPictureOwnerSnapshot {
    const parsed = pictureInPicturePresencePayloadSchema.parse(payload)
    const now = Math.max(0, this.clock.now())
    const observedAt = Math.min(Math.max(0, parsed.observedAt), now)
    this.prune(now)

    if (parsed.state === 'active') {
      const current = this.owner
      const sameOwner =
        current !== null &&
        current.tabId === source.tabId &&
        current.frameId === source.frameId &&
        current.sessionId === source.sessionId &&
        current.mediaId === parsed.mediaId
      if (!sameOwner) this.generation += 1
      this.owner = {
        tabId: source.tabId,
        frameId: source.frameId,
        sessionId: source.sessionId,
        mediaId: parsed.mediaId,
        state: 'active',
        generation: sameOwner && current !== null ? current.generation : this.generation,
        observedAt,
        expiresAt: now + this.activeLeaseMs
      }
      void this.broadcast()
      return this.snapshot(now)
    }

    if (this.matches(source, parsed.mediaId)) {
      const current = this.owner
      if (current !== null) {
        this.owner = {
          ...current,
          state: 'grace',
          observedAt,
          expiresAt: now + this.graceLeaseMs
        }
        void this.broadcast()
      }
    }
    return this.snapshot(now)
  }

  snapshot(now = Math.max(0, this.clock.now())): PictureInPictureOwnerSnapshot {
    this.prune(now)
    return pictureInPictureOwnerSnapshotSchema.parse({ owner: this.publicOwner() })
  }

  resolve(generation: number): InternalOwnerLease | null {
    this.prune(Math.max(0, this.clock.now()))
    return this.owner?.generation === generation ? this.owner : null
  }

  current(): InternalOwnerLease | null {
    this.prune(Math.max(0, this.clock.now()))
    return this.owner
  }

  invalidate(generation: number): void {
    if (this.owner?.generation !== generation) return
    this.owner = null
    this.generation += 1
    void this.broadcast()
  }

  removeTab(tabId: number): void {
    if (this.owner?.tabId !== tabId) return
    this.invalidate(this.owner.generation)
  }

  removeFrame(source: PictureInPictureOwnerSource): void {
    if (!this.matchesSource(source)) return
    this.invalidate(this.owner?.generation ?? -1)
  }

  private matches(source: PictureInPictureOwnerSource, mediaId: MediaId): boolean {
    return this.matchesSource(source) && this.owner?.mediaId === mediaId
  }

  private matchesSource(source: PictureInPictureOwnerSource): boolean {
    return (
      this.owner !== null &&
      this.owner.tabId === source.tabId &&
      this.owner.frameId === source.frameId &&
      this.owner.sessionId === source.sessionId
    )
  }

  private prune(now: number): void {
    if (this.owner === null || now < this.owner.expiresAt) return
    this.owner = null
    this.generation += 1
  }

  private publicOwner(): PictureInPictureOwnerLease | null {
    if (this.owner === null) return null
    return pictureInPictureOwnerLeaseSchema.parse({
      tabId: this.owner.tabId,
      frameId: this.owner.frameId,
      mediaId: this.owner.mediaId,
      state: this.owner.state,
      generation: this.owner.generation,
      observedAt: this.owner.observedAt,
      expiresAt: this.owner.expiresAt
    })
  }

  private async broadcast(): Promise<void> {
    const payload = this.snapshot()
    let candidates: Awaited<ReturnType<TabsPort['list']>>
    try {
      candidates = await this.tabs.list()
    } catch {
      return
    }
    await Promise.all(
      candidates.flatMap((tab) =>
        [...new Set(this.frameIds(tab.id))].map(async (frameId) => {
          try {
            await this.tabs.send(
              tab.id,
              createTabRequest('media.picture-in-picture.owner-changed', payload),
              frameId
            )
          } catch {
            // Tabs/frames without an authorized content runtime are expected.
          }
        })
      )
    )
  }
}
