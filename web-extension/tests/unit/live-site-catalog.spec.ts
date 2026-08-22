import { describe, expect, it } from 'vitest'
import { LIVE_SITE_DEFINITIONS } from '../e2e/live-site-catalog'

describe('live-site catalog', () => {
  it('keeps ids and environment override keys unique', () => {
    const ids = LIVE_SITE_DEFINITIONS.map((site) => site.id)
    const environmentKeys = LIVE_SITE_DEFINITIONS.map((site) => site.urlEnvironmentKey)

    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(environmentKeys).size).toBe(environmentKeys.length)
  })

  it('retains the README inventory and adds mainstream coverage', () => {
    const ids = new Set(LIVE_SITE_DEFINITIONS.map((site) => site.id))
    const readmeSites = [
      'bilibili',
      'tencent-video',
      'douyin',
      'zhihu-video',
      'iqiyi',
      'youku',
      'youtube',
      'ted',
      'instagram',
      'twitter',
      'telegram-web',
      'pornhub',
      'douyu',
      'huya',
      'weibo-tv',
      'kueran',
      'sohu-video',
      'netease-open-class',
      'qq-music-mv',
      'phoenix-video',
      'fun-tv',
      'pptv',
      'qilu-video',
      'sunshine-satellite-tv',
      'cctv',
      'mango-tv',
      'ixigua',
      'zhibo-tv',
      'china-sports',
      'acfun',
      'kuaishou',
      'miomio',
      '56-com',
      'vk',
      'vine',
      'magisto',
      'cbs',
      'fc2-video',
      'ximalaya',
      'lrts',
      'qingting-fm',
      'kugou-audiobook',
      'baidu-netdisk-audio',
      'aliyun-drive-audio'
    ]
    const mainstreamAdditions = [
      'vimeo',
      'dailymotion',
      'twitch',
      'tiktok',
      'facebook-watch',
      'reddit-video',
      'niconico',
      'bilibili-live',
      'douyin-live',
      'spotify',
      'soundcloud'
    ]

    expect(readmeSites.every((id) => ids.has(id))).toBe(true)
    expect(mainstreamAdditions.every((id) => ids.has(id))).toBe(true)
  })

  it('reserves full UX assertions for concrete video/audio pages', () => {
    for (const site of LIVE_SITE_DEFINITIONS) {
      expect(site.urls.length).toBeGreaterThan(0)
      expect(site.playSelectors.length).toBeGreaterThan(0)
      if (site.profile === 'discovery') expect(site.tier).not.toBe(1)
    }
  })

  it('keeps the Tencent segment transition as an explicit compatibility scenario', () => {
    const tencent = LIVE_SITE_DEFINITIONS.find((site) => site.id === 'tencent-video')

    expect(tencent?.transition).toEqual({
      selectors: ['[dt-params*="vid=m00246emesy"]'],
      targetUrlPattern: 'm00246emesy\\.html'
    })
  })
})
