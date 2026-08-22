# H5Player Web Extension 重构工程管理中心

> 状态：Active / Phase 6.5 Implementation Review / Phase 7 Frozen<br>
> 建立日期：2026-08-10  
> 最后更新：2026-08-20
> 维护范围：Web Extension 重构的需求、架构、任务、质量、发布与审查资料  
> 与 `docs/` 的边界：`docs/` 继续存放面向用户和现有工程的说明；本目录只管理项目治理与重构交付资料。

## 1. 目录目标

本目录是 H5Player Web Extension 重构的唯一项目管理入口，用来解决以下问题：

- 将“为什么重构、重构到什么程度、何时算完成”固化为可验证的需求。
- 明确油猴脚本是稳定基线，Web Extension 是独立演进的新产品线。
- 用架构边界、类型契约和自动化测试替代隐式约定。
- 用任务 ID、里程碑、质量门禁和审查记录追踪实际进展。
- 为未来是否反向重构油猴脚本保留证据，而不是提前承诺共享代码。

## 2. 核心结论

1. `src/h5player/`、`src/libs/`、`config/` 和现有油猴构建链在本次 Web Extension 重构中视为 Legacy 稳定基线，不进行体系化翻修。
2. `web-extension/` 采用绿地重构，不再把“注入油猴产物并模拟 GM API”作为目标架构。
3. 新扩展采用 TypeScript 严格模式、分层模块、显式能力接口、版本化数据模型和自动化测试矩阵。
4. 页面 MAIN world、扩展 isolated world 与 service worker 必须形成最小权限边界；禁止通过修改全站 CSP、`unsafe-eval`、`new Function` 或任意代码执行完成注入。
5. 功能按纵向切片迁移，以可观测行为与旧脚本做对照；不以“代码搬完”作为完成标准。
6. Web Extension 达到稳定门槛前，不启动油猴脚本的共享核心抽取或 TypeScript 全量迁移。
7. 当前 Preview 的 required permissions 固定为 `storage`、`activeTab`、`scripting`；`<all_urls>` 只存在于
   `optional_host_permissions`，真实站点静态 `content_scripts` 保持空数组。
8. Phase 6 已建立单一版本源、确定性 Chrome/Firefox release bundle、供应链 evidence 和分层 no-publish CI；该能力不等于
   真实 Beta、商店提交或 Stable 批准。
9. Stable 当前明确为 `NO-GO`；两个连续真实 Beta RC、真实浏览器/站点/权限矩阵、商店签字和观察窗口不可由本地 fixture 替代。
10. 2026-08-12 用户实测确认页面 Overlay、媒体级反馈和倍速继承未达交付标准；Phase 6.5 核心实现现已进入审查，Tier 1/Tier 2 live smoke 已取得条件证据。Netflix 前景归属、frame/session 生命周期、bundle 预算、增强诊断 30 分钟 churn 和 Firefox headed fixture 基线已取得工程证据；其它宿主碰撞、Ixigua no-media、Firefox 真实站点/权限 UX 和用户 Exit 证据仍未闭环，当前保持 `UX NO-GO / Phase 7 HOLD`。
11. Legacy 实验总开关直接覆盖的下载与 MSE 捕获已作为 EXT-153 工程预览迁入；global/site 独立下载开关、资源预算、失败终态和清理已有自动化证据，EXT-154 的 MAIN capture 与 isolated-content 最终 sink 边界也已落地。hostile/live/headed 验收仍未完成，不能据此解冻 Phase 7 或 Stable。

## 3. 文档地图

