# Phase 4 Exit Review（2026-08-11）

> 文档 ID：REVIEW-006  
> 状态：Approved / Conditional GO  
> 评审责任：Project / Architecture / Quality / Security / UI / Release Owner  
> 最后更新：2026-08-11  
> 关联：ADR-0009～ADR-0012、EXT-080～EXT-087、RISK-018～RISK-022  
> 评审范围：Phase 4 Preview 工程基线，不是 Beta、Stable 或商店发布审查

## 1. 目标与范围

Phase 4 在不修改 Legacy 油猴主线的前提下，为 Web Extension 增加高级通用媒体能力、页面 Overlay、截图、播放进度、
跨 Tab advisory event 和 bundle budget，并继续沿用 Phase 1～3 已建立的 typed protocol、权限、存储、application facade
和自动化门禁。

本评审覆盖：

- zoom、pan、rotate、flip、filter、atomic reset，以及 native/web fullscreen、PiP capability；
- top-frame closed ShadowRoot Overlay、typed view model/intent、hostile CSS reset 和生命周期清理；
- bounded capture artifact、Canvas 编码错误映射和 isolated-world Blob 下载；
- 匿名 progress identity、TTL、容量、隐私开关、恢复/保存/完成删除和跨 Tab advisory event；
- Chrome/Firefox production build、manifest guardrail、raw bundle budget、自动化测试、短 churn 和 Legacy 冻结回归。

本评审不覆盖：Tier 1 真实站点适配、Firefox ESR/最低 142.0、Chrome previous stable、Edge、headed 原生权限确认框、
真实解码帧截图、CORS blocked 截图、native→web fullscreen fallback、PiP unavailable、progress restore/complete 浏览器 E2E、
multi-tab advisory 浏览器 E2E、iframe-only media Overlay、完整 30 分钟 RC churn、SBOM/provenance、商店材料或 Stable
Go/No-Go。

## 2. 结论摘要

| 项目                          | 结论                                                                    |
| ----------------------------- | ----------------------------------------------------------------------- |
| Phase 4 Preview 工程范围      | 通过                                                                    |
| 进入 Phase 5 工程开发         | Conditional GO                                                          |
| 高级能力专项浏览器覆盖        | 部分；unit/component/integration 完整，列出的专项 E2E 尚未完成          |
| Beta / Stable / 商店发布      | 不批准                                                                  |
| Tier 1 真实站点完成声明       | 不批准                                                                  |
| Firefox ESR/最低版本完成声明  | 不批准                                                                  |
| Legacy 主线改动或共享核心抽取 | 不批准；继续保持独立                                                    |

Conditional GO 只表示 Phase 4 的 Preview 工程基线可以作为 Phase 5 的输入。它不允许把固定 fixture、单元或契约测试外推成
真实站点、完整浏览器能力或发布资格。

## 3. 完成交付

| Task    | 状态     | 主要证据                                                                                                      |
| ------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| EXT-080 | Verified | visual domain、GenericMediaController transform/filter/reset、状态隔离与 inline style restore 单元测试        |
| EXT-081 | Verified | fullscreen/PiP capability、native/web mode、bounded error mapping；专项浏览器 fallback 场景列为后续缺口      |
| EXT-082 | Verified | Overlay component/controller、closed ShadowRoot 配置、top-frame gate、mount/remove 和 hostile CSS reset      |
| EXT-083 | Verified | native capture bindings、artifact Schema、实际 MIME、CORS/ready/size/encode/Blob/download 边界测试           |
| EXT-084 | Verified | progress domain、repository、content runtime 恢复/保存/节流/完成删除、隐私清理与导入导出回归                 |
| EXT-085 | Verified | background cross-tab service、sender policy、source-tab 过滤、content advisory 接收和发送失败隔离           |
| EXT-086 | Verified | Chrome/Firefox raw bundle budget、manifest required-host/static-script/WAR guardrail 和 CI job                |
| EXT-087 | Verified | 本评审、ADR、风险、路线图、追踪矩阵、兼容矩阵和测试证据边界同步                                               |

