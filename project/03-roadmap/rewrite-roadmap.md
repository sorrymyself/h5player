# Web Extension 重构路线图

> 文档 ID：ROADMAP-001  
> 状态：In Review / Phase 6.5 Implementation Review<br>
> 负责人：Project Owner  
> 最后更新：2026-08-14
> 估算方式：以退出条件为主，不以日期驱动；建议两周一个可演示增量。

## 总体路径

```text
Phase 0 基线与脚手架
  -> Phase 1 契约、存储、消息、安全边界
    -> Phase 2 媒体核心纵向切片
      -> Phase 3 配置/快捷键/Popup/Options
        -> Phase 4 画面、UI、截图、进度
          -> Phase 5 站点适配与兼容矩阵
            -> Phase 6 Beta、发布工程与稳定化
              -> Phase 6.5 体验补齐与交付级 UI
                -> Phase 7 实验能力与是否共享核心的决策
```

## 当前阶段状态

| 阶段      | 状态                             | 结论                                                                                                                                      |
| --------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0   | Completed                        | 独立工程基线与 Legacy 隔离已批准                                                                                                          |
| Phase 1   | Completed                        | typed protocol、storage、security boundary 已批准                                                                                         |
| Phase 2   | Completed                        | Tier 0 媒体核心与双浏览器真实扩展证据已批准                                                                                               |
| Phase 3   | Completed for Preview            | [Exit Review](../09-reviews/phase-3-exit-review-2026-08-11.md) 为 Conditional GO；可进入 Phase 4，不具备 Stable 资格                      |
| Phase 4   | Completed for Preview            | [Exit Review](../09-reviews/phase-4-exit-review-2026-08-11.md) 为 Conditional GO；可进入 Phase 5，不具备 Stable 资格                      |
| Phase 5   | Completed for Preview            | [Exit Review](../09-reviews/phase-5-exit-review-2026-08-11.md) 为 Conditional GO；fixture 范围可进入 Phase 6                              |
| Phase 6   | Conditional GO                   | [Exit Review](../09-reviews/phase-6-exit-review-2026-08-11.md)：发布工程基线完成；真实 Beta/Stable 外部证据未完成                         |
| Phase 6.5 | Implementation Review / UX NO-GO | [实现审查](../09-reviews/phase-6.5-implementation-review-2026-08-14.md)：核心代码与部分自动化已落地；headed/live/churn/用户 Exit 仍未闭环 |
| Phase 7   | HOLD                             | 实验能力与是否共享/重构 Legacy 的独立决策；依赖 Phase 6.5 Exit 和用户确认解除冻结                                                         |

## Phase 0：基线冻结与工程脚手架

目标：建立不触碰 Legacy 的独立开发闭环。

主要交付：

- 确认 ADR-0004 技术栈，创建 TS 严格模式、多入口 manifest profile。
- 建立 lint、format、typecheck、unit、build、extension E2E 命令。
- 建立固定测试页面：basic、multi-player、SPA、Shadow DOM、same/cross-origin iframe、property-reset。
- 记录 Legacy 核心行为快照、默认快捷键和允许差异。
- 建立 CI、artifact、依赖缓存和基础安全扫描。

退出条件：

- Chrome 与 Firefox dev 包可加载；至少一个空壳 popup、content、background 和 page-main E2E 通过。
- Legacy `yarn build` 仍可运行且产物行为不因新脚手架改变。
- 新代码无 JS 业务文件、无 `any` 漏洞基线、无循环依赖。
- `EXT-001`～`EXT-012` 全部 Verified。

## Phase 1：契约、消息、配置与安全边界

目标：先完成跨上下文基础设施，使后续功能不再绕过边界。

主要交付：

- 消息 Envelope、Schema、nonce 握手、请求超时、错误码。
- background settings repository、schemaVersion、迁移、备份和订阅。
- Browser Ports、structured logger、diagnostic redaction。
- 权限清单、manifest 最小权限和 CSP/远程执行禁止扫描。

退出条件：

- 页面伪造消息、错误 payload、重放、未知 type 被安全拒绝。
- 多 Tab 并发写不同配置字段不丢失；service worker 重启后状态恢复。
- manifest 不含 `webRequestBlocking`/全站 CSP 改写；产物扫描不含 `eval`/`new Function`。
- 配置从 N、N-1、损坏数据迁移/恢复测试通过。

## Phase 2：通用媒体核心 MVP

目标：在真实扩展中完成从媒体发现到命令执行的最小闭环。

范围：

