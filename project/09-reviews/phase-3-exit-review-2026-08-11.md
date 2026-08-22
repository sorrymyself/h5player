# Phase 3 Exit Review（2026-08-11）

> 文档 ID：REVIEW-005  
> 状态：Approved / Conditional GO  
> Reviewers：Product / Architecture / Quality / Security / UI / Release  
> 关联：ADR-0003、ADR-0005、ADR-0007、ADR-0008、EXT-060..069  
> 评审范围：Phase 3 Preview 工程基线，不是 Stable 发布审查

## 1. 目标与范围

在不修改 Legacy 油猴主线的前提下，为 Web Extension 建立可维护的设置、快捷键、站点权限和原生扩展 UI
纵向切片，并把配置生命周期、权限生命周期、组件边界、自动化测试与诊断能力纳入统一工程门禁。

本评审覆盖：

- Hotkey domain/interpreter/controller 与页面/播放器聚焦策略；
- Settings Schema V2、迁移、导入导出、reset、backup、restore 和跨 Tab local revision 刷新；
- Popup、Options 六页面、共享组件、zh-CN/en-US、自动 a11y 基线；
- optional host onboarding、动态 isolated/MAIN content-script registration、bootstrap、撤权与 worker restart；
- Chrome/Firefox 真实临时安装扩展的权限/媒体链路和固定 fixture。

本评审不覆盖：Tier 1 真实站点适配、Firefox ESR/最低版本、Chrome previous stable、Edge、商店提交、完整
headed 权限 UX、视觉增强、截图、进度恢复、发布产物签名/SBOM 或 Stable Go/No-Go。

## 2. 评审结论摘要

| 项目                          | 结论                                                |
| ----------------------------- | --------------------------------------------------- |
| Phase 3 P0 工程范围           | 通过                                                |
| 进入 Phase 4                  | Conditional GO                                      |
| Preview 使用声明              | 允许；仅限 Tier 0 通用媒体能力和已验证 fixture 范围 |
| Beta / Stable / 商店发布      | 不批准                                              |
| Tier 1 真实站点完成声明       | 不批准                                              |
| Legacy 主线改动或共享核心抽取 | 不批准；继续保持独立                                |

Conditional GO 的含义是：**Phase 3 Preview 范围可进入下一阶段工程开发**。后续开发必须复用本阶段的 typed
protocol、SettingsRepository、permission registration、application facade 和测试门禁，不能为赶功能绕过这些边界。

## 3. 完成交付

| Task    | 状态     | 主要证据                                                                                                              |
| ------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| EXT-060 | Verified | `src/domain/hotkey`、application hotkey controller、DOM event source；冲突/editable/focus/repeat/composition 单元测试 |
| EXT-061 | Verified | PopupApplication + PopupApp；当前页状态、媒体命令、权限、停用、worker restart Chrome E2E                              |
| EXT-062 | Verified | OptionsApplication、router 与 General/Shortcuts/Sites/Data/Diagnostics/About 六页面；组件/集成测试                    |
| EXT-063 | Verified | ShortcutRecorder、规范化 chord、保留快捷键/冲突提示、键盘操作与 axe 测试                                              |
| EXT-064 | Verified | SiteAccessService、动态 registration、reconcile queue；Chrome grant/reject/revoke、Firefox origin grant/revoke 与停用 |
| EXT-065 | Verified | V2 import preview/export、262144-byte 上限、Blob URL lifecycle、reset/backup/restore 原子测试                         |
| EXT-066 | Verified | bounded diagnostics summary、hostname 降敏、权限/运行时摘要与 Options 导出                                            |
| EXT-067 | Verified | zh-CN/en-US catalog、key 完整性、参数格式化和 fallback 测试                                                           |
| EXT-068 | Verified | Popup/Options/ShortcutRecorder 组件、axe 自动基线、焦点/键盘交互和拒绝态测试                                          |
| EXT-069 | Verified | 本审查、权限清单、风险台账、兼容矩阵、路线图和追踪矩阵同步                                                            |