## 4. 退出条件核对

- [x] visual state 按媒体隔离；reset 为单次原子操作；teardown 恢复原始 inline style。
- [x] fullscreen/PiP 使用显式 capability 和 typed error，不依赖页面传入任意调用目标。
- [x] Overlay 只在 top frame 创建，使用 WXT `createShadowRootUi`、`mode: 'closed'`、`position: 'inline'`、
      `document.documentElement` anchor 和 `cssInjectionMode: 'ui'`。
- [x] Overlay Vue 组件只消费版本化 view model 并发出 typed intent；媒体命令由 application/controller 映射。
- [x] capture 不修改 `crossorigin`，不申请 downloads/clipboard 权限；artifact MIME 使用 Canvas 编码器实际返回的
      `blob.type`，非 PNG/JPEG、空 Blob、超限或安全异常返回 bounded error。
- [x] progress 默认关闭，使用匿名 identity、TTL/容量、5 秒节流、`<=3s` floor 和接近结束优先删除。
- [x] 兼容 Schema 可读取旧 `titleHint`，策略层会立即剥离；导入、落盘和导出均不保留观看标题。
- [x] cross-tab event 为非权威 advisory message，不持久化、不重试、不改变本地命令成功语义，也不自动暂停其他 Tab。
- [x] Chrome/Firefox production manifest 无 required host permission、静态 content script 或 WAR；bundle raw budget 通过。
- [x] 全量静态、测试、覆盖率、构建、预算、双浏览器 E2E、短 churn、Legacy hash 和 `git diff --check` 通过。
- [ ] 高级能力专项浏览器 E2E、完整浏览器版本矩阵、Tier 1 真实站点和发布工程尚未完成；它们不属于本次 GO 范围。

## 5. 架构审查

- `domain/visual`、`domain/capture`、`domain/progress` 只保存纯模型、策略和 Schema；浏览器/DOM 操作位于 adapter、
  infrastructure、runtime 或 UI 边界。
- page-main 执行媒体 DOM 和 Canvas 操作；isolated content 负责 extension runtime、Overlay 和本地下载；background 继续作为
  settings/progress 权威和跨 Tab advisory router。新增能力没有绕过三上下文 typed protocol。
- Overlay 使用 closed root 降低宿主页面意外干扰，但不是安全沙箱。WXT event isolation 只处理冒泡阶段事件，页面的
  capture-phase listener 仍可能先观察事件，因此不能把 event isolation 作为秘密或授权边界。
- top-frame-only 避免重复 Overlay；各 iframe 仍运行媒体 runtime。当前没有 frame registry/selection 聚合，iframe-only
  media 的 top-frame Overlay 体验明确降级。
- SettingsRepository 仍是 settings/progress 唯一持久化事实源；跨 Tab event 和 capture artifact 均不持久化。
- dependency-cruiser 检查 128 modules / 415 dependencies，0 violations。

## 6. 安全、隐私与权限审查

- required permissions 仍只有 `storage`、`activeTab`、`scripting`；`<all_urls>` 只存在于
  `optional_host_permissions`。没有 downloads、clipboardWrite、tabs、cookies、webRequestBlocking 或 required host。
- capture 不通过修改 CSP、强制 `crossorigin`、远程代理或任意下载绕过浏览器安全模型。CORS/DRM/未解码/尺寸/编码失败
  只返回有限错误码，不返回完整媒体 URL 或浏览器堆栈。
- 4 MiB capture 二进制会形成约 5.6 MiB base64 消息，是已登记的性能/内存风险；artifact 不经过 background 广播。
- progress 不保存 query、fragment、完整 URL、临时 media ID 或标题；匿名 hash 仅为降敏标识，不是密码学匿名化。
- cross-tab payload 只含匿名 mediaKey、source tab/frame、bounded timestamp、event ID；background 校验真实 content
  sender context，并隔离目标 Tab 发送失败。
