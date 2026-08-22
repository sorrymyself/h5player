import type { Ref } from 'vue'
import { messages, type Locale, type MessageKey } from './messages'

export { messages, type Locale, type MessageKey } from './messages'

export function detectLocale(value: string | undefined): Locale {
  return value?.toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN'
}

export function translate(
  locale: Locale,
  key: MessageKey,
  params: Readonly<Record<string, string | number>> = {}
): string {
  const template = messages[locale][key] ?? messages['en-US'][key] ?? key
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, name: string) => {
    const value = params[name]
    return value === undefined ? `{${name}}` : String(value)
  })
}

export function useTranslator(
  locale: Ref<Locale>
): (key: MessageKey, params?: Readonly<Record<string, string | number>>) => string {
  return (key, params = {}) => translate(locale.value, key, params)
}

export function formatNumber(value: number, locale: Locale, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value)
}

export function formatPercent(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value)
}