- 媒体发现、生命周期、active player 评分。
- play/pause、seek、rate、volume/mute。
- 通用 adapter、命令注册表、快捷键只读默认映射。
- 当前页面连接状态和最小 popup 控制。
- Chrome 与 Firefox 的真实扩展 core smoke；Firefox 驱动由 Selenium Manager 在测试运行时治理。

退出条件：

- P0 核心命令在 basic/multi/SPA/Shadow/iframe fixtures 通过。
- 30 分钟 churn 测试无 listener/session 单调增长。
- 与 Legacy 的核心命令差分用例通过或差异已批准。
- Chrome/Firefox 核心 E2E 全绿。

Phase 2 的 Firefox 证据以当前自动化 Firefox 153.0 为基线；Firefox 最低版本 `142.0` 与 ESR
权限矩阵仍需在 Stable 前按兼容矩阵补齐，不得把单一版本结果扩写为全版本承诺。

## Phase 3：配置、快捷键与原生扩展 UI

目标：让用户可理解地管理扩展，而不是依赖油猴菜单模拟。

状态：**Completed for Preview / Conditional GO（2026-08-11）**。

范围：

- Popup 当前页面状态、常用命令和站点开关。
- Options 全局/站点设置、快捷键编辑、冲突校验、导入导出、恢复默认。
- 跨 Tab `storage.local` change event + revision 重拉、诊断脱敏导出；Preview 不启用跨设备 `storage.sync`。
- 全局页面/播放器聚焦快捷键模式。
- optional host onboarding、动态 isolated/MAIN registration、当前页 bootstrap 与撤权 teardown。

退出条件：

- [x] P0 配置/快捷键/UI 需求在 unit/component/integration 与 Chrome 真扩展主路径通过；Firefox 真扩展覆盖权限和媒体核心链路。
- [x] Popup/Options/ShortcutRecorder 的 axe 自动基线与键盘交互通过；完整 headed/manual WCAG 与视觉审查保留为 Beta 门禁。
- [x] 配置导入失败不会修改现有数据；V1/V2 读取、V2 导出、reset/backup/restore 可逆并有测试。
- [x] Popup 能解释无权限、受限页面、无媒体、站点/本页停用和 runtime 状态。
- [x] 生产 manifest 无 required host、静态 content scripts 和 WAR；Chrome grant/reject/revoke 与 Firefox grant/revoke 生命周期通过。

验证摘要：28 个 unit files / 93 tests、3 个 component files / 9 tests、7 个 integration files / 40 tests、
21 个 compatibility tests；Chrome 3 个 E2E 场景、Firefox 153.0 权限/媒体 E2E、5 秒 churn smoke、security scan、
dependency boundaries 和 Legacy hash 回归均通过。精确证据以 Phase 3 Exit Review 为准。

未纳入本阶段完成声明：Tier 1 真实站点、Firefox ESR/最低版本、Chrome previous stable、Edge、原生权限确认框 headed UX、
商店审核材料、完整 RC 长稳和 Stable Go/No-Go。

## Phase 4：高级通用能力与页面组件

目标：在不改动 Legacy 主线的前提下，完成 Web Extension 的高级通用能力、页面 Overlay、截图、进度与跨 Tab 工程基线。

范围：

- transform、filter、reset、web/native fullscreen、PiP。
- 页面 overlay 组件化、closed Shadow DOM 隔离、top-frame 挂载和站点禁用。
- 截图、进度保存/恢复、跨 Tab advisory event。
- raw/gzip bundle budget、生产 manifest guardrail、质量/安全/架构审查。

退出条件：

- [x] 视觉状态按媒体隔离，原子 reset、fullscreen/PiP capability 和错误降级通过单测、组件与 typed contract；
      native→web fallback、PiP unavailable 等专项浏览器 E2E 保留为 Phase 5/Beta 收敛项。
- [x] CORS/DRM、未就绪、尺寸、编码和下载失败给出 bounded typed error；不新增 downloads/clipboard 权限。
- [x] Overlay 使用 closed Shadow DOM、hostile CSS reset、event isolation、mount/teardown；仅 top frame 展示。
- [x] 进度具备匿名 identity、TTL、容量、隐私开关、5 秒节流和完成删除；跨 Tab 仅为 advisory event。
- [x] Chrome/Firefox 生产 bundle raw budget、manifest guardrail 和 CI 检查通过。
- [x] 全量静态/单测/组件/集成/兼容/安全/依赖边界、串行 Chromium E2E、Firefox E2E、churn smoke 和 Legacy hash 通过。

