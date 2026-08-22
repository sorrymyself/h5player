import { describe, expect, it } from 'vitest'
import {
  classifyExternalBlock,
  classifyPageAccessSignals,
  finiteNumberOrNull,
  groupVisualSlotCandidates,
  rateMatches,
  visualUiCoverageRatios,
  type LiveRect
} from '../e2e/live-site-assertions'

function rect(x: number, y: number, width: number, height: number): LiveRect {
  return { x, y, width, height, right: x + width, bottom: y + height }
}

describe('live-site assertions', () => {
  it('classifies navigation away from the target site without treating subdomains as external', () => {
    const allowed = ['www.ted.com', 'ted.com']

    expect(classifyExternalBlock(null, 'https://ted.com/talks/example', allowed)).toBeNull()
    expect(classifyExternalBlock(null, 'https://www.ted.com/talks/example', allowed)).toBeNull()
    expect(
      classifyExternalBlock(null, 'https://play.google.com/store/apps/details?id=ted', allowed)
    ).toBe('external-navigation')
    expect(classifyExternalBlock(403, 'https://www.ted.com/challenge', allowed)).toBe('http-403')
    expect(classifyExternalBlock(410, 'https://www.ted.com/removed', allowed)).toBe('http-410')
    expect(classifyExternalBlock(503, 'https://www.ted.com/talks/example', allowed)).toBe(
      'http-503'
    )
    expect(classifyExternalBlock(null, 'https://www.ted.com/challenge', allowed)).toBe(
      'anti-bot-challenge'
    )
    expect(classifyExternalBlock(null, 'https://x.com/i/flow/login', ['x.com'])).toBe(
      'login-required'
    )
  })

  it('rejects missing and non-finite rates instead of treating them as a pass', () => {
    expect(finiteNumberOrNull(Number.NaN)).toBeNull()
    expect(finiteNumberOrNull(Number.POSITIVE_INFINITY)).toBeNull()
    expect(rateMatches(Number.NaN, 1.5)).toBe(false)
    expect(rateMatches(null, 1.5)).toBe(false)
    expect(rateMatches(1.5, 1.5)).toBe(true)
  })

  it('classifies explicit access gates without treating a generic login link as a login wall', () => {
    expect(classifyPageAccessSignals('Video', 'Log in  Sign up  Trending videos')).toEqual([])
    expect(classifyPageAccessSignals('Blocked', 'Verify you are human to continue')).toEqual([
      'anti-bot'
    ])
    expect(classifyPageAccessSignals('Blocked', '请在下图依次点击指定图片')).toEqual(['anti-bot'])
    expect(classifyPageAccessSignals('Mobile', '打开 App 看完整内容')).toEqual(['app-only'])
    expect(classifyPageAccessSignals('Members', 'Sign in to watch this video')).toEqual([
      'login-required'
    ])
    expect(classifyPageAccessSignals('Instagram', '登录 Instagram')).toEqual(['login-required'])
    expect(classifyPageAccessSignals('音乐', '登录后即可查看歌词并收听完整曲目')).toEqual([
      'login-required'
    ])
    expect(
      classifyPageAccessSignals('Unavailable', 'This video is not available in your region')
    ).toEqual(['geo-restricted'])
  })

  it('groups fully overlapped media while keeping separate and PiP videos independent', () => {
    const groups = groupVisualSlotCandidates([
      { mediaId: 'preload', rect: rect(48, 76, 962, 541) },
      { mediaId: 'content', rect: rect(48, 76, 962, 541) },
      { mediaId: 'secondary', rect: rect(48, 650, 640, 360) },
      { mediaId: 'pip', rect: rect(700, 400, 240, 135) }
    ])

    expect(groups.map((group) => group.map((item) => item.mediaId))).toEqual([
      ['preload', 'content'],
      ['secondary'],
      ['pip']
    ])
  })

  it('measures visible controls from trigger, panel and feedback geometry instead of layout tools bounds', () => {
    const media = rect(0, 0, 1000, 500)
    const trigger = rect(940, 8, 52, 32)
    const panelOutside = rect(1000, 8, 220, 260)
    const feedback = rect(940, 48, 52, 24)
    const coverage = visualUiCoverageRatios(media, media, [trigger, panelOutside, feedback])
    expect(coverage.mediaCoverageRatio).toBeCloseTo((52 * 32 + 52 * 24) / (1000 * 500), 6)
    expect(coverage.visibleMediaCoverageRatio).toBeCloseTo(coverage.mediaCoverageRatio, 6)
  })
})
