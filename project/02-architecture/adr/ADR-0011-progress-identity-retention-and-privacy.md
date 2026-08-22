# ADR-0011：播放进度 Identity、保留期与隐私策略

> 状态：Accepted for Preview  
> 日期：2026-08-11  
> 决策人：Data / Security / Product Owner  
> 关联：EXT-084、FR-MEDIA-002、RISK-020

## 背景

播放进度会形成观看历史。运行时 media ID 不稳定，完整页面或媒体 URL 又可能包含账号、query token、fragment 和
付费内容信息，因此不能直接作为持久化键。

## 决策

1. `storage.local` 的版本化 SettingsRepository 继续作为唯一权威；不新增第二个存储事实源。
2. 保存默认关闭，只有有效设置 `media.restoreProgress=true` 且 `retainProgressDays>0` 时读写。
3. Identity 按优先级选择：稳定媒体 ID hash → 去 query/fragment 的媒体 source path hash → 页面
   origin+pathname hash。当前通用 runtime 没有可信稳定媒体 ID 时使用页面 origin+pathname。
4. 持久化记录只保留规范化 site、匿名 mediaKey、position、duration、updatedAt、expiresAt；不保存临时 media ID、
   原始 URL、query、fragment 或标题。兼容 Schema 暂时允许读取遗留 `titleHint`，但策略层必须在导入、规范化、落盘和
   导出前强制剥离。
5. 保存节流为 5 秒；`<=3s` 不保存；接近结束（duration-5s）优先删除，即使短媒体当前位置也小于 3 秒。
6. TTL 上限由设置 Schema 控制；容量采用 oldest eviction，并保护当前写入键。
7. 用户关闭恢复或把保留期设为 0 时，受影响记录在同一 repository mutation 中清除。

## 后果与限制

- 匿名 hash 是去敏标识而不是密码学匿名化；同一设备上的重复 path 仍可关联。
- 仅依赖 page pathname 会把同一路径中的多个节目合并；Phase 5 adapter 可提供经审查的稳定内容 ID，但不能上传原始
  token 或标题。
- Preview 不做跨设备 sync，不发送进度到网络，也不把 progress 放入诊断导出。

## 验证

- `tests/unit/progress-domain.spec.ts`
- `tests/integration/progress-repository.spec.ts`
- content runtime 保存/恢复策略与结构化 runtime contracts
- 导入拒绝 raw source URL 的安全回归