## 4. 退出条件核对

- [x] P0 配置、快捷键和 UI 需求有 unit/component/integration 证据，并在 Chrome 真扩展主路径串联。
- [x] Settings V2 从 V0/V1 逐版迁移；损坏/未来版本不覆盖原值；导入失败保持现状，reset/restore 有备份。
- [x] Popup 能区分 granted/missing/restricted/unknown、无媒体、站点停用、本页临时停用和 runtime 状态。
- [x] Options 六页面不直接依赖媒体 DOM；Vue presentation 通过 application facade 与 typed runtime API 工作。
- [x] 快捷键使用固定 command ID 与 `KeyboardEvent.code` chord；未知/冲突/浏览器保留组合不会被静默执行。
- [x] 生产 Chrome/Firefox manifest 无 required host permissions、静态 `content_scripts` 和 WAR；`<all_urls>` 仅 optional。
- [x] Chrome 覆盖授权前 absence、拒绝、restricted、current-site/all-sites grant、worker restart、撤权和页面重载隔离。
- [x] Firefox 153.0 覆盖 origin grant + `activeTab`、动态 registration/bootstrap、六类媒体命令、撤权和重载后 absence。
- [x] Popup/Options/Recorder axe 自动检查和键盘组件测试通过。
- [x] Legacy hash/size 保持冻结基线，Legacy 源码与根构建链不在 Phase 3 diff 范围。
- [ ] Firefox ESR/最低版本、Chrome previous stable、Edge 与 headed 原生权限确认框尚未形成发布证据；列为 Beta/Stable 前置门禁。

## 5. 测试与指标

| 检查                      | 结果                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Format / lint / typecheck | Passed                                                                                                      |
| Unit                      | 28 files / 93 tests passed                                                                                  |
| Component                 | 3 files / 9 tests passed                                                                                    |
| Integration               | 7 files / 40 tests passed                                                                                   |
| Compatibility             | 2 files / 21 tests passed                                                                                   |
| Coverage                  | Statements 85.84%；Branches 75.18%；Functions 88.24%；Lines 89.50%                                          |
| Security                  | 静态扫描 120 files + 2 manifests；security tests 3 passed                                                   |
| Dependency boundaries     | 105 modules / 330 dependencies；0 violations                                                                |
| Chrome E2E                | 3 passed；configured 30-minute churn 默认未配置而 skipped                                                   |
| Firefox E2E               | Firefox 153.0；权限生命周期、动态注册和 6 类媒体命令通过                                                    |
| Firefox lint              | 0 errors；1 条 Vue 生成 runtime `UNSAFE_VAR_ASSIGNMENT` warning                                             |
| Churn smoke               | 5017 ms；82 cycles；1 worker restart；listeners `4→4`；heap `3613664→4315488` bytes                         |
| Legacy                    | SHA-256 `91b5312d7cf150cd852d005b1e5d5f3d8ed2ed7cd8a481dfa1d561d48f7b3f27`；561788 bytes                    |
| Production manifests      | required `storage/activeTab/scripting`；optional `<all_urls>`；`content_scripts: []`；无 required hosts/WAR |
| Artifact footprint        | Chrome/Firefox unpacked production directory 各约 484 KiB                                                   |

当前 Vitest 全局强制阈值为 statements/lines/functions 80%、branches 75%，本次均通过。更高的按包覆盖率仍是
Stable 收敛目标，尚未配置为按包 CI hard gate。

Phase 2 已执行的 30 分钟 churn（8056 cycles、161 worker restarts、listeners `4→4`）继续作为历史证据。本次 Phase 3
只重新执行 5 秒 smoke，不把历史结果伪装为本阶段重跑。

## 6. Chrome E2E 证据

`tests/e2e/extension-smoke.spec.ts` 当前三个主场景覆盖：

1. 授权前 runtime absence、用户拒绝、restricted page 和可解释状态；
2. 当前站点媒体控制、快捷键、页面临时停用、站点永久停用、service worker restart 和撤权；
3. all-sites、multi-player、SPA、open Shadow DOM、hostile、strict CSP、same/cross-origin iframe 和 Options 撤权。

