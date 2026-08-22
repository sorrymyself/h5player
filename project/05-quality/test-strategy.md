# 自动化测试策略

> 文档 ID：QA-001  
> 状态：In Review / Phase 6.5 UX Test Amendment
> 负责人：Quality Owner  
> 最后更新：2026-08-12

## 1. 测试目标

测试要证明三件事：

1. 领域逻辑在没有浏览器的情况下正确。
2. 各运行时边界和浏览器能力在受控环境中正确协作。
3. 真实打包扩展在真实浏览器页面中不会因为构建、权限、上下文或生命周期差异而失效。

## 2. 测试分层

### 2.1 静态质量

- TypeScript strict/typecheck。
- ESLint、格式、依赖边界、循环依赖。
- Schema 与消息类型生成/一致性检查。
- 禁止模式：`eval`、`new Function`、远程 script、内联危险注入、CSP 改写。
- manifest 权限、host、web accessible resource 白名单校验。

### 2.2 单元测试（Vitest）

覆盖纯函数和领域模型：

- 播放速度/音量/seek 边界、NaN/Infinity/负数。
- active player 评分、tie-breaker 和状态转移。
- 命令注册、能力检查、错误映射。
- 快捷键解析、组合键冲突、editable target、repeat。
- 配置默认值、站点覆盖合并和清理。
- Schema 解析、版本迁移、未知字段和损坏数据。
- 消息 Envelope 编解码、nonce、超时和重放拒绝。
- URL/origin 规范化与诊断脱敏。
- visual transform/filter/atomic reset、fullscreen/PiP capability 和 capture error mapping。
- progress identity/TTL/capacity/privacy/completion policy 与 cross-tab advisory event。
- playback policy scope/source/priority、user intent writeback、actual rate separation、bounded lifecycle replay。
- feedback event merge/replace/expiry、media anchor placement/fallback、visibility state、no-anchor/audio degradation。

当前仓库强制门禁以 `vitest.config.ts` 为事实源：statements ≥80%、lines ≥80%、functions ≥80%、branches ≥75%。
核心 domain/application 的 lines ≥85%、branches ≥80%，以及配置/消息/迁移关键分支 ≥95% 仍是 Stable 收敛目标；在改为
按包强制阈值前，只能作为审查指标，不能虚报为 CI 已阻断的门禁。

### 2.3 组件测试

使用 Testing Library 或等价工具验证：

- popup/options/overlay 的状态、事件、错误和 loading。
- 键盘导航、焦点、ARIA、禁用态和空状态。
- 多语言文本不会溢出或丢失参数。
- UI 不直接依赖浏览器 API；使用 fake application facade。
- MediaQuickControls 的 collapsed/expanded/hidden、hover/focus/pause/touch/reduced-motion 状态。
- MediaFeedbackPresenter 的最终值、aria-live、错误、合并/过期、无 anchor 和音频降级。
- 200% 缩放、中文/英文长文本、深色/浅色和宿主 CSS 污染 fixture。

### 2.4 集成测试

使用 fake browser ports + JSDOM/happy-dom 或受控 DOM：

- content ↔ page-main handshake。
- content ↔ background request/response。
- storage repository 与 migration/backup。
- 多 Tab 订阅、并发更新、worker 重启模拟。
- media discovery、adapter setup/teardown 和 command execution。
- discovery → anchor registry → policy resolver → lifecycle coordinator → command result → feedback presenter 全链路。
- 多媒体 active media 切换、媒体删除/复用、权限撤销和站点停用时的 UI/策略/反馈 teardown。

### 2.5 扩展 E2E（Playwright / Selenium WebDriver）

必须加载构建后的 unpacked extension，覆盖：

- 安装/首次启动/更新迁移。
- basic 页面发现媒体、快捷键、popup 命令。
- SPA 路由、动态媒体、多个媒体切换。
- Shadow DOM、同源 iframe、跨源 iframe（能力可用/不可用两种）。
- CSP 严格页面、页面伪造消息、页面重写媒体属性。
- options 保存、导入、导出、恢复和错误回滚。
- service worker 休眠/重启后恢复。
- Chrome 与 Firefox 最低支持版本/当前稳定版本 smoke。
- media-anchor、media-feedback、media-churn-rate、media-policy、media-obscured、touch-overlay fixtures；默认页面不得出现视口级大面板。
- 新媒体/重播/SPA 换集/`src` 变化/website reset 自动倍速策略；快捷键、Overlay、Popup 最终值反馈一致。

