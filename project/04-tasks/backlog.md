# Web Extension 重构主任务台账

> 文档 ID：TASK-003  
> 状态：Active / Phase 6.5 Implementation Review / Phase 7 HOLD<br>
> 负责人：Project Owner  
> 最后更新：2026-08-22
> 规则：任务状态以 `progress.md` 为当前摘要，本页保留完整规划。

优先级：P0 稳定版阻塞；P1 稳定版目标；P2 后续/实验。估算：S（≤1 日）、M（2～3 日）、L（4～7 日）、XL（需拆分）。

## EPIC-00：工程基线与脚手架（Phase 0）

| ID      | 任务                                            | 优先级 | 估算 | 依赖         | 验收摘要                       | 状态     |
| ------- | ----------------------------------------------- | ------ | ---- | ------------ | ------------------------------ | -------- |
| EXT-001 | 建立 `web-extension/src`、多入口和 profile 配置 | P0     | L    | —            | Chrome/Firefox dev 包可加载    | Verified |
| EXT-002 | TypeScript strict、路径别名、声明输出           | P0     | M    | EXT-001      | typecheck 通过，无业务 JS 新增 | Verified |
| EXT-003 | ESLint/Prettier/依赖边界/循环依赖检查           | P0     | M    | EXT-002      | CI 命令可执行并有失败样例      | Verified |
| EXT-004 | Vitest 基础配置与测试工具箱                     | P0     | M    | EXT-002      | unit 命令与覆盖率报告可生成    | Verified |
| EXT-005 | Playwright 扩展加载 smoke                       | P0     | L    | EXT-001      | Chrome 真包可安装并打开 popup  | Verified |
| EXT-006 | Firefox 扩展加载 spike                          | P0     | M    | EXT-001      | 记录可行性/阻塞和替代方案      | Verified |
| EXT-007 | 固定测试页 basic/multi-player                   | P0     | M    | EXT-005      | 页面可稳定复现媒体元素         | Verified |
| EXT-008 | 固定测试页 SPA/Shadow/iframe                    | P0     | L    | EXT-007      | 生命周期场景可自动驱动         | Verified |
| EXT-009 | Legacy 行为快照与允许差异清单                   | P0     | L    | EXT-007      | 核心命令快照可重放             | Verified |
| EXT-010 | 新旧构建互不影响的 CI job                       | P0     | M    | EXT-001      | Legacy build 与新 build 同时绿 | Verified |
| EXT-011 | 版本、产物目录和 source map 规范                | P0     | S    | EXT-001      | 产物命名和 metadata 固定       | Verified |
| EXT-012 | Phase 0 基线审查                                | P0     | M    | EXT-001..011 | 评审记录 Approved              | Verified |

## EPIC-01：消息、存储与安全基础（Phase 1）

| ID      | 任务                                       | 优先级 | 估算 | 依赖             | 验收摘要                   | 状态     |
| ------- | ------------------------------------------ | ------ | ---- | ---------------- | -------------------------- | -------- |
| EXT-020 | 定义 Message Envelope 与错误码             | P0     | M    | EXT-002          | 类型与 Schema 一致         | Verified |
| EXT-021 | 实现 nonce 握手与 frame/session 校验       | P0     | L    | EXT-020          | 伪造/重放消息被拒绝        | Verified |
| EXT-022 | 实现 request/response、超时、取消和重连    | P0     | L    | EXT-020          | worker 重启可恢复握手      | Verified |
| EXT-023 | 建立 Browser Ports（runtime/tabs/storage） | P0     | L    | EXT-020          | domain 无浏览器导入        | Verified |
| EXT-024 | 定义 Settings Schema 与命名空间            | P0     | M    | EXT-002          | 默认值/边界/未知字段有测试 | Verified |
| EXT-025 | 实现 SettingsRepository 与并发策略         | P0     | L    | EXT-023,EXT-024  | 多 Tab 更新不丢字段        | Verified |
| EXT-026 | 实现 schema migration、backup、rollback    | P0     | L    | EXT-025          | N/N-1/损坏数据测试通过     | Verified |
| EXT-027 | 实现导入/导出格式 v1 与脱敏                | P0     | M    | EXT-024,EXT-026  | 非法导入保持原状态         | Verified |
| EXT-028 | 生成最小权限 manifest profiles             | P0     | L    | EXT-001,ADR-0005 | 无未证明高危权限           | Verified |
| EXT-029 | 删除 CSP/unsafe-eval/任意执行路径          | P0     | M    | EXT-028          | 静态禁止扫描通过           | Verified |
| EXT-030 | structured logger 与 redaction             | P0     | M    | EXT-020          | 日志不含敏感字段           | Verified |
| EXT-031 | 消息攻击与权限边界测试                     | P0     | L    | EXT-021,EXT-028  | 安全测试全绿               | Verified |
| EXT-032 | Phase 1 架构/安全审查                      | P0     | M    | EXT-020..031     | 评审记录 Approved          | Verified |