| 领域   | 入口                                                                                             | 用途                                                              |
| ------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| 治理   | [项目章程](./00-governance/project-charter.md)                                                   | 目标、边界、原则、角色与成功标准                                  |
| 治理   | [文档管理规范](./00-governance/document-standard.md)                                             | 目录、命名、状态、评审和归档规则                                  |
| 治理   | [工程开发规范](./00-governance/engineering-standard.md)                                          | 工作区、脚本、类型、依赖、CI 与本地开发约定                       |
| 治理   | [术语表](./00-governance/glossary.md)                                                            | 统一 Legacy、上下文、能力、支持等级等术语                         |
| 治理   | [风险台账](./00-governance/risk-register.md)                                                     | 风险等级、owner、缓解、触发与复查                                 |
| 需求   | [产品与重构需求](./01-requirements/product-requirements.md)                                      | 用户价值、范围、功能需求、非目标                                  |
| 需求   | [功能对照矩阵](./01-requirements/feature-parity-matrix.md)                                       | Legacy 功能到扩展模块、阶段和测试的映射                           |
| 需求   | [需求追踪矩阵](./01-requirements/traceability-matrix.md)                                         | 全部功能需求到任务、测试和完成证据的映射                          |
| 需求   | [非功能需求](./01-requirements/non-functional-requirements.md)                                   | 性能、安全、兼容、可维护性与可访问性指标                          |
| 需求   | [Legacy 体验能力提炼](./01-requirements/legacy-ux-capability-extraction.md)                      | Legacy 优秀交互的证据、吸收原则和不复制边界                       |
| 需求   | [媒体 UI 交互细化需求](./01-requirements/ux-interaction-requirements.md)                         | 媒体级控件、反馈、倍速策略、多媒体和无障碍需求                    |
| 需求   | [实验性能力对齐](./01-requirements/experimental-capability-parity.md)                            | Legacy 实验总开关范围、下载/MSE 契约、差异和后续安全边界          |
| 架构   | [目标架构](./02-architecture/target-architecture.md)                                             | 运行上下文、分层、数据流和目录结构                                |
| 架构   | [模块目录与契约](./02-architecture/module-catalog.md)                                            | 模块职责、依赖规则和公共接口                                      |
| 架构   | [UI 组件架构](./02-architecture/ui-component-architecture.md)                                    | 组件层级、状态、样式隔离与可访问性                                |
| 架构   | [UI/策略运行时架构](./02-architecture/ux-runtime-and-policy-architecture.md)                     | Anchor、Feedback、Playback Policy 和 Lifecycle Coordinator        |
| 架构   | [数据模型与迁移契约](./02-architecture/data-model.md)                                            | 配置、进度、会话、导入导出和版本迁移                              |
| 架构   | [平台内核契约](./02-architecture/platform-kernel-contracts.md)                                   | Phase 1 消息、sender、请求生命周期、Ports 与 Settings V1 实现契约 |
| 架构   | [迁移与 Legacy 边界](./02-architecture/migration-strategy.md)                                    | 平行演进、功能切片、回退与共享代码条件                            |
| 决策   | [ADR 索引](./02-architecture/adr/README.md)                                                      | 已接受和待决的架构决策                                            |
| 路线图 | [阶段路线图](./03-roadmap/rewrite-roadmap.md)                                                    | Phase 0～7、退出条件和依赖关系                                    |
| 任务   | [主任务台账](./04-tasks/backlog.md)                                                              | Epic、任务、依赖和验收标准                                        |
| 任务   | [当前进度](./04-tasks/progress.md)                                                               | 当前阶段、风险、阻塞与下一步                                      |
| 任务   | [任务工作流](./04-tasks/task-workflow.md)                                                        | 从需求到交付的状态机和 Definition of Ready/Done                   |
| 质量   | [自动化测试策略](./05-quality/test-strategy.md)                                                  | 单元、组件、集成、端侧、兼容和差分测试                            |
| 质量   | [质量门禁](./05-quality/quality-gates.md)                                                        | PR、夜间、候选发布和正式发布门槛                                  |
| 质量   | [兼容性矩阵](./05-quality/compatibility-matrix.md)                                               | 浏览器、页面形态、重点站点和能力覆盖                              |
| 质量   | [站点 Adapter 支持矩阵](./05-quality/site-adapter-matrix.md)                                     | owner、Tier、fixture、验证日期、真实站点状态和已知限制            |
| 质量   | [UX 验收与测试矩阵](./05-quality/ux-acceptance-and-test-matrix.md)                               | 媒体定位、反馈时序、倍速继承、遮挡和 headed/live 证据             |
| 安全   | [安全与隐私基线](./06-security/security-and-privacy.md)                                          | 权限、消息、存储、远程通信和商店审核要求                          |
| 安全   | [权限清单](./06-security/permission-inventory.md)                                                | 每项 manifest 权限、使用点、替代方案、测试和移除条件              |
| 发布   | [版本与发布策略](./07-release/release-strategy.md)                                               | 渠道、版本、构建、签名、灰度和回滚                                |
| 发布   | [商店与合规清单](./07-release/store-and-compliance.md)                                           | 权限说明、隐私、审核材料与内容边界                                |
| 发布   | [发布产物与证据契约](./07-release/release-artifact-and-evidence-contract.md)                     | 版本输入、9 文件 bundle、ZIP、SBOM、gate 与复现规则               |
| 发布   | [Chrome/Firefox Listing 包](./07-release/store-listing-package.md)                               | 商店文案、截图、浏览器/站点声明和签字清单                         |
| 发布   | [隐私与权限披露](./07-release/privacy-and-permission-disclosure.md)                              | 本地数据、保留/清除、无遥测边界和权限理由                         |
| 运维   | [可观测性与支持](./08-operations/observability-and-support.md)                                   | 日志、诊断、缺陷分级和兼容性维护                                  |
| 运维   | [站点适配问题与回退手册](./08-operations/site-adapter-runbook.md)                                | 问题收敛、版本/功能 kill switch、热修复与恢复流程                 |
| 运维   | [Beta/更新/回滚/Incident](./08-operations/beta-update-rollback-incident-runbook.md)              | opt-in、升级、forward-fix、事故与外部演练                         |
| 审查   | [现状基线审查](./09-reviews/baseline-assessment-2026-08-10.md)                                   | 代码事实、缺口、风险与重构起点                                    |
| 审查   | [Phase 2 Exit Review](./09-reviews/phase-2-exit-review-2026-08-10.md)                            | 通用媒体核心、双浏览器 E2E、差分和长稳态结论                      |
| 审查   | [Phase 3 Exit Review](./09-reviews/phase-3-exit-review-2026-08-11.md)                            | 设置、快捷键、权限 onboarding、扩展 UI、双浏览器门禁与剩余风险    |
| 审查   | [Phase 4 Exit Review](./09-reviews/phase-4-exit-review-2026-08-11.md)                            | 高级媒体、Overlay、截图、进度、预算门禁与剩余端侧缺口             |
| 审查   | [Phase 5 Exit Review](./09-reviews/phase-5-exit-review-2026-08-11.md)                            | 站点 registry、fixture、故障隔离、诊断和证据边界                  |
| 审查   | [Phase 6 Exit Review](./09-reviews/phase-6-exit-review-2026-08-11.md)                            | 发布工程证据、外部门禁和 Stable NO-GO                             |
| 审查   | [体验差距审查](./09-reviews/ux-gap-review-2026-08-12.md)                                         | 用户实测问题、证据映射、UX NO-GO 与 Phase 7 冻结                  |
| 审查   | [Phase 6.5 实现审查](./09-reviews/phase-6.5-implementation-review-2026-08-14.md)                 | 当前实现、UX-ACC 部分证据、剩余 headed/live/churn 门禁与任务状态  |
| 审查   | [Tier 1/2 Live Smoke 审查](./09-reviews/live-site-smoke-review-2026-08-15.md)                    | 真实站点实例/UI 映射、pointer、反馈、倍速继承、碰撞和外部阻断证据 |
| 审查   | [Legacy 能力对齐审查](./09-reviews/legacy-capability-parity-review-2026-08-18.md)                | 核心命令、实验下载追加、验证证据和剩余安全/站点边界               |
| 审查   | [Netflix 前景媒体归属审查](./09-reviews/netflix-foreground-media-ownership-review-2026-08-19.md) | 背景预览筛除、前景命令/UI owner、Tier 1 回归与最终 live 证据      |
| 审查   | [iframe 生命周期与控制竞态审查](./09-reviews/iframe-lifecycle-control-race-fix-2026-08-20.md)    | frame/session owner、页面状态顺序、恢复 hydration、churn 与预算   |
| 审查   | [Phase 6.5 长稳态与 Legacy 隔离审查](./09-reviews/phase-6.5-churn-and-legacy-isolation-review-2026-08-22.md) | 30 分钟诊断 churn、Legacy detached 构建与冻结边界                 |
| 审查   | [Phase 6.5 Firefox Headed UX 审查](./09-reviews/phase-6.5-firefox-headed-ux-review-2026-08-22.md) | Firefox fixture 锚定、显隐、反馈、暂停、iframe 与证据边界        |
| 审查   | [UltraQA 场景矩阵](./09-reviews/ultraqa-scenario-matrix-2026-08-19.md)                            | 对抗场景、fresh 命令证据、清理状态与 Phase 7 停止条件             |
| 审查   | [审查清单](./09-reviews/review-checklists.md)                                                    | 需求、架构、安全、测试和发布审查                                  |
| 模板   | [模板目录](./templates/README.md)                                                                | 新需求、任务、ADR、风险和发布记录模板                             |

