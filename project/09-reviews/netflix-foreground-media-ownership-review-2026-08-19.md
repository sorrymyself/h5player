# Netflix 前景媒体归属审查

> 文档 ID：REV-2026-08-19-NETFLIX-FOREGROUND-OWNER  
> 日期：2026-08-19  
> 结论：Foreground ownership verified in frozen Chromium live environment  
> 范围：Web Extension；Legacy `src/h5player/` 未修改

## 1. 问题与验收标准

Netflix 公开预览页面同时创建全屏背景预览 video 和前景播放器 video。旧实现把低透明度背景实例当成正常候选，导致它可能取得 active media、快捷键和 Overlay 归属。

本轮验收要求：

- 当前景 media 存在时，低透明度背景/预览 media 不得取得命令或 UI 所有权。
- baseline、resize、scroll、reload 后都必须维持一对一实例/UI 映射。
- 快捷键、Popup 站点倍速和 reload 继承必须作用于同一个前景实例。
- 修复不得让“全部候选都透明”的合法页面失去控制，也不得回归五个 Tier 1 站点。

## 2. 根因

1. active-player scoring 只考虑面积、可见比例、播放态等信号，没有在多候选场景区分低透明度背景 media。
2. eligibility 允许旧 active ID 持续覆盖 presentation 信号，背景实例一旦被选中就可能长期持有 UI。
3. Chromium MAIN world 初始化时错误捕获 `getComputedStyle`，失败回退会把所有 opacity 报告为 `1`。
4. 多媒体页面没有周期性复核 presentation，SPA 预览层与前景播放器切换后不能及时重新选主。

## 3. 修复边界

- `MIN_FOREGROUND_MEDIA_OPACITY` 设为 `0.5`；当前景候选存在时，低于阈值的 video 归类为 `background-media`。
- stale active ID 不再覆盖低透明度背景判定；所有候选均低透明度时保留 fallback，避免控制面完全丢失。
- 多实例页面每秒重新检查 presentation；单媒体页面不增加该轮询成本。
- Generic native bindings 捕获真实 `getComputedStyle`，不再把 Chromium MAIN world 的透明度统一回退为 `1`。
- live probe 与产品 runtime 使用一致的前景选择语义，报告只把 eligible foreground media 计入 Host/Trigger 映射。

Netflix adapter 的命令策略保持：rate 原生菜单优先，菜单不存在时使用 captured native playback-rate setter；seek 原生控件缺失时显式降级。该策略避免公开预览页因缺少完整账号播放器菜单而产生伪失败，同时不伪造 seek 成功。

## 4. 自动化证据

- 前景 scoring、eligibility、Overlay、discovery 与 GenericAdapter opacity 回归：5 files / 36 tests passed。
- Netflix/adapter targeted suite：3 files / 34 tests passed。
- 最新完整 Node `24.13.0` 门禁：unit `363`、component `40`、integration `139`、compatibility `40`、security `3`；format、ESLint、TypeScript 和 dependency boundary（179 modules / 589 dependencies）通过。新增的下载门禁、long-press、音频失败降级和 autoplay scope/重复 toggle 保护用例不改变本审查的 Netflix 结论。
- Chrome real-extension：`9 passed`，14 个环境控制用例 skipped。
- Firefox 153：`web-ext lint` 0 errors / 2 existing warnings；权限生命周期与媒体 Selenium E2E 通过。
- `pnpm build:all` 通过；Chrome/Firefox manifest 均为 `0.1.7.10000`。

构建 manifest SHA-256：

- Chrome：`b63ef959517a531b6007669c3fb3f2db34a673b7e401f9d087e627ed0c80030a`
- Firefox：`bebf0e0a381b8b82d959874d0d49fbda1591e7ae8953ee204402e6daf8b54326`

## 5. Netflix 最终实测

报告：`web-extension/test-results/live-sites/2026-08-19-netflix-foreground-owner-final/netflix/report.json`

| 项目           | 结果                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------- |
| Run ID         | `2026-08-19-netflix-foreground-owner-final`                                                   |
| 环境           | `darwin 25.5.0 arm64`；bundled Chromium `151.0.7922.34`；headed `1440x900`                    |
| 扩展           | `0.1.7.10000`；fingerprint `b315ef25d1dc4511b715b6931f4893afb871470f9a3ea87de65102127d765d1e` |
| 报告           | `outcome=passed`；`violations=[]`；`warnings=[]`                                              |
| 背景实例       | `media-0-1`；opacity `0.25`；无 Host/Trigger，不参与 active/UI                                |
| 前景实例       | `media-0-2`；opacity `1`；唯一 eligible media 与 Overlay owner                                |
| 布局生命周期   | baseline、resize、scroll、reload 无 orphan、unassigned、duplicate Host/Trigger                |
| 快捷键         | `media-0-2`，`1→1.1`，feedback visible                                                        |
| Popup / reload | Popup 达到 `1.5`；reload 后 `media-0-2` 继承 `1.5`                                            |

## 6. Tier 1 回归

报告目录：`web-extension/test-results/live-sites/2026-08-19-tier1-foreground-fix-final/`

| 站点          | 目标实例    | 结果/保留边界                                                      |
| ------------- | ----------- | ------------------------------------------------------------------ |
| YouTube       | `media-0-1` | passed；无 warning                                                 |
| Bilibili      | `media-0-1` | passed；无 warning                                                 |
| Tencent Video | `media-0-1` | passed；保留 native controls/subtitle/danmaku/ad collision warning |
| iQIYI         | `media-0-2` | passed；保留页面无可用滚动距离 warning                             |
| Youku         | `media-0-2` | passed；保留 collision warning                                     |

五站快捷键、Popup `1.5` 与 reload `1.5` 继承均成功，且 `violations=[]`。

## 7. 结论与剩余门禁

Netflix 背景预览夺取 active media/UI 的 P0 风险在本冻结环境中已关闭，不再列为 Phase 6.5 未解决项。Netflix 支持等级仍为 Tier 2 Best effort，不能把公开预览页证据外推到所有账号、DRM、广告或 AB 播放器状态。

Phase 7 与 Stable 继续 HOLD：Firefox headed UX、30 分钟 churn、hostile/live 实验下载、真实音频链路、鼠标长按、PiP headed、其他失败站点和用户 Exit Review 尚未完成。
