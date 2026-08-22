# 媒体 UI、反馈与控制权体验质量验收矩阵

> 文档 ID：QUAL-UX-001  
> 状态：In Review / Phase 6.5 Live + Firefox Headed Fixture Evidence Added
> 负责人：Quality Owner / UX Owner  
> 最后更新：2026-08-22
> 关联：REQ-UX-001、REQ-UX-002、ARCH-UX-001、ADR-0015/0016/0017、NFR-PERF/UXREL/A11Y、RISK-016/018/021/028/029/030

## 1. 证据分层

| 层级               | 证明内容                                                        | 不能证明                       |
| ------------------ | --------------------------------------------------------------- | ------------------------------ |
| Unit               | policy、scope、反馈合并、状态机、值归一化                       | 真实定位、宿主样式、浏览器焦点 |
| Component          | quick controls、feedback presenter、visibility state、a11y/i18n | 真媒体生命周期和浏览器权限     |
| Integration        | discovery → policy → command → snapshot → feedback、teardown    | 真实视频网站 DOM 漂移          |
| Real-extension E2E | 打包扩展、权限、Popup/Overlay、SPA、多媒体、Shadow/iframe       | 所有真实站点与浏览器版本       |
| Headed manual      | 实际视觉遮挡、原生焦点、鼠标/触控、站点原生控件共存             | 可重复的全量回归               |
| Live smoke         | Tier 1 真实站点、登录态/换集/广告/播放器行为                    | 脱离冻结环境的普遍兼容性       |

## 1.1 Phase 6.5 Tier 1 / Tier 2 live smoke 快照

本节记录真实站点证据，不把 `report.outcome=passed` 直接等同于 UX 验收通过。Run ID 为
`2026-08-14T23-25-32-569Z`，使用 Playwright bundled Chromium `151.0.7922.34`、headed、`1440x900`，OS 为
`darwin 25.5.0 arm64`，扩展 fingerprint 为
`b27117abd9471284c1308c2da8c7e78c5d7a6d971a3a53563e1ed573193cc9ab`。完整 JSON 和截图见
`web-extension/test-results/live-sites/2026-08-14T23-25-32-569Z/` 及
[live-site-smoke-review-2026-08-15](../09-reviews/live-site-smoke-review-2026-08-15.md)。

| 站点          | media/UI 实例证据                                                                 | 交互与反馈证据                                                                                     | 当前 UX 判定                                    |
| ------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| YouTube       | `media-0-1` 一对一；resize/scroll/reload anchor distance `0`；无 orphan/duplicate | hover 真实打开；快捷键 `1→1.1`、Popup `1.5`、reload 继承 `1.5`；feedback 可见                      | 条件通过，仍缺换集/广告/登录态和 Firefox headed |
| Bilibili      | `media-0-1` 一对一；resize/scroll/reload 映射正确                                 | hover 真实打开；快捷键、Popup、feedback、reload 继承通过                                           | 条件通过，仍缺复杂播放器状态                    |
| Tencent Video | 初始 `media-0-1`；专项 reload/WASM 为 `media-14-1`；双模式控制目标明确            | 倍速/feedback/继承通过；初始与 reload/WASM 顶层代理透明边缘真实 hover 通过；collision warning 保留 | UX-ACC-003 双模式通过；UX-ACC-005 仍待碰撞避让  |
| iQIYI         | `media-0-2` 一对一；resize/reload 通过；页面无可用 scroll 距离                    | 倍速/feedback/继承通过；兼容 Modal/新手遮罩阻断 pointer，使用 DOM fallback                         | scroll 证据缺失，pointer 可达性待补             |
| Youku         | 视觉 slot 含两个 media，Host/Trigger 只绑定 active `media-0-2`；无重复 Host       | 倍速/feedback/继承通过；登录/会员/广告浮层阻断 pointer，使用 DOM fallback                          | active 选择正确，外部浮层避让待补               |

判定规则：`DOM fallback` 是诊断降级，不是真实 pointer 通过；碰撞 warning 必须保留；无实际 scroll 距离只能写成“未测量”，不能写成
scroll 通过。五站本轮均无机器 `violations`，但这不足以将 UX-ACC-001～015 标记为 `Verified`。

