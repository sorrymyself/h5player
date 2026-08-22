# 站点 Adapter 支持矩阵

> 文档 ID：QA-006  
> 状态：Approved for Phase 6.5 Preview Evidence
> 负责人：Web Extension Compatibility  
> 最后更新：2026-08-19

## 1. 证据边界

本矩阵记录 Web Extension 的静态 adapter catalog、固定脱敏 fixture，以及单独冻结的 Tier 1/Tier 2 live smoke 证据。fixture 只证明
hostname/path 匹配、优先级、声明式选择器、Generic 回退、版本/功能禁用和生命周期隔离；live smoke 只证明记录的浏览器、OS、
URL 类别和页面状态。两类证据都不能外推为账号/DRM/AB 实验环境或所有生产播放器版本的完整支持。

## 2. 当前矩阵

| Adapter       | Tier | 支持等级    | Owner                       | Version | Fixture              | 最近 fixture 验证 | 真实站点 smoke（2026-08-14/16/19） | 主要能力/限制                                                                             |
| ------------- | ---- | ----------- | --------------------------- | ------- | -------------------- | ----------------- | ---------------------------------- | ----------------------------------------------------------------------------------------- |
| YouTube       | 1    | Preview     | Web Extension Compatibility | 1.2.0   | `youtube.html`       | 2026-08-18        | 条件通过：Chromium headed          | play/pause/native/web fullscreen/next selector；未迁移广告跳过 Hook                       |
| Bilibili      | 1    | Preview     | Web Extension Compatibility | 1.2.0   | `bilibili.html`      | 2026-08-18        | 条件通过：Chromium headed          | 主站/子域、点播/直播/动态 fixture；native/web fullscreen 与 next；不注入弹幕业务逻辑      |
| Tencent Video | 1    | Preview     | Web Extension Compatibility | 1.3.0   | `tencent-video.html` | 2026-08-18        | 条件通过：控制权/切片/reload       | DOM/WASM 双模式、独立 playback-rate bridge、切片实例迁移、站点轮询保护；碰撞 warning 保留 |
| iQIYI         | 1    | Preview     | Web Extension Compatibility | 1.1.0   | `iqiyi.html`         | 2026-08-18        | 条件通过：DOM fallback             | native/web fullscreen；站点兼容 Modal/新手遮罩阻断 pointer，scroll 无可用距离             |
| Youku         | 1    | Preview     | Web Extension Compatibility | 1.1.0   | `youku.html`         | 2026-08-18        | 条件通过：DOM fallback             | native fullscreen；登录/会员/广告浮层遮挡；视觉 slot 内两个 media 只绑定 active media     |
| Netflix       | 2    | Best effort | Web Extension Compatibility | 1.1.0   | `netflix.html`       | 2026-08-18        | 通过：前景 owner headed smoke      | rate 原生菜单优先、缺失时 captured setter 回退；seek 无原生控件时显式降级；背景预览无 UI  |
| Ixigua        | 2    | Best effort | Web Extension Compatibility | 1.0.0   | `ixigua.html`        | 2026-08-11        | 阻断：公开入口无媒体               | App-only 提示；`media=[]`，未取得实例/UI 或命令证据                                       |
| AcFun         | 2    | Best effort | Web Extension Compatibility | 1.0.0   | `acfun.html`         | 2026-08-11        | 条件通过：Chromium headed          | native/web fullscreen selector；基础 hover/反馈/倍速闭环通过                              |
| Sohu Video    | 2    | Best effort | Web Extension Compatibility | 1.0.0   | `sohu-video.html`    | 2026-08-11        | 条件通过：danmaku warning          | native/web fullscreen selector；映射通过，展开区与弹幕潜在碰撞                            |
| TED           | 2    | Best effort | Web Extension Compatibility | 1.0.0   | `ted.html`           | 2026-08-11        | 阻断：reload 外部跳转              | 初始映射/反馈通过；advertising warning；reload `external-navigation`                      |

## 3. 自动化事实源

