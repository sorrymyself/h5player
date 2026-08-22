import * as z from 'zod/mini'
import { adapterRuntimeDiagnosticsSchema } from '../adapter'
import { mediaPlaybackPolicyStateSchema } from '../../domain/playback'

export const frameMediaLocationSchema = z.enum(['none', 'top-frame', 'child-frame', 'mixed'])

export const frameRuntimeReportPayloadSchema = z.strictObject({
  ready: z.boolean(),
  mediaCount: z.int().check(z.nonnegative()),
  activeMedia: z.boolean(),
  anchoredMediaCount: z.int().check(z.nonnegative()),
  pageUiHidden: z.boolean(),
  temporaryDisabled: z.boolean(),
  updatedAt: z.int().check(z.nonnegative())
})

export const frameRuntimeReportResponseSchema = z.strictObject({
  accepted: z.boolean(),
  stateKnown: z.boolean(),
  pageUiHidden: z.boolean(),
  temporaryDisabled: z.boolean()
})

export const siteContextResponseSchema = z.strictObject({
  tab: z.nullable(
    z.strictObject({
      id: z.int().check(z.nonnegative()),
      origin: z.optional(z.string().check(z.minLength(1), z.maxLength(256))),
      hostname: z.optional(z.string().check(z.minLength(1), z.maxLength(256))),
      protocol: z.optional(z.string().check(z.minLength(1), z.maxLength(32)))
    })
  ),
  permission: z.enum(['granted', 'missing', 'restricted', 'unknown']),
  enabled: z.boolean(),
  temporaryDisabled: z.boolean(),
  pageUiHidden: z.optional(z.boolean()),
  hiddenMediaCount: z.optional(z.int().check(z.nonnegative())),
  mediaCount: z.int().check(z.nonnegative()),
  topFrameMediaCount: z.optional(z.int().check(z.nonnegative())),
  childFrameMediaCount: z.optional(z.int().check(z.nonnegative())),
  childFrameCount: z.optional(z.int().check(z.nonnegative())),
  anchoredMediaCount: z.optional(z.int().check(z.nonnegative())),
  mediaLocation: z.optional(frameMediaLocationSchema),
  activeMedia: z.boolean(),
  adapters: z.optional(adapterRuntimeDiagnosticsSchema),
  activePlaybackPolicy: z.optional(z.nullable(mediaPlaybackPolicyStateSchema)),
  runtime: z.enum(['ready', 'disabled', 'unavailable', 'unknown']),
  reason: z.enum([
    'none',
    'no-active-tab',
    'restricted-page',
    'permission-required',
    'extension-disabled',
    'site-disabled',
    'temporarily-disabled',
    'no-media',
    'iframe-media',
    'initialization-failed'
  ])
})

export const siteReconcilePayloadSchema = z.strictObject({
  bootstrapCurrentTab: z.boolean()
})

export const siteReconcileResponseSchema = z.strictObject({
  registeredOrigins: z.int().check(z.nonnegative()),
  bootstrapped: z.boolean()
})

export const siteTemporaryDisablePayloadSchema = z.strictObject({
  disabled: z.boolean(),
  commandIssuedAt: z.optional(z.int().check(z.nonnegative())),
  commandRevision: z.optional(z.int().check(z.nonnegative()))
})

export const siteTemporaryDisableResponseSchema = z.strictObject({
  disabled: z.boolean()
})

export const sitePageUiVisibilityPayloadSchema = z.strictObject({
  hidden: z.boolean()
})

export const sitePageUiVisibilityResponseSchema = z.strictObject({
  hidden: z.boolean(),
  hiddenMediaCount: z.int().check(z.nonnegative())
})

export const siteRuntimeStateResponseSchema = z.strictObject({
  ready: z.boolean(),
  temporaryDisabled: z.boolean(),
  pageUiHidden: z.optional(z.boolean()),
  hiddenMediaCount: z.optional(z.int().check(z.nonnegative())),
  mediaCount: z.int().check(z.nonnegative()),
  activeMedia: z.boolean(),
  adapters: z.optional(adapterRuntimeDiagnosticsSchema),
  activePlaybackPolicy: z.optional(z.nullable(mediaPlaybackPolicyStateSchema))
})

export type SiteContextResponse = z.infer<typeof siteContextResponseSchema>
export type SiteReconcilePayload = z.infer<typeof siteReconcilePayloadSchema>
export type SiteReconcileResponse = z.infer<typeof siteReconcileResponseSchema>
export type SiteTemporaryDisablePayload = z.infer<typeof siteTemporaryDisablePayloadSchema>
export type SiteTemporaryDisableResponse = z.infer<typeof siteTemporaryDisableResponseSchema>
export type SitePageUiVisibilityPayload = z.infer<typeof sitePageUiVisibilityPayloadSchema>
export type SitePageUiVisibilityResponse = z.infer<typeof sitePageUiVisibilityResponseSchema>
export type SiteRuntimeStateResponse = z.infer<typeof siteRuntimeStateResponseSchema>
export type FrameRuntimeReportPayload = z.infer<typeof frameRuntimeReportPayloadSchema>
export type FrameRuntimeReportResponse = z.infer<typeof frameRuntimeReportResponseSchema>
