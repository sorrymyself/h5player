import { inject, type ComputedRef, type InjectionKey, type Ref } from 'vue'
import type { OptionsApplication, OptionsSnapshot } from '../../application/ui'
import type { Locale, MessageKey } from '../i18n'

export type OptionsUiContext = Readonly<{
  application: OptionsApplication
  snapshot: Ref<OptionsSnapshot | null>
  busy: Ref<boolean>
  error: Ref<string | null>
  locale: ComputedRef<Locale>
  t(key: MessageKey, params?: Readonly<Record<string, string | number>>): string
  reload(): Promise<void>
  run(operation: () => Promise<OptionsSnapshot>): Promise<boolean>
}>

export const optionsUiContextKey: InjectionKey<OptionsUiContext> = Symbol('options-ui-context')

export function useOptionsContext(): OptionsUiContext {
  const context = inject(optionsUiContextKey)
  if (!context) throw new Error('Options UI context is unavailable')
  return context
}