## EPIC-02：通用媒体核心（Phase 2）

| ID      | 任务                               | 优先级 | 估算 | 依赖                    | 验收摘要                                               | 状态     |
| ------- | ---------------------------------- | ------ | ---- | ----------------------- | ------------------------------------------------------ | -------- |
| EXT-040 | MediaSession/Capabilities 领域模型 | P0     | M    | EXT-002                 | 不变量和序列化测试                                     | Verified |
| EXT-041 | DOM media discovery 与 teardown    | P0     | L    | EXT-023,EXT-040         | 动态媒体生命周期正确                                   | Verified |
| EXT-042 | active player 评分与切换           | P0     | L    | EXT-041                 | 多媒体选择矩阵通过                                     | Verified |
| EXT-043 | GenericAdapter                     | P0     | M    | EXT-040,EXT-041         | 无站点配置也能控制                                     | Verified |
| EXT-044 | Command Registry 与错误处理        | P0     | L    | EXT-040,EXT-043         | 命令输入输出可预测                                     | Verified |
| EXT-045 | play/pause/seek 命令               | P0     | M    | EXT-044                 | basic E2E 通过                                         | Verified |
| EXT-046 | rate/volume/mute 命令              | P0     | M    | EXT-044                 | 范围、锁定和降级通过                                   | Verified |
| EXT-047 | 页面运行时组装与幂等初始化         | P0     | L    | EXT-041..046            | 重复注入不重复监听                                     | Verified |
| EXT-048 | 核心媒体快照消息                   | P0     | M    | EXT-020,EXT-047         | popup 可读状态                                         | Verified |
| EXT-049 | 核心差分测试                       | P0     | L    | EXT-009,EXT-045,EXT-046 | 允许差异已登记                                         | Verified |
| EXT-050 | Phase 2 稳定性/性能审查            | P0     | M    | EXT-040..049            | 30 分钟 churn 通过                                     | Verified |
| EXT-051 | Firefox 真扩展 core E2E 与驱动治理 | P0     | M    | EXT-040..049            | Firefox 153 临时安装、核心命令和 Selenium Manager 通过 | Verified |

## EPIC-03：设置、快捷键和扩展 UI（Phase 3）

| ID      | 任务                      | 优先级 | 估算 | 依赖                    | 验收摘要                                                                                               | 状态     |
| ------- | ------------------------- | ------ | ---- | ----------------------- | ------------------------------------------------------------------------------------------------------ | -------- |
| EXT-060 | Hotkey domain/interpreter | P0     | L    | EXT-044,EXT-024         | 冲突、输入框、焦点、repeat 规则及 domain/controller 测试通过                                           | Verified |
| EXT-061 | Popup view model 与状态页 | P0     | M    | EXT-048,EXT-060         | 真扩展 Popup 状态、命令、权限和 worker restart E2E 通过                                                | Verified |
| EXT-062 | Options 路由与配置表单    | P0     | L    | EXT-025,EXT-027         | 六个 Options 页面、保存、错误和 live reload 通过                                                       | Verified |
| EXT-063 | 快捷键编辑器与冲突提示    | P0     | M    | EXT-060,EXT-062         | recorder、冲突、保留快捷键和键盘操作组件测试通过                                                       | Verified |
| EXT-064 | 站点规则与临时停用        | P0     | M    | EXT-025,EXT-061         | Chrome grant/reject/revoke；Firefox origin grant/revoke；双端动态注册、临时/永久停用 E2E/contract 通过 | Verified |
| EXT-065 | 配置导入导出/恢复 UI      | P0     | M    | EXT-027,EXT-062         | Schema 预览、导出 Blob 生命周期、reset/backup/restore 测试通过                                         | Verified |
| EXT-066 | 诊断摘要与脱敏导出        | P0     | M    | EXT-030,EXT-061,EXT-062 | bounded summary、hostname 脱敏和 Options 诊断页测试通过                                                | Verified |
| EXT-067 | i18n zh-CN/en-US          | P0     | M    | EXT-061,EXT-062         | 双 catalog 完整性、参数格式化和页面文案测试通过                                                        | Verified |
| EXT-068 | A11y/组件测试             | P0     | M    | EXT-061..067            | Popup/Options/Recorder axe 与键盘组件测试通过                                                          | Verified |
| EXT-069 | Phase 3 产品/UX/安全审查  | P0     | M    | EXT-060..068            | Phase 3 Exit Review 记录 Preview 条件 GO 与剩余风险                                                    | Verified |

