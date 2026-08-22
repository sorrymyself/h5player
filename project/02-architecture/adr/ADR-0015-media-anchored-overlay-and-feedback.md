# ADR-0015：媒体锚定 Overlay、即时反馈与 Preview 方案修正

> 状态：Proposed  
> 日期：2026-08-12  
> 决策人：TODO（用户审核后填写）  
> 关联：REQ-UX-001、REQ-UX-002、FR-UI-003/006/007/008、EXT-128～130/135～139、RISK-021/028

## Context

Phase 4 的 Overlay 技术壳已验证 closed ShadowRoot、typed view model 和 teardown，但当前实现以
`document.documentElement` 为 anchor，并使用视口级 fixed 大面板。用户实测显示它会遮挡刷视频体验；反馈也被困在全局 panel，
无法让用户在当前视频右上角低干扰地确认最终值。

Legacy 取证证明了“按媒体实例归属控件”“短时媒体反馈”“播放速率意图在新媒体生命周期中重应用”是用户价值，而不是必须复制的
DOM、属性劫持或组件实现。新方案还必须保持无 WAR、无 CSP 改写、无远程代码和显式 teardown。

## Principles / Decision drivers

1. 媒体归属优先：控件和反馈必须可追踪到稳定 `mediaId` 与 anchor。
2. 低干扰优先：播放中不显示持续视口级大面板；反馈不抢焦点、不拦截媒体交互。
3. 生命周期完整：用户倍速意图与媒体实际值分离，新媒体/重播/换集自动继承，重试有界。
4. 保持安全与 Legacy 边界：保留 ShadowRoot/typed boundary，不修改 Legacy，不扩大权限。

## Options considered

### Option A：继续扩展单一全局 Overlay

- 做法：保留 `document.documentElement` anchor，在 fixed panel 中增加更多状态和反馈。
- 优点：改动少，能复用当前 controller/component。
- 缺点：无法解决遮挡和错误媒体归属；反馈仍不在媒体附近；多媒体和生命周期复杂度集中到一个全局面板，不能满足 UX P0。

### Option B：按媒体实例建立 Anchor Registry、Quick Controls 和 Feedback Presenter（推荐）

- 做法：由 `MediaAnchorRegistry` 管理 `mediaId → media/container/geometry`，每个媒体按需挂载轻量控件和反馈；命令经统一 facade，倍速经 policy/lifecycle 协调器。
- 优点：直接满足媒体归属、低干扰、反馈时序和新媒体继承；可按媒体 teardown，适配多媒体、音频和降级态；仍可复用 closed ShadowRoot 和现有 typed boundary。
- 缺点：生命周期、定位、frame/audio fallback 和视觉测试复杂度增加；需要拆分现有全局 controller，并重新校准 z-index/覆盖阈值。

## Decision

采用 Option B，作为 Phase 6.5 的目标架构提案。Phase 4 的 closed ShadowRoot、样式内联、无 WAR、事件隔离和组件边界继续保留；
`document.documentElement` 只能作为管理节点或无 anchor 降级，不得作为默认视觉归属。页面默认拆分为 per-media quick controls 与 per-media
feedback；Popup/Options 只承担全局/站点/诊断和明确的辅助面板。

## Why chosen

Option B 是唯一能同时满足用户实测的三项 P0 问题和现有安全/工程约束的方案。Option A 虽然短期成本较低，但会把已确认的体验缺口
永久化，无法通过 UX-ACC-001/005/006/010。

## Consequences

- 正面：控件与反馈跟随正确媒体；用户一次设置倍速后可跨新媒体、重播和换集继承；多媒体目标和 teardown 更可验证。
- 负面/技术债：需要新的 anchor/feedback/policy/lifecycle 模块、headed visual smoke 和真实站点证据；iframe-only 聚合仍需独立决策。
- 迁移与兼容：Legacy 不改；Phase 4 Overlay 仅保留为技术 Preview 历史状态，实施期间允许 feature flag 回退到隐藏页面 UI + Popup/快捷键。

## Verification

- `QUAL-UX-001` 的 UX-ACC-001～015；尤其是定位、反馈、倍速继承、作用域来源、多媒体和 churn 门禁。
- Chromium/Firefox real-extension headed visual、触控/键盘人工 smoke、Tier 1 live smoke；fixture 只能证明可重复 DOM 契约。
- dependency boundary、manifest/WAR/CSP/Legacy hash 与 30 分钟资源 churn 回归。

## Follow-ups

- EXT-128～130：实现 anchor/quick controls/feedback presenter。
- EXT-131～135：实现 policy/lifecycle、作用域 UI 和多媒体/audio/frame 降级。
- EXT-136～138：补齐 a11y、视觉、真实扩展和 live smoke 证据。
- EXT-139：完成 Phase 6.5 Exit Review；用户确认后才重新评估 Phase 7。
