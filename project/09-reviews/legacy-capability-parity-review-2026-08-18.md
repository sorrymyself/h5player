# Legacy 能力对齐实现审查

> 文档 ID：REV-2026-08-18-LEGACY-PARITY  
> 日期：2026-08-19  
> 结论：Engineering Verified for core controls / Experimental boundary implemented / Hostile-live and UX acceptance pending
> 范围：仅 Web Extension；Legacy 油猴源码与构建链未修改

## 1. 本轮目标

本轮优先迁移 Legacy 已验证的控制能力、快捷键语义和兼容细节，不以 UI 重设计作为交付前置条件。实现必须进入 typed domain、command、policy、adapter 和测试边界，禁止直接复制 Legacy 全局对象、原型副作用或任意脚本配置。

## 2. 已完成能力

- 播放/暂停、5 秒与 30 秒跳转、5% 与 20% 音量、静音、0.1x 调速、1-4x 直选。
- `Z` 在 1x 与上次非 1x 之间切换；300ms 内连续数字键按 Legacy 语义累加倍速。
- 原生/网页全屏、PiP、截图 artifact 与下载回调。
- 缩放、平移、旋转、水平/垂直镜像、亮度/对比度/饱和度/色相/模糊、transform reset、all reset。
- 30 FPS 前后逐帧，执行前自动暂停；Netflix 屏蔽与站点语义冲突的向前逐帧键。
- 下一集命令、capability 门控、严格失败传播，以及逐帧/视觉/下一集的媒体锚定反馈。
- `Shift+R` 原子切换当前站点进度恢复，开启后立即尝试恢复当前媒体。
- playback intent 在新媒体、重播、换源、切片实例替换和网站 setter/轮询后继续生效。
- Netflix 原生 seek/rate；YouTube web fullscreen；Bilibili 子域、直播和动态 fixture。

## 3. 额外稳定性修复

页级临时停用和 UI 隐藏此前存在 top-frame 状态回放竞态：content 上报新值时，background 可能仍返回旧 tab cache，导致用户操作被回滚。现在目标状态会在 top-frame 请求前进入 cache，请求失败再恢复旧值；iframe child fan-out 和 top-frame 恢复能力均保留。

## 4. 验证证据

- 固定 Node `24.13.0` 最新完整门禁：format、ESLint、TypeScript、361 unit、40 component、139 integration、40 compatibility、3 security 和 dependency boundary（179 modules / 589 dependencies）全通过；新增用例覆盖 global/site 下载门禁、长按释放状态保护、音频增益失败降级和 adapter-owned autoplay 边界。
- Chrome real-extension：fresh build 后 9 个核心 E2E 通过；覆盖权限生命周期、BFCache/context invalidation、iframe ownership、媒体锚点、音频 fallback、hostile rate/volume/seek polling 等场景。配置 churn 与 live-site 用例因环境条件跳过，未计入通过数。
- Firefox 153：fresh build、`web-ext lint`（0 errors，2 warnings）和核心权限/媒体 Selenium E2E 通过；Firefox headed UX 仍单独保留为未完成验收项。
- Compatibility report：10 个 adapter fixture 均为 `fixture-verified`，baseline SHA-256 同步。
- Legacy 源码目录 `src/h5player/` 未修改。

## 5. 实验能力追加审查（2026-08-18）

本轮已完成 Legacy 实验总开关直接控制的下载/MSE 核心迁移，详见 [实验能力对齐文档](../01-requirements/experimental-capability-parity.md)：

- 默认关闭不安装 URL/MediaSource/SourceBuffer Hook，关闭立即恢复原生方法。
- 直链同源下载、短媒体跨域 bounded fetch、MSE 音视频分轨、`Shift+D`、queued `endOfStream` 自动完成已接入。
- 记录代次、revoke/sourceclose/切源/停用/teardown 清理，单流/页面/chunk 上限，错误 `endOfStream` 和 pending 超时均有终态。
- `isTrusted` 下载快捷键和 isolated content 持久化设置门禁已补齐。

当前不能标记 Stable/安全 Verified 的原因：MAIN world 与页面共享 realm，nonce/session 不是授权；页面仍可能干扰同 realm 的 MediaSource、postMessage 或媒体实例。实验 manager 已不挂载到 `window`，MAIN 仅负责 bounded capture/prepare，最终 `<a>.click()` 与跨域 bounded fetch 已迁移到 isolated content；EXT-154 剩余 hostile-page、真实站点下载和 headed 证据。

## 6. 剩余差异与待验收