### Phase 3 交付证据（2026-08-11）

- 单元：28 files / 93 tests；组件：3 files / 9 tests；集成：7 files / 40 tests。
- Chrome：3 个真实扩展场景通过；默认 churn 场景按未配置时长跳过，独立 5 秒 smoke 为 82 cycles、1 次 worker restart、listeners 4→4。
- Firefox：Firefox 153.0 临时安装 MV3；真实 optional origin、activeTab、动态注册、媒体命令和撤权链路通过。
- 安全：静态扫描 120 files + 2 manifests；security tests 3 passed；依赖边界 105 modules / 330 dependencies 无违规。
- Legacy：`pnpm test:legacy` SHA-256 与冻结基线一致；Legacy 源码和根构建链不在本阶段重构范围。
- 受限项：headless 无法直接操作原生扩展权限确认框，见 [Phase 3 Exit Review](../09-reviews/phase-3-exit-review-2026-08-11.md) 的 harness 边界说明；Firefox ESR/最低版本和真实站点 Tier 1 仍是后续门槛。

## EPIC-04：高级通用能力（Phase 4）

| ID      | 任务                                 | 优先级 | 估算 | 依赖            | 验收摘要                    | 状态     |
| ------- | ------------------------------------ | ------ | ---- | --------------- | --------------------------- | -------- |
| EXT-080 | transform/filter domain 与命令       | P1     | L    | EXT-044,EXT-047 | 状态隔离/重置通过           | Verified |
| EXT-081 | Fullscreen/PiP capability adapters   | P1     | L    | EXT-043,EXT-044 | capability/错误降级契约通过 | Verified |
| EXT-082 | Overlay shell 与 Shadow DOM 样式隔离 | P1     | L    | EXT-061,EXT-067 | 不污染页面                  | Verified |
| EXT-083 | Screenshot/capture service           | P1     | M    | EXT-023,EXT-044 | CORS/DRM 错误可解释         | Verified |
| EXT-084 | Progress repository 与恢复策略       | P1     | M    | EXT-025,EXT-040 | 过期/容量/隐私测试          | Verified |
| EXT-085 | Cross-tab event service              | P1     | M    | EXT-022,EXT-025 | 不依赖高频轮询              | Verified |
| EXT-086 | Bundle/performance budgets           | P0     | M    | EXT-080..085    | CI 超预算失败               | Verified |
| EXT-087 | Phase 4 视觉/性能审查                | P1     | M    | EXT-080..086    | 评审记录 Conditional GO     | Verified |

### Phase 4 交付证据（2026-08-11）

- EXT-080/081：visual domain、原子 reset、native/web fullscreen、PiP、inline style restore；unit/component/typed contract 已通过，专项浏览器 E2E 缺口单独登记。
- EXT-082：top-frame closed ShadowRoot Overlay、hostile CSS reset、事件隔离、动态 mount/teardown；component + Chrome lifecycle fixtures。
- EXT-083：Canvas capture、bounded artifact、CORS/DRM/ready/size/encode failure、临时 Blob 下载；unit + contract/security checks；Preview 禁用媒体下载。
- EXT-084：匿名 identity hash、TTL、容量、隐私开关、5 秒节流、短媒体完成删除、恢复/清理；domain、repository 与 content-runtime integration。
- EXT-085：三类 advisory event、source-tab 过滤、timestamp clamp、发送失败隔离；cross-tab unit + background contract。
- EXT-086：Chrome/Firefox raw budget：background 150 KiB、content 250 KiB、page-main 200 KiB；manifest 无 required host/static content/WAR；CI budget script 通过。
- 质量证据：52 files / 249 tests；coverage 85.68/76.57/87.33/89.28；check、build、budget、security、boundaries、串行 Chromium E2E、Firefox 153 E2E、5 秒 churn 和 Legacy hash 全部通过。
- 运行约束：扩展 E2E 固定 `workers: 1`，避免多个 persistent Chromium profile 并行启动导致资源争抢和超时；这不是产品功能限制。
- 端侧缺口：真实解码帧/CORS blocked 截图、native→web fullscreen fallback、PiP unavailable、progress restore/complete、multi-tab advisory event、iframe-only media Overlay 均未由当前 Chrome/Firefox E2E 覆盖。