Chrome harness 使用隔离的临时扩展目录/profile：grant 路径先用临时 `host_permissions` 让浏览器建立授权状态，关闭后
恢复 production manifest 并复用该 profile；reject 路径使用移除 optional host 声明的测试副本，使真实
`permissions.request()` 确定性返回 `false`。测试结束清理临时目录，并独立扫描未修改的 production manifest。

## 7. Firefox E2E 证据

`scripts/firefox-e2e.ts` 使用 Firefox 153.0、Selenium 临时安装和 `--allow-system-access` 测试 harness：

- 授权前确认页面无 runtime marker；
- 通过 `ExtensionPermissions.add(..., extensionEmitter)` 只为测试 extension 授予 optional origin；
- 通过 `tabManager.addActiveTabPermission()` 模拟用户点击 action 后的临时 `activeTab`；
- reconcile 后确认两个动态 content-script ID、当前页 bootstrap 和媒体状态；
- 验证 seek、rate、volume、mute、pause、play；
- 撤权后确认 registration 注销，页面重载后 runtime 继续 absence。

Firefox 内部 API、system access 参数和 extension emitter 只存在于测试脚本，不属于产品 WebExtension API，也不进入
`src`、entrypoints、manifest 或打包产物。Firefox all-sites 与浏览器级拒绝路径尚未单独执行，不能由 origin grant
结果外推。

## 8. 权限自动化边界

当前 headless Chrome/Firefox 无法稳定接受或拒绝原生扩展权限确认框。Phase 3 的自动化证明：

- 产品只从浏览器已授予 origins 派生 registration；
- grant/reject/revoke 后的 application 状态、动态脚本和页面 runtime 行为正确；
- production manifest 权限最小化不被测试副本污染；
- worker restart、permission event 与显式 reconcile 并发不会留下重复/幽灵 registration。

自动化没有证明：原生确认框文字、焦点、浏览器 UI 可达性、用户是否能清楚理解 all-sites 影响以及商店审核表现。
因此接受 `DECISION-006`：harness 可作为 Preview 状态机证据，Beta/商店提交前必须进行 headed 手工权限 smoke；缺失时
由 `RISK-017` 阻断发布。

## 9. 架构审查

- `domain/hotkey` 只包含 command/chord/validation 规则；DOM event source、controller 和 Vue UI 分属 infrastructure、
  application 与 presentation，依赖方向扫描无违规。
- PopupApplication/OptionsApplication 是浏览器/runtime API 与 Vue 之间的 facade；组件测试使用 fake facade，Vue 组件
  不直接读写 media DOM、storage 或 arbitrary browser API。
- Settings Schema V2、export contract、patch schema 和 migration 同源；`storage.local` 是唯一配置权威，Preview 不启用
  `storage.sync`。ADR-0008 只冻结未来白名单。
- SiteAccessService 使用 reconcile queue 串行化 permission events 与显式 reconcile；registration service 只使用两个固定
  文件名/ID，不接受页面传入权限名、文件名或代码。
- page-main/content/background 继续通过 typed Zod protocol 和 sender policy 协作；新增 UI 能力没有绕过 Phase 1 边界。
- i18n catalog 与共享组件建立了可扩展基线；Phase 4 overlay 仍需单独处理页面样式隔离和 bundle/performance budget。

## 10. 安全、隐私与数据审查

- required permissions 只有 `storage`、`activeTab`、`scripting`；没有 `tabs`、downloads、clipboard、webRequest、cookies、
  externally connectable、远程脚本或 required host permission。
- security scan 同时检查源码、Chrome/Firefox 产物和 manifest；无 `eval`、`new Function`、unsafe-eval、CSP 改写、WAR
  或业务 innerHTML assignment。