Tier 2 fresh run 为 `2026-08-14T23-50-00-000Z`；Ixigua 负向 run 为 `2026-08-15T00-05-00-000Z`。

| 站点       | media/UI 实例证据                                                      | 交互与反馈证据                                     | 当前 UX 判定                                          |
| ---------- | ---------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------- |
| Netflix    | 两个可见视觉 slot 各有一个同 mediaId Host/Trigger，无 orphan/duplicate | hover、快捷键、Popup、feedback、reload 继承通过    | 实例匹配正确，但背景预览也暴露控件；UX-ACC-010 未通过 |
| AcFun      | `media-0-1` 一对一；resize/scroll/reload 稳定                          | hover 与完整倍速/反馈闭环通过                      | 冻结环境条件通过                                      |
| Sohu Video | 顶层 `media-0-1` 一对一                                                | hover 与倍速闭环通过；展开区命中 danmaku collision | UX-ACC-003/005 部分阻断                               |
| TED        | 初始 `media-0-2` 一对一                                                | hover、快捷键、Popup、feedback 通过；reload 外跳   | advertising collision；生命周期证据阻断               |
| Ixigua     | runtime ready，但两个公开入口均 `media=[]`、`hosts=[]`                 | 页面要求打开 App 看完整内容                        | 外部可用性阻断，不能评价 UX-ACC-001～010              |

Tier 2 的 `4 passed` 是 Playwright 用例完成状态，不覆盖 TED report outcome=`blocked`；Ixigua strict smoke 因 `REQUIRE_MEDIA=1` 按预期失败。
UX 验收必须读取 report outcome、warnings、pointer method 和截图，不能只读取测试退出码。

## 1.2 Firefox headed fixture 快照

2026-08-22 使用 Firefox `153.0`、生产 `.output/firefox-mv3`、`headless=false` 和 `1440x900` 请求窗口执行。完整证据见
[Phase 6.5 Firefox Headed UX 证据审查](../09-reviews/phase-6.5-firefox-headed-ux-review-2026-08-22.md)。

| 能力 | 结果 | 验收边界 |
| --- | --- | --- |
| per-media anchor | baseline/scroll/resize distance 均为 `0` | 支持 UX-ACC-001；真实站点安全区仍待补 |
| 低干扰显隐 | 默认收起、扩大透明 hitbox、播放后 opacity `0`、暂停保持收起 | 支持 UX-ACC-003；宿主控件碰撞仍待补 |
| 快捷键与反馈 | `KeyC 1→1.1×`、状态区复用、feedback expiry | 支持 UX-ACC-004/005/013；低扰动 p95 尚未测量 |
| frame 生命周期 | iframe remove/restore 后 runtime 与 media host 恢复 | 支持 UX-ACC-012/021 fixture 路径 |
| 浏览器回收 | headed/headless 完整入口均退出，无残留 driver/browser | harness 生命周期通过 |

Firefox fixture 通过不计入 Firefox live-site smoke，不覆盖原生权限确认框、200% zoom、theme、reduced-motion、字幕、站点原生控件、ESR/最低版本或用户 Exit Review。

## 2. 需求追踪与验收项