## EPIC-05：站点适配与兼容（Phase 5）

| ID      | 任务                            | 优先级 | 估算 | 依赖            | 验收摘要               | 状态                 |
| ------- | ------------------------------- | ------ | ---- | --------------- | ---------------------- | -------------------- |
| EXT-100 | Adapter registry/match/priority | P0     | M    | EXT-043         | 冲突优先级可预测       | Verified             |
| EXT-101 | Tier 1 YouTube adapter          | P1     | M    | EXT-100,EXT-081 | fixture + smoke        | Verified for fixture |
| EXT-102 | Tier 1 Bilibili adapter         | P1     | L    | EXT-100,EXT-081 | fixture + smoke        | Verified for fixture |
| EXT-103 | Tier 1 Tencent adapter          | P1     | M    | EXT-100         | fixture + smoke        | Verified for fixture |
| EXT-104 | Tier 1 iQIYI/Youku adapters     | P1     | L    | EXT-100         | fixture + smoke        | Verified for fixture |
| EXT-105 | Tier 2 adapter batch            | P1     | XL   | EXT-100         | 每站点有 owner/fixture | Verified for fixture |
| EXT-106 | Adapter failure isolation       | P0     | M    | EXT-100..105    | 单适配器故障隔离       | Verified             |
| EXT-107 | Compatibility matrix automation | P0     | L    | EXT-101..106    | 生成报告/趋势          | Verified             |
| EXT-108 | Phase 5 compatibility review    | P1     | M    | EXT-100..107    | Tier 门槛通过          | Verified             |

### Phase 5 交付证据（2026-08-11）

- `MediaAdapterRegistry` 复用现有 `MediaAdapter<HTMLMediaElement>` 契约，priority 降序 + id 稳定排序，Generic 永远兜底。
- Tier 1 五站、Tier 2 五站均有脱敏 fixture；catalog 记录 owner/version/tier/support/lastVerified/features/matches。
- attach/detach/action/selector failure injection、SPA rematch、version/feature disable 和 typed diagnostics 通过。
- `test:compat:report` 校验 catalog、fixture、Tier、version、support level、owner、lastVerified、SHA-256 baseline 与 183 天复核时效；
  Phase 5 退出时真实站点 smoke 尚未验证；Phase 6.5 fresh evidence 见 EXT-138 与 live smoke 审查。

## EPIC-06：Beta 与 Stable 发布（Phase 6）

| ID      | 任务                                | 优先级 | 估算 | 依赖                    | 验收摘要                                              | 状态                                                |
| ------- | ----------------------------------- | ------ | ---- | ----------------------- | ----------------------------------------------------- | --------------------------------------------------- |
| EXT-120 | CI required checks 与缓存           | P0     | M    | EXT-003..005            | PR/nightly/RC workflow 可验证；分支保护外部配置待确认 | Engineering verified / external enforcement pending |
| EXT-121 | Chrome/Firefox release profiles     | P0     | L    | EXT-028,EXT-011         | 单一版本源、profile、manifest 映射和双端产物          | Verified                                            |
| EXT-122 | hash/SBOM/license/provenance        | P0     | M    | EXT-121                 | 9 文件 evidence bundle、inspection、复现              | Verified                                            |
| EXT-123 | Store listing/privacy/security docs | P0     | L    | EXT-028,EXT-030         | 文案/权限/隐私包完成；URL、截图、商店签字待外部       | Engineering complete / store sign-off pending       |
| EXT-124 | Beta opt-in/update/rollback         | P0     | L    | EXT-121                 | runbook、Schema/backup 演练；真实商店 rollback 待外部 | Engineering complete / drill pending                |
| EXT-125 | release candidate regression        | P0     | L    | EXT-050,EXT-069,EXT-108 | gate 编排和双次复现完成；两轮真实 Beta RC 待证据      | Automation verified / external evidence pending     |
| EXT-126 | Stable Go/No-Go review              | P0     | M    | EXT-120..125            | 记录已建立；当前 Stable `NO-GO`                       | Reviewed / NO-GO                                    |
| EXT-127 | Post-release review                 | P1     | M    | EXT-126                 | 模板和指标边界完成；真实发布后复盘待执行              | Template ready / post-release pending               |

## EPIC-06.5：体验补齐与交付级媒体 UI（Phase 6.5）