验证摘要（2026-08-11）：52 个测试文件 / 249 个测试；coverage statements 85.68%、branches 76.57%、functions
87.33%、lines 89.28%；Chrome E2E 3/3、5 秒 churn 94 cycles/1 次 worker restart/listeners 4→4；Firefox 153.0
E2E 与 web-ext lint 通过；Chrome/Firefox background/content/page-main raw 分别约 90.15/191.67/77.98 KiB，预算通过。

现有双浏览器 E2E 继续证明权限、动态注册、核心媒体命令与固定页面生命周期；它没有覆盖真实解码帧截图、CORS blocked
截图、native→web fullscreen fallback、PiP unavailable、progress restore/complete、multi-tab advisory event 或
iframe-only media Overlay，不能把单元/契约证据扩写为这些端侧场景已经完成。

Preview 明确限制：Overlay 不聚合 iframe-only media；capture artifact 经 base64 传输，4 MiB 二进制上限带来约 5.6 MiB
消息体风险；跨 Tab 不自动暂停/仲裁；未完成 Tier 1 真实站点、Firefox ESR/最低版本、Chrome previous stable、Edge、
headed 权限确认框、商店发布或 Stable 资格。

## Phase 5：站点适配与兼容性收敛

目标：把历史 TCC 中高价值站点逐个迁入可测试 Adapter。

范围：

- Tier 1 站点自动化保护。
- Tier 2 站点 fixture + 手工 smoke。
- adapter health、版本禁用、诊断命中信息。
- 站点问题模板和快速回退机制。

退出条件：

- [x] Tier 1 五站固定脱敏 fixture 自动化通过；真实站点 smoke 明确未执行。
- [x] Tier 2 五站有 owner、best-effort 等级、fixture 与验证日期；真实站点状态不外推。
- [x] 单个 adapter 的 attach/detach/action/selector 抛错不会影响 GenericAdapter。
- [x] 版本/功能 kill switch、运行时健康诊断、fixture SHA baseline 和兼容报告进入门禁。
- [x] 兼容矩阵无未解释 fixture 红项；live smoke 缺口明确保留为 Phase 6/Beta 门禁。

## Phase 6：Beta、发布工程与稳定化

目标：形成可安全分发、可灰度、可回滚的产品。

范围：

- Alpha/Beta/Stable profile、自动版本、zip、hash、SBOM、许可证报告。
- Chrome Web Store / Firefox AMO 审核资料和隐私说明。
- Beta 反馈、缺陷分级、发布候选回归、性能/安全审计。
- 发布、回滚和 incident runbook。

工程交付（2026-08-11）：

- [x] EXT-120：PR/nightly/RC workflow、固定 action SHA、冻结安装、缓存、Legacy baseline、双浏览器和 no-publish RC lane。
- [x] EXT-121：package.json 单一版本源、Dev/Alpha/Beta/RC/Stable profile、manifest 数字映射和默认 Dev 构建。
- [x] EXT-122：确定性 ZIP、checksums、release manifest、SPDX SBOM、许可证、测试/兼容报告和 unsigned provenance。
- [x] EXT-123：商店 listing、权限/隐私说明、截图计划与外部签字清单（实际 URL/账号/提交仍待外部完成）。
- [x] EXT-124：Beta opt-in、更新、forward-fix/rollback、incident runbook 与本地数据演练边界。
- [x] EXT-125：候选编排、gate schema、双次复现命令和 RC record 模板。
- [x] EXT-126：Stable Go/No-Go 模板与本阶段基于证据的 `NO-GO` 结论。
- [x] EXT-127：发布后复盘模板、指标边界和 Legacy 冻结决策输入。

外部退出条件（未完成前不得 Stable）：

- [ ] 两个连续真实 Beta 候选无 P0/P1 回归并完成观察窗口。
- [ ] Chrome Stable/previous、Firefox Stable/ESR/minimum、Edge（若宣称）真实矩阵通过。
- [ ] Tier 1 真实站点 smoke、headed 原生权限 UX、真实商店签字/提交和签名证据完成。
- [ ] 真实商店安装/升级/回滚或 forward-fix 演练通过。
- [ ] Stable Go/No-Go 记录批准。

## Phase 6.5：体验补齐与交付级媒体 UI（实现审查中）

目标：吸收 Legacy 已验证的低干扰、高反馈、少重复操作体验，在不复制旧实现的前提下，把 Web Extension 从“功能可用的技术 Preview”提升为可进入真实 Beta 验证的交付级产品。

当前状态：需求、架构和主要工程切片已实现并进入审查；在 headed/live/churn 和用户 Exit Review 完成前，不得把阶段标为
Completed、不得解除 Phase 7，也不得以 fixture 自动化替代交付级体验证据。

