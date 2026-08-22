# 自动化质量门禁

> 文档 ID：QA-002  
> 状态：In Review / Phase 6.5 UX Gate Amendment<br>
> 负责人：Quality Owner  
> 最后更新：2026-08-15

## 1. PR 门禁（每次变更）

必须全部通过：

- `format:check`
- `lint`
- `typecheck`
- `unit`
- 受影响模块的组件/集成测试
- 依赖边界与循环依赖扫描
- 禁止代码/远程资源/权限扫描
- manifest schema/lint
- Legacy 构建回归（不修改其源码）
- `test:coverage` 全局 thresholds：statements/lines/functions ≥80%，branches ≥75%
- `build:all` 后执行 `test:budget`，同时检查三类入口 raw budget 和 production manifest guardrail

以下变更额外要求：

| 变更                  | 额外门禁                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------- |
| message/schema        | contract tests + backwards compatibility review                                           |
| storage/migration     | N/N-1/corrupt/rollback tests                                                              |
| permission/manifest   | security review + store text update                                                       |
| DOM Hook/adapter      | hostile page + lifecycle + target browser E2E                                             |
| UI                    | component + a11y + i18n tests                                                             |
| build/release         | reproducibility + artifact inspection                                                     |
| capture/progress      | bounded artifact、隐私/TTL/容量、CORS/DRM/完成删除测试                                    |
| cross-tab             | sender context、source tab 过滤、发送失败隔离、无轮询证明                                 |
| per-media UI/feedback | anchor registry、媒体定位/避让、反馈时序/最终值、宿主兼容与 teardown                      |
| playback policy       | global/site/page/media 优先级、scope writeback、lifecycle replay、hostile reset、有界重试 |

## 2. Nightly 门禁

- Chrome/Firefox 完整 E2E 矩阵。
- 30 分钟媒体 churn 和 worker restart 压力。
- Tier 1/2 adapter fixture。
- 依赖漏洞、许可证、SBOM 和产物扫描。
- 与上一稳定候选的差分测试。
- 生成覆盖率、兼容性、性能和 flaky 报告。
- Phase 6.5 UX fixtures：anchor/feedback/policy/churn/multi-player/touch；保存截图、trace、反馈时序和资源计数。

## 3. Release Candidate 门禁

- 所有 PR 门禁和 nightly 结果在候选提交上重新运行。
- P0 E2E 100% 通过；P1 E2E ≥90% 且未通过项有批准的风险记录。
- 核心 domain/application 覆盖率达到 NFR 目标。
- bundle、启动、内存和长任务预算不超标。
- Critical/High 安全漏洞为 0；权限与隐私文案一致。
- Chrome/Firefox zip 可安装、升级、卸载和回滚。
- 产物 hash、SBOM、许可证、提交 SHA 和版本 metadata 齐全。
- `QUAL-UX-001` P0 验收项全部通过；不得用 Popup 控制成功、headless harness 或 fixture 全绿替代 headed 视觉证据。

## 4. Stable Go/No-Go

### Go 条件

- 无未接受 P0/P1 缺陷。
- 两个连续候选版本在目标浏览器矩阵通过。
- Tier 1 站点自动化保护通过，Tier 2 有明确降级说明。
- 数据迁移/恢复演练成功。
- 权限、安全、隐私、商店 listing 和支持文档均获审查。
- 回滚包和 incident 联系路径可用。

### No-Go 条件

- 任何未解释的权限扩大、远程代码或 CSP 绕过。
- 关键命令在一个目标浏览器不稳定。
- service worker 重启导致设置丢失或页面无法重连。
- E2E 通过依赖真实生产站点偶然可用。
- 发布产物不可复现或无法确认来源。

## 5. 例外规则

例外必须写入 `RISK-*` 或发布审批记录，包含：范围、理由、用户影响、临时缓解、owner、到期版本和回退条件。P0 安全门禁、远程执行禁止项和数据损坏保护不可豁免。

## 5.5 Phase 6.5 UX 强制门禁（用户审核后生效）

### 进入门禁

