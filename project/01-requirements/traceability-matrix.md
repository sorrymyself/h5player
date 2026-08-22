# 功能需求追踪矩阵

> 文档 ID：REQ-004  
> 状态：In Review / Phase 6.5 Implementation Evidence Update<br>
> 负责人：Product Owner / Quality Owner  
> 最后更新：2026-08-16
> 维护规则：任务进入 Ready 前确认映射；Verified 后把“证据”替换为具体测试/CI/评审链接。

## 1. 启动、发现与会话

| 需求           | 模块                                    | 任务                                        | 自动化证据                                                                                                                                 | Phase   | 当前证据状态                                            |
| -------------- | --------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ------------------------------------------------------- |
| FR-BOOT-001    | runtime/content, page-main, site access | EXT-021, EXT-047, EXT-064                   | `page-runtime.spec.ts`；生产 manifest 静态 scripts 为空；Chrome/Firefox optional grant→register→bootstrap/navigation E2E                   | 1/2/3   | Verified                                                |
| FR-BOOT-002    | infrastructure/dom, domain/media        | EXT-041                                     | `media-discovery.spec.ts` 动态插入/移除、SPA teardown；Chrome churn                                                                        | 2       | Verified                                                |
| FR-BOOT-003    | DOM observer, runtime lifecycle         | EXT-008, EXT-041, EXT-047                   | Chrome SPA + Shadow E2E、`shadow-root-hook-coverage.spec.ts`、重复初始化/teardown 集成测试                                                 | 0/2     | Verified                                                |
| FR-BOOT-004    | frame runtime/bridge                    | EXT-008, EXT-021, EXT-047, EXT-135, EXT-146 | ADR-0019；Chrome same/cross-origin iframe、late inheritance、iframe-only ownership、撤权/worker restart E2E；sender/frame boundary tests   | 0/2/6.5 | Verified for engineering / headed permission UX pending |
| FR-BOOT-005    | settings/site policy, popup             | EXT-061, EXT-064                            | `site-access.spec.ts`；Chrome 临时停用、站点停用、恢复、撤权与 worker restart E2E                                                          | 3       | Verified                                                |
| FR-SESSION-001 | media selection service                 | EXT-042                                     | `active-player-scoring.spec.ts` + Chrome multi-player/SPA/Shadow E2E                                                                       | 2       | Verified                                                |
| FR-SESSION-002 | media session state                     | EXT-040, EXT-042                            | `media-model.spec.ts`、`media-discovery.spec.ts` 多实例状态隔离                                                                            | 2       | Verified                                                |
| FR-SESSION-003 | selection heuristics/capabilities       | EXT-042, EXT-049                            | active-player scoring matrix、capability snapshots、Legacy core differential                                                               | 2       | Verified                                                |
| FR-SESSION-004 | media anchor/active ownership           | EXT-128, EXT-135, EXT-137                   | `media-anchor-registry.ts/spec.ts`、eligibility unit、anchor/obscured/iframe-only Chromium E2E；headed active-switch 与 30 分钟 churn 待补 | 6.5     | Implemented / acceptance evidence partial               |

## 2. 核心命令与快捷键