- security scan 检查 142 个文件和 2 个 production manifest；security tests 3/3 通过。

## 7. 测试与指标

| 检查                      | 结果                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| Format / lint / typecheck | Passed                                                                                                    |
| Composite `check`         | Passed                                                                                                    |
| Unit                      | 36 files / 143 tests passed                                                                               |
| Component                 | 4 files / 19 tests passed                                                                                 |
| Integration               | 9 files / 63 tests passed                                                                                 |
| Compatibility             | 2 files / 21 tests passed                                                                                 |
| Security tests            | 1 file / 3 tests passed                                                                                   |
| Coverage total            | 52 files / 249 tests passed                                                                               |
| Coverage                  | Statements 85.68%；Branches 76.57%；Functions 87.33%；Lines 89.28%                                        |
| Dependency boundaries     | 128 modules / 415 dependencies；0 violations                                                              |
| Chrome E2E                | 3 passed；configured churn 在普通套件中按设计 skipped                                                     |
| Firefox E2E               | Firefox 153.0；optional origin、动态注册、6 类核心媒体命令和撤权通过                                      |
| Firefox lint              | 0 errors；2 条 Vue/generated runtime `UNSAFE_VAR_ASSIGNMENT` warning                                      |
| Churn smoke               | 5051 ms；94 cycles；1 worker restart；listeners `4→4`；heap `4752684→6424152` bytes                        |
| Legacy regression         | SHA-256 `91b5312d7cf150cd852d005b1e5d5f3d8ed2ed7cd8a481dfa1d561d48f7b3f27`；561788 bytes                  |

当前 Vitest 强制阈值保持 statements/lines/functions ≥80%、branches ≥75%，没有为通过 Phase 4 降低 threshold。
`content-runtime.ts` 在新增消息、启动降级和 progress orchestration 集成测试后达到 96.22% branch coverage；浏览器上下文编排
代码未恢复覆盖率排除。

## 8. 构建、预算与 manifest 证据

| Target      | background raw | content raw | page-main raw | Manifest guardrail |
| ----------- | -------------- | ----------- | ------------- | ------------------ |
| Chrome MV3  | 90,150 B       | 191,669 B   | 77,976 B      | Passed             |
| Firefox MV3 | 90,151 B       | 191,669 B   | 77,976 B      | Passed             |

强制上限分别为 150 KiB、250 KiB、200 KiB。两端 production manifest 均为 required
`storage/activeTab/scripting`、optional `<all_urls>`、`content_scripts: []`、required host 0、WAR 0。

## 9. 浏览器证据边界

现有 Chromium 三个主场景继续覆盖：授权前 absence/拒绝/受限页；当前站点媒体控制、快捷键、停用、worker restart 和
撤权；all-sites 下的 multi-player、SPA、open Shadow DOM、hostile、strict CSP、same/cross-origin iframe lifecycle 与
Options 撤权。Firefox 153.0 继续覆盖 optional origin + activeTab harness、动态注册、核心命令和撤权。

这些用例没有执行以下 Phase 4 专项场景：

1. 可真实解码视频帧的截图成功和 CORS blocked 截图；
2. native fullscreen 失败后自动回退 web fullscreen；
3. PiP API unavailable/拒绝的真实浏览器行为；
4. progress restore、接近完成删除和浏览器重启后的端侧链路；
5. 两个真实 Tab 之间的 advisory event 发布、转发和接收；
6. 页面只有 iframe media 时的 Overlay 归属、展示与交互。

因此 FR-VISUAL-001/003、FR-MEDIA-001/002/003 和 FR-UI-003 只获得 Preview 范围的 unit/component/integration/contract
验证，不能写成完整 Chrome/Firefox 高级能力 E2E 已完成。

