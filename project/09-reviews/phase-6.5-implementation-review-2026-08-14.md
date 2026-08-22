# Phase 6.5 实现与验收证据审查（2026-08-14）

> 后续覆盖说明（2026-08-19）：本文保留 2026-08-14/15 当时的实现与风险结论。Netflix 多媒体前景归属已由 [Netflix 前景媒体归属审查](./netflix-foreground-media-ownership-review-2026-08-19.md) 关闭；30 分钟 churn 已取得部分稳定性证据，但 Observer/Timer/authority teardown/heap 斜率仍未直接取证；高级能力差距见 [实验与高级能力差距审查](./experimental-capability-gap-review-2026-08-19.md)。Phase 7/Stable HOLD 结论不变。

> 后续覆盖说明（2026-08-20）：route-first 首键、腾讯换集 staged intent/旧 frame 响应恢复、Dailymotion 跨域首键与双端 bundle budget 的最新证据见 [Phase 6.5 路由首键、腾讯换集与 Bundle Budget 收口审查](./phase-6.5-route-first-hotkey-and-budget-review-2026-08-20.md)。该审查更新 targeted 工程证据，但不改变本文的 UX NO-GO、Phase 7 HOLD 和用户 Exit Review 门禁。

> 后续覆盖说明（2026-08-22）：Observer/Timer/authority/heap/Long Task 增强诊断已完成连续 30 分钟复跑，UQA-005 更新为 PASS；详见 [Phase 6.5 长稳态 Churn 与 Legacy 构建隔离审查](./phase-6.5-churn-and-legacy-isolation-review-2026-08-22.md)。Phase 7/Stable HOLD 仍由 Firefox headed、真实站点/宿主 UI 风险和用户 Exit Review 决定。

> 文档 ID：REVIEW-UX-002  
> 状态：In Review / Engineering Implemented / UX NO-GO  
> 负责人：Project Owner / Product Owner / UX Owner / Quality Owner  
> 最后更新：2026-08-15  
> 关联：EXT-128～139、REQ-UX-001/002、ARCH-UX-001、ADR-0015/0016、QUAL-UX-001、RISK-021/028/029  
> 审查范围：当前共享工作树中的 Web Extension Phase 6.5 实现、自动化与 2026-08-14/15 Tier 1/Tier 2 bundled Chromium live smoke；不包含品牌浏览器、商店、签名包或最终用户验收

## 1. 审查结论

Phase 6.5 已不再是纯文档提案：per-media anchor、低干扰 quick controls、媒体级 feedback、倍速 policy/lifecycle、
Popup/Options 作用域说明、frame runtime registry 和相应自动化已经进入实现审查。

当前结论：`ENGINEERING IMPLEMENTED / LIVE SMOKE PARTIAL / UX NO-GO / PHASE 7 HOLD`。

这表示核心架构方向和主要代码切片已经落地，且九个取得媒体的真实站点已取得冻结环境的实例/UI 与基础倍速闭环证据，Ixigua 也有
App-only/no-media 负向证据；但不能宣告 Phase 6.5 完成，也不能进入 Phase 7。Netflix 多 slot、Tencent/iQIYI/Youku 真实 pointer、
Sohu/TED 宿主碰撞、Firefox UX、30 分钟 churn、换集/广告/登录态和用户签字仍是强制门禁。

## 2. 已实现能力与证据

| 能力                              | 主要实现                                                                    | 当前自动化证据                                                                                                         | 证据边界                                                            |
| --------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| per-media anchor 与 host 生命周期 | `src/infrastructure/dom/media-anchor-registry.ts`、`entrypoints/content.ts` | `media-anchor-registry.spec.ts`；Chromium scroll/resize/replacement/removal E2E                                        | 未证明 native fullscreen、所有站点 CSS/z-index 和 30 分钟资源稳定性 |
| 低干扰 quick controls             | `src/ui/media/MediaQuickControls.vue/.css`                                  | component 覆盖 playing/paused/compact、hover/focus/click、Escape/Tab、touch pointer、scope/hide actions                | 未完成 headed 遮挡、字幕、原生控件、窄屏和 200% zoom 审查           |
| typed per-media feedback          | `src/application/feedback/*`、`MediaFeedbackPresenter.vue`                  | unit/component 覆盖最终值、error redaction、replace/expiry、policy edge、aria-live；audio-only fallback E2E            | 未完成真实像素安全区、p95 时延和跨入口 headed 证据                  |
| playback policy 与写回 scope      | `src/domain/playback/*`、content/background/runtime API、Popup/Options      | policy unit、site write contract、page/media session isolation integration、Popup/Options component                    | 尚未在 Tier 1 真实站点证明所有换集/reset/writeback 行为             |
| playback lifecycle                | `PlaybackLifecycleCoordinator`                                              | 新媒体、重播、source/duration generation、bounded retry、teardown/race、hidden/tiny/audio eligibility unit/integration | 缺真实 SPA 换集、站点反向 reset 与长时间运行证据                    |
| frame/runtime 聚合与继承          | `FrameRuntimeRegistry`、site access/background/content protocols            | registry/site/background tests；iframe-only、late same/cross-origin state inheritance E2E                              | Firefox headed、复杂嵌套 frame 与真实播放器仍未验证                 |
| Popup/Options 产品说明            | `PopupApp.vue`、`GeneralPage.vue`、`SitesPage.vue`                          | scope/source/protection、global/site 设置和继承恢复 component/unit/integration                                         | 新用户 usability 与商店版本实测待补                                 |

