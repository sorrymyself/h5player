# Architecture Decision Records

> 文档 ID：ARCH-007  
> 状态：Approved  
> 负责人：Architecture Owner  
> 最后更新：2026-08-19

ADR 用于记录跨模块、跨版本或会影响安全、隐私、兼容性的决策。编号不可复用；被取代的 ADR 必须保留并链接替代项。

| 编号                                                                               | 标题                                      | 状态                             | 结论                                                                                       |
| ---------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------ |
| [ADR-0001](./ADR-0001-greenfield-extension.md)                                     | Web Extension 独立绿地重构                | Accepted                         | 新扩展与油猴主线平行演进                                                                   |
| [ADR-0002](./ADR-0002-runtime-contexts-and-bridge.md)                              | 运行时上下文与消息桥                      | Accepted                         | MAIN/content/background 分层，严格 typed bridge                                            |
| [ADR-0003](./ADR-0003-versioned-storage.md)                                        | 版本化配置与存储权威                      | Accepted                         | background repository + Schema migration                                                   |
| [ADR-0004](./ADR-0004-toolchain-and-test-stack.md)                                 | 构建与测试技术栈                          | Accepted                         | 独立 pnpm；WXT/Vite + TS/Vitest/Playwright/Zod Mini                                        |
| [ADR-0005](./ADR-0005-permission-minimization.md)                                  | 权限最小化与远程能力                      | Accepted                         | required 为 storage/activeTab/scripting；all-sites optional；无网络拦截/远程代码           |
| [ADR-0006](./ADR-0006-declarative-main-world-entry.md)                             | 声明式 MAIN world 入口                    | Accepted                         | `document_start`/`allFrames` content script，消除异步注入竞态                              |
| [ADR-0007](./ADR-0007-runtime-host-permission-onboarding.md)                       | 动态内容脚本与站点授权                    | Accepted                         | 空静态 matches；optional host；两个固定脚本运行时注册、bootstrap 与撤销                    |
| [ADR-0008](./ADR-0008-settings-sync-whitelist.md)                                  | 配置同步字段白名单                        | Accepted                         | local 权威；Preview 不启用 sync，仅冻结小型非敏感字段白名单                                |
| [ADR-0009](./ADR-0009-overlay-shadow-root-and-frame-policy.md)                     | Overlay Shadow Root 与 Frame 策略         | Accepted for Preview             | closed ShadowRoot、top-frame-only、typed UI boundary                                       |
| [ADR-0010](./ADR-0010-capture-artifact-and-permission-boundary.md)                 | 截图 Artifact 与权限边界                  | Accepted for Preview             | bounded artifact；无 downloads/clipboard 权限；失败显式降级                                |
| [ADR-0011](./ADR-0011-progress-identity-retention-and-privacy.md)                  | 播放进度 Identity、保留期与隐私策略       | Accepted for Preview             | 匿名 identity、TTL/容量、默认关闭、旧标题字段强制清理                                      |
| [ADR-0012](./ADR-0012-cross-tab-advisory-media-events.md)                          | 跨 Tab Advisory Media Event 语义          | Accepted for Preview             | 非权威、不保证送达、不自动暂停或仲裁                                                       |
| [ADR-0013](./ADR-0013-site-adapter-registry-and-fallback.md)                       | 站点 Adapter Registry、故障隔离与回退     | Accepted for Preview             | Generic-first 包装、静态匹配/kill switch、fixture 与真实 smoke 分离                        |
| [ADR-0014](./ADR-0014-release-profiles-deterministic-artifacts-and-provenance.md)  | 发布 Profile、确定性产物与 Provenance     | Accepted for Phase 6             | 单一版本源、确定性 ZIP、evidence schema、unsigned provenance、no-publish RC                |
| [ADR-0015](./ADR-0015-media-anchored-overlay-and-feedback.md)                      | 媒体锚定 Overlay、即时反馈与 Preview 修正 | Proposed                         | Phase 6.5 采用 per-media anchor/feedback；保留 ShadowRoot 与安全边界；用户审核前不实施     |
| [ADR-0016](./ADR-0016-playback-intent-policy-and-lifecycle.md)                     | 倍速用户意图、作用域与生命周期策略        | Proposed                         | 分离 intent/actual，按 global/site/page/media 解析并在生命周期幂等应用；默认写回待用户确认 |
| [ADR-0017](./ADR-0017-main-world-media-control-authority.md)                       | MAIN world 媒体控制权仲裁与分层恢复       | Accepted for Phase 6.5           | per-instance setter 仲裁为主、有界生命周期恢复为辅；倍速/音量持续保护，进度短租约保护      |
| [ADR-0018](./ADR-0018-experimental-download-boundary.md)                           | 实验下载捕获代次与最终保存边界            | Accepted for engineering preview | 默认关闭零 Hook、代次/预算/失败清理；MAIN sink 安全拆分为 EXT-154 前保持阻断               |
| [ADR-0019](./ADR-0019-host-frame-authorization-replaces-cross-origin-broadcast.md) | Host/Frame 授权替代 Legacy 跨域广播开关   | Accepted for Phase 6.5           | 浏览器 host permission 是授权事实源；精确 frame owner 路由，不复制任意跨域广播或同名开关   |
