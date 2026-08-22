# ADR-0013：站点 Adapter Registry、故障隔离与回退

> 状态：Accepted for Preview  
> 日期：2026-08-11  
> 决策人：Architecture / Compatibility / Security Owner  
> 关联：EXT-100～EXT-107、FR-ADAPTER-002～004

## 背景

Legacy TCC 把站点 selector、命令式函数、样式修改和播放器业务逻辑集中在一个大型配置对象中。Web Extension 需要迁移
高价值站点，但不能让站点漂移破坏 Generic Core，也不能把远程函数或任意配置引入 MAIN world。

## 决策

1. page-main 只装配一个实现现有 `MediaAdapter<HTMLMediaElement>` 的 `MediaAdapterRegistry`；media discovery、command
   registry 和 bridge 不增加站点分支。
2. 每个媒体先创建 Generic controller，site controller 只做包装。selector/Hook 未命中、抛错或被禁用时立即回退 Generic。
3. 匹配仅允许随构建发布的 hostname/path prefix；候选按 priority 降序、id 稳定排序。
4. Catalog 声明 id、version、owner、Tier、support level、fixture、lastVerified、features 和 selectors。
5. Registry 在构造时校验并防御性冻结 catalog、disable policy 与 Hook 表；数量、字段、selector 和诊断计数均受协议上限约束。
6. selector 优先，并先在目标媒体的父容器内查找、再回退 document，减少多播放器页面串控。命令式 Hook 只允许静态
   attach/detach/play/pause/fullscreen 入口，必须有生命周期与失败注入测试。
7. kill switch 只支持精确 adapter version 或 feature，存在本地 `rollback-policy.ts`；禁止远程 selector、远程代码和用户函数。
8. 运行时健康信息只包含 adapter 元数据、selected/status/failureCount/disabledFeatures，经 typed state 进入本地诊断。
9. 固定脱敏 fixture 是 PR 主要证据；真实站点 smoke 作为 Phase 6/Beta 独立证据，不由 fixture 外推。

## 后果

- 站点适配数量增加不会让 domain/application 出现 hostname 分支。
- 单个 adapter 可按 feature 或 version 快速回退，同时保留通用媒体控制。
- selector 点击是 best-effort，真实站点登录态、DRM、AB 实验和 DOM 漂移仍需要发布前 smoke。
- 当前 target 限定为原生 `HTMLMediaElement`；非原生 player API 和不可见 closed Shadow DOM 需后续 ADR。

## 验证

- `tests/unit/adapter-registry.spec.ts`
- `tests/compatibility/site-adapter-fixtures.spec.ts`
- `tests/integration/diagnostics.spec.ts`
- `scripts/compatibility-report.ts`
- `tests/baselines/site-adapters.json`