| ID         | 验收标准                                                                                                                   | 证据                                          | 阻断级别 |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | -------- |
| UX-ACC-001 | 默认页面不显示视口级大面板；控件 host 与媒体 DOMRect 误差在滚动/resize 后保持在 UI 设计阈值内                              | component + Chromium E2E + Firefox headed fixture | P0       |
| UX-ACC-002 | 同一媒体最多一个 UI host；移除、停用、撤权后 host/listener/timer 全部清理                                                  | unit + integration + churn                    | P0       |
| UX-ACC-003 | 播放中 UI 不持续遮挡视频主体；暂停时已展开面板立即收起且不得被状态反馈重新打开；仅倍速状态区的悬停/焦点/触控明确手势可展开 | component + Firefox headed fixture + live manual | P0       |
| UX-ACC-004 | 快捷键和 UI 产生同一 `FeedbackEvent`，连续同类操作只保留最终值                                                             | unit + component + dual-browser E2E           | P0       |
| UX-ACC-005 | 倍速反馈出现在当前媒体右上角安全区，约 1.5～2 秒后消失，不抢焦点，不拦截视频操作                                           | component + Firefox headed fixture + live manual | P0       |
| UX-ACC-006 | 新媒体、重播、SPA 换集和 src 变化自动应用 effective rate，用户无需重复设置                                                 | integration + real-extension E2E              | P0       |
| UX-ACC-007 | website reset 在保护开启时有界重应用并显示最终状态；保护关闭时显示可解释降级                                               | unit + hostile fixture + live smoke           | P0       |
| UX-ACC-008 | 全局默认、站点策略、页面临时覆盖、当前媒体临时意图、媒体实际值五个概念可区分；Popup/Options 显示有效来源                   | unit + component + E2E                        | P0       |
| UX-ACC-009 | 当前媒体设置与页面策略写回范围可预测；“仅当前媒体”不会污染站点/全局设置                                                    | unit + integration + E2E                      | P0       |
| UX-ACC-010 | 多媒体页面不误控第二个内容媒体、广告或背景音频；active media 变化时 UI/反馈归属同步                                        | integration + multi-player E2E                | P0       |
| UX-ACC-011 | audio 无媒体矩形时使用紧凑页面反馈，不出现大面板                                                                           | component + headed manual                     | P1       |
| UX-ACC-012 | 无 anchor、iframe-only、能力不支持、权限撤销和站点停用显示独立降级态                                                       | component + dual-browser E2E                  | P0       |
| UX-ACC-013 | 输入框/可编辑元素内快捷键不触发；Popup/Options/Overlay 入口命令语义一致                                                    | unit + dual-browser E2E                       | P0       |
| UX-ACC-014 | zh-CN/en-US、深色/浅色、200% 缩放、reduced-motion、键盘焦点通过 a11y 基线                                                  | axe + keyboard + Firefox headed fixture + manual | P1       |
| UX-ACC-015 | 空白页、无媒体页和媒体 churn 不产生持续长任务或 listener/host 单调增长                                                     | performance + churn                           | P0       |
| UX-ACC-016 | 保护开启后，网站普通 setter 和 50～200ms 轮询不能覆盖已确认的 `playbackRate`；相同值写入不报错，关闭保护后网站值可生效     | unit + hostile real-extension E2E             | P0       |
| UX-ACC-017 | `protectVolume` 同时保护 volume/muted；网站自动静音、恢复音量和延迟回写不能覆盖用户值，关闭后恢复透明                      | unit + hostile real-extension E2E             | P0       |
| UX-ACC-018 | `protectCurrentTime` 默认关闭；开启后只在扩展 seek/恢复的短租约内阻止冲突跳转，自然播放持续推进，租约外站点 seek 可生效    | unit + integration + headed fixture           | P0       |
| UX-ACC-019 | 未绑定媒体、第二媒体、广告/背景媒体和保护关闭属性完全透传；单一 binding teardown 后不再拦截，prototype descriptor 可恢复   | unit + multi-player + churn                   | P0       |
| UX-ACC-020 | 自定义媒体元素/adapter 只有在真实 actual value 已变化后返回成功；腾讯切片/换集后连续快捷键仍控制真实播放实例               | unit + Tencent live smoke                     | P0       |
| UX-ACC-021 | 扩展 reload/撤权/frame 销毁不会留下 wrapper、timer 或未处理 `Extension context invalidated`；失败按属性降级且有诊断        | integration + dual-browser E2E + console audit | P0       |

## 3. 建议新增自动化场景

### 3.1 Fixture 页面

- `media-anchor.html`：媒体尺寸、位置、滚动、resize、fullscreen 变化。
- `media-feedback.html`：连续倍速/音量/seek 操作、消息替换和过期。
- `media-churn-rate.html`：动态新增、删除、复用媒体与 src 变化。
- `media-policy.html`：global/site/page/media 四层策略、网站反向设置、保护开关。
- `media-authority.html`：prototype setter、实例 setter、50～200ms 轮询、延迟 reset、保护开关、第二媒体透传、descriptor teardown。
- `media-seek-lease.html`：自然播放推进、扩展 seek、冲突拉回、租约到期、直播/换集模拟。
- `media-obscured.html`：广告、背景音频、不可见媒体和多个内容播放器。
- `touch-overlay.html`：无 hover 的 touch/pointer 打开与收起。

### 3.2 单元与组件

