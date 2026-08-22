export type LiveSiteProfile = 'video' | 'audio' | 'discovery'
export type LiveSiteSource = 'adapter' | 'readme' | 'mainstream'

export type LiveSiteDefinition = Readonly<{
  id: string
  tier: 1 | 2 | 3
  source: LiveSiteSource
  profile: LiveSiteProfile
  label: string
  urlEnvironmentKey: string
  urls: readonly string[]
  playSelectors: readonly string[]
  allowedHostnames?: readonly string[]
  transition?: Readonly<{
    selectors: readonly string[]
    targetUrlPattern: string
  }>
}>

const site = (
  definition: Omit<LiveSiteDefinition, 'urlEnvironmentKey'> & { urlEnvironmentKey?: string }
): LiveSiteDefinition => ({
  ...definition,
  urlEnvironmentKey:
    definition.urlEnvironmentKey ??
    `H5PLAYER_LIVE_${definition.id.replaceAll('-', '_').toUpperCase()}_URL`
})

/**
 * The catalog deliberately includes historical README entries even when a site is
 * now login-gated, redirected, App-only, or no longer exposes a stable public player.
 * Those observations are useful compatibility evidence and must not be silently
 * dropped from the matrix.
 */
export const LIVE_SITE_DEFINITIONS = Object.freeze([
  site({
    id: 'youtube',
    tier: 1,
    source: 'adapter',
    profile: 'video',
    label: 'YouTube',
    urls: [
      'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
      'https://www.youtube.com/watch?v=jNQXAC9IVRw'
    ],
    playSelectors: ['.ytp-play-button']
  }),
  site({
    id: 'bilibili',
    tier: 1,
    source: 'adapter',
    profile: 'video',
    label: 'Bilibili',
    urls: [
      'https://www.bilibili.com/video/BV1XT4y1p7nM/',
      'https://player.bilibili.com/player.html?bvid=BV1XT4y1p7nM&autoplay=0'
    ],
    playSelectors: ['.bpx-player-ctrl-play', '.bilibili-player-video-btn-start']
  }),
  site({
    id: 'tencent-video',
    tier: 1,
    source: 'adapter',
    profile: 'video',
    label: 'Tencent Video',
    urls: [
      'https://v.qq.com/x/cover/zgexd0mcj7at1fc/g00248hvnae.html',
      'https://v.qq.com/x/cover/mzc002004l7dytn/a41015zf3eq.html',
      'https://v.qq.com/txp/iframe/player.html?vid=a41015zf3eq'
    ],
    playSelectors: ['.txp-shadow-mod', '.txp_btn_play'],
    transition: {
      selectors: ['[dt-params*="vid=m00246emesy"]'],
      targetUrlPattern: 'm00246emesy\\.html'
    }
  }),
  site({
    id: 'iqiyi',
    tier: 1,
    source: 'adapter',
    profile: 'video',
    label: 'iQIYI',
    urls: ['https://www.iqiyi.com/v_q0ni081x08.html'],
    playSelectors: ['.iqp-btn-play', '.iqp-player-play']
  }),
  site({
    id: 'youku',
    tier: 1,
    source: 'adapter',
    profile: 'video',
    label: 'Youku',
    urls: [
      'https://v.youku.com/v_show/id_XMTQ3NTE5MzYzNg==.html',
      'https://player.youku.com/embed/XMTQ3NTE5MzYzNg=='
    ],
    playSelectors: ['.control-play-icon', '.kui-control-play-icon', '.x-player-play-icon']
  }),
  site({
    id: 'netflix',
    tier: 2,
    source: 'mainstream',
    profile: 'video',
    label: 'Netflix',
    urls: ['https://www.netflix.com/title/80192098'],
    playSelectors: [
      'button[data-uia="control-play-pause-play"]',
      '.button-nfplayerPlay',
      '[aria-label*="Play"]'
    ]
  }),
  site({
    id: 'ixigua',
    tier: 2,
    source: 'adapter',
    profile: 'video',
    label: 'Ixigua',
    urls: ['https://www.ixigua.com/', 'https://m.ixigua.com/video/6730010081607287299'],
    playSelectors: ['xg-start', '.xgplayer-start', '[aria-label*="Play"]', '[aria-label*="播放"]']
  }),
  site({
    id: 'acfun',
    tier: 2,
    source: 'adapter',
    profile: 'video',
    label: 'AcFun',
    urls: ['https://www.acfun.cn/v/ac3040055'],
    playSelectors: ['.btn-play', '.play-btn', '[data-role="play"]']
  }),
  site({
    id: 'sohu-video',
    tier: 2,
    source: 'adapter',
    profile: 'video',
    label: 'Sohu Video',
    urls: ['https://tv.sohu.com/v/dXMvMzQ2NjQwNzgxLzE3MzYyMDgwMi5zaHRtbA==.html'],
    playSelectors: ['.x-player-play', '.player-control-play', '[data-role="play"]']
  }),
  site({
    id: 'ted',
    tier: 2,
    source: 'adapter',
    profile: 'video',
    label: 'TED',
    urls: ['https://www.ted.com/talks/larry_smith_why_you_will_fail_to_have_a_great_career'],
    playSelectors: ['button[data-testid="play-button"]', '.js-play', '[aria-label*="Play"]']
  }),

  // README video sites and live platforms.
  site({
    id: 'douyin',
    tier: 1,
    source: 'readme',
    profile: 'video',
    label: 'Douyin',
    urls: ['https://www.douyin.com/video/7232244817046687034', 'https://www.douyin.com/'],
    playSelectors: ['video', '[data-e2e="feed-video"]', '[aria-label*="播放"]']
  }),
  site({
    id: 'zhihu-video',
    tier: 2,
    source: 'readme',
    profile: 'video',
    label: 'Zhihu Video',
    urls: ['https://www.zhihu.com/zvideo/1243300276481773568'],
    playSelectors: ['video', '.VideoAnswerPlayer', '[aria-label*="播放"]']
  }),
  site({
    id: 'instagram',
    tier: 2,
    source: 'readme',
    profile: 'discovery',
    label: 'Instagram',
    urls: ['https://www.instagram.com/'],
    playSelectors: ['video', '[aria-label*="Play"]']
  }),
  site({
    id: 'twitter',
    tier: 2,
    source: 'readme',
    profile: 'discovery',
    label: 'Twitter / X',
    urls: ['https://x.com/explore', 'https://twitter.com/explore'],
    playSelectors: ['video', '[aria-label*="Play"]']
  }),
  site({
    id: 'telegram-web',
    tier: 3,
    source: 'readme',
    profile: 'discovery',
    label: 'Telegram Web',
    urls: ['https://web.telegram.org/'],
    playSelectors: ['video', 'audio']
  }),
  site({
    id: 'pornhub',
    tier: 2,
    source: 'readme',
    profile: 'video',
    label: 'Pornhub',
    urls: ['https://www.pornhub.com/'],
    playSelectors: ['video', '.player .play', '[aria-label*="Play"]']
  }),
  site({
    id: 'douyu',
    tier: 1,
    source: 'readme',
    profile: 'video',
    label: 'Douyu',
    urls: ['https://www.douyu.com/9999'],
    playSelectors: ['video', '.play-btn', '[aria-label*="播放"]']
  }),
  site({
    id: 'huya',
    tier: 1,
    source: 'readme',
    profile: 'video',
    label: 'Huya',
    urls: ['https://www.huya.com/660000'],
    playSelectors: ['video', '.player-video-button', '[aria-label*="播放"]']
  }),
  site({
    id: 'weibo-tv',
    tier: 2,
    source: 'readme',
    profile: 'discovery',
    label: 'Weibo TV',
    urls: ['https://weibo.com/tv'],
    playSelectors: ['video', '[aria-label*="播放"]']
  }),
  site({
    id: 'kueran',
    tier: 3,
    source: 'readme',
    profile: 'discovery',
    label: 'Kueran Video',
    urls: ['https://krcom.cn/'],
    playSelectors: ['video']
  }),
  site({
    id: 'netease-open-class',
    tier: 2,
    source: 'readme',
    profile: 'discovery',
    label: 'NetEase Open Class',
    urls: ['https://open.163.com/ted'],
    playSelectors: ['video', '.u-cti-play', '[aria-label*="播放"]']
  }),
  site({
    id: 'qq-music-mv',
    tier: 2,
    source: 'readme',
    profile: 'video',
    label: 'QQ Music MV',
    urls: ['https://y.qq.com/portal/mv_lib.html'],
    playSelectors: ['video', '.mv_play', '[aria-label*="播放"]']
  }),
  site({
    id: 'phoenix-video',
    tier: 3,
    source: 'readme',
    profile: 'discovery',
    label: 'Phoenix Video',
    urls: ['https://v.ifeng.com/'],
    playSelectors: ['video', '[aria-label*="播放"]']
  }),
  site({
    id: 'fun-tv',
    tier: 3,
    source: 'readme',
    profile: 'discovery',
    label: 'Fun TV',
    urls: ['https://www.fun.tv/'],
    playSelectors: ['video', '[aria-label*="播放"]']
  }),
  site({
    id: 'pptv',
    tier: 3,
    source: 'readme',
    profile: 'discovery',
    label: 'PPTV',
    urls: ['https://www.pptv.com/'],
    playSelectors: ['video', '[aria-label*="播放"]']
  }),
  site({
    id: 'qilu-video',
    tier: 3,
    source: 'readme',
    profile: 'video',
    label: 'Qilu Net',
    urls: ['https://v.iqilu.com/'],
    playSelectors: ['video', '[aria-label*="播放"]']
  }),
  site({
    id: 'sunshine-satellite-tv',
    tier: 3,
    source: 'readme',
    profile: 'discovery',
    label: 'Sunshine Satellite TV',
    urls: ['https://www.isuntv.com/'],
    playSelectors: ['video', '[aria-label*="播放"]']
  }),
  site({
    id: 'cctv',
    tier: 2,
    source: 'readme',
    profile: 'discovery',
    label: 'CCTV',
    urls: ['https://www.cntv.cn/', 'https://tv.cctv.com/'],
    allowedHostnames: ['cntv.cn', 'cctv.com', 'm.cctv.com'],
    playSelectors: ['video', '[aria-label*="播放"]']
  }),
  site({
    id: 'mango-tv',
    tier: 2,
    source: 'readme',
    profile: 'discovery',
    label: 'Mango TV',
    urls: ['https://www.mgtv.com/'],
    playSelectors: ['video', '[aria-label*="播放"]']
  }),
  site({
    id: 'zhibo-tv',
    tier: 3,
    source: 'readme',
    profile: 'discovery',
    label: 'Zhibo.tv',
    urls: ['https://v.zhibo.tv/'],
    playSelectors: ['video']
  }),
  site({
    id: 'china-sports',
    tier: 3,
    source: 'readme',
    profile: 'discovery',
    label: 'China Sports',
    urls: ['https://video.zhibo.tv/'],
    playSelectors: ['video']
  }),
  site({
    id: 'kuaishou',
    tier: 1,
    source: 'readme',
    profile: 'video',
    label: 'Kuaishou',
    urls: ['https://www.kuaishou.com/'],
    playSelectors: ['video', '[aria-label*="播放"]']
  }),
  site({
    id: 'miomio',
    tier: 3,
    source: 'readme',
    profile: 'discovery',
    label: 'MioMio',
    urls: ['https://www.miomio.tv/'],
    playSelectors: ['video']
  }),
  site({
    id: '56-com',
    tier: 3,
    source: 'readme',
    profile: 'discovery',
    label: '56.com',
    urls: ['https://www.56.com/'],
    playSelectors: ['video']
  }),
  site({
    id: 'vk',
    tier: 2,
    source: 'readme',
    profile: 'discovery',
    label: 'VK',
    urls: ['https://vk.com/'],
    playSelectors: ['video', '[aria-label*="Play"]']
  }),
  site({
    id: 'vine',
    tier: 3,
    source: 'readme',
    profile: 'discovery',
    label: 'Vine',
    urls: ['https://vine.co/'],
    playSelectors: ['video']
  }),
  site({
    id: 'magisto',
    tier: 3,
    source: 'readme',
    profile: 'discovery',
    label: 'Magisto',
    urls: ['https://www.magisto.com/'],
    playSelectors: ['video']
  }),
  site({
    id: 'cbs',
    tier: 3,
    source: 'readme',
    profile: 'discovery',
    label: 'CBS',
    urls: ['https://www.cbs.com/'],
    playSelectors: ['video', '[aria-label*="Play"]']
  }),
  site({
    id: 'fc2-video',
    tier: 3,
    source: 'readme',
    profile: 'discovery',
    label: 'FC2 Video',
    urls: ['https://video.fc2.com/'],
    playSelectors: ['video', '[aria-label*="Play"]']
  }),

  // README audio sites.
  site({
    id: 'ximalaya',
    tier: 2,
    source: 'readme',
    profile: 'audio',
    label: 'Ximalaya',
    urls: ['https://www.ximalaya.com/sound/607324626'],
    playSelectors: ['.play-btn', 'audio', 'button[aria-label*="播放"]']
  }),
  site({
    id: 'lrts',
    tier: 3,
    source: 'readme',
    profile: 'audio',
    label: 'Lazy to Listen',
    urls: ['https://www.lrts.me/'],
    playSelectors: ['audio', 'button[aria-label*="播放"]', '[class*="play" i]']
  }),
  site({
    id: 'qingting-fm',
    tier: 3,
    source: 'readme',
    profile: 'audio',
    label: 'Qingting FM',
    urls: ['https://www.qtfm.cn/channels/297367/'],
    playSelectors: ['button.playBtn', 'audio', 'button[aria-label*="播放"]']
  }),
  site({
    id: 'kugou-audiobook',
    tier: 2,
    source: 'readme',
    profile: 'audio',
    label: 'Kugou Audiobook',
    urls: ['https://www.kugou.com/ts/'],
    playSelectors: ['audio', 'button[aria-label*="播放"]', '[class*="play" i]']
  }),
  site({
    id: 'baidu-netdisk-audio',
    tier: 2,
    source: 'readme',
    profile: 'audio',
    label: 'Baidu Netdisk Audio',
    urls: ['https://pan.baidu.com/'],
    playSelectors: ['audio', 'button[aria-label*="播放"]', '[class*="play" i]']
  }),
  site({
    id: 'aliyun-drive-audio',
    tier: 2,
    source: 'readme',
    profile: 'audio',
    label: 'AliYun Drive Audio',
    urls: ['https://www.aliyundrive.com/'],
    playSelectors: ['audio', 'button[aria-label*="播放"]', '[class*="play" i]']
  }),

  // Mainstream sites not listed in the legacy README.
  site({
    id: 'vimeo',
    tier: 1,
    source: 'mainstream',
    profile: 'video',
    label: 'Vimeo',
    // Prefer the stable player surface. The public wrapper for this sample can
    // legitimately show a temporary “processing” state and remove its media
    // element even while the direct player remains playable.
    urls: ['https://player.vimeo.com/video/76979871', 'https://vimeo.com/76979871'],
    playSelectors: ['button[aria-label*="Play"]', '.vp-controls .play', 'video']
  }),
  site({
    id: 'dailymotion',
    tier: 1,
    source: 'mainstream',
    profile: 'video',
    label: 'Dailymotion',
    urls: ['https://www.dailymotion.com/video/x84sh87'],
    playSelectors: ['button[aria-label*="Play"]', '.dmp_PlayerControls_PlayPause', 'video']
  }),
  site({
    id: 'twitch',
    tier: 1,
    source: 'mainstream',
    profile: 'video',
    label: 'Twitch',
    urls: ['https://www.twitch.tv/monstercat'],
    playSelectors: ['button[data-a-target="player-play-pause-button"]', 'video']
  }),
  site({
    id: 'tiktok',
    tier: 1,
    source: 'mainstream',
    profile: 'video',
    label: 'TikTok',
    urls: ['https://www.tiktok.com/@scout2015/video/6718335390845095173'],
    playSelectors: ['video', '[data-e2e*="video"]', '[aria-label*="Play"]']
  }),
  site({
    id: 'facebook-watch',
    tier: 2,
    source: 'mainstream',
    profile: 'discovery',
    label: 'Facebook Watch',
    urls: ['https://www.facebook.com/watch/'],
    playSelectors: ['video', '[aria-label*="Play"]']
  }),
  site({
    id: 'reddit-video',
    tier: 2,
    source: 'mainstream',
    profile: 'discovery',
    label: 'Reddit Video',
    urls: ['https://www.reddit.com/r/videos/'],
    playSelectors: ['video', '[aria-label*="play" i]']
  }),
  site({
    id: 'niconico',
    tier: 2,
    source: 'mainstream',
    profile: 'video',
    label: 'Niconico',
    urls: ['https://www.nicovideo.jp/watch/sm9'],
    playSelectors: ['video', 'button[aria-label*="再生"]', '[aria-label*="Play"]']
  }),
  site({
    id: 'bilibili-live',
    tier: 2,
    source: 'mainstream',
    profile: 'video',
    label: 'Bilibili Live',
    urls: ['https://live.bilibili.com/6'],
    playSelectors: ['video', '.live-player-mounter', '[aria-label*="播放"]']
  }),
  site({
    id: 'douyin-live',
    tier: 2,
    source: 'mainstream',
    profile: 'discovery',
    label: 'Douyin Live',
    urls: ['https://live.douyin.com/'],
    playSelectors: ['video', '[data-e2e*="live"]', '[aria-label*="播放"]']
  }),
  site({
    id: 'spotify',
    tier: 2,
    source: 'mainstream',
    profile: 'audio',
    label: 'Spotify',
    urls: ['https://open.spotify.com/track/03UrZgTINDqvnUMbbIMhql'],
    playSelectors: ['audio', 'button[aria-label="播放"]', 'button[aria-label="Play"]']
  }),
  site({
    id: 'soundcloud',
    tier: 2,
    source: 'mainstream',
    profile: 'audio',
    label: 'SoundCloud',
    urls: ['https://soundcloud.com/forss/flickermood'],
    playSelectors: ['audio', 'button[aria-label*="Play"]', '[title*="Play"]']
  })
] as const satisfies readonly LiveSiteDefinition[])