执行约定：

- Chromium 使用 Playwright persistent context 加载 unpacked MV3，并通过 CDP 验证 service worker restart、listener 和 heap。
- Chromium 权限 E2E 使用隔离 `extension-harness.ts`：临时 profile 预置 grant，拒绝副本确定性返回 `false`；每次仍扫描
  原 production manifest，避免测试副本改变发布事实。
- Firefox 使用 Selenium WebDriver 临时安装 `.output/firefox-mv3`；Selenium Manager 解析 geckodriver，禁止在 pnpm 依赖安装阶段执行驱动下载脚本。
- Firefox 权限 E2E 在测试 profile 中使用 `ExtensionPermissions.add(..., extensionEmitter)` 建立 optional origin，并用
  `tabManager.addActiveTabPermission()` 模拟 action 用户手势；这些 Firefox 内部 API 禁止进入生产源码、manifest 或产物。
- 浏览器版本、扩展 ID、命令集合和聚合指标必须输出为机器可读事件，供阶段审查和 CI artifact 引用。
- Playwright 扩展 lifecycle suite 固定 `workers: 1`；需要吞吐时按 browser/scenario 拆独立 runner，禁止同进程并发多个 persistent profile。
- 原生权限确认框在 headless 自动化中不可稳定操作；harness 证明权限状态机，不证明弹窗文案、焦点或商店体验。
  Beta/商店提交前必须执行 headed 手工 permission smoke。

### 2.6 兼容性与差分测试

- 固定 HTML fixture 是主测试 Oracle，真实站点只做发布前 smoke 和人工探索。
- 对 Legacy 和 Web 运行相同命令序列，比较可观测 snapshot。
- 每个允许差异都有 ID、原因和批准人。
- 站点适配器按 Tier 生成通过/失败/未测报告。

### 2.7 性能与稳定性

- 初始化、媒体发现、命令响应 p50/p95。
- 空白页 CPU/长任务/内存基线。
- 30 分钟媒体 churn、SPA 导航和 worker 重启压力。
- bundle gzip 大小、首次执行和按需 chunk 预算。
- Phase 4 PR budget 以 raw bytes 强制：background 150 KiB、content 250 KiB、page-main 200 KiB；gzip 作为诊断指标。
- 每次发布候选至少跑一次性能 smoke；每周夜间跑完整压力。
- Phase 6.5 记录媒体发现到控件可交互 p95 ≤150ms、命令成功到反馈可见 p95 ≤100ms、默认反馈 1.5～2.0s、覆盖面积目标 ≤20%。
- headed visual 记录滚动/resize/fullscreen/PiP/窄媒体定位误差、焦点顺序和字幕/原生控件避让；不能以 headless DOM 坐标单独通过。
- 阶段审查必须区分本次运行与继承证据：Phase 3/4 分别重新执行 5 秒 churn smoke，Phase 2 的 30 分钟结果只作为
  历史证据引用，不得写成后续阶段已重跑。

### 2.8 安全测试

- 页面消息伪造、nonce 缺失、重放、跨 frame、错误 tabId。
- XSS/HTML 注入、URL scheme、任意下载、剪贴板滥用。
- 权限缺失与 optional permission 拒绝。
- CSP 严格页、Trusted Types/iframe sandbox 边界。
- 依赖漏洞、许可证、产物内容和 source map 泄露检查。

## 3. 固定测试页面

`web-extension/tests/e2e/pages/` 至少维护：