- `REQ-UX-001`、`REQ-UX-002`、`ARCH-UX-001`、`QUAL-UX-001` 已由用户审核并标记 Approved 或明确条件批准。
- EXT-128～139 必须补齐 owner、依赖、验证文件和失败回退；未经批准的需求不得进入 `Ready`。
- Legacy 文件、根构建链和 `dist/` 的 hash baseline 保持不变；Phase 6.5 只能修改 `web-extension/` 及测试/项目文档。

### PR / Integration 门禁

- `MediaAnchorRegistry`：同一 `mediaId` 至多一个 host；scroll/resize/fullscreen/SPA/source 变化后定位可重算；移除、停用、撤权清理 host/listener/observer/timer。
- `MediaFeedbackPresenter`：快捷键、Overlay、Popup 使用同一 `FeedbackEvent`；同媒体同类反馈 replace/merge，默认 1.5～2.0 秒过期，显示最终值、aria-live 和错误原因。
- `PlaybackPolicyResolver`：global/site/page/media 优先级、source、保护状态和 scope writeback 具备纯函数测试；当前实际值不写入 settings，临时作用域不污染持久策略。
- `PlaybackLifecycleCoordinator`：新媒体、loadedmetadata/canplay/playing/replay/src/SPA/reset 和 teardown 有状态机测试；重复目标去重、重试有界、无无限 interval/MutationObserver。
- `MediaControlAuthority`：每个媒体实例独立 binding；rate/volume/muted 保护和 currentTime 短租约有 unit/hostile fixture；网站写入只能触发有界重申，停用、撤权、detach、reload 必须 fail-closed。
- `Runtime lifetime`：content/background 的 Port disconnect 必须同步消费 `runtime.lastError`；BFCache 恢复后重连；context invalidation 只吞精确失效错误并清理旧 UI/timer/listener/bridge；Chromium 错误面板不得新增对应记录。
- UI 变更必须通过组件、a11y、i18n、宿主 CSS 污染和 visual regression；页面默认不得出现视口级大面板。

### Nightly / RC 体验门禁

- Chromium/Firefox headed visual：播放中折叠、悬停/焦点展开、暂停、触控打开、反馈右上角安全区、窄媒体避让、字幕/原生控件共存。
- Real-extension E2E：新媒体/重播/SPA 换集/`src` 变化自动继承倍速；多媒体不误控广告/背景音频；Popup/Overlay/快捷键结果一致。
- Hostile/live authority：50～200ms setter/轮询、延迟 reset、自定义媒体实例、child→top/实例替换后仍保持用户 intent；探测器的 stale-frame 降级不得替代真实 rate、时间增量、轮询稳定性和反馈断言。
- 30 分钟媒体 churn：host/listener/observer/timer 无单调增长；listener/host leak 直接阻断 P0。
- Tier 1 live smoke：YouTube、Bilibili、Tencent Video、iQIYI、Youku；Tier 2 smoke：Netflix、AcFun、Sohu Video、TED、Ixigua；记录浏览器/OS/扩展 SHA/页面类型/登录态/广告/换集与截图。

### 当前 live smoke 门禁证据（更新至 2026-08-17）