| 需求          | 模块                            | 任务                      | 自动化证据                                                                                                                                 | Phase | 当前证据状态                               |
| ------------- | ------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ------------------------------------------ |
| FR-CORE-001   | command registry/media handlers | EXT-044, EXT-045, EXT-046 | `command-registry.spec.ts`、`media-commands.spec.ts`；Chrome/Firefox basic E2E；differential                                               | 2     | Verified                                   |
| FR-CORE-002   | volume handler                  | EXT-046                   | range/rounding/mute unit、Chrome/Firefox E2E（含调音解除静音）                                                                             | 2     | Verified                                   |
| FR-CORE-003   | media policy/hook adapter       | EXT-046, EXT-047, EXT-145 | 原生引用捕获、桥边界、MAIN authority setter/轮询仲裁、hostile fixture 与 Chromium E2E；更多真实站点 reset 模式待扩展                       | 2/6.5 | Implemented / acceptance evidence partial  |
| FR-CORE-004   | domain/command                  | EXT-044                   | registry contract、background/media integration、Popup dispatch                                                                            | 2     | Verified                                   |
| FR-CORE-005   | capability-aware commands       | EXT-044, EXT-045, EXT-046 | capability matrix、unsupported/error unit、双浏览器 core E2E                                                                               | 2     | Verified                                   |
| FR-CORE-006   | playback policy resolver        | EXT-131, EXT-134, EXT-137 | `domain/playback/*`、`playback-policy.spec.ts`、content/background scope/writeback integration、Popup/Options source/protection component  | 6.5   | Implemented / acceptance evidence partial  |
| FR-CORE-007   | playback lifecycle coordinator  | EXT-132, EXT-135, EXT-137 | coordinator + unit 覆盖 new/replay/source/duration/reset/retry/teardown/race；content integration；真实换集/live E2E 待补                  | 6.5   | Implemented / acceptance evidence partial  |
| FR-CORE-008   | MAIN media control authority    | EXT-145, EXT-146          | `media-control-authority.spec.ts`、page protocol/runtime integration、hostile setter/轮询 fixture、Chromium hostile authority E2E          | 6.5   | Implemented / acceptance evidence partial  |
| FR-CORE-009   | authority lifecycle/degradation | EXT-145..147              | currentTime lease、custom element、detach/teardown、child→top 迁移；Tencent 登录 720P 跨帧仲裁 unit/integration 与 `0.1.4.10000` live 证据 | 6.5   | Implemented / Tencent live evidence passed |
| FR-HOTKEY-001 | hotkey registry/settings        | EXT-009, EXT-060, EXT-063 | `hotkey-domain.spec.ts` 默认/覆盖/禁用；`shortcut-recorder.spec.ts`；Options facade assignment tests                                       | 0/3   | Verified                                   |
| FR-HOTKEY-002 | hotkey interpreter/controller   | EXT-060                   | editable/composition/repeat/physical-code matrix、DOM composed-path 和串行 dispatch unit；Chrome keyboard E2E                              | 3     | Verified                                   |
| FR-HOTKEY-003 | shortcut editor/Schema          | EXT-060, EXT-063          | 保留快捷键、非法 chord、冲突检测、Escape 取消与 axe component tests                                                                        | 3     | Verified                                   |
| FR-HOTKEY-004 | hotkey mode policy              | EXT-060, EXT-064          | page/player focus、disabled、editable policy unit；站点/本页停用 Chrome E2E                                                                | 3     | Verified                                   |

## 3. 画面、媒体与跨 Tab

| 需求          | 模块                                | 任务         | 自动化证据                                                                                                                            | Phase | 当前证据状态                     |
| ------------- | ----------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------- |
| FR-VISUAL-001 | visual domain/commands              | EXT-080      | `visual-domain.spec.ts`、`visual-media-commands.spec.ts`；专项浏览器 E2E 尚未执行                                                     | 4     | Verified for Preview             |
| FR-VISUAL-002 | visual reset transaction            | EXT-080      | 单次 controller reset、inline style restore、teardown unit                                                                            | 4     | Verified                         |
| FR-VISUAL-003 | fullscreen/PiP adapters             | EXT-081      | generic adapter/command unit；native→web fallback 与 PiP unavailable 浏览器 E2E 待补                                                  | 4     | Verified for Preview             |
| FR-VISUAL-004 | overlay component shell             | EXT-082      | `overlay.spec.ts`、controller unit、hostile/CSP/iframe runtime lifecycle；iframe-only 聚合待补                                        | 4     | Verified for Preview             |
| FR-MEDIA-001  | capture service                     | EXT-083      | capture command/download/native binding unit、bounded Schema/security/manifest checks；真实帧/CORS E2E 待补                           | 4     | Verified for Preview             |
| FR-MEDIA-002  | progress repository                 | EXT-084      | progress domain/repository/content-runtime TTL/capacity/privacy/restore/节流集成；浏览器 E2E 待补                                     | 4     | Verified for Preview             |
| FR-MEDIA-003  | cross-tab event service             | EXT-085      | cross-tab service unit、background/content typed contract                                                                             | 4     | Verified advisory only           |
| FR-MEDIA-004  | experimental/advanced media package | EXT-153..157 | 下载/MSE、独立 global/site 门禁、资源预算/取消/清理、安全 sink、音频增益、长按/autoplay、PiP lease unit/integration；live/headed 待补 | 6.5   | Implemented / acceptance pending |