- Catalog：`web-extension/src/adapters/sites/catalog.ts`。
- 本地 kill switch：`web-extension/src/adapters/sites/rollback-policy.ts`，禁止远程填充。
- Fixture：`web-extension/tests/fixtures/sites/`。
- 契约测试：`tests/unit/adapter-registry.spec.ts`、`tests/compatibility/site-adapter-fixtures.spec.ts`。
- 冻结基线：`tests/baselines/site-adapters.json`，包含 owner/support level/lastVerified 与 fixture SHA-256。
- 报告：`pnpm test:compat:report`；catalog、support level、owner、fixture 或 hash 未显式同步会失败，lastVerified 超过
  183 天也会阻断。

## 4. Tier 1 live smoke 证据

### 4.1 冻结环境

| 字段       | 值                                                                                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run ID     | `2026-08-14T23-25-32-569Z`                                                                                                                                     |
| 命令       | `H5PLAYER_LIVE_HEADLESS=0 H5PLAYER_LIVE_SITES=youtube,bilibili,tencent-video,iqiyi,youku H5PLAYER_LIVE_REQUIRE_MEDIA=1 pnpm --dir web-extension test:e2e:live` |
| OS / 架构  | `darwin 25.5.0` / `arm64`                                                                                                                                      |
| 浏览器     | Playwright bundled Chromium `151.0.7922.34`，headed，`1440x900`                                                                                                |
| 扩展       | `0.1.0.10000`；fingerprint `b27117abd9471284c1308c2da8c7e78c5d7a6d971a3a53563e1ed573193cc9ab`                                                                  |
| 自动化结果 | `5 passed`；所有站点 `violations=[]`                                                                                                                           |

完整报告目录：`web-extension/test-results/live-sites/2026-08-14T23-25-32-569Z/`。逐站报告和截图索引见
[live-site-smoke-review-2026-08-15](../09-reviews/live-site-smoke-review-2026-08-15.md)。

### 4.2 证据解释

- `mediaId`、Host、Trigger 的映射在 baseline、resize、scroll（iQIYI 除外）和 reload 后均无 orphan/duplicate。
- 五站快捷键 `1→1.1`、Popup `1.5`、反馈可见和 reload 后 `1.5` 继承均通过；Tencent reload 后 mediaId 由 `media-0-1`
  变为 `media-13-1`，仍保持一对一绑定。
- YouTube/Bilibili 的 quick controls 通过真实 hover 打开；该历史批次中的 Tencent、iQIYI、Youku 明确标记 `DOM fallback required`。
  Tencent 已由 2026-08-16 `0.1.0.10004` 专项复测补充为“初始与 reload/WASM 顶层代理真实 hover 均通过”；iQIYI/Youku 结论不变。
- Youku 的单一视觉 slot 含两个 eligible media，但 Host/Trigger 只归属当前 `media-0-2`；这属于 active-media 选择结果，不是重复 Host。

### 4.3 后续复测规则

每次站点 adapter 或 overlay 改动都必须保留完整 JSON 和截图；如果出现 warning，报告只能标记为条件通过，不能由测试脚本删除 warning
来变成绿灯。需要补做：Tencent 碰撞避让、iQIYI/Youku 浮层避让、站点换集/广告/登录态，以及 Firefox headed UX。

### 4.4 Tencent 2026-08-16 专项补充

- 精确 URL：`https://v.qq.com/x/cover/zgexd0mcj7at1fc/g00248hvnae.html`。
- Run `2026-08-16-tencent-shadow-anchor-hitbox-10004` 使用扩展 `0.1.0.10004`；严格 smoke `1 passed`、`violations=[]`；初始与 reload/WASM 均真实 hover 命中，仍保留原生控件/字幕/弹幕碰撞 warning。
- adapter 同时观察到两个候选实例，但初始快捷键/Popup 目标均为可见 `media-0-1`；reload 后进入 WASM viewport proxy `media-14-1`，通过可信 bridge 继承 `1.5`，adapter `failureCount=0`。
- 初始 hitbox 为 `56.188 x 56`、可见 trigger 为 `32.188 x 32`；reload hitbox 为 `66.688 x 56`、trigger 为 `42.688 x 32`；两种模式的透明边缘真实 hover 均成功。
- 详细证据见 [Tencent Video 多实例控制与悬停区复测](../09-reviews/tencent-video-multi-instance-and-hitbox-review-2026-08-16.md)。

