import { MediaAdapterRegistry, type AdapterRegistryOptions } from './registry'
import { SITE_ADAPTER_DEFINITIONS, SITE_ADAPTER_DISABLE_POLICY, SITE_ADAPTER_HOOKS } from './sites'

export * from './generic'
export * from './registry'
export * from './sites'

export function createProductionAdapterRegistry(
  options: Omit<AdapterRegistryOptions, 'definitions'> = {}
): MediaAdapterRegistry {
  const { hooks, ...rest } = options
  return new MediaAdapterRegistry({
    definitions: SITE_ADAPTER_DEFINITIONS,
    disablePolicy: SITE_ADAPTER_DISABLE_POLICY,
    ...rest,
    hooks: Object.freeze({ ...SITE_ADAPTER_HOOKS, ...hooks })
  })
}
