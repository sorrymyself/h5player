# ADR-0008：配置同步采用小型非敏感字段白名单

> 状态：Accepted  
> 日期：2026-08-10  
> 决策人：Architecture / Security / Product / Quality  
> 关联：ADR-0003、DECISION-005、FR-CONFIG-005、EXT-062、EXT-069

## Context

`storage.local` 是扩展配置的唯一权威。产品希望未来可在多设备间同步一部分偏好，但站点规则、观看进度、诊断和
实验开关可能包含隐私或安全敏感信息；Chrome/Firefox 的 sync 配额和冲突语义也不同。若未经白名单直接镜像整个
`SettingsData`，会造成隐私扩大、配额失败和整包覆盖。

## Decision

Phase 3 冻结以下白名单作为未来 `storage.sync` 的允许字段，但 Preview 阶段不启用跨设备镜像；Phase 3 的“跨 Tab
同步”仅指通过 `storage.local` 变更事件和 revision 重新拉取快照。

允许同步的字段（单值、非敏感、总大小受 8 KiB item / 64 KiB 总预算约束）：

- `global.enabled`
- `global.ui.overlayEnabled`
- `global.ui.theme`
- `global.ui.locale`
- `global.hotkeys.enabled`
- `global.hotkeys.scope`
- `global.media.defaultPlaybackRate`
- `global.media.defaultVolume`
- `global.media.restoreProgress`
- `global.policies.protectPlaybackRate`
- `global.policies.protectCurrentTime`
- `global.policies.protectVolume`

明确不同步：`global.hotkeys.bindings`（平台键位/用户自定义可能不兼容）、`global.policies.allowExperimental`、
`global.diagnostics`、全部 `sites`、`progress`、备份、日志、诊断和任何 URL/标题/媒体标识。

未来启用时必须使用独立版本化 sync envelope、字段级冲突合并、配额/失败降级和用户 opt-in；不能把 sync 值直接
写回 local，也不能以设备时间作为安全凭据。启用前需新增 ADR、隐私文案和双浏览器测试。

## Alternatives considered

- **同步完整 SettingsData**：隐私、配额和冲突风险过高，否决。
- **同步快捷键/站点规则**：键盘布局和站点标识跨设备不稳定，延期。
- **现在直接启用 sync**：没有用户 opt-in 和跨浏览器冲突证据，延期到 Beta/Stable 前专项设计。

## Consequences

- 当前实现保持本地权威、跨 Tab 可观察且可恢复；不会悄悄把用户数据上传到浏览器账户同步服务。
- 未来要增加 sync 功能必须补 schema、冲突策略和 release/store review；白名单本身可作为审查基线。

## Verification

- `tests/unit/settings-sync-whitelist.spec.ts` 验证字段集合、排除项和预算。
- `tests/integration/settings-repository.spec.ts` / UI subscription 验证 local 变更重拉快照。