- 实验下载的真实站点/headed 下载验收、队列在换源/换集下的体验复核；Web Audio 音量增益的真实音频链路与跨域媒体验收。
- 任意 JavaScript 配置、Legacy 全局原型副作用、跨标签高频轮询/TTL 原样复制。
- 鼠标长按临时加速、autoplay coordinator 和 PiP 跨标签 owner lease 已完成工程实现，仍需原生控件/触控、广告/换集、headed PiP、跨浏览器和 worker 重启证据；临时启停/作用域快捷键仍按现有核心能力验收。
- Douyin、Baidu Pan、Zhihu、Weibo 等高价值 adapter，以及 Bilibili `bwp-video` 专用控制器验证。
- UI 视觉重设计、宿主字幕/弹幕/原生控件避让和最终用户 Exit Review。

## 7. 发布结论

Legacy 主要媒体控制、实验下载边界和高级能力工程实现已经进入 Web Extension 的分层边界，可作为 `0.1.7.10000` 的工程预览版本构建。下载确认/文件名编辑已使用 isolated content 非阻塞队列接入；Phase 7 与 Stable 仍保持 HOLD，直到 hostile/live/headed 证据和 UX 验收完成；Legacy 源码继续冻结。

## 8. 2026-08-19 回归修复

fresh Chrome real-extension E2E 暴露下载确认层的命中测试回归：每个 content frame 都会挂载下载 prompt 的 shadow host，而空队列时 host 仍覆盖整个视口并接收 `pointer-events`，导致页面按钮被透明层截获并最终超时。现已修复为：空队列 host 默认 `visibility:hidden`、`opacity:0`、`pointer-events:none`；只有确认队列存在当前请求时，才通过 `data-h5p-ext-download-prompt-open="true"` 打开模态层。

修复后证据：

- Chrome 核心 real-extension E2E `9 passed`；此前失败的 all-sites、iframe ownership、late iframe state 和 media anchor 四个场景均通过。
- Firefox 153 fresh build、`web-ext lint` `0 errors / 2 warnings` 与权限/媒体 Selenium E2E 通过。
- 后续完整质量门禁已覆盖本段修复及高级能力 scope correction：unit `363`、component `40`、integration `139`、compatibility `40`、security `3` 全通过；format、ESLint、TypeScript、dependency boundary（179 modules / 589 dependencies）全通过。
- Chrome/Firefox manifest 均为 `0.1.7.10000`。

## 9. Netflix 前景媒体归属修复（2026-08-19）

Netflix 公开预览页同时存在透明度 `0.25` 的背景预览视频和透明度 `1` 的前景播放器。旧实现把两者都视为可长期交互媒体，背景实例会夺取 active media、Host 和 Trigger；Chromium MAIN world 的 `getComputedStyle` 捕获错误又会把透明度错误回退为 `1`，放大该问题。

本轮已完成以下修复：

- 当同一文档存在前景媒体时，低透明度 video 被归类为 `background-media`，即使持有旧 active ID 也不能继续取得命令或 UI 归属；只有所有候选都透明时才保留兜底选择，避免合法播放器完全失去控制。
- 多媒体页面每秒重新检查 presentation，支持 SPA、预览层和播放器切换后重新选主。
- 修复 Chromium MAIN world 原生 `getComputedStyle` 捕获，GenericAdapter 能读取真实 opacity。
- Netflix 倍速继续优先使用站点原生倍速菜单；公开预览页没有该菜单时，回退到已捕获的原生 playback-rate setter。seek 在原生 seek 控件缺失时仍显式降级，不伪造成功。

最终 headed live run `2026-08-19-netflix-foreground-owner-final` 使用 bundled Chromium `151.0.7922.34`、扩展 `0.1.7.10000`：

- report `outcome=passed`、`violations=[]`、`warnings=[]`。
- `media-0-1`（opacity `0.25`）无 Host/Trigger，不参与 active/UI；`media-0-2`（opacity `1`）是唯一 eligible foreground player。
- baseline、resize、scroll、reload 均无 orphan、unassigned 或 duplicate Host/Trigger。
- 快捷键作用于 `media-0-2`，倍速 `1→1.1` 且反馈可见；Popup 达到 `1.5`；reload 后同一前景实例继承 `1.5`。

同一构建的 Tier 1 strict run `2026-08-19-tier1-foreground-fix-final` 五站全部通过：YouTube、Bilibili 无 warning；Tencent Video 保留宿主碰撞 warning；iQIYI 保留页面无可用滚动距离 warning；Youku 保留宿主碰撞 warning。该结果证明前景筛选没有回归 Tier 1 的快捷键、Popup 和 reload 继承闭环，但不解除 Firefox headed、长 churn、hostile/live 实验下载、音频/长按/PiP headed 与最终 UX Exit Review 门禁。