### 2.1 2026-08-14/15 live smoke 增量证据

- Tier 1 Run `2026-08-14T23-25-32-569Z` 在 Playwright bundled Chromium `151.0.7922.34` headed、`darwin 25.5.0 arm64`、
  viewport `1440x900` 下完成，五站测试均通过机器断言且 `violations=[]`。
- YouTube/Bilibili 的真实 hover 展开通过；Tencent/iQIYI/Youku 只能由 DOM fallback 证明控件状态，不能计为真实 pointer 通过。
- 五站 baseline/resize/reload 的 mediaId/Host/Trigger 无 orphan/duplicate；除 iQIYI 无可用 scroll 距离外，其余 scroll 映射通过。
- 五站快捷键 `1→1.1`、Popup `1.5`、feedback 可见和 reload `1.5` 继承通过。Tencent reload 后 mediaId 变化为 `media-13-1`，
  UI 仍重新绑定到新实例；Youku 一个视觉 slot 内两个 eligible media 只为 active `media-0-2` 创建 Host/Trigger。
- 腾讯父页面原生控制/弹幕层覆盖 child-frame UI；iQIYI 兼容 Modal/新手遮罩、Youku 登录/会员/广告层会阻断 pointer。
  这些是实际兼容边界，不是可删除的测试噪声。
- Tier 2 Run `2026-08-14T23-50-00-000Z` 覆盖 Netflix、AcFun、Sohu、TED：Netflix 两个视觉 slot 各自正确绑定但背景媒体也暴露 UI；
  AcFun 无 warning；Sohu 有 danmaku collision；TED 初始交互通过但 reload `external-navigation`，report outcome=`blocked`。
- Ixigua Run `2026-08-15T00-05-00-000Z` 的两个公开入口均无 `<video>`，页面显示“打开 App 看完整内容”；只能记为外部可用性阻断，
  不得计入兼容通过。

完整报告、截图和逐站结论见 [live-site-smoke-review-2026-08-15](./live-site-smoke-review-2026-08-15.md)。

## 3. UX-ACC 当前判定

| 验收项     | 当前状态                 | 已有证据                                                                                                                                             | 仍缺证据                                                      |
| ---------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| UX-ACC-001 | In Review / live partial | 五站 baseline/resize/reload 映射；四站 scroll；anchor distance `0`；无 orphan/duplicate                                                              | iQIYI scroll、native fullscreen、三站浮层可达性               |
| UX-ACC-002 | In Review / partial      | removal/disable/revoke/iframe lifecycle 自动化；fresh 30 分钟 run 6587 cycles/131 restarts/quick-control host 回零                                   | 完整 Host、listener、observer/timer 与 authority binding 计数 |
| UX-ACC-003 | In Review / live partial | YouTube/Bilibili 真实 hover；五站折叠/展开截图                                                                                                       | Tencent/iQIYI/Youku pointer、触控设备、字幕/原生控件共存      |
| UX-ACC-004 | In Review / live partial | 五站快捷键与 Popup 均反馈最终值；typed replace/expiry unit/component                                                                                 | Overlay 点击入口真实端侧一致性与连续操作时序                  |
| UX-ACC-005 | In Review / live partial | 五站 feedback 可见且归属正确 media；无 viewport overflow                                                                                             | 三站外部层遮挡、p95 首帧时延                                  |
| UX-ACC-006 | In Review / live partial | 五站 Popup `1.5` 在 reload 后自动继承，Tencent 新 frame/mediaId 仍继承                                                                               | 真实换集、src/MSE/reset 和 Firefox E2E                        |
| UX-ACC-007 | In Review / partial      | protection on/off、bounded retry、edge feedback unit                                                                                                 | hostile browser fixture 与 Tier 1 reset/live smoke            |
| UX-ACC-008 | In Review / partial      | global/site/page/media resolver；Popup source/protection；Options global/site                                                                        | 页面整体可用性与真实 E2E 来源展示                             |
| UX-ACC-009 | In Review / partial      | page/media session isolation、site persistence 与失败 fallback integration                                                                           | 完整端侧 writeback/reload/navigation 证据                     |
| UX-ACC-010 | In Review / live partial | Youku 同一视觉 slot 两个 media 只绑定 active `media-0-2`；无重复 Host                                                                                | 广告/背景媒体切换和多视觉播放器 headed 反馈                   |
| UX-ACC-011 | In Review / partial      | audio-only page feedback E2E、presenter component                                                                                                    | headed 音频反馈与宿主页面共存                                 |
| UX-ACC-012 | In Review / partial      | no-anchor/audio/iframe-only/permission/disable 自动化                                                                                                | 能力不支持、复杂 frame 和人工降级文案证据                     |
| UX-ACC-013 | In Review / partial      | editable E2E、typed command/scope contracts                                                                                                          | 三入口端侧最终值与错误语义一致性                              |
| UX-ACC-014 | In Review / partial      | zh-CN/en-US、keyboard、aria-live、component a11y 基线                                                                                                | 200% zoom、light/dark、reduced-motion、Firefox headed         |
| UX-ACC-015 | In Review / partial      | generation/race/fail-closed reconnect tests；fresh 30 分钟 run 1801096ms、6587 cycles、131 restarts、window listeners `4→4`、首尾 GC heap 在宽限额内 | Observer/Timer/LongTask、分段 heap 斜率与完整资源趋势         |