范围：

- 以稳定 `mediaId` 为中心建立 per-media anchor registry，页面 quick controls 跟随视频而不是跟随视口。
- 将默认大面板拆为低干扰 quick controls、二级 advanced menu 和独立 per-media feedback presenter。
- 建立 global/site/page/media 四层倍速作用域、用户意图写回和策略来源展示。
- 建立新媒体、重播、SPA 换集、`src` 变化和网站反向改值的 lifecycle coordinator。
- 统一快捷键、页面 UI、Popup 的 command result 与最终值反馈。
- 补齐多媒体、音频、Shadow DOM、iframe、触控、键盘、缩放和宿主控件避让。
- 建立 headed 视觉回归、真实扩展 E2E、30 分钟 churn 和 Tier 1 live smoke 证据。

明确非范围：

- 不修改 Legacy `src/h5player/`、`src/libs/`、根构建链或发行行为。
- 不进入媒体下载、MediaSource、声音增益、声明式自定义规则或共享核心抽取。
- 不把 Phase 4 全局 Overlay 继续扩展为更大的页面控制台。
- 不用修改宿主 CSP、inline style、closed Shadow DOM 或无限轮询解决定位/倍速保护问题。

退出条件：

- [ ] `REQ-UX-001/002`、`ARCH-UX-001`、`QUAL-UX-001` 经用户审核并进入 Approved 或带明确条件的可执行状态。
- [ ] `UX-ACC-001..015` 的 P0 全部 Verified，P1 无未接受的交付阻塞项。
- [ ] 默认页面不存在视口级大面板；控件和反馈与正确媒体绑定，滚动/resize/fullscreen/SPA 后归属正确。
- [ ] 用户设置一次倍速后，新媒体、重播、换集和 `src` 变化无需重复设置；网站反向改值有界处理且可解释。
- [ ] 快捷键、页面控件和 Popup 产生一致的最终值反馈；输入框、焦点、触控和多媒体目标无 P0 回归。
- [ ] Chromium/Firefox real-extension E2E、headed 视觉/焦点/遮挡、30 分钟 churn 和 Tier 1 live smoke 证据完成。
- [ ] EXT-128～139 全部 Verified，Phase 6.5 Exit Review 获用户确认；随后才可重新评估 Phase 7。

## Phase 7：实验能力与 Legacy 后续决策

目标：把高风险能力置于成熟基础之上，并决定是否影响油猴主线。

候选：

- 媒体下载/MediaSource、音频增益、声明式自定义规则。
- 可选遥测或兼容性健康信号（必须 opt-in）。
- 抽取通用 pure packages 给油猴脚本使用。

退出条件：

- 每项实验功能都有独立权限、风险、性能和合规 ADR。
- 扩展稳定运行数据足以评估共享核心收益与成本。
- 关于“是否重构油猴脚本”的新项目章程被明确批准或否决。

进入条件：Phase 6.5 Exit Review 已通过、`UX NO-GO` 已解除，并由用户明确批准重新启动 Phase 7；Phase 6 发布工程的历史 Conditional GO 不能单独满足此条件。

## 阶段控制规则

- 不允许为了追赶站点数量跳过 Phase 1 的消息、存储和权限边界。
- 一个阶段可提前实现后续 spike，但不能宣告后续功能完成。
- 每个阶段结束都必须在 `09-reviews/` 新增评审记录，并更新 backlog、progress、矩阵和风险。
- 若连续两个里程碑质量门禁未过，暂停新增功能，优先偿还架构和测试债。
- Phase 3 的 Conditional GO 只授权继续 Phase 4 工程开发；任何 Beta/Stable 或 Tier 1 对外承诺仍必须满足 Phase 5/6 门禁。
- Phase 4 的 Conditional GO 只授权继续 Phase 5 工程开发；不授权 Beta、Stable、Tier 1 支持、最低浏览器版本或商店发布声明。
- Phase 5 的 Conditional GO 只授权继续 Phase 6 发布工程；固定 fixture 不得扩写为 Tier 1 真实生产站点支持。
- Phase 6 的 Conditional GO 只确认 repository release-engineering baseline；不授权 Beta 分发、商店提交或 Stable 发布。
- Phase 6.5 是用户实测触发的强制体验补齐阶段；完成前不得启动 EXT-140～144，也不得抽取或改写 Legacy 共享核心。
- 只有 Phase 6 外部门禁和 Phase 6.5 UX 门禁均有可回链记录，Stable 才能从 `NO-GO` 变为 `GO`。