## 4. 站点适配器

| 需求           | 模块                         | 任务                      | 自动化证据                                                                         | Phase | 当前证据状态         |
| -------------- | ---------------------------- | ------------------------- | ---------------------------------------------------------------------------------- | ----- | -------------------- |
| FR-ADAPTER-001 | adapters/generic             | EXT-043                   | `generic-adapter.spec.ts`、basic/multi fixture；Chrome/Firefox 无站点配置 core E2E | 2     | Verified             |
| FR-ADAPTER-002 | adapter registry/sites       | EXT-100..105              | registry unit + 10 site fixtures；真实站点 smoke 未执行                            | 5     | Verified for fixture |
| FR-ADAPTER-003 | adapter isolation            | EXT-100, EXT-106          | attach/action/selector/detach throw、SPA rematch、Generic fallback                 | 5     | Verified             |
| FR-ADAPTER-004 | adapter metadata/diagnostics | EXT-100, EXT-106, EXT-107 | exact version/feature disable、adapter health、SHA baseline/report                 | 5     | Verified             |
| FR-ADAPTER-005 | declarative custom rules     | EXT-142                   | Schema fuzz + no-code-execution security test                                      | 7     | Deferred             |

## 5. 配置与数据

| 需求          | 模块                          | 任务                           | 自动化证据                                                                                                | Phase   | 当前证据状态 |
| ------------- | ----------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------- | ------- | ------------ |
| FR-CONFIG-001 | domain/settings, repository   | EXT-024, EXT-025               | strict Schema/default/unknown/range tests；repository integration                                         | 1       | Verified     |
| FR-CONFIG-002 | settings resolution           | EXT-024, EXT-025               | global/site/session priority + normalized origin unit tests                                               | 1       | Verified     |
| FR-CONFIG-003 | settings service/subscription | EXT-025, EXT-062               | repository 并发/订阅；Options storage change live reload；Chromium worker restart 后 revision/状态恢复    | 1/3     | Verified     |
| FR-CONFIG-004 | migration/import/export       | EXT-026, EXT-027, EXT-065      | V0/V1/V2→V3、corrupt/future、backup/rollback、262144-byte import、预览/确认、reset 与 Blob revoke tests   | 1/3/6.5 | Verified     |
| FR-CONFIG-005 | sync whitelist                | EXT-025, EXT-062, DECISION-005 | `settings-sync-whitelist.spec.ts`；local authority + change event 已验证；Preview 明确不启用 storage.sync | 1/3     | Verified     |
| FR-CONFIG-006 | Legacy JSON converter         | EXT-027, EXT-143               | sample mapping/golden files                                                                               | 1/7     | Deferred     |

## 6. UI 与诊断