- `playback-policy.spec.ts`：优先级、scope、source、能力降级。
- `playback-lifecycle-coordinator.spec.ts`：event generation、去重、有界重试、teardown。
- `media-anchor-registry.spec.ts`：DOMRect、fallback placement、host 清理。
- `feedback-presenter.spec.ts`：merge/replace/expiry/error/aria-live/no-anchor。
- `quick-controls.spec.ts`：低认知入口、固定倍速、当前值、disabled/unsupported。
- `overlay-visibility.spec.ts`：hover/focus/pause/touch/hidden/reduced-motion。
- `media-control-authority.spec.ts`：getter 透明、per-instance rate/volume/muted、currentTime lease、custom element、diagnostics、teardown。
- `page-media-protocol-boundaries.spec.ts`：authority configure 的 strict schema、错误 source/session/replay 和 response pairing。

### 3.3 端侧与人工

- Chromium headed：至少验证 basic、multi-player、SPA、strict CSP、hostile、Shadow DOM、iframe。
- Firefox headed fixture 已自动验证定位、feedback、快捷键、暂停收起和 iframe teardown/restore；继续验证真实站点、原生权限确认、临时扩展重启与最低版本。
- Tier 1 live smoke：YouTube、Bilibili、Tencent Video、iQIYI、Youku；Tier 2 smoke：Netflix、Ixigua、AcFun、Sohu Video、TED；记录浏览器、OS、扩展 fingerprint、页面类别、换集/广告/登录态，并将真实 pointer、DOM fallback、blocked/no-media 分开计分。
- 腾讯专项：正常 HTMLMediaElement 与 WASM `<fake-video>` 双路径；等待实际播放、触发切片/换集、连续调速，至少读取两个时间点的真实 rate/播放进度；仅 storage、扩展 snapshot 或隐藏辅助实例变化判为 inconclusive。
- 视觉记录：默认播放中、暂停、悬停展开、快捷键反馈、站点原生控件共存、字幕和窄屏。

## 4. 指标与门槛

- 媒体发现到 quick controls 可交互：p95 ≤ 150ms，复用 NFR-PERF-002。
- 命令成功到 feedback 首次可见：headed 基线 p95 ≤ 100ms；若浏览器限制无法稳定测量，必须记录测量方法和例外。
- feedback 默认可见窗口：1.5～2.0s；连续操作不得超过一个同类提示。
- 页面 UI 默认覆盖面积：媒体主体的目标 ≤20%；超出时自动收缩为入口按钮并登记截图证据。
- 30 分钟媒体 churn：host、listener、observer、timer 数量无单调增长；失败时阻断 P0。
- 关键体验需求分支覆盖率 ≥95%；新增协调器/策略服务不能以全局阈值替代关键路径覆盖。
- authority 不创建常驻短周期 interval；hostile 页面自身轮询运行 60 秒时，扩展 blocked counter 有上限、实际值稳定、主线程无扩展引起的持续长任务。

## 5. 缺陷分级

- P0：视口大面板默认出现、控件/反馈定位到错误媒体、倍速每次新媒体必须重复设置、网站可静默夺回已保护的 rate/volume/seek、命令误控第二媒体、teardown 泄漏。
- P1：反馈延迟/遮挡明显、触控无法打开、策略来源不清、站点反向改值无解释、a11y/国际化阻断核心路径。
- P2：二级菜单布局、小幅动画或非核心高级能力差异。

## 6. 完成门禁

当前 live smoke 仅使 UX-ACC-001/004/006/010 获得部分真实证据；Firefox headed fixture 为 UX-ACC-001/003～005/012～014/021 增加浏览器内证据，但不计真实站点通过。Netflix 背景媒体误暴露已关闭；Tencent 宿主碰撞、iQIYI/Youku pointer、Sohu/TED 碰撞、
TED reload 外跳、Ixigua no-media、iQIYI scroll、换集/广告/登录态、Firefox live-site/权限 UX 仍未关闭；30 分钟 churn 与 Firefox fixture 基线已通过。UX-ACC-001～010、012、
013、015～021 的 P0 未全部完成前，Phase 7 保持冻结；不得以“Popup 能控制媒体”“unit 通过”“fixture 全绿”“Playwright passed”或
“report outcome=passed”替代页面体验证据。UX-ACC-011/014 的 P1 缺口必须显式评审和接受。
