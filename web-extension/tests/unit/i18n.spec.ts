import { describe, expect, it } from 'vitest'
import { detectLocale, messages, translate } from '../../src/ui/i18n'

describe('UI internationalization', () => {
  it('keeps zh-CN and en-US catalogs structurally complete', () => {
    expect(Object.keys(messages['en-US']).sort()).toEqual(Object.keys(messages['zh-CN']).sort())
  })

  it('formats parameters and uses deterministic locale detection', () => {
    expect(translate('zh-CN', 'options.revision', { value: 7 })).toBe('配置修订 7')
    expect(translate('en-US', 'options.revision', { value: 7 })).toBe('Settings revision 7')
    expect(detectLocale('en-GB')).toBe('en-US')
    expect(detectLocale('zh-Hans')).toBe('zh-CN')
  })
})
