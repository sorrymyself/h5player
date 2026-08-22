import * as z from 'zod/mini'

export const siteAdapterPageActionSchema = z.enum(['next', 'autoplay'])
export const siteAdapterPageActionResponseSchema = z.strictObject({
  declared: z.boolean(),
  handled: z.boolean(),
  adapterId: z.nullable(z.string().check(z.minLength(1), z.maxLength(128)))
})

export const adapterRuntimeDiagnosticSchema = z.strictObject({
  id: z.string().check(z.minLength(1), z.maxLength(128)),
  version: z.string().check(z.minLength(1), z.maxLength(64)),
  tier: z.union([z.literal(1), z.literal(2)]),
  supportLevel: z.enum(['preview', 'best-effort']),
  status: z.enum(['available', 'selected', 'degraded', 'disabled']),
  selected: z.boolean(),
  selectedMediaCount: z.int().check(z.nonnegative(), z.lte(128)),
  failureCount: z.int().check(z.nonnegative(), z.lte(1_000_000)),
  lastFailureStage: z.nullable(z.enum(['attach', 'detach', 'selector', 'action'])),
  disabledFeatures: z
    .array(z.enum(['playback', 'fullscreen-native', 'fullscreen-web', 'next', 'autoplay']))
    .check(z.maxLength(8))
})

export const adapterRuntimeDiagnosticsSchema = z
  .array(adapterRuntimeDiagnosticSchema)
  .check(z.maxLength(32))

export type AdapterRuntimeDiagnostic = z.infer<typeof adapterRuntimeDiagnosticSchema>
export type SiteAdapterPageAction = z.infer<typeof siteAdapterPageActionSchema>
export type SiteAdapterPageActionResponse = z.infer<typeof siteAdapterPageActionResponseSchema>