- 设置导入有格式/version/大小/Schema 约束；未知命令、站点规则、权限或脚本内容不进入业务对象；失败不修改现有 revision。
- 诊断导出使用 bounded summary；URL 只保留 hostname，不包含页面标题、媒体 URL、正文、cookie、token 或完整设置包。
- optional origin 与动态 registration 是浏览器 profile 状态，不复制进 Settings envelope，避免形成双重权限事实源。
- Vue 生成 runtime 的单条 Firefox lint warning 保留为供应链/构建风险，不能通过放宽业务代码扫描掩盖。

## 11. UX 与可访问性审查

- Popup 和 Options 对权限、无媒体、站点/本页停用、错误和 loading 提供文字状态，不只依赖颜色。
- ShortcutRecorder 支持键盘录制、取消、冲突和浏览器保留组合提示；输入控件/editable target 默认不抢键。
- Popup、Options、Recorder 组件 axe 自动检查与键盘交互通过，公共 toggle/dialog/status/metric/panel 组件已复用。
- 当前结论只认可自动化 WCAG 基线；多缩放级别、强制色彩、高对比模式、屏幕阅读器和原生权限弹窗仍需 headed/manual
  审查后才能作为 Beta/Stable 可访问性声明。

## 12. Legacy 隔离审查

- Web Extension 继续使用独立 `web-extension/package.json`、pnpm lockfile、WXT/Vite 构建与测试命令。
- Legacy `src/h5player/`、`src/libs/`、`config/`、根 Yarn/Rollup 链和冻结 userscript 产物未被 Phase 3 重构。
- Legacy regression 以固定 SHA-256 和 561788-byte 大小验证；本评审不授权改写油猴实现或把未稳定模块抽成共享核心。
- 是否重构油猴脚本仍属于 Phase 7 的独立成本收益评估与新章程决策。

## 13. 剩余风险与强制跟进

| 项目                                                          | Owner                   | 最晚里程碑     | 发布影响                                  |
| ------------------------------------------------------------- | ----------------------- | -------------- | ----------------------------------------- |
| Headed 原生权限确认框、文案、焦点、accept/reject/revoke smoke | Quality / Security / UX | Beta candidate | 缺失则阻断 Beta/商店                      |
| Firefox ESR/最低 142.0、Chrome previous stable、Edge 矩阵     | Quality / Release       | Phase 5/6      | 缺失则阻断 Stable                         |
| Firefox all-sites 与浏览器级拒绝 E2E                          | Quality / Runtime       | Beta candidate | 缺失则 all-sites 不能形成双浏览器发布承诺 |
| Tier 1 adapter fixture + real-site smoke                      | Adapter Owners          | Phase 5 Exit   | 缺失则不得宣称 Tier 1 支持                |
| 完整 RC 30 分钟 churn、bundle/performance budget              | Performance / Release   | Phase 4/6      | 超预算阻断 RC                             |
| SBOM/license/provenance、zip/hash、商店/隐私材料              | Release / Security      | Phase 6        | 缺失则不得发布 Stable                     |
| WXT 0.x 与 Vue runtime warning 跟踪                           | Build / Security        | 每次依赖升级   | 升级必须独立变更并重跑双浏览器门禁        |

## 14. 验证命令

```bash
cd web-extension
corepack pnpm@11.21.0 check
corepack pnpm@11.21.0 test:coverage
corepack pnpm@11.21.0 test:e2e
corepack pnpm@11.21.0 test:e2e:firefox
corepack pnpm@11.21.0 test:churn:smoke
corepack pnpm@11.21.0 test:legacy
```

发布候选还必须额外执行 `test:churn`、浏览器版本矩阵、headed permission smoke 和 Phase 6 发布工程门禁。

## 15. 最终结论

`CONDITIONAL GO`

Phase 3 的设置、快捷键、权限 onboarding、Popup/Options、诊断和自动化体系已达到 Preview 范围进入 Phase 4 的
工程条件。该结论不等于 Stable、不等于 Tier 1 真实站点完成、不等于 Firefox ESR/最低版本支持，也不授权修改
Legacy 油猴主线。上述发布前置条件未完成前，所有对外描述必须保持 Preview 边界。
