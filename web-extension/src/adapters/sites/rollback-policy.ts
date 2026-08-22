import type { SiteAdapterDisablePolicy } from '../../domain/adapter'

/**
 * Release-time compatibility kill switch. Entries must be reviewed, tested and
 * shipped with the extension; this policy is never populated from remote code.
 */
export const SITE_ADAPTER_DISABLE_POLICY = Object.freeze({
  adapterVersions: Object.freeze({}),
  features: Object.freeze({})
}) satisfies SiteAdapterDisablePolicy