本 Epic 由 2026-08-12 用户实测触发，需求、架构和主要工程切片已进入实现审查。当前状态表示“代码与自动化已有证据，但交付级
验收尚未闭环”，不能把 `In Review` 等同于 `Verified`。Phase 7、Stable 与 Legacy 重构决策均继续冻结。

| ID      | 任务                                            | 优先级 | 估算 | 依赖                             | 当前实现/证据摘要                                                                                                                                                                                                                    | 状态                                                      |
| ------- | ----------------------------------------------- | ------ | ---- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| EXT-128 | MediaAnchorRegistry 与 per-media host 生命周期  | P0     | L    | EXT-041,EXT-042,ADR-0009/0015    | registry、唯一 host、scroll/resize/replacement/removal E2E 与 Firefox headed baseline/scroll/resize `0` 距离通过；30 分钟 churn 通过，完整 fullscreen 证据待补                                                                       | In Review / engineering implemented, acceptance partial   |
| EXT-129 | 低干扰 MediaQuickControls 与显隐/避让策略       | P0     | L    | EXT-128,EXT-082                  | closed-root controls、暂停收起、trigger/hitbox 与隐藏路径已有 component/E2E；Firefox headed hover、扩展 hitbox、播放自动隐藏和暂停收起通过，真实站点遮挡/字幕/原生控件待补                                                          | In Review / engineering implemented, acceptance partial   |
| EXT-130 | typed MediaFeedbackEvent 与 per-media presenter | P0     | M    | EXT-044,EXT-128                  | 最终值、replace/expiry、aria-live、audio fallback 已有自动化；Firefox headed `KeyC 1→1.1×` 与 expiry 通过，真实安全区和低扰动 p95 时延仍待补                                                                                          | In Review / engineering implemented, acceptance partial   |
| EXT-131 | PlaybackPolicyResolver 与作用域/写回模型        | P0     | L    | EXT-024..026,EXT-064,ADR-0016    | global/site/page/media 优先级、source、保护、站点持久化与临时 scope isolation 已有 unit/integration/component                                                                                                                        | In Review / engineering implemented, acceptance partial   |
| EXT-132 | PlaybackLifecycleCoordinator                    | P0     | L    | EXT-041,EXT-046,EXT-131,ADR-0016 | 新媒体、重播、source/duration generation、reset 保护、有界重试、teardown/race 单测已落地；真实换集/live smoke 待补                                                                                                                   | In Review / engineering implemented, acceptance partial   |
| EXT-133 | 快捷键、Overlay、Popup command/feedback 统一    | P0     | M    | EXT-060,EXT-061,EXT-129,130      | content command 统一产出 typed feedback；editable 与 scope contract 已覆盖，Firefox headed 快捷键最终值通过；Popup/Overlay 跨入口 headed 最终值仍待补                                                                               | In Review / engineering implemented, acceptance partial   |
| EXT-134 | Popup/Options 倍速作用域、来源与保护状态        | P0     | M    | EXT-062,EXT-131                  | Popup 展示 effective source/protection 与 scope；Options 提供 global/site rate 和继承恢复；可用性实测待补                                                                                                                            | In Review / engineering implemented, acceptance partial   |
| EXT-135 | 多媒体、音频、Shadow DOM 与 frame 降级          | P0     | L    | EXT-128..132,EXT-042             | eligibility、audio fallback、iframe-only registry 与同/跨源状态继承已有 E2E；Firefox headed iframe remove/restore 通过，真实站点/人工降级证据待补                                                                                   | In Review / engineering implemented, acceptance partial   |
| EXT-136 | 触控、键盘、a11y、i18n 与宿主 UI 共存           | P1     | M    | EXT-129,EXT-130,EXT-067/068      | component 覆盖 click/touch、Escape/Tab、i18n、aria-live；Firefox headed 基础 pointer/键盘通过，200% zoom、reduced-motion、主题、字幕和宿主控件共存待补                                                                                | In Review / headed fixture evidence partial               |
| EXT-137 | 自动化 fixture、real-extension E2E 与 churn     | P0     | XL   | EXT-128..135,EXT-005/008         | fresh 全量门禁、双端 build/budget、增强诊断 30 分钟 churn 均通过；Firefox 153 headed fixture 覆盖锚定、显隐、快捷键反馈、暂停和 iframe restore；真实站点与原生权限 UX 仍待补                                                        | In Review / engineering evidence passed, exit pending     |
| EXT-138 | Headed 视觉、焦点、触控和 Tier 1/2 live smoke   | P0     | L    | EXT-129..137,EXT-101..104        | Chromium Tier 1/Netflix/Tencent/Dailymotion 证据与 Firefox headed fixture 已建立；Dailymotion 几何仍 `probe-limited`，其它真实 pointer/宿主共存、Sohu/TED、Ixigua、Firefox live-site 与场景扩展仍待补                       | In Review / external UX evidence partial                  |
| EXT-139 | Phase 6.5 产品/UX/架构/质量 Exit Review         | P0     | M    | EXT-128..138                     | 已建立实现审查记录；UX-ACC、剩余风险、用户签字和 Phase 7 解冻条件尚未通过                                                                                                                                                            | HOLD / Exit Review pending                                |
| EXT-145 | MAIN world MediaControlAuthority                | P0     | L    | EXT-041,046,132,ADR-0017         | per-instance binding；rate/volume/muted 持续保护；currentTime 短租约；custom accessor；descriptor-safe teardown；bounded diagnostics；hostile fixture/unit 已通过                                                                    | In Review / engineering implemented                       |
| EXT-146 | Authority typed protocol 与 runtime 接入        | P0     | L    | EXT-145,ADR-0002/0006            | content 下发 resolved protect policy；page-main attach/detach/command commit；routed frame 生命周期；停用/撤权/reload fail-closed；跨 frame 迁移集成已通过                                                                           | In Review / engineering implemented                       |
| EXT-147 | Hostile reset 与腾讯切片/换集稳定性验收         | P0     | L    | EXT-137/138,EXT-145/146          | setter/轮询与延迟 reset fixture、route-first 首键、切片/reload staged intent 继承、旧 frame 过时响应恢复、登录态 720P native/fake 跨帧仲裁、3 秒稳定采样与快捷键证据已通过；广告、更多登录态和可重复 active fake-video 样本待补 | In Review / Tencent acceptance evidence passed            |
| EXT-148 | MV3 context/BFCache 错误收敛与重载清理          | P0     | M    | EXT-137,EXT-146                  | content/background 消费 disconnect lastError；精确 invalidation rejection boundary；250ms fail-closed probe；BFCache/错误面板/unpacked reload E2E；`0.1.2.10000` 双端构建通过                                                        | Verified                                                  |
| EXT-149 | Legacy 快捷键与媒体命令能力对齐                 | P0     | L    | EXT-044,EXT-060,EXT-080..084     | 播放/进度/音量/倍速、全屏/PiP、截图、变换/滤镜、30 FPS 逐帧、下一集、`Z` 记忆和数字键叠加均有 typed command 与回归测试                                                                                                               | Verified                                                  |
| EXT-150 | 本站进度恢复快捷切换与反馈                      | P0     | M    | EXT-084,EXT-130,EXT-133          | `Shift+R` 通过受限 background 协议原子修改当前站点，开启后立即恢复当前媒体，成功/失败均反馈                                                                                                                                          | Verified                                                  |
| EXT-151 | Legacy 站点原生控制语义补齐                     | P1     | M    | EXT-100..108,EXT-149             | adapter 独立 seek/rate capability；Netflix rate 原生菜单优先、缺失时 captured setter 回退，seek 无控件显式降级；fixture/baseline 与 headed 前景 owner 通过                                                                           | Verified for fixture / conditional live                   |
| EXT-152 | 页级状态 mutation 顺序与 iframe 一致性          | P0     | M    | EXT-064,EXT-135,EXT-148          | hidden/temporary 目标状态在 top-frame 请求前进入 tab cache，失败回滚；20 次 Chrome 重复回归无状态回放                                                                                                                                | Verified                                                  |
| EXT-153 | Legacy 实验下载与 MSE 捕获能力对齐              | P1     | L    | EXT-149,FR-MEDIA-004             | `Shift+D`、global/site `download.enabled`、同源/短跨域直链、MSE 分轨、queued endOfStream、错误终态、预算、取消/清理、trusted hotkey、非阻塞确认和文件名编辑已实现                                                                    | In Review / engineering implemented                       |
| EXT-154 | 实验捕获授权与最终下载 sink 安全拆分            | P0     | L    | EXT-153,ADR-0002,SEC-001         | 实验管理器不挂载到 `window`；MAIN 仅负责 bounded capture/prepare；isolated content 按真实设置和用户 intent 执行最终 anchor/fetch sink；hostile-page 与 live-site 证据待补                                                            | In Review / boundary implemented, acceptance pending      |
| EXT-155 | 音频增益可选模块                                | P2     | M    | EXT-129,EXT-149                  | Web Audio 延迟建图、1×～6×、global/site 策略与 capability 门控已实现；建图/增益失败会释放图、回滚 `1×`、移除 capability 并拒绝命令；站点音频链路、跨域媒体和 headed 体验待补                                                         | In Review / engineering implemented, acceptance pending   |
| EXT-156 | 鼠标长按临时加速与 autoplay coordinator         | P2     | M    | EXT-129,EXT-132                  | 左键长按临时 3×/释放恢复、pointerup/异步 play-pause 状态保护、控制栏排除与时长校验已实现；autoplay 已改为顶层可见媒体 + adapter 声明式站点按钮，目前仅 Bilibili 启用；基础 headed 按钮单击/播放保持已通过，登录态/触控/广告/换集待补 | In Review / engineering implemented, acceptance pending   |
| EXT-157 | PiP 跨 Tab 控制权与远程快捷键                   | P2     | L    | EXT-081,EXT-149                  | background owner lease、heartbeat/grace、generation、精确 tab/frame 路由和远程命令 allowlist 已实现；headed PiP、跨浏览器与重启场景待补                                                                                              | In Review / engineering implemented, acceptance pending   |