## 4. 推荐阅读顺序

首次参与重构时按以下顺序阅读：

1. 本页与《项目章程》。
2. 《产品与重构需求》《功能对照矩阵》。
3. 当前 UX 审核先阅读《Legacy 体验能力提炼》《媒体 UI 交互细化需求》《UI/策略运行时架构》《UX 验收与测试矩阵》和《体验差距审查》。
4. 《目标架构》《模块目录与契约》《迁移与 Legacy 边界》。
5. 《阶段路线图》《主任务台账》《自动化测试策略》。
6. 开始任务前阅读相应 ADR、安全基线和质量门禁。
7. 真实 Beta/发布工作前阅读 [Phase 6 Exit Review](./09-reviews/phase-6-exit-review-2026-08-11.md)、artifact contract、
   Listing/隐私材料和 Beta runbook；不得跳过外部证据门禁。

## 5. 单一事实源

- 范围和验收：`01-requirements/`。
- 技术边界和已定决策：`02-architecture/` 与 ADR。
- 计划与执行状态：`03-roadmap/`、`04-tasks/`。
- 是否允许合并或发布：`05-quality/`、`06-security/`、`07-release/`。
- 历史结论和审查证据：`09-reviews/`。

当前阶段结论以 [Phase 6.5 实现审查](./09-reviews/phase-6.5-implementation-review-2026-08-14.md)、
[Tier 1/2 Live Smoke 审查](./09-reviews/live-site-smoke-review-2026-08-15.md)、
[Netflix 前景媒体归属审查](./09-reviews/netflix-foreground-media-ownership-review-2026-08-19.md)、
[iframe 生命周期与控制竞态审查](./09-reviews/iframe-lifecycle-control-race-fix-2026-08-20.md)、
[Phase 6.5 长稳态与 Legacy 隔离审查](./09-reviews/phase-6.5-churn-and-legacy-isolation-review-2026-08-22.md)、
[Phase 6.5 Firefox Headed UX 审查](./09-reviews/phase-6.5-firefox-headed-ux-review-2026-08-22.md)、
[UltraQA 场景矩阵](./09-reviews/ultraqa-scenario-matrix-2026-08-19.md)、
[体验差距审查](./09-reviews/ux-gap-review-2026-08-12.md) 和 [Phase 6 Exit Review](./09-reviews/phase-6-exit-review-2026-08-11.md)
共同为准：Phase 6 repository release-engineering baseline 继续有效，Phase 6.5 核心实现进入审查，但页面 UX 尚未 GO，
Phase 7 冻结，Stable 为 `NO-GO`。

当文档冲突时，优先级为：已接受 ADR > 已批准需求 > 路线图 > 任务描述 > 临时进度记录。冲突必须通过更新上位文档解决，不允许长期保留口头例外。