## 10. WXT 与 Overlay 核验

针对 WXT 0.21.3 源码完成了 API 行为核验：

- `createShadowRootUi` 支持 closed root、inline position、函数 anchor、mount/remove 生命周期和 event isolation；
- content-script 的 `cssInjectionMode: 'ui'` 与 UI helper 生命周期一致，当前 `?inline` CSS 不产生 WAR；
- `ctx.isInvalid` 和 `ctx.onInvalidated` 分别处理异步创建后的早期失效与后续 teardown；
- event isolation 使用冒泡阶段阻断，不能阻止宿主页面 capture-phase 监听，也不能承担认证或数据保密职责。

## 11. Legacy 隔离审查

- `src/h5player/`、`src/libs/`、`config/`、根 Yarn/Rollup 构建链和 `dist/h5player.user.js` 未被 Phase 4 重构。
- Web Extension 继续使用独立 `web-extension/package.json`、pnpm lockfile、WXT/Vite 和测试命令。
- Legacy regression 固定 hash 和 561788-byte 大小通过；本评审不授权修改油猴实现或抽取未稳定共享核心。
- 是否重构油猴脚本仍只允许在 Phase 7 依据扩展稳定性和维护成本另行立项。

## 12. 剩余风险与强制跟进

| 项目                                                            | Owner                         | 最晚里程碑     | 发布影响                                   |
| --------------------------------------------------------------- | ----------------------------- | -------------- | ------------------------------------------ |
| iframe-only media Overlay/frame registry                        | UI / Runtime                  | Phase 5/Beta   | 未完成不得宣称 iframe Overlay 完整支持     |
| capture 真实帧/CORS E2E 与 base64 内存预算                       | Quality / Performance/Security | Phase 5/Beta   | 未完成不得扩大截图发布声明                 |
| native→web fullscreen fallback、PiP unavailable 浏览器 E2E      | Media / Quality               | Phase 5/Beta   | 未完成只保留 capability contract 声明      |
| progress restore/complete 与 multi-tab advisory 浏览器 E2E      | Data / Runtime / Quality      | Phase 5/Beta   | 未完成不得声明完整端侧恢复/协调             |
| Firefox ESR/最低 142.0、Chrome previous stable、Edge            | Quality / Release             | Phase 5/6      | 缺失阻断 Stable                            |
| headed 权限确认框、完整 30 分钟 churn、Tier 1 真实站点           | UX / Quality / Adapter Owners | Beta/Phase 5   | 缺失阻断对应 Beta/Tier 声明                |
| SBOM/license/provenance、zip 安装升级/回滚、商店与隐私材料       | Release / Security            | Phase 6        | 缺失阻断商店和 Stable                      |
| WXT 0.x、Vue generated lint warnings 与 Overlay event/z-index   | Build / Security / UI         | 每次升级/Phase 5 | 升级必须独立复核并重跑双浏览器门禁        |

## 13. 实际验证命令

在 `web-extension/` 执行并通过：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm check
pnpm test:coverage
pnpm build:all
pnpm test:budget
pnpm test:e2e
pnpm test:e2e:firefox
pnpm test:churn:smoke
pnpm test:legacy
git diff --check
```

发布候选仍必须额外执行 30 分钟 `test:churn`、完整浏览器版本矩阵、headed permission smoke、Tier 1 真实站点 smoke、
可复现 release artifact、SBOM/provenance 和 Phase 6 发布门禁。

## 14. 最终结论

`CONDITIONAL GO`

**Preview 范围可进入下一阶段工程开发。**

这里的“下一阶段”仅指 Phase 5 站点适配与兼容性收敛。该结论不等于 Stable，不等于 Beta 完成，不等于 Tier 1
真实站点完成，不等于 Firefox ESR/最低版本完成，也不表示商店发布准备完成；上述前置条件未满足前，所有对外描述必须
保持 Preview 边界。