### Phase 6.5 当前实现证据（更新至 2026-08-22）

- Anchor/UI：`media-anchor-registry.ts`、`MediaQuickControls.vue`、`media-anchor-registry.spec.ts`、
  `media-quick-controls.spec.ts` 与 Chromium anchor/obscured E2E。
- Feedback：`application/feedback/*`、`MediaFeedbackPresenter.vue`、unit/component tests 与 audio-only page fallback E2E。
- Policy/Lifecycle：`domain/playback/*`、`PlaybackLifecycleCoordinator`、policy/lifecycle/eligibility unit 与 content/background contract tests。
- Control authority：ADR-0017 冻结的 per-instance MAIN world 仲裁、持续 rate/volume、短租约 currentTime、typed configure/commit 与 fail-closed teardown 已实现；EXT-145～147 进入审查和扩展站点取证。
- Runtime lifecycle：EXT-148 已验证 BFCache message-port 断连不会产生 unchecked `runtime.lastError`，扩展 context 失效不会留下旧 UI 或未处理 Promise rejection，新 unpacked 实例可重新注册并恢复。
- Legacy parity：EXT-149～151 已把 Legacy 的主要键盘命令面、逐帧/下一集/视觉细节、截图 artifact、本站进度恢复切换和 Netflix 原生控制语义迁入 typed domain；rate 原生菜单缺失时回退 captured setter，seek 无控件显式降级；不复制 Legacy 全局副作用。
- Frame/runtime：`FrameRuntimeRegistry`、iframe-only ownership、late same/cross-origin state inheritance、settings fail-closed
  reconnect 自愈、按 tab/有效媒体 report 恢复与 worker-restart 重复回归。