| 门禁                | 当前证据                                                                                                                                                                         | 判定                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Tier 1 冻结环境     | Run `2026-08-14T23-25-32-569Z`；Chromium `151.0.7922.34` headed；`darwin 25.5.0 arm64`；extension fingerprint `b27117abd9471284c1308c2da8c7e78c5d7a6d971a3a53563e1ed573193cc9ab` | Recorded                       |
| Tier 1 实例/UI 映射 | 五站 baseline/resize/reload 无 orphan/duplicate；除 iQIYI 无可用 scroll 距离外，其余 scroll 映射通过                                                                             | Partial pass                   |
| Tier 1 倍速闭环     | 五站快捷键 `1→1.1`、Popup `1.5`、feedback 可见、reload 后 `1.5` 继承通过                                                                                                         | Pass in frozen environment     |
| 控制权 hostile 门禁 | authority unit/fixture 覆盖 setter、50～200ms 轮询、延迟 reset、custom element、短租约 seek、detach/teardown；Chromium hostile E2E 通过                                          | Engineering pass               |
| Tencent 切片/reload | Run `2026-08-16-tencent-stale-frame-fix`；切片后新实例继承 `1.5x`，快捷键到 `2x` 后抵抗站点轮询并显示反馈，reload 后 `1.5x` 继续继承；`violations=[]`                            | Conditional live pass          |
| Tier 1 真实 pointer | YouTube/Bilibili hover 通过；Tencent 初始与 reload/WASM 顶层代理透明边缘 hover 均通过；iQIYI/Youku 需要 DOM fallback                                                             | P1 evidence gap                |
| Tier 1 宿主共存     | Tencent 仍有原生控制/弹幕层碰撞 warning；Youku 出现浮层碰撞；iQIYI 有站点 Modal/新手遮罩                                                                                         | UX hold                        |
| Tier 2 媒体页面     | Run `2026-08-14T23-50-00-000Z`；Netflix/AcFun/Sohu/TED；Playwright `4 passed`，report `3 passed + 1 blocked`                                                                     | Conditional evidence           |
| Tier 2 实例/UI      | Netflix 两 slot 各自一对一；AcFun/Sohu/TED 初始 mediaId 一对一；Sohu/TED 保留碰撞 warning                                                                                        | Partial pass                   |
| Tier 2 生命周期     | Netflix/AcFun/Sohu reload `1.5`；TED reload `external-navigation`，不计继承通过                                                                                                  | Partial pass                   |
| Ixigua 外部阻断     | Run `2026-08-15T00-05-00-000Z`；两个公开入口 HTTP 200 但 `media=[]`，截图为“打开 App 看完整内容”                                                                                 | Not compatible evidence        |
| 浏览器通道          | bundled Chromium 可自动侧载；品牌 Chrome/Edge 已移除 Playwright 所需侧载 flags                                                                                                   | Brand browser evidence missing |

`report.outcome=passed` 只表示该站点没有机器 `violations`，不覆盖 warnings；Playwright `passed` 也不覆盖 report 的 `blocked/no-media`。
DOM fallback 不满足真实 pointer 门禁；外部浮层、碰撞、无滚动距离、reload 外跳和 App-only 页面都必须在报告中保留。详细证据见
[live-site-smoke-review-2026-08-15](../09-reviews/live-site-smoke-review-2026-08-15.md) 与
[媒体控制权优先级与腾讯切片稳定性审查](../09-reviews/media-control-authority-and-tencent-stability-review-2026-08-17.md)。

品牌 Chrome/Edge 不允许当前 Playwright persistent-context harness 自动加载未打包扩展；依据
<https://playwright.dev/docs/chrome-extensions>，自动化继续使用 bundled Chromium，品牌浏览器通过独立手工安装/专用环境验证，不能混写为已通过。

### Exit 规则

- UX-ACC-001～010、012、013、015 为 P0，必须全部 `Verified`。
- UX-ACC-011、014 为 P1；未通过项必须有明确风险记录和用户接受，不得静默标绿。
- EXT-139 Exit Review 必须明确 `UX GO`、`UX CONDITIONAL GO` 或 `UX NO-GO`；只有前两者且用户确认时，才允许重新评估 Phase 7。

## 6. Phase 4 强制预算与执行约束

| 项目                   | 门槛/策略                                       | 当前结果                              |
| ---------------------- | ----------------------------------------------- | ------------------------------------- |
| background raw         | ≤150 KiB                                        | Chrome 90,150 B；Firefox 90,151 B     |
| content raw            | ≤250 KiB                                        | 两端 191,669 B                        |
| page-main raw          | ≤200 KiB                                        | 两端 77,976 B                         |
| production manifest    | required host=0、static content script=0、WAR=0 | Passed                                |
| Chromium extension E2E | `workers: 1`，每场景独立 persistent profile     | 3 passed / 1 configured churn skipped |
| churn smoke            | 5 秒 PR smoke；30 分钟 nightly/RC               | 94 cycles、1 restart、listeners 4→4   |

Chromium 扩展 lifecycle 用例不得在同一机器上并行启动多个 persistent profile。Phase 4 实测并行运行会让 profile seed/
close/worker startup 争抢资源，在产品断言开始前耗尽 30 秒 timeout；串行运行全部通过。需要并行时应拆成独立 CI job/
runner，而不是提高单用例 timeout 掩盖资源竞争。