| 需求        | 模块                          | 任务                               | 自动化证据                                                                                                                                                           | Phase | 当前证据状态                              |
| ----------- | ----------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------- |
| FR-UI-001   | popup                         | EXT-061, EXT-064                   | `popup.spec.ts` + Chrome/Firefox extension E2E：状态、媒体命令、权限、停用、撤权、worker restart                                                                     | 3     | Verified                                  |
| FR-UI-002   | options                       | EXT-062, EXT-063, EXT-065, EXT-066 | 六路由页面；`options.spec.ts` 导航/live reload/import；Options all-sites revoke E2E                                                                                  | 3     | Verified                                  |
| FR-UI-003   | anchored quick controls       | EXT-082, EXT-128, EXT-129, EXT-137 | `MediaQuickControls.vue/.css`、anchor registry、component interaction、Chromium scroll/resize/replacement/removal；headed visual/native fullscreen 待补              | 4/6.5 | Implemented / acceptance evidence partial |
| FR-UI-004   | application facade/view model | EXT-061, EXT-062, EXT-082          | Popup/Options/Overlay application unit；dependency-cruiser 128 modules / 415 dependencies / 0 violations                                                             | 3/4   | Verified                                  |
| FR-UI-005   | i18n                          | EXT-067, EXT-068                   | zh-CN/en-US catalog structural completeness、参数格式化、Popup/Options/Recorder axe tests                                                                            | 3     | Verified                                  |
| FR-UI-006   | feedback event/presenter      | EXT-130, EXT-133, EXT-137          | feedback factory/store/presenter unit/component、最终值/error/expiry/policy edge、audio-only page fallback E2E；跨入口 headed 待补                                   | 6.5   | Implemented / acceptance evidence partial |
| FR-UI-007   | overlay visibility policy     | EXT-129, EXT-136, EXT-138          | playing collapsed、paused forced-collapse、trigger hover/focus/click/touch、hidden component 与 runtime 已实现；reduced-motion、200% zoom、字幕/宿主控件 headed 待补 | 6.5   | Implemented / headed evidence pending     |
| FR-UI-008   | quick controls/onboarding     | EXT-129, EXT-133, EXT-134, EXT-136 | 固定倍速、scope、当前值、policy source/protection、键盘/touch/zh-CN/en-US component；真实 usability smoke 待补                                                       | 6.5   | Implemented / usability evidence pending  |
| FR-DIAG-001 | structured logger             | EXT-030                            | `structured-logger.spec.ts` ring-buffer/capacity/redaction                                                                                                           | 1     | Verified                                  |
| FR-DIAG-002 | diagnostics service/UI        | EXT-066                            | `diagnostics.spec.ts` bounded summary/脱敏；Options diagnostics page；download Blob lifecycle test                                                                   | 3     | Verified                                  |
| FR-DIAG-003 | status/error mapping          | EXT-048, EXT-061, EXT-066          | no-permission/rejected/restricted/no-media/site-disabled/temporary/init-failure contract + E2E                                                                       | 2/3   | Verified                                  |

## 7. 非功能需求到门禁映射

| NFR 领域                | 主要事实源                                     | 执行门禁/任务                                              |
| ----------------------- | ---------------------------------------------- | ---------------------------------------------------------- |
| NFR-MAINT-*             | `engineering-standard.md`, `module-catalog.md` | EXT-002/003；PR static gate                                |
| NFR-PERF-*              | `test-strategy.md`, `quality-gates.md`         | EXT-050/086；nightly stress/RC budget                      |
| NFR-REL-*               | `target-architecture.md`, `test-strategy.md`   | lifecycle/restart/migration E2E                            |
| NFR-UXREL-*             | `ux-runtime-and-policy-architecture.md`        | EXT-128/132/137；per-media teardown、幂等/有界重试         |
| NFR-SEC-*               | `security-and-privacy.md`                      | EXT-028..031；security release gate                        |
| NFR-COMPAT-*            | `compatibility-matrix.md`                      | EXT-006/008/107；nightly matrix                            |
| NFR-TEST-*              | `test-strategy.md`                             | EXT-004/005/007/008；coverage gate                         |
| NFR-A11Y-* / NFR-I18N-* | `ui-component-architecture.md`                 | EXT-067/068；component/a11y gate                           |
| NFR-OBS-*               | `observability-and-support.md`                 | EXT-030/066；redaction/export gate                         |
| NFR-BUILD-* / NFR-REL-* | `release-artifact-and-evidence-contract.md`    | EXT-120..122/125；profiles、inspection、reproducibility    |
| NFR-PRIV-* / NFR-SEC-*  | `privacy-and-permission-disclosure.md`         | EXT-123/124/126；store/manual external gates               |
| Phase 6.5 UX P0/P1      | `ux-acceptance-and-test-matrix.md`             | EXT-128..139；unit/component/integration/headed/live smoke |

## 8. Phase 6 发布需求追踪