- Route-first/runtime：顶层媒体缓存为空但 child frame 已可路由时，第一次快捷键直接异步解析并执行；命令 setter 假成功而最终 snapshot 未命中时显式失败；腾讯旧 frame 响应过时后可在新实例恢复 staged intent。
- State ordering：EXT-152 修复 top frame mutation 上报与后台旧缓存回包之间的竞态；临时停用和页面 UI 隐藏均先登记目标状态，请求失败恢复旧值。
- Experimental parity：EXT-153 已实现 Legacy 实验总开关直接覆盖的下载/MSE 能力及 global/site 独立下载开关；默认关闭时不安装 Hook，关闭/切源/错误/超时可回收。EXT-154 的实验端口与最终 sink 边界已落地，剩余为 hostile-page、真实站点和 headed 下载验收。
- Advanced parity：EXT-155～157 的音频增益、鼠标长按/autoplay 与 PiP 跨 Tab lease 已进入工程实现；在 live/headed 证据补齐前保持 `Acceptance pending`，不升级为 Stable。
- Firefox headed fixture：Firefox 153 production MV3 临时安装已覆盖 anchor scroll/resize、pointer hitbox、播放自动隐藏、快捷键最终值、feedback expiry、暂停收起和 iframe restore；只计 fixture 证据，不计 live-site 通过。
- 高级能力差距审查（2026-08-19）确认并修正：autoplay 已由通用 `media.play` 收窄为 adapter 声明的站点按钮动作，未声明站点不执行且 iframe 禁用；音频增益建图失败已动态降级 capability；Legacy `allowCrossOriginControl` 的 Web 替代为 host/frame 授权和精确 frame owner，不隐式扩大权限。
- 当前缺口：Tencent 宿主避让与登录态/广告态/换集共存、iQIYI/Youku 真实 pointer/浮层共存、Sohu/TED 安全区与 reload 外跳、Ixigua 可复现 Web 播放器、Firefox 真实站点/权限 UI、native fullscreen、200%/theme/reduced-motion/字幕与原生控件共存、换集/广告/登录态和用户 Exit Review。增强诊断 30 分钟 churn 与 Firefox fixture 基线已通过；Netflix active/background 筛选已关闭。

