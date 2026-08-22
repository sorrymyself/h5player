# Tencent Video 多实例控制与悬停区复测

> 文档 ID：REVIEW-012
> 状态：Conditional Pass
> 日期：2026-08-16
> 范围：Web Extension `0.1.0.10004`

## 1. 复测目标

- 验证腾讯页面存在多个媒体实例时，快捷键和 Popup 不会只修改隐藏辅助实例。
- 验证腾讯切换到 WASM/Canvas 播放表面后，倍速命令仍有可观察的播放器证据，不能以 fake video 属性变化伪造成功。
- 扩大倍速标识的鼠标触发区域，但保持可见标识尺寸和位置不变。

精确页面：`https://v.qq.com/x/cover/zgexd0mcj7at1fc/g00248hvnae.html`。

## 2. 实现结论

腾讯控制采用双模式处理：

1. 普通 DOM 视频模式对顶层 `video, audio` 候选按播放中、真实媒体源、有效时长/进度和可见面积排序，只写入最高分的可见实例；隐藏、无尺寸或未渲染的辅助实例不参与选择。
2. WASM/Canvas 模式由 `vm.gtimg.cn` fake-video 子帧发起 typed request，经可信顶层腾讯页面确认后写入站点 session rate、点击精确倍速菜单项，并向子帧返回 ACK；子帧只在收到匹配 requestId 的成功 ACK 后更新代理媒体。
3. 桥接拒绝错误 origin、错误 fake-frame path、非后代 WindowProxy、非腾讯顶层、错误 requestId、`accepted: false` 和超时响应。
4. 顶层页面会在开放 Shadow DOM 中寻找与远程媒体尺寸匹配的 `vm.gtimg.cn` fake-video iframe，并把 viewport proxy 锚定到该真实播放表面；隐藏辅助视频不会成为跨帧路由目标。
5. 倍速可见按钮保持原尺寸和位置，透明 hitbox 向播放器内部扩展；端侧测试从透明边缘移动鼠标，而不是从按钮中心触发。

## 3. 自动化证据

| 项目        | 结果                                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Run ID      | `2026-08-16-tencent-shadow-anchor-hitbox-10004`                                                                                                                                |
| 环境        | `darwin 25.5.0 arm64`、Chromium `151.0.7922.34`、`1440x900`、headless                                                                                                          |
| 扩展        | `0.1.0.10004`，fingerprint `70c511c175c4eb64b7dd84b6b2e0f9f20d3d8fc98f9de79f0ada4096fa4d80a8`                                                                                  |
| 严格结果    | Playwright `1 passed`，report `outcome=passed`，`violations=[]`                                                                                                                |
| 多实例      | adapter `selectedMediaCount=2`；初始快捷键和 Popup 均控制 `media-0-1`，`failureCount=0`                                                                                        |
| 初始倍速    | 快捷键 `1 -> 1.1`；Popup `1.5`；腾讯 `1.5` 菜单项为 `txp_current`                                                                                                              |
| reload/WASM | reload 后目标为 `media-14-1` viewport proxy；顶层 Host 与真实播放 iframe anchor distance `0`，`sessionStorage.playbackRate="1.5"`，腾讯 `1.5` 菜单项为 `txp_current`，继承通过 |
| hitbox      | 初始 hitbox `56.188 x 56`、trigger `32.188 x 32`；reload hitbox `66.688 x 56`、trigger `42.688 x 32`；两次 `usedTransparentHitboxEdge=true`，方法均为真实 `hover`              |
| 全量门禁    | unit `253`、component `36`、integration `107`、compatibility `36`、security `3` 全部通过（Node `24.13.0`）                                                                     |
| 双浏览器    | Chrome E2E `7 passed`；Firefox 153 核心权限/媒体 E2E 完整通过                                                                                                                  |

报告：`web-extension/test-results/live-sites/2026-08-16-tencent-shadow-anchor-hitbox-10004/tencent-video/report.json`。

## 4. 保留风险

- 初始展开仍报告原生 controls/subtitle/danmaku/ad 的潜在碰撞 warning，需要继续做视觉避让审查。
- reload 后 WASM viewport proxy 的真实 pointer 已通过；当前仍有腾讯原生 controls/字幕/弹幕层潜在碰撞 warning，登录弹窗、广告、换集和 DRM 状态尚未覆盖。
- 本次证明了给定公开页面和冻结环境中的双模式控制链路，不外推到登录态、广告态、换集、AB 播放器或 DRM 页面。

## 5. 判定

多实例误控、伪成功、顶层代理错位和透明触发区过小均已取得实现与自动化证据。腾讯双模式倍速与 reload UI pointer 可标记为 `Conditional Pass`；宿主碰撞及登录态/广告态/换集覆盖仍是 UX evidence gap，Phase 7 继续 HOLD。