| 任务    | 工程实现与自动化证据                                                                               | 治理/人工证据                              | 当前状态                                            |
| ------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------- |
| EXT-120 | `.github/actions/setup-web-extension`、PR/nightly/RC workflows、`release-ci-policy.spec.ts`        | required checks/branch protection 实际配置 | Engineering verified / external enforcement pending |
| EXT-121 | `src/release/profile.ts`、`wxt.config.ts`、`release-profile.spec.ts`                               | 候选版本冻结与 Release Manager 确认        | Verified                                            |
| EXT-122 | `scripts/release/*`、archive/evidence/artifact/dependency tests、bundle verify/reproducibility     | CI/商店签名 provenance（未来）             | Verified for unsigned repository evidence           |
| EXT-123 | `store-listing-package.md`、`privacy-and-permission-disclosure.md`、artifact permission inspection | 公开隐私 URL、截图、账号与商店签字/回执    | Engineering complete / external pending             |
| EXT-124 | `beta-update-rollback-incident-runbook.md`、settings migration/backup/corrupt tests                | 真实商店 update/rollback/forward-fix drill | Engineering complete / external drill pending       |
| EXT-125 | RC workflow、release gate schema、双次复现、RC record template                                     | 两个连续真实 Beta RC 与观察窗口            | Automation verified / external pending              |
| EXT-126 | Stable template、`test-summary.json` NO-GO policy、Phase 6 Exit Review                             | 全角色签字和商店证据                       | Reviewed / Stable NO-GO                             |
| EXT-127 | post-release template、无遥测指标边界、Legacy 冻结判断项                                           | 首次真实发布后执行                         | Template ready / execution pending                  |

## 9. Phase 6.5 体验能力追踪（实现审查）

| 验收项             | 需求                              | 任务                | 当前实现与自动化证据                                                                                                                                          | 当前状态 / 剩余证据                                                                                                       |
| ------------------ | --------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| UX-ACC-001/002     | FR-SESSION-004、FR-UI-003         | EXT-128/129/137     | `MediaAnchorRegistry` unit；unique host、scroll/resize/replacement/removal、disable/revoke/iframe lifecycle Chromium 7/7 E2E；30 分钟 quick-control host 回零 | Engineering automation verified；headed screenshot、native fullscreen、完整 host/listener/observer/timer diagnostics 待补 |
| UX-ACC-003/014     | FR-UI-007/008                     | EXT-129/136/138     | quick controls component 覆盖 playing/paused/compact、hover/focus/click/touch、Escape/Tab、zh-CN/en-US、aria-live                                             | Component partial；200% zoom、theme、reduced-motion、字幕/宿主控件、Firefox headed 待补                                   |
| UX-ACC-004/005/013 | FR-UI-006、FR-HOTKEY-002          | EXT-130/133/137     | typed feedback final value/error/replace/expiry/policy edge unit/component；editable E2E；audio fallback E2E                                                  | Automation partial；feedback 安全区、p95 时延、快捷键/UI/Popup 跨入口 headed 待补                                         |
| UX-ACC-006/007     | FR-CORE-006/007                   | EXT-131/132/137/138 | resolver/coordinator unit 覆盖 new/replay/source/duration/reset protection/bounded retry/teardown/race；content integration                                   | Automation partial；hostile real-extension、真实换集/src/reset 与 Tier 1 live smoke 待补                                  |
| UX-ACC-008/009     | FR-CORE-006、FR-UI-008            | EXT-131/134/137     | global/site/page/media priority、session isolation、site persistence/fallback、Popup source/scope、Options global/site inheritance                            | Automation partial；真实 reload/navigation/writeback 与 usability 待补                                                    |
| UX-ACC-010/011/012 | FR-SESSION-003/004、FR-UI-003/006 | EXT-128/130/135/138 | eligibility unit；multi/obscured/audio/iframe-only、late same/cross-origin inheritance、worker fail-closed/reconnect E2E                                      | Engineering automation verified；真实广告/背景媒体、headed audio/no-anchor/复杂 frame 待补                                |
| UX-ACC-015         | FR-BOOT-002、FR-SESSION-004       | EXT-128/132/137     | generation/race/teardown、fail-closed reconnect unit/integration；fresh 30 分钟 churn 6587 cycles/131 restarts/window listeners 4→4/首尾 GC heap 有界         | Partial；Observer/Timer/LongTask、authority teardown 和分段 heap 趋势待补                                                 |

Phase 6.5 只有在 `UX-ACC-001..015` 的 P0 全部 `Verified`、P1 无未接受阻塞项且 EXT-139 审查通过后，才能解除 Phase 7 冻结。

## 10. 证据更新规则

- `Planned`：有任务和测试层级但尚无实现。
- `Building`：任务 In Progress，填写 PR 链接。
- `Verified`：填写测试路径、CI artifact、浏览器矩阵和评审记录。
- `Deferred`：必须保留产品理由、风险和重新评估条件。
- 任何 P0 在 Stable Go/No-Go 时不是 `Verified`，结论自动为 No-Go。