### Phase 6.5 fresh live evidence

- Tier 1 Run `2026-08-14T23-25-32-569Z`：YouTube、Bilibili、Tencent Video、iQIYI、Youku；5 个 report outcome=`passed`。Tencent 专项 Run `2026-08-16-tencent-shadow-anchor-hitbox-10004` 已证明初始与 reload/WASM 顶层透明边缘 hover、真实播放表面锚定和双模式倍速控制；Run `2026-08-16-tencent-stale-frame-fix` 进一步证明切片后新实例继承 `1.5x`、快捷键到 `2x` 后抵抗站点轮询、反馈归属正确、reload 后继续继承 `1.5x`，`outcome=passed`、`violations=[]`。原生控件/字幕/弹幕 collision warning 仍保留，iQIYI/Youku 结论不变。
- Tier 2 Run `2026-08-14T23-50-00-000Z`：Netflix、AcFun、Sohu Video、TED；Playwright `4 passed`，report 为 3 个 `passed` + TED `blocked`，不能按进程绿灯覆盖 report outcome。
- 覆盖性 Run `2026-08-19-netflix-foreground-owner-final`：Netflix 背景 opacity `0.25` 实例无 Host/Trigger，前景 opacity `1` 实例独占 UI，快捷键/Popup/reload 继承通过，`warnings=[]`、`violations=[]`。Run `2026-08-19-tier1-foreground-fix-final` 的五个 Tier 1 strict smoke 全部通过并保留站点 warning。
- Targeted Run `2026-08-20-phase65-budget-final`：Tencent 与 Dailymotion 均为 `outcome=passed`、`violations=[]`。Tencent 换集后继承 `1.5x`、首次/延迟快捷键、3 秒轮询稳定性与 reload 继承通过；Dailymotion 跨域实例首次快捷键、Popup `1.5x` 和 reload 继承通过，closed ShadowRoot 只保留 `probe-limited` 几何 warning。
- Firefox fixture Run `2026-08-22`：Firefox `153.0` headed production MV3 的锚定、显隐、扩大 hitbox、快捷键/feedback、暂停和 iframe restore 通过；该 Run 不属于 live-site smoke，不改变外部 UX 判定。
- Ixigua Run `2026-08-15T00-05-00-000Z`：公开桌面/移动入口 HTTP 200 但无 `<video>`，strict `no-media` 失败和 App-only 截图已归档；不计兼容通过。

## EPIC-07：实验能力与后续决策（Phase 7）

| ID      | 任务                                 | 优先级 | 估算 | 依赖            | 验收摘要                                                       | 状态                                |
| ------- | ------------------------------------ | ------ | ---- | --------------- | -------------------------------------------------------------- | ----------------------------------- |
| EXT-140 | 下载/MediaSource threat & perf spike | P2     | L    | EXT-126,EXT-139 | 工程 spike 已由 EXT-153 提前完成；正式授权/sink 架构转 EXT-154 | Superseded by EXT-153/154           |
| EXT-141 | 声音增益可选模块                     | P2     | M    | EXT-126,EXT-139 | 工程实现已完成；权限/性能与真实站点审查待补                    | In Review / engineering implemented |
| EXT-142 | 声明式自定义规则 Schema              | P2     | L    | EXT-126,EXT-139 | 不执行任意代码                                                 | Proposed                            |
| EXT-143 | 共享核心成本收益评估                 | P2     | M    | EXT-127,EXT-139 | 数据化 ADR                                                     | Proposed                            |
| EXT-144 | 油猴脚本后续项目决策                 | P2     | S    | EXT-143         | 新章程或明确关闭                                               | Proposed                            |

EXT-140 已由 EXT-153/154 吸收；EXT-142～144 保持正式任务状态 `Proposed`，而 EXT-141 与 EXT-155～157 已提前完成工程实现。整个 Phase 7 当前为 `HOLD`；EXT-139 和用户明确解冻前不得进入 `Ready`。