Phase 4 Conditional GO 不替代 Nightly/RC 门禁：尚未重跑 30 分钟 churn、Tier 1 真实站点、完整浏览器版本矩阵、
headed 权限 UX、zip 安装升级/回滚和 SBOM/provenance。

## 7. Phase 5 Adapter 强制门禁

- `pnpm test:compat` 必须通过所有 Tier 1/Tier 2 脱敏 fixture；`pnpm test:compat:report` 必须通过
  catalog/fixture/SHA baseline。
- 每个 adapter 必须有 owner、version、Tier、support level、fixture 和 lastVerified；support level/owner drift 或超过
  183 天未复核均阻断合并。
- registry priority/tie、version/feature disable、SPA rematch、attach/detach/action/selector failure isolation 必须有自动化证据。
- adapter diagnostics 必须 bounded、脱敏，并显示 selected/status/failureCount/disabledFeatures；Generic fallback 不能被站点异常破坏。
- Tier 1 已有一次 bundled Chromium headed smoke，但三站仍有 DOM fallback/遮挡 warning，换集/广告/登录态与品牌浏览器未覆盖；
  这些属于明确黄项，不得在发布说明中写成完整生产支持。
- kill switch 只能是随扩展发布的静态代码，不允许远程 selector、远程任意函数、页面注入规则或新增权限。

## 8. Phase 6 发布工程强制门禁

| 层级    | Repository 自动化                                                                                                | 外部/人工证据                                                                                 |
| ------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| PR      | Legacy baseline；`check`/coverage/build/budget/security；Firefox lint；双端 package + verify；Chrome/Firefox E2E | GitHub required-check/branch-protection 实际配置                                              |
| Nightly | PR 基线 + production audit + 30 分钟 churn + 双次 release reproducibility                                        | 必要时真实站点独立 smoke，不并入易 flaky 的 PR                                                |
| RC      | 候选 SHA 重跑全部 gate；显式 channel/sequence/source date；9 文件 evidence；no-publish artifact                  | 浏览器版本矩阵、Tier 1 live、headed 权限、install/upgrade/rollback、store sign-off、Beta 窗口 |
| Stable  | 自动 gate 全部 `passed` 且两个连续真实候选                                                                       | Stable Go/No-Go 全角色签字、商店签名/提交和回退路径                                           |

发布工具的 gate 输入只是一项证据摘要，不能自行证明 CI 或人工检查发生。以下规则不可豁免：

- 正式候选工作树必须 clean；版本、commit、lockfile、toolchain、canonical source date 和 artifact hash 必须闭环；只有 Stable
  profile + clean worktree + 全 gate passed 才可标记 `stableEligible`。
- `release:verify` 必须确认 bundle 只有规范 9 文件，绑定 artifact file/browser/inspection，重建兼容报告并重新检查两端 ZIP；
  `release:reproducibility` 必须逐文件 hash 一致。
- 运行时依赖许可证不在 allowlist、SBOM/lockfile/digest 不一致、危险 ZIP metadata、权限/CSP/远程代码漂移立即失败。
- dependency audit 必须覆盖 dev/build closure，禁止用 `--prod` 隐藏构建链风险；RISK-027 只允许精确 GHSA ID 的临时例外。
- `compatibility-report.html` 必须与当前 adapter catalog/fixture SHA baseline 重建结果逐字一致；fixture-only 状态不能转换为 live
  smoke `passed`。
- unpacked E2E 与 archive inspection 不等于真实商店签名包安装/升级/降级；`artifact-install` 在外部演练前保持未完成。
- Stable 只要缺少两个连续 Beta RC、目标版本矩阵、无阻断 warning 的 Tier 1 live、headed 权限、store sign-off 或观察窗口，结论即 `NO-GO`。

Phase 6 repository baseline 的验证记录见 `phase-6-exit-review-2026-08-11.md`；该 Conditional GO 只允许进入真实 Beta
取证，不允许把 RC workflow 产物上传 Stable 渠道。