| 页面                       | 验证内容                                        |
| -------------------------- | ----------------------------------------------- |
| `basic.html`               | 单 video、常见属性和命令                        |
| `multi.html`               | 多 video、active player 选择                    |
| `spa.html`                 | 路由切换、动态插入/销毁                         |
| `shadow-open.html`         | open Shadow DOM                                 |
| `iframe-same-origin.html`  | 同源 frame                                      |
| `iframe-cross-origin.html` | 跨源 frame 与权限降级                           |
| `hostile-page.html`        | 重写属性、伪造消息、异常 DOM                    |
| `strict-csp.html`          | 严格 CSP/Trusted Types                          |
| `media-anchor.html`        | 媒体位置、滚动、resize、fullscreen 与 host 跟随 |
| `media-feedback.html`      | 连续命令、最终值、合并、过期和 aria-live        |
| `media-churn-rate.html`    | 动态新增/删除/复用媒体、src 变化和倍速继承      |
| `media-policy.html`        | global/site/page/media 作用域和 website reset   |
| `media-obscured.html`      | 广告、背景音频、不可见媒体、多播放器误控保护    |
| `touch-overlay.html`       | 无 hover 的触控打开、焦点和收起                 |
| `adapter-fixtures/*`       | 站点选择器和特例                                |

## 4. 测试数据与隔离

- fixture 不使用真实用户数据、登录态、付费内容或未经许可的媒体地址。
- 每个 E2E 使用独立 browser context、扩展 profile 和 storage namespace。
- 时间、随机数、网络和权限均可控；测试不依赖生产远程站点可用性。
- 失败时保存 trace、截图、console、service worker 日志和 manifest profile，但先执行脱敏。

## 5. Flaky 测试治理

- 任何重试只能掩盖偶发环境问题，不得作为通过条件。
- Flaky 测试标记 owner、失败率、Issue 和修复期限；连续两个周期未修复则阻塞对应层级发布。
- 等待使用可观测条件（元素、消息、状态）而非固定长 sleep。
- 每周报告 flaky rate，目标 `<1%`；P0 E2E 目标 `<0.5%`。

## 6. 测试缺口处理

暂时无法自动化的真实站点/浏览器能力必须登记：场景、手工步骤、风险、owner、替代 fixture 和补齐里程碑。没有记录的手工“已验证”不计入 Stable 证据。

## 7. Phase 3 已执行门禁（2026-08-11）

| 层级                      | 当前结果                                                                                 | 主要覆盖                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Format / lint / typecheck | Passed                                                                                   | Prettier、ESLint、Vue/TS strict                                                  |
| Unit                      | 28 files / 93 tests                                                                      | hotkey、settings V2、migration、i18n、download lifecycle、logger                 |
| Component                 | 3 files / 9 tests                                                                        | Popup、Options、ShortcutRecorder、axe 与键盘交互                                 |
| Integration               | 7 files / 40 tests                                                                       | background contract、site access、diagnostics、settings repository、page runtime |
| Compatibility             | 2 files / 21 tests                                                                       | Legacy core-media differential 与 oracle 完整性                                  |
| Coverage                  | 85.84% statements / 75.18% branches / 88.24% functions / 89.50% lines                    | 通过当前全局阈值                                                                 |
| Security                  | 静态扫描 120 files + 2 manifests；3 tests passed                                         | 权限 allowlist、危险模式、sender/adversarial messages                            |
| Dependency boundaries     | 105 modules / 330 dependencies；0 violations                                             | domain/application/UI/runtime 依赖方向                                           |
| Chrome E2E                | 3 passed；configured churn 默认 skipped                                                  | 权限生命周期、Popup/Options、媒体/快捷键、fixture 矩阵、worker restart           |
| Firefox E2E               | Firefox 153.0 passed                                                                     | origin grant + activeTab、注册/bootstrap、6 类媒体命令、撤权                     |
| Churn smoke               | 5017 ms / 82 cycles / 1 worker restart / listeners `4→4`                                 | Phase 3 短稳回归                                                                 |
| Legacy regression         | SHA-256 `91b5312d7cf150cd852d005b1e5d5f3d8ed2ed7cd8a481dfa1d561d48f7b3f27`；561788 bytes | Legacy 冻结边界                                                                  |

## 8. Phase 4 已执行门禁（2026-08-11）