## 4. 当前阻断与剩余门禁

1. Tencent child-frame UI 与父页面原生控制/弹幕层冲突；需评审保持 child-frame 自持 UI 还是引入受控 top-frame proxy。
2. iQIYI 的兼容 Modal/新手遮罩、Youku 的登录/会员/广告浮层阻断真实 pointer；需建立浮层避让、延迟打开或明确降级策略。
3. Chromium headed：native fullscreen、字幕/原生控件、深浅主题、200% zoom、reduced-motion、p95 feedback 时延仍缺证据。
4. Firefox headed：页面定位、反馈、快捷键、frame teardown 和临时扩展重启体验仍未执行。
5. Tier 1 live smoke 尚未覆盖换集、广告、登录态、站点 reset；iQIYI 本轮没有可用 scroll 距离，不能写成 scroll 通过。
6. 运行稳定性：fresh 30 分钟 churn 已证明 quick-control host 每轮回零、选定 window listeners 保持 `4→4`、131 次 worker restart 可恢复和首尾 heap 在宽限额内；要满足完整合同仍需 typed observer/timer/authority diagnostics 与分段 heap/LongTask 取样。
7. 外部体验：原生权限确认框、商店 listing/截图和签名包 install/update/rollback 仍属于 Phase 6 外部门禁。
8. 用户 Exit Review：EXT-139 必须记录 `UX GO`、`UX CONDITIONAL GO` 或 `UX NO-GO` 并获得用户确认。

## 5. 风险与处置

- 发现 iframe 恢复后立即重启 MV3 worker 时，初始 `settings.get` 可被终止中的 worker 打断并留下 fail-closed runtime。当前实现将
  lifetime-port reconnect 作为恢复握手，single-flight 刷新设置、等待媒体 hydration，再以每次重试重算的 fresh topology 上报；
  background recovery waiter 按 tab 且只接受有效媒体 report，避免其他 tab 或 top-frame 空报告提前结束。content integration、
  完整 Chromium 7/7 和 iframe 专项连续 5 次通过必须保留为回归证据。
- 当前自动化大量基于 fixture。fixture 可证明协议、状态机与生命周期，但不能外推为 Tier 1 真实站点视觉和兼容性已完成。
- 本轮 live smoke 的 `DOM fallback required` 是实际 pointer 失败的诊断结果，不是可用 DOM 状态的替代证明；Tencent/Youku 的 collision
  warning 与 iQIYI 的无 scroll 距离必须保留在质量记录中。
- 品牌 Chrome/Edge 当前不能通过 Playwright harness 自动侧载未打包扩展；官方 Playwright 文档要求使用 bundled Chromium。品牌浏览器证据
  需要独立手工安装或专用测试环境，不能把 bundled Chromium 结果改写成品牌通道通过。
- 本机默认 Node 为 `24.18.1`，仓库发布证据固定 Node `24.13.0`；本轮已用隔离的 Node `24.13.0` 重跑完整 `pnpm check`，
  不修改版本 pin。

## 6. 决定

- EXT-128～135：`In Review / engineering implemented, acceptance partial`。
- EXT-136：`In Review / component evidence partial`。
- EXT-137：`In Review / engineering automation verified, 30-minute/headed exit pending`。
- EXT-138：`In Review / Chromium live evidence partial`；五站基础闭环已取证，但三站 pointer/浮层与 Firefox/场景覆盖待补。
- EXT-139：`HOLD / Exit Review pending`。
- Phase 7：继续 `HOLD`；Stable：继续 `NO-GO`；Legacy：继续冻结。

下一次审查只在新增 headed/live/churn 证据或关闭 P0/P1 缺口后更新，不以 unit/component 数量增加自动升级为 `Verified`。
