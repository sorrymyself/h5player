# ADR-0016：播放倍速用户意图、作用域与生命周期策略

> 状态：Proposed  
> 日期：2026-08-12  
> 决策人：TODO（用户审核后填写）  
> 关联：REQ-UX-001、REQ-UX-002、FR-CORE-006/007、EXT-131/132/134/137～139、RISK-029、DECISION-011/013

## Context

当前 Web Extension 已有 global/site `defaultPlaybackRate` 和 `protectPlaybackRate` Schema，但媒体命令主要修改当前
controller 的实际值，没有形成“用户明确设置 → 解析有效策略 → 新媒体/重播/换集自动应用 → 网站反向修改有界处理”的闭环。
用户实测因此需要对每个新播放或重新播放的视频重复设置倍速。

Legacy 的价值在于把倍速视为可继承的用户意图，但其属性劫持、页面存储和全量媒体广播不应直接复制。新扩展需要明确持久化作用域、
临时作用域、媒体实际值、保护策略和多媒体同步边界。

## Principles / Decision drivers

1. 一次明确设置应在用户预期范围内持续生效，减少重复操作。
2. 持久化用户意图与媒体实际状态必须分离；网站瞬时值不能静默成为设置。
3. 作用域和写回可见可预测，临时操作不能污染站点或全局策略。
4. 生命周期应用幂等、有界、可诊断；不以无限轮询或属性劫持作为产品契约。
5. 多媒体页面优先避免误控广告、背景音频和第二个内容媒体。

## Options considered

### Option A：只控制当前媒体实际值

- 做法：`media.set-rate` 只写当前 `HTMLMediaElement.playbackRate`，不更新意图或生命周期策略。
- 优点：模型最简单，几乎不需要迁移。
- 缺点：新媒体、重播、换集和网站 reset 后丢失；直接导致用户已实测的重复操作问题。

### Option B：所有倍速操作直接写全局默认并广播所有媒体

- 做法：每次快捷键/UI 操作都持久化为 global 值，并同步页面所有媒体。
- 优点：持续性强，实现路径直观。
- 缺点：站点差异和临时观看需求无法表达；容易污染所有网站并误控广告/背景音频；用户无法理解操作范围。

### Option C：分层 Playback Intent/Policy + Lifecycle Coordinator（推荐）

- 做法：区分 global default、site policy、page session override、current-media temporary intent 和 media actual；由纯函数
  resolver 解析 effective policy，由 coordinator 在媒体生命周期幂等应用；用户操作显式携带 writeback scope。
- 优点：一次设置可持续、站点可锁定、临时操作可隔离、来源可展示；网站 reset 和多媒体同步可用策略与能力控制。
- 缺点：需要 Schema/消息/view model 增量、迁移和更多测试；默认写回作用域与媒体分类需产品确认。

## Decision

采用 Option C，作为 Phase 6.5 提案：

```text
current-media temporary intent
  > page session override
    > site policy
      > global default
        > product default 1x
```

- `media actual` 是观察结果，不参与上述持久化优先级，也不能自动写回 Settings。
- 默认用户操作写回作用域由 DECISION-011 在审核时确认；推荐站点策略，同时提供“仅当前媒体”和“当前页面临时”入口。
- 新媒体、loadedmetadata/canplay/playing、重播、SPA 换集、`src`/duration generation 变化和 policy change 均触发幂等解析/应用。
- `protectPlaybackRate` 只表达是否保护用户意图；实现必须按站点能力有界重试、去重并可降级，不能无限轮询。
- 页面内同步默认仅针对可识别的内容媒体；广告、隐藏媒体和背景音频排除规则由 DECISION-013 与 adapter capability 决定。

## Why chosen

Option A 无法解决已确认的核心问题；Option B 虽能减少重复操作，但会制造更严重的全局污染和误控。Option C 增加了工程复杂度，
却是唯一同时满足持续性、作用域可预测、多媒体安全和可测试性的方案，并可复用现有 Settings Repository、active scoring 和 typed command。

## Consequences

- 正面：用户可按网站锁定倍速，新媒体/重播/换集自动继承；Popup/Options 可解释有效值、来源和保护状态。
- 负面/技术债：Settings/Envelope/ViewModel 可能升版；需要 migration、source/scope UI、多媒体分类和 coordinator 状态机。
- 迁移与兼容：旧 global/site 字段必须无损映射为新 policy；无法分类或不支持倍速的媒体退化为当前媒体控制并显示原因。
- 安全/性能：不新增权限或远程配置；重试预算、observer/listener/timer 进入 churn 和性能门禁。

## Verification

- Unit：priority/source/scope/writeback、range/clamp、capability、保护开关、外部 observation 不写回。
- Integration：discovered/metadata/playing/replay/src/SPA/settings change/reset/teardown、去重和有界重试。
- Real-extension E2E：global/site/page/media 隔离、新媒体/换集继承、Popup/Overlay/快捷键一致、多媒体不误控。
- Headed/live：Tier 1 站点换集、重播、广告、站点 reset 与最终反馈；记录浏览器/OS/extension SHA。

## Follow-ups

- 用户确认 DECISION-011：默认写回 global、site 或先弹出/记忆作用域。
- 用户确认 DECISION-013：页面内容媒体分类和同步边界。
- EXT-131/132/134：实现 resolver、coordinator 和作用域 UI。
- EXT-137/138：补齐自动化、headed 与 live evidence。
- EXT-139：评审迁移、剩余风险和 Phase 7 解冻条件。