### 4.5 Tencent 控制权与切片稳定性补充

- Run `2026-08-16-tencent-stale-frame-fix` 使用扩展 `0.1.1.10000`、bundled Chromium `151.0.7922.34`、`darwin 25.5.0 arm64`、headless `1440x900`；严格 smoke `1 passed`，report `outcome=passed`、`violations=[]`。
- 初始可见 `media-0-1` 快捷键 `1→1.1` 且 feedback 可见；Popup 将站点策略设为 `1.5x` 并取得最终值反馈。
- 点击新片段后目标迁移为 `media-15-tencent-viewport`，自动继承 `1.5x`；快捷键调到 `2x` 后 `stableAfterSitePolling=true`，feedback 归属新实例，没有继续控制旧隐藏实例。
- reload 期间旧 child frame 接收端会消失；探测器只对该 stale-frame 传输错误回退到后台全局路由，协议、Schema 和扩展运行时错误仍保持 fatal。reload 最终目标回到 `media-0-1`，实际倍速 `1.5x`，继承通过。
- 仍保留展开区与原生 controls/subtitle/danmaku/ad 的潜在碰撞 warning；本证据不外推登录态、广告态、DRM 或腾讯 AB 播放器。
- 详细证据见 [媒体控制权优先级与腾讯切片稳定性审查](../09-reviews/media-control-authority-and-tencent-stability-review-2026-08-17.md)。

### 4.6 2026-08-19 Tier 1 前景筛选回归

- Run `2026-08-19-tier1-foreground-fix-final` 使用扩展 `0.1.7.10000`、bundled Chromium `151.0.7922.34`、`darwin 25.5.0 arm64`、headed `1440x900`；五站 strict smoke 全部 `passed` 且 `violations=[]`。
- YouTube、Bilibili 无 warning；Tencent Video 保留 native controls/subtitle/danmaku/ad collision warning；iQIYI 保留页面无可用滚动距离 warning；Youku 保留 collision warning。
- YouTube、Bilibili、Tencent Video 的目标为 `media-0-1`，iQIYI、Youku 的目标为 `media-0-2`；每站快捷键 `1→1.1`、Popup `1.5`、reload `1.5` 继承均成功。
- 完整报告目录：`web-extension/test-results/live-sites/2026-08-19-tier1-foreground-fix-final/`。

## 5. Tier 2 live smoke 与外部阻断证据

| Run                                         | 覆盖                            | 自动化/报告结果                                                               | 关键边界                                                                                |
| ------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `2026-08-14T23-50-00-000Z`                  | Netflix、AcFun、Sohu Video、TED | Playwright `4 passed`；report outcome `3 passed + 1 blocked`；`violations=[]` | Netflix 两个视觉 slot；Sohu danmaku collision；TED advertising collision 且 reload 外跳 |
| `2026-08-19-netflix-foreground-owner-final` | Netflix                         | strict headed smoke `passed`；`violations=[]`、`warnings=[]`                  | opacity `0.25` 背景预览不再拥有 Host/Trigger；opacity `1` 前景播放器独占命令与 UI       |
| `2026-08-15T00-05-00-000Z`                  | Ixigua                          | strict smoke 失败；report outcome `no-media`                                  | 两个公开入口 HTTP 200 但无 `<video>`；页面要求打开 App，看不到可测播放器                |