| 层级          | 当前结果                                                                                | Phase 4 重点                                                                            |
| ------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Unit          | 36 files / 143 tests                                                                    | visual/capture/progress/cross-tab/overlay controller/budget                             |
| Component     | 4 files / 19 tests                                                                      | Overlay ready/loading/error/disabled/keyboard + 既有 UI                                 |
| Integration   | 9 files / 63 tests                                                                      | progress repository、content runtime、background contracts、runtime/storage/site access |
| Compatibility | 2 files / 21 tests                                                                      | Legacy core differential/oracle                                                         |
| Coverage      | 52 files / 249 tests；85.68 statements / 76.57 branches / 87.33 functions / 89.28 lines | 全局门槛通过，不降低 threshold                                                          |
| Security      | 142 files + 2 manifests；3 tests                                                        | 无 remote/eval/CSP bypass；无 required host/static content/WAR                          |
| Boundaries    | 128 modules / 415 dependencies / 0 violations                                           | native capture 位于 generic adapter 边界                                                |
| Chromium      | 3 passed，`workers:1`；configured churn 默认 skipped                                    | 权限/lifecycle/worker restart/multi/SPA/Shadow/hostile/CSP/iframe                       |
| Firefox       | 153.0 E2E passed；web-ext lint 0 errors/2 generated warnings                            | optional origin、动态注册、媒体命令、撤权                                               |
| Churn         | 5051 ms / 94 cycles / 1 restart / listeners 4→4                                         | Phase 4 快速稳定性回归；不足 50 cycles 时也强制一次 worker restart                      |
| Budget        | background 90150/90151 B、content 191669 B、page-main 77976 B raw，双端 passed          | background/content/page-main + manifest guardrail                                       |
| Legacy        | frozen SHA-256/size passed                                                              | Legacy 源码和根构建链未改                                                               |

Phase 4 尚缺少的端侧专项：可真实解码帧的截图成功/CORS fixture、native→web fullscreen fallback、PiP unavailable、
progress restore/complete 的浏览器 E2E、multi-tab advisory event 和 iframe-only Overlay 期望。它们是 Phase 5/Beta 收敛项，
不能被现有 unit/contract 证据扩写为完整端侧覆盖。

## 9. Phase 5 已执行门禁（2026-08-11）

| 层级            | 当前结果                                      | Phase 5 重点                                                                       |
| --------------- | --------------------------------------------- | ---------------------------------------------------------------------------------- |
| Unit            | 37 files / 151 tests                          | registry priority/match、subdomain opt-in、disable、SPA rematch、failure isolation |
| Compatibility   | 3 files / 33 tests                            | 10 site fixtures、selector actions、catalog completeness、fixture SHA report       |
| Integration     | 9 files / 63 tests                            | page/content/background adapter diagnostics contract                               |
| Security        | 150 files + 2 manifests；3 tests              | no remote rules/eval、bounded selector/diagnostic policy、permissions unchanged    |
| Boundaries      | 136 modules / 432 dependencies / 0 violations | registry/site adapter dependency direction                                         |
| Live site smoke | 未执行                                        | 必须在 Phase 6/Beta 按浏览器/OS/扩展 SHA 单独冻结证据                              |

Fixture 通过只证明脱敏 DOM 契约和 fallback，不得外推为真实登录态、DRM、AB 实验或生产站点完整支持。
兼容报告同时校验 version、Tier、support level、owner、lastVerified、fixture SHA，并对超过 183 天未复核的 adapter
阻断门禁。

## 10. 标准验证命令

在 `web-extension/` 执行：

```bash
corepack pnpm@11.21.0 check
corepack pnpm@11.21.0 test:coverage
corepack pnpm@11.21.0 build:all
corepack pnpm@11.21.0 test:budget
corepack pnpm@11.21.0 test:e2e
corepack pnpm@11.21.0 test:e2e:firefox
corepack pnpm@11.21.0 test:churn:smoke
corepack pnpm@11.21.0 test:legacy
```

`test:churn` 是 30 分钟夜间/候选门禁，不应并入普通 PR 快速检查；Stable 候选仍需运行完整浏览器版本矩阵、headed
权限 smoke、真实 Tier 1 smoke 和发布产物复现。Phase 5 额外要求 `pnpm test:compat:report`。
