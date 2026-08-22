# Web Extension 体验差距审查（2026-08-12）

> 文档 ID：REVIEW-UX-001  
> 状态：In Review  
> 负责人：Project Owner / Product Owner / UX Owner  
> 最后更新：2026-08-12  
> 关联：REQ-UX-001、REQ-UX-002、ARCH-UX-001、ADR-0015/0016、QUAL-UX-001、RISK-028/029、Phase 6 Exit Review、Phase 7 Roadmap

> 后续状态：本审查保留为用户实测触发和需求基线；实现现状与剩余验收缺口见
> [Phase 6.5 实现审查（2026-08-14）](./phase-6.5-implementation-review-2026-08-14.md)。

## 1. 审查结论

当前 Web Extension 的平台、权限、媒体核心、Popup/Options、基础 Overlay 和自动化工程基线可运行，但页面体验尚未达到交付标准。Phase 7 暂停，先执行体验能力补齐里程碑（暂称 Phase 6.5）。

结论：`UX NO-GO / Phase 7 HOLD`。

这不是对 Legacy 代码质量的否定，也不是要求原样复制 Legacy；它表示当前扩展尚未吸收 Legacy 最关键的用户价值：低干扰页面控件、媒体级即时反馈和一次设置后持续生效。

## 2. 用户实测问题与证据映射

| 实测问题                             | 当前扩展证据                                                                                                                                             | Legacy 对照证据                                                                                        | 判定            |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------- |
| 默认为全局大控制面板，严重遮挡       | `web-extension/src/ui/overlay/MediaOverlay.css:34-57` 使用 fixed + 视口右下角 + 最大 720px；`entrypoints/content.ts:80-108` 以 documentElement 为 anchor | `src/h5player/ui/h5playerUI.js:111-180` 为每个 video 建立 anchor popup；`:364-467` 按媒体状态定位/显隐 | P0 产品缺口     |
| 反馈不在当前媒体右上角               | 当前 Overlay 主要通过 `notice` 在全局 panel 内显示；`content-overlay-controller.ts:142-170`/`:369-374` 只维护单个 controller notice                      | `src/h5player/h5player.js:1576-1758` 按当前媒体容器建立短时 tips，视频默认 absolute，音频固定右下角    | P0 产品缺口     |
| 新视频/重播需重复设置倍速            | 当前有 `defaultPlaybackRate` Schema/站点覆盖，但 `content-runtime.ts:308-351` 未在媒体生命周期应用该策略；`media.set-rate` 只执行当前 controller         | `src/h5player/h5player.js:263-300`、`:672-736`、`:846-864` 在 playing/设置/reset 时持久化和重应用      | P0 行为闭环缺口 |
| 快捷键/UI/新用户路径未形成低认知闭环 | 当前 hotkey catalog 与 Popup 存在，但 Overlay 是大面板，反馈和策略来源不清                                                                               | Legacy UI 提供固定倍速菜单，快捷键共享播放器命令并在当前媒体提示                                       | P1 体验缺口     |

## 3. 当前已具备能力

- `MediaSnapshot` 有稳定 `mediaId`、active media 和 capabilities。
- active player scoring 已考虑可见性、焦点、最近交互、播放状态和面积。
- `SettingsData` 已有 global/site default rate、volume、protection policy。
- Popup/Options 与 typed command/application facade 已建立；Overlay 组件有 unit/component/a11y 基线。
- content/page-main/background 的 typed boundary、Shadow DOM 隔离和 teardown 机制可作为重构基础。

## 4. 必须先补齐的能力

1. 媒体实例级 anchor registry 与轻量 quick controls；
2. 每媒体 feedback presenter 和统一 feedback event；
3. playback policy resolver + lifecycle coordinator；
4. global/site/page/media 作用域和用户意图持久化闭环；
5. 快捷键、页面 UI、Popup 的一致反馈和低认知入口；
6. 多媒体、音频、SPA、Shadow DOM、iframe 和站点反向修改的降级与证据；
7. headed 视觉、遮挡、焦点、触控和真实 Tier 1 smoke 门禁。

## 5. Phase 7 冻结规则

- EXT-140～EXT-144 保持 `Proposed`，不得开始实现或抽取共享 Legacy 核心。
- 新增实验能力不得用来绕过 UX P0 缺口；下载、声音增益、声明式自定义规则和共享核心评估全部后置。
- Phase 6 发布工程的 `CONDITIONAL GO` 不自动转为 UX 或 Stable GO。
- 只有 `QUAL-UX-001` 的 P0 门禁通过、`REVIEW-UX-001` 更新为 Approved/Conditional GO，并由用户确认需求后，才允许重新评估 Phase 7。

## 6. 审查输入与限制

- Legacy 静态证据：`src/h5player/h5player.js`、`src/h5player/ui/h5playerUI.js`、`src/h5player/tips.js`、`src/h5player/configManager.js`、`src/h5player/ui/js/menu.js`。
- Web Extension 当前实现：`entrypoints/content.ts`、`src/ui/overlay/*`、`src/runtime/content/*`、`src/domain/settings/*`、`src/infrastructure/dom/*`。
- 当前审查没有修改任何运行代码，也没有访问真实生产站点；真实站点/浏览器视觉行为需在后续 headed smoke 中验证。