- 2026-08-14 的 Netflix 双 slot 记录保留为历史缺陷证据；2026-08-19 覆盖性复测已关闭该问题，背景 `media-0-1` 无 Host/Trigger，前景 `media-0-2` 是唯一 eligible media。
- Netflix 前景实例完成快捷键 `1→1.1`、Popup `1.5`、reload `1.5`，baseline/resize/scroll/reload 均无 orphan、unassigned 或 duplicate Host/Trigger。原生 rate 菜单仍优先；菜单缺失时使用捕获的原生 setter，不把公开预览页误判为 adapter 失败。
- Sohu 的真实 hover 可用，但展开面板与 danmaku 区域相交；TED 的初始 hover 可用，但广告态和 reload 外跳使其只能标记为阻断。
- Ixigua 页面 runtime 已注入且为 `ready`，但最终 `media=[]`、`hosts=[]`；这是外部内容可用性缺口，不得写成 adapter live 通过或扩展回归。

完整证据目录分别为 `web-extension/test-results/live-sites/2026-08-14T23-50-00-000Z/`、
`web-extension/test-results/live-sites/2026-08-19-netflix-foreground-owner-final/` 与
`web-extension/test-results/live-sites/2026-08-15T00-05-00-000Z/`。

## 6. README 与主流站点扩展证据

本轮新增的真实站点目录事实源为 `web-extension/tests/e2e/live-site-catalog.ts`，它与产品 adapter catalog 分离：前者管理真实站点
验证入口和负向证据，后者管理运行时 adapter 选择。两者不能互相推导支持等级。

| 分类           | 数量 | 站点/限制摘要                                                                                                                                                 |
| -------------- | ---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 完整流程通过   |   10 | YouTube、Bilibili、Tencent、iQIYI、Youku、Netflix、AcFun、Sohu、Qilu、Niconico；Netflix 最新复测无 warning，其余条件站点仍保留 pointer/碰撞/DOM fallback 限制 |
| 仅发现级       |    3 | CCTV、China Sports、CBS；无完整 rate/feedback/reload 证据                                                                                                     |
| 交互或映射失败 |    9 | Douyin、Pornhub、Huya、Kuaishou、Vimeo、Dailymotion、Twitch、Bilibili Live、Douyin Live                                                                       |
| 外部阻断       |   10 | TED reload 外跳、Zhihu HTTP 403、Instagram/Twitter/Weibo/Spotify 登录、MioMio/VK/Magisto 迁移、Reddit HTTP 403                                                |
| no-media       |   24 | Ixigua App-only、Douyu/TikTok 无可见 content slot、QQ Music MV 列表无详情播放器，以及多个首页/音频/网盘入口无标准媒体                                         |

逐站 JSON、截图和限制解释见 [扩展真实站点兼容性审查](../09-reviews/expanded-live-site-compatibility-review-2026-08-15.md)。特别注意：

- `passed` 只表示当前 profile 的断言没有 violation；带 warning 的站点仍是条件证据；
- `media-discovery` 只表示媒体被发现，不能升级为 adapter support；
- DOM fallback、登录/验证码/年龄门、外部跳转和无标准 `<audio>` 都必须保留在 release evidence 中；
- Bilibili Live 的图片点击验证码在媒体初始化后才出现，截图是主要反爬证据，不能把其 UI 失败当作普通播放器回归；
- 音频页面没有稳定公开 HTMLMediaElement 时，支持等级保持 `Unverified`，不得用 Web Audio 猜测替代。

## 7. 支持声明规则

- Tier 1/Tier 2 fixture 全绿只能写成“adapter fixture verified”；本轮 live smoke 只能写成“bundled Chromium headed 条件证据”。
- 只有在冻结浏览器版本、OS、扩展 SHA、真实 URL 类别、时间、pointer 交互和限制的 smoke 证据存在后，才能更新“真实站点 smoke”。
- `DOM fallback` 只证明 DOM 状态可读，不证明用户鼠标/触控能够打开控件；任何外部 Modal、广告、原生控件或父 frame 遮挡都必须保留为 warning。
- 任何 adapter 健康度为 degraded/disabled 时，GenericAdapter 必须继续存在，且诊断不得包含完整 URL、title、媒体源或页面文本。
