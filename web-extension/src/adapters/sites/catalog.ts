import type { SiteAdapterDefinition } from '../../domain/adapter'

export const SITE_ADAPTER_DEFINITIONS = Object.freeze([
  {
    id: 'youtube',
    version: '1.2.0',
    priority: 100,
    owner: 'Web Extension Compatibility',
    tier: 1,
    supportLevel: 'preview',
    fixture: 'youtube.html',
    lastVerified: '2026-08-18',
    matches: [{ hostname: 'youtube.com' }, { hostname: 'www.youtube.com' }],
    features: ['playback', 'fullscreen-native', 'fullscreen-web', 'next'],
    selectors: {
      play: ['.ytp-play-button'],
      pause: ['.ytp-play-button'],
      fullscreenNative: ['.ytp-fullscreen-button'],
      fullscreenWeb: ['button.ytp-size-button'],
      next: ['.ytp-next-button']
    }
  },
  {
    id: 'bilibili',
    version: '1.3.0',
    priority: 100,
    owner: 'Web Extension Compatibility',
    tier: 1,
    supportLevel: 'preview',
    fixture: 'bilibili.html',
    lastVerified: '2026-08-18',
    matches: [{ hostname: 'bilibili.com', includeSubdomains: true }],
    features: ['playback', 'fullscreen-native', 'fullscreen-web', 'next', 'autoplay'],
    selectors: {
      autoplay: [
        '.bpx-player-ctrl-play',
        '.squirtle-video-start',
        '.bilibili-player-video-btn-start'
      ],
      play: [
        '.bpx-player-ctrl-play',
        '.bilibili-player-video-btn-start',
        '.bilibili-live-player-video-controller-start-btn button'
      ],
      pause: [
        '.bpx-player-ctrl-play',
        '.bilibili-player-video-btn-start',
        '.bilibili-live-player-video-controller-start-btn button'
      ],
      fullscreenNative: [
        '.bpx-player-ctrl-full',
        '.bilibili-player-video-btn-fullscreen',
        '.bilibili-live-player-video-controller-fullscreen-btn button',
        'button[name="fullscreen-button"]'
      ],
      fullscreenWeb: [
        '.bpx-player-ctrl-web-enter',
        '.bpx-player-ctrl-web-leave',
        '.bilibili-live-player-video-controller-web-fullscreen-btn button'
      ],
      next: [
        '.bpx-player-ctrl-next',
        '.squirtle-video-next',
        '.bilibili-player-video-btn-next',
        '.bpx-player-ctrl-btn[aria-label="下一个"]'
      ]
    }
  },
  {
    id: 'tencent-video',
    version: '1.3.0',
    priority: 100,
    owner: 'Web Extension Compatibility',
    tier: 1,
    supportLevel: 'preview',
    fixture: 'tencent-video.html',
    lastVerified: '2026-08-18',
    matches: [
      { hostname: 'v.qq.com' },
      { hostname: 'sports.qq.com' },
      { hostname: 'vm.gtimg.cn', path: '/thumbplayer/txv/wasm/' }
    ],
    features: ['playback', 'playback-rate', 'fullscreen-native', 'fullscreen-web', 'next'],
    selectors: {
      play: ['.container_inner .txp-shadow-mod'],
      pause: ['.container_inner .txp-shadow-mod'],
      fullscreenNative: ['txpdiv[data-report="window-fullscreen"]'],
      fullscreenWeb: ['txpdiv[data-report="browser-fullscreen"]'],
      next: ['txpdiv[data-report="play-next"]']
    }
  },
  {
    id: 'iqiyi',
    version: '1.1.0',
    priority: 100,
    owner: 'Web Extension Compatibility',
    tier: 1,
    supportLevel: 'preview',
    fixture: 'iqiyi.html',
    lastVerified: '2026-08-18',
    matches: [{ hostname: 'iqiyi.com' }, { hostname: 'www.iqiyi.com' }],
    features: ['fullscreen-native', 'fullscreen-web', 'next'],
    selectors: {
      fullscreenNative: ['.iqp-btn-fullscreen'],
      fullscreenWeb: ['.iqp-btn-webscreen'],
      next: ['.iqp-btn-next']
    }
  },
  {
    id: 'youku',
    version: '1.1.0',
    priority: 100,
    owner: 'Web Extension Compatibility',
    tier: 1,
    supportLevel: 'preview',
    fixture: 'youku.html',
    lastVerified: '2026-08-18',
    matches: [{ hostname: 'youku.com' }, { hostname: 'v.youku.com' }],
    features: ['fullscreen-native', 'next'],
    selectors: {
      fullscreenNative: ['.control-fullscreen-icon'],
      next: ['.control-next-video']
    }
  },
  {
    id: 'netflix',
    version: '1.1.0',
    priority: 80,
    owner: 'Web Extension Compatibility',
    tier: 2,
    supportLevel: 'best-effort',
    fixture: 'netflix.html',
    lastVerified: '2026-08-18',
    matches: [{ hostname: 'netflix.com' }, { hostname: 'www.netflix.com' }],
    features: ['seek', 'playback-rate', 'fullscreen-native'],
    selectors: {
      seekForward: ['button.button-nfplayerFastForward', '[data-uia="player-skip-forward"]'],
      seekBackward: ['button.button-nfplayerBackTen', '[data-uia="player-skip-back"]'],
      playbackRate: [
        'button.button-nfplayerPlaybackRate',
        'button.button-nfplayerSpeed',
        '[data-uia="player-speed-control"]',
        '[data-uia="controls-playback-rate"]',
        '[data-uia="control-playback-speed"]',
        '[data-uia="playback-speed-control"]'
      ],
      fullscreenNative: ['button.button-nfplayerFullscreen']
    }
  },
  {
    id: 'ixigua',
    version: '1.0.0',
    priority: 80,
    owner: 'Web Extension Compatibility',
    tier: 2,
    supportLevel: 'best-effort',
    fixture: 'ixigua.html',
    lastVerified: '2026-08-11',
    matches: [{ hostname: 'ixigua.com' }, { hostname: 'www.ixigua.com' }],
    features: ['fullscreen-native', 'fullscreen-web'],
    selectors: {
      fullscreenNative: ['xg-fullscreen.xgplayer-fullscreen'],
      fullscreenWeb: ['xg-cssfullscreen.xgplayer-cssfullscreen']
    }
  },
  {
    id: 'acfun',
    version: '1.0.0',
    priority: 80,
    owner: 'Web Extension Compatibility',
    tier: 2,
    supportLevel: 'best-effort',
    fixture: 'acfun.html',
    lastVerified: '2026-08-11',
    matches: [{ hostname: 'acfun.cn' }, { hostname: 'www.acfun.cn' }],
    features: ['fullscreen-native', 'fullscreen-web'],
    selectors: {
      fullscreenNative: ['[data-bind-key="screenTip"]'],
      fullscreenWeb: ['[data-bind-key="webTip"]']
    }
  },
  {
    id: 'sohu-video',
    version: '1.0.0',
    priority: 80,
    owner: 'Web Extension Compatibility',
    tier: 2,
    supportLevel: 'best-effort',
    fixture: 'sohu-video.html',
    lastVerified: '2026-08-11',
    matches: [{ hostname: 'tv.sohu.com' }],
    features: ['fullscreen-native', 'fullscreen-web'],
    selectors: {
      fullscreenNative: ['button[data-title="网页全屏"]'],
      fullscreenWeb: ['button[data-title="全屏"]']
    }
  },
  {
    id: 'ted',
    version: '1.0.0',
    priority: 80,
    owner: 'Web Extension Compatibility',
    tier: 2,
    supportLevel: 'best-effort',
    fixture: 'ted.html',
    lastVerified: '2026-08-11',
    matches: [{ hostname: 'ted.com' }, { hostname: 'www.ted.com' }],
    features: ['fullscreen-native'],
    selectors: { fullscreenNative: ['button.Fullscreen'] }
  }
] as const satisfies readonly SiteAdapterDefinition[])
