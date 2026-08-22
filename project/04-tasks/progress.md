# Web Extension 重构进度

> 文档 ID：TASK-002  
> 状态：Active  
> 负责人：Project Owner / Quality Owner  
> 最后更新：2026-08-22
> 更新频率：每周或每个开发周期

## 当前阶段

**Phase 6.5：控制权 P0 已实现并进入审查；UX NO-GO；Phase 7 HOLD**

Phase 6 的 release profiles、确定性双端 ZIP、evidence bundle 和 CI 基线继续有效；但 2026-08-12 用户实测确认页面 UI、
即时反馈和倍速继承存在交付级 P0 缺口。当前已按补充后的需求实现主要 Phase 6.5 切片，并完成 56 个 README/主流视频、音频和直播
入口的 bundled Chromium headed live smoke。基础批次见 [live smoke 审查](../09-reviews/live-site-smoke-review-2026-08-15.md)，完整逐站矩阵见
[扩展真实站点兼容性审查](../09-reviews/expanded-live-site-compatibility-review-2026-08-15.md)。2026-08-15 的 56 站历史快照记录为 10 个完整 video flow 通过、3 个仅
media-discovery、9 个功能/交互失败、10 个外部阻断、24 个 no-media；Netflix 背景媒体归属已由 2026-08-19 覆盖性复测关闭，Dailymotion Host/Trigger 与首次快捷键失败已由
2026-08-20 targeted run 覆盖为功能通过、几何 `probe-limited`。Tencent 宿主碰撞与 iQIYI/Youku/Niconico pointer、Huya/Vimeo Host/Trigger、
Kuaishou/Douyin Live 实例误报、Twitch/Pornhub 遮挡、音频无标准媒体、Firefox 真实站点/原生权限 UX、广告/更多登录态和用户 Exit Review 尚未完成。
既有 30 分钟 churn 与 fresh 增强诊断 30 分钟复跑均已取得稳定性证据，Firefox 153 headed fixture 的锚定、显隐、快捷键反馈、暂停收起和 iframe 恢复也已通过；这些工程证据仍不能外推为真实站点或用户 UX 验收，因此结论为 `ENGINEERING EVIDENCE PASSED / UX NO-GO / Phase 7 HOLD`。

2026-08-16 新增 P0：现有原生 setter 捕获只能保证扩展自身写入，不会阻止网站后续 setter、轮询、播放器初始化和自定义媒体实例夺回倍速/音量/进度控制。ADR-0017、EXT-145～147 已建立。

2026-08-17 状态：per-instance MAIN world authority、typed policy configure/commit、routed Tencent lifecycle、hostile setter/轮询 fixture 与 Chromium E2E 已落地。腾讯严格 Run `2026-08-16-tencent-stale-frame-fix` 在切片后继承 `1.5x`，快捷键调至 `2x` 后 `stableAfterSitePolling=true`，feedback 可见且归属新实例，reload 后 `1.5x` 继续继承；report `outcome=passed`、`violations=[]`。本轮修正的 stale frame 回退只处理旧 child frame 接收端消失，不吞协议、Schema 或扩展运行时错误。

2026-08-17 补充：Chrome 扩展错误面板中的 BFCache port disconnect 与 `Extension context invalidated` 已完成根因修复。content/background 两端统一消费 `runtime.lastError`；content context 增加精确 rejection boundary、重连失效短路和 250ms fail-closed validity probe。真实扩展 E2E 已验证 BFCache 恢复、旧 UI 清理、unpacked 重载、新实例重新注册，以及错误面板不新增两类错误。产物升级为 `0.1.2.10000`，详见 [扩展上下文与 BFCache 错误审查](../09-reviews/extension-context-and-bfcache-error-review-2026-08-17.md)。

2026-08-17 追加：修复腾讯 `<fake-video>` 同一媒体会话实例替换时“先 release、后 attach”以及短暂无目标空窗造成的倍速意图丢失。新实例现在先接管同一 `mediaId` 的 authority 并继承 intended rate；短暂无目标时保留旧 binding，直到新实例接管或 teardown。新增连续站点回写和异步空窗回归测试。`0.1.3.10000` 在腾讯真实页面完成 30 秒/114 次 `2x` 稳定采样，随后延迟 `KeyC` 成功调至 `2.1x`；详见 [腾讯实例替换与控制权迁移修复审查](../09-reviews/tencent-authority-rebind-fix-2026-08-17.md)。

2026-08-17 追加：修复腾讯登录态 `720P` 的跨 frame 早停。顶层暂停或镜像 Tencent native 不再阻止后台继续查询真实 `tencent-viewport` authority；native/fake-video 并存回归验证后台按 `[0, 17]` 查询并选择 frame `17`。新构建为 `0.1.4.10000`；登录态真实页面完成 `480P -> 720P -> 2x`、12 秒持续播放、`KeyC 2.1x` 连续采样和 `KeyX 2x` 回退。详见 [腾讯登录态 720P 跨帧路由修复审查](../09-reviews/tencent-logged-720-cross-frame-routing-fix-2026-08-17.md)。

2026-08-18 追加：优先完成 Legacy 能力对齐，不改 Legacy 源码且暂不继续重设计 UI。Web Extension 已补齐完整 typed 快捷键命令面、`Z` 倍速记忆、300ms 数字键叠加、30 FPS 逐帧、下一集、视觉变换/滤镜/重置、截图下载回调、`Shift+R` 本站进度恢复切换，以及 Netflix 原生 seek/rate、YouTube web fullscreen、Bilibili 子域/直播/动态 fixture。页级临时停用/UI 隐藏的 top-frame 旧状态回放竞态也已修复；20 次 Chrome 重复回归通过。实验下载追加后的目标构建版本为 `0.1.6.10000`。

2026-08-18 实验能力追加：Legacy `enhance.allowExperimentFeatures` 直接控制的 `Shift+D` 下载和 MediaSource 分段捕获已迁入 Web Extension。实现包含默认关闭零 Hook、启用后新 capture generation、同源直链与短跨域 bounded fetch、MSE 音视频分轨、正常结束自动下载、错误结束/超时/超限终态、revoke/sourceclose/切源/停用回收，以及 synthetic hotkey 和 isolated content settings 双重门禁。工程状态为 `EXT-153 In Review`。

2026-08-19 实验边界收尾：最终 `<a>.click()` 与跨域 bounded fetch 已位于 isolated content；实验 manager 仅保留 extension-owned MAIN registry，不再通过 `Symbol.for` 暴露到页面 `window`。`media.cancel-download`、取消后的 `endOfStream()` 抑制、下载确认/文件名编辑的非阻塞队列、音频增益、鼠标长按、autoplay coordinator 和 PiP 跨 Tab owner lease 均已有 typed runtime、设置门禁和自动化证据。fresh Chrome E2E 发现并修复空下载 prompt shadow host 截获全屏页面点击的回归，修复后核心 real-extension `9/9` 通过；Firefox 153 权限/媒体 E2E 和 `web-ext lint` 亦通过。`EXT-154` 由安全架构阻塞转为 `boundary implemented / hostile-live acceptance pending`；真实 hostile 页面、下载站点、headed PiP/音频/长按仍不能替代工程实现，也不能据此解冻 Phase 7 或 Stable。当前工程预览版本为 `0.1.7.10000`。

2026-08-19 高级能力差距审查：长按释放新增 `pointerup` 兼容和 600ms 有界播放状态保护，抵抗站点在释放后的异步 play/pause 反向切换；unit `4/4`、目标 ESLint 与 `vue-tsc` 通过。审查同时识别出 autoplay 站点动作、音频增益运行时可用性和 Legacy 跨域开关替代关系三个边界，后续条目已分别完成工程修正；详见 [高级能力差距审查](../09-reviews/experimental-capability-gap-review-2026-08-19.md)。

2026-08-19 音频增益失败语义收紧：`GenericMediaController` 在 Web Audio 建图或增益设置失败时释放临时/旧图，原子回滚到 `1×`，移除当前实例的 `audioGain` capability，并让命令以错误结束，避免 UI 报告假成功；新增 generic-adapter 回归覆盖。跨域无 CORS 可能静默输出的 headed 证据仍待补齐。

2026-08-19 autoplay scope correction：移除对任意 paused media 的通用 `media.play` 尝试，改为 typed adapter page action。未声明 autoplay 的站点第一次探测后终止；iframe 与 routed child-frame media 均由 coordinator 硬门禁禁止；目前仅 Bilibili 复用 Legacy 的三个播放按钮 selector，并保留可见性、generation、用户暂停后不重放和最多 10 次有界重试语义。已处理的 DOM 播放按钮动作必须先等到新的媒体状态观察，未观察到状态变化则安全停止，避免异步 toggle 按钮被重复点击；autoplay/adapter/protocol/content 目标回归通过；登录态、广告/换集和真实按钮演进仍待 headed 验收。

2026-08-19 Bilibili autoplay headed 复验：普通视频 live smoke Run `2026-08-19-autoplay-bilibili-reverify` 为 `passed / violations=[] / warnings=[]`，实例、锚定 UI、反馈和 reload 倍速继承均通过；另在顶层 `player.bilibili.com` 的 `autoplay=0` 入口开启扩展 autoplay，3 秒观察窗内只触发一次 `.bpx-player-ctrl-play`，视频随后保持播放，未发生二次 toggle。该证据关闭基础按钮重复点击风险，但登录态、广告、换集和 selector 演进仍保持 Acceptance pending。

2026-08-19 跨 frame 产品边界固化：ADR-0019 明确不复制 Legacy `allowCrossOriginControl`。浏览器 host permission 是跨源 runtime 的授权事实源，frame registry 只信任真实 sender，跨 frame/PiP 命令只路由到精确 owner；撤权、frame unload 和 teardown fail-closed。未来只能增加缩小能力的策略开关，不能用设置扩大浏览器权限。

2026-08-19 Netflix 前景归属收尾：修复 MAIN world `getComputedStyle` 捕获和多媒体 presentation 复核，当前景 video 存在时不再让 opacity `0.25` 的预览实例取得 active media、Host 或 Trigger；所有候选都透明时仍保留控制兜底。最终 Run `2026-08-19-netflix-foreground-owner-final` 为 `passed / violations=[] / warnings=[]`，前景 `media-0-2` 完成 `1→1.1`、Popup `1.5` 和 reload `1.5` 继承。Run `2026-08-19-tier1-foreground-fix-final` 的五个 Tier 1 strict smoke 全部通过，Tencent/Youku collision 与 iQIYI no-scroll warning 按原样保留。详细结论见 [Netflix 前景媒体归属审查](../09-reviews/netflix-foreground-media-ownership-review-2026-08-19.md)。

2026-08-20 生命周期与预算收口：frame slot 改为精确 connected `sessionId` 所有权，覆盖 dormant/late ready report、frameId 复用、旧 session teardown、child-frame 导航、`PAGE_RUNTIME_UNAVAILABLE`、late iframe 和 MV3 worker restart；页面停用/UI 隐藏命令增加按 Tab 串行、revision 防乱序、remembered child frame 恢复与有界消息超时。恢复运行时会重新读取设置并等待媒体状态 hydration，避免 UI/媒体宿主迟迟不回挂。最终审查同时关闭 Tencent routed child media 跳过进度恢复/暂停保存的回归。详见 [iframe 生命周期与控制竞态审查](../09-reviews/iframe-lifecycle-control-race-fix-2026-08-20.md)。

2026-08-20 route-first 与预算最终收口：跨域 routed media 在顶层缓存为空时可由第一次快捷键直接解析执行；setter 返回成功但最终倍速未命中时明确返回 `COMMAND_EXECUTION_FAILED`；腾讯换集后 staged playback intent 可跨旧 frame 响应与 authority 迁移恢复。fresh 全量门禁为 Unit `386`、Component `40`、Integration `152`、Compatibility `40`、Security `3`；Chrome/Firefox 构建和 budget 均通过，双端 `content.js` 为 `255921 / 256000` bytes，仅余 `79` bytes。headed Run `2026-08-20-phase65-budget-final` 中 Tencent 与 Dailymotion 均为 `outcome=passed`、`violations=[]`；腾讯换集、延迟快捷键、3 秒站点轮询稳定性和 reload 继承通过，Dailymotion 跨域实例首次快捷键、Popup `1.5x` 和 reload 继承通过。详见 [Phase 6.5 路由首键、腾讯换集与 Bundle Budget 收口审查](../09-reviews/phase-6.5-route-first-hotkey-and-budget-review-2026-08-20.md)。

2026-08-22 长稳态与 Legacy 校验隔离收口：增强诊断 churn 连续运行 `1,801,716ms`，完成 `903` cycles、`19` 次 worker restart（populated `10`、empty `9`），listeners 峰值 `5`、hosts 峰值 `3` 后回归基线，observer/timer/authority diagnostics 每轮回零，Long Task `0`；UQA-005 更新为 `PASS`。同时 `test:legacy` 改为冻结提交 detached worktree 构建，成功/失败/源漂移回归均证明主工作树 `dist/h5player.user.js` 不被改写，冻结 SHA-256 `91b5312d...` / `561788` bytes 保持一致。详见 [Phase 6.5 长稳态 Churn 与 Legacy 构建隔离审查](../09-reviews/phase-6.5-churn-and-legacy-isolation-review-2026-08-22.md)。

2026-08-22 Firefox headed UX 基线：Firefox `153.0`、`headless=false`、生产 MV3 临时安装完成媒体锚定（baseline/scroll/resize distance 均为 `0`）、透明扩展 hitbox、播放后自动隐藏、`KeyC 1→1.1×` 最终值反馈、反馈过期、暂停强制收起和 iframe remove/restore；完整入口正常退出且 `web-ext lint` 为 `0 errors / 2 existing warnings`。该证据只关闭本地 fixture 核心 UX 缺口，真实站点、原生权限框、200% zoom/主题/字幕共存和用户 Exit Review 仍未通过。详见 [Phase 6.5 Firefox Headed UX 证据审查](../09-reviews/phase-6.5-firefox-headed-ux-review-2026-08-22.md)。

## Phase 6.5 已实现能力

- `MediaAnchorRegistry` 将 stable `mediaId` 映射到视频 DOMRect；per-media closed ShadowRoot host 跟随 scroll/resize，
  并在媒体 replacement/removal、停用、撤权和 teardown 时清理。
- `MediaQuickControls` 取代默认视口级大面板：播放中折叠，暂停强制收起且只显示短暂状态反馈；面板仅由倍速状态区的 hover/focus 或显式 click/touch 展开；Escape/Tab、
  当前媒体隐藏和页面临时隐藏均有组件或端侧证据。
- typed `MediaFeedbackEvent`、per-media presenter 和 page fallback 已落地；命令使用最终 snapshot 值，按 media replace/expiry，
  error 不泄露诊断上下文，audio/no-anchor 使用轻量页面反馈。
- `PlaybackPolicyResolver` 与 `PlaybackLifecycleCoordinator` 已连接 global/site/page/media intent、新媒体自动应用、重播/source/duration
  generation、网站 reset 保护、有界重试、teardown 与 race guard；当前媒体/页面临时值不写入持久设置。
- Popup 显示 effective source、保护状态和 rate scope；Options 支持 global/site rate、保护策略与独立继承恢复。
- `FrameRuntimeRegistry` 与 typed frame reports 已支持 iframe-only ownership、页面 UI/temporary state fan-out、late same/cross-origin
  继承和 worker restart 恢复，不再把 child-frame media 伪装成 top-frame active media。
- `MediaControlAuthority` 在 MAIN world 以媒体实例为边界维护用户 intent：受保护的 rate/volume/muted 可在网站 setter/轮询后重申，currentTime 只在用户 seek 后使用短租约；实例替换、停用、撤权、reload 和 teardown 均 fail-closed。
- 腾讯多实例路由在 DOM 视频、WASM viewport proxy、切片替换和 child→top authority 迁移时重新选择真实播放实例；旧 frameId 消失时 live probe 回退到后台全局路由，业务 oracle 仍要求实际 rate、轮询稳定性和 feedback 全部通过。
- MV3 lifetime port 在 BFCache 中断时同步消费 `runtime.lastError` 并恢复连接；扩展更新/卸载使 context 失效时，旧 UI、timer、listener、runtime 和 bridge 在 250ms 探测窗口内 fail-closed 清理。
- Legacy command parity 通过 typed planner/registry 统一能力门控和反馈：播放、进度、音量、倍速、全屏/PiP、截图、逐帧、下一集、缩放/平移/旋转/镜像/滤镜与重置均不再依赖 Legacy 全局对象。
- `Shift+R` 只允许 content 修改浏览器验证出的当前站点恢复策略；开启后立即尝试恢复当前媒体进度，不允许伪造跨站点 mutation。
- 页级临时停用和 UI 隐藏在 top-frame mutation 发出前先更新 tab runtime cache，发送失败时原子回滚，避免 frame report 旧回包撤销用户刚完成的操作。

## Phase 6.5 任务状态

| 范围         | 当前状态                                                | 结论                                                                                                                                                                                                                                                                          |
| ------------ | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EXT-128～135 | In Review / engineering implemented, acceptance partial | 核心实现、unit/component/integration 和部分 Chromium E2E 已具备；不得标 Verified                                                                                                                                                                                              |
| EXT-136      | In Review / headed fixture evidence partial             | 键盘、touch pointer、i18n、aria-live 有证据；Firefox headed 基础 pointer/键盘通过，200% zoom、theme、reduced-motion、字幕和宿主控件共存待补                                                                                                                                    |
| EXT-137      | In Review / engineering evidence passed                 | fresh `pnpm check` 为 Unit `390`（72 files）、Component `40`、Integration `152`、Compatibility `40`、Security `3`；双端 build/budget 与 30 分钟 churn 通过；Firefox 153 headed fixture 核心 UX 通过，真实站点和原生权限 UX 仍待补                                                   |
| EXT-138      | In Review / external UX evidence partial                | 56 站历史报告、Netflix/Tier 1 覆盖性复测和 Tencent/Dailymotion targeted smoke 已建立；Firefox 仅 fixture 通过，其它关键 UI/实例、真实 pointer/宿主共存和跨浏览器 live-site 仍待关闭                                                                                       |
| EXT-139      | HOLD / Exit Review pending                              | 用户签字和 Phase 7 解冻结论未获得                                                                                                                                                                                                                                             |
| EXT-145/146  | In Review / engineering implemented                     | MAIN world 仲裁、typed protocol、binding/迁移、停用/撤权/reload teardown 与 hostile fixture 已通过                                                                                                                                                                            |
| EXT-147      | In Review / Tencent acceptance fix verified             | 换集后 staged intent、旧 frame 响应过时恢复、authority 迁移、首次/延迟快捷键、3 秒站点轮询稳定性与 reload 继承均通过；广告/更多登录态/可重复 AB active fake-video 仍待补                                                                                                      |
| EXT-148      | Verified / lifecycle error containment                  | BFCache port error、context invalidation、旧 UI 清理与重载恢复已由错误面板 real-extension E2E 验证                                                                                                                                                                            |
| EXT-149/150  | Verified / Legacy command parity                        | 主要快捷键、媒体/视觉命令、逐帧/下一集、截图和本站进度恢复切换已由 unit/integration 覆盖                                                                                                                                                                                      |
| EXT-151      | Verified for fixture / conditional live                 | Netflix 原生 UI 优先、captured setter 倍速回退和前景实例归属已由 fixture + headed live 验证；账号/DRM/AB 仍按边界声明                                                                                                                                                         |
| EXT-152      | Verified / page-state ordering                          | 临时停用/UI 隐藏竞态已由集成测试和 20 次 Chrome 重复 E2E 验证                                                                                                                                                                                                                 |
| EXT-153      | In Review / experimental parity implemented             | Legacy 实验下载/MSE 核心语义、资源预算、失败终态、清理和 trusted hotkey 已由 unit/integration 覆盖                                                                                                                                                                            |
| EXT-154      | In Review / boundary implemented, acceptance pending    | manager 不挂载 `window`；isolated content 执行最终 sink；同 realm 伪造与 hostile/live-site 证据仍需保留为残余风险                                                                                                                                                             |
| EXT-155      | In Review / engineering implemented                     | 音频增益 1×～6×、global/site 策略和 capability 门控已实现；建图/增益失败原子回滚并动态降级 capability；真实音频链路/headed 体验待补                                                                                                                                           |
| EXT-156      | In Review / engineering implemented, acceptance pending | 长按 3×、释放恢复、pointerup/异步播放状态保护、控制栏排除和时长校验已实现；autoplay 仅由顶层 adapter 声明式站点按钮执行，目前 Bilibili 启用；基础 headed 单击/播放保持已通过，登录态/触控/广告/换集待补                                                                       |
| EXT-157      | In Review / engineering implemented                     | PiP owner lease、heartbeat/grace、generation、精确 frame 路由和 allowlist 已实现；headed/跨浏览器/重启待补                                                                                                                                                                    |

## 已完成基线

- Legacy 油猴主线继续独立：根 Yarn/Rollup、`src/h5player/`、`src/libs/`、`config/` 和冻结产物未被
  Web Extension 重构改写。
- WXT/Vite 多入口、TypeScript strict、Vue presentation、Vitest、Playwright、Selenium、pnpm lockfile、
  依赖边界和静态安全扫描已形成独立闭环。
- Protocol v1、nonce/replay、sender policy、request lifecycle、Browser Ports、structured logger、
  SettingsRepository、版本迁移与恢复在 Phase 1 建立。
- 通用媒体发现、GenericAdapter、active-player scoring、page/content/background bridge、核心命令和
  双浏览器真实扩展 E2E 在 Phase 2 建立。

## Phase 3 已完成交付

### 快捷键与领域策略

- `domain/hotkey` 提供固定 command ID、物理 `KeyboardEvent.code` chord、规范化、显示、冲突和浏览器保留
  快捷键校验。
- interpreter/controller 明确 editable、player focus、composition、repeat、disabled 和事件消费策略；连续命令
  串行化，异步失败进入 logger。
- DOM event source 使用 composed path 识别输入控件和媒体焦点；页面临时停用、站点停用和全局停用均阻断命令。

### Settings Schema V3 与数据生命周期

- `storage.local` 仍是唯一权威；Schema V3 延续 typed 快捷键约束，并新增 global/site 下载、音频增益、鼠标长按时长与 autoplay 策略。
- V0/V1/V2 可迁移至 V3；无效旧快捷键在迁移时丢弃，不执行未知命令；future/corrupt 数据不覆盖原值。
- 导入格式升级为 V3，同时兼容 V1/V2；支持预览、262144-byte 上限、原子导入、导出、分类 reset、最近备份和恢复。
- ADR-0008 冻结未来 sync 白名单，但 Preview 不启用 `storage.sync`；跨 Tab 更新只依赖 local change event + revision 重拉。

### 站点权限与动态运行时

- required permissions 固定为 `storage`、`activeTab`、`scripting`；`<all_urls>` 只位于
  `optional_host_permissions`。
- production manifests 的 `content_scripts` 为 `[]`，不含 `host_permissions` 或 WAR；构建仍输出
  `content-scripts/content.js` 和 `content-scripts/page-main.js`。
- background 只从 `permissions.getAll()` 派生动态注册，稳定注册 isolated/MAIN 两个脚本；grant/revoke、
  permission event、显式 reconcile 和 worker 启动都经过串行 reconcile。
- 当前 origin 保留非默认端口；拒绝、受限页面、当前站点/所有站点授权、撤权、临时停用、永久站点停用和 worker
  restart 均有自动化证据。

### Popup、Options、诊断与组件

- PopupApplication/OptionsApplication 隔离 browser/runtime API，Vue 组件只依赖 application facade。
- Popup 提供权限状态、媒体指标与命令、全局/站点/本页开关、当前站点撤权和 Options 入口。
- Options 提供 General、Shortcuts、Sites、Data、Diagnostics、About 六个路由页面。
- 快捷键 recorder、确认对话框、toggle、status、metric、panel 等公共组件已建立；Popup/Options/Recorder 通过 axe
  自动检查和键盘交互测试。
- zh-CN/en-US catalog 结构完整；诊断仅输出本地 bounded summary，URL 降为 hostname，排除 title、媒体 URL、
  page text、cookie 和 token。

## Phase 4 已完成交付

- visual state 按 MediaSession 隔离，支持 zoom/pan/rotate/flip/filter、单调用原子 reset、native/web fullscreen、PiP；原始 inline style 在 reset/teardown 恢复。PiP 跨 Tab 控制另由 background lease 管理，不与 advisory event 混用。
- top frame 挂载 closed ShadowRoot Overlay，包含 hostile CSS reset、event isolation、动态 mount/teardown 和 typed intent→command 映射；iframe 仍运行媒体 runtime，但 Preview 不做跨 frame 媒体聚合。
- Canvas 截图不修改 crossorigin、不新增 downloads/clipboard 权限；bounded artifact 通过临时 Blob URL 下载，CORS/DRM/未就绪/尺寸/编码失败均映射为有限错误。
- progress 使用匿名 hash identity、TTL、容量、隐私门禁和 5 秒节流；完成判断优先删除记录。跨 Tab 的 playback/progress 仍是 advisory event，不自动暂停；PiP 控制则使用独立的 owner lease、heartbeat/grace 与精确 frame 路由。
- bundle budget 和 manifest guardrail 已进入 CI；生产 Chrome/Firefox 无 required host、静态 content scripts 和 WAR。

## Phase 5 已完成交付

- `MediaAdapterRegistry` 作为现有 MediaDiscovery 的单一复合 adapter；priority 降序、id 稳定 tie-break，GenericController
  在每个媒体上先创建并作为永久 fallback。
- Registry 对 catalog、rollback policy 和 Hook 表运行时校验并防御性冻结；selector 优先在目标媒体父容器内解析，
  再回退 document，降低多播放器串控风险。
- 静态 catalog 覆盖 Tier 1：YouTube、Bilibili、Tencent Video、iQIYI、Youku；Tier 2：Netflix、Ixigua、AcFun、
  Sohu Video、TED。每项包含 owner、version、tier、support、fixture、lastVerified、match 和 feature。
- selector 优先；受限 Hook 只允许随构建发布的 attach/detach/action/fullscreen 入口。attach、detach、selector、action
  抛错均被隔离，SPA URL 变化在下一次 snapshot/command 自动重匹配。
- `rollback-policy.ts` 支持精确 adapter version 或单 feature 禁用；禁止远程规则、页面规则和任意用户函数。
- adapter health 经 page-main → content site state → background diagnostics 输出，只有 id/version/tier/status/failure count/
  disabled features，不含完整 URL、title、媒体源或页面文本。
- 10 个脱敏 fixture、compatibility contract、SHA-256 baseline 和 `test:compat:report` 已进入 `pnpm check`；报告同时冻结
  support level/owner/lastVerified，并对超过 183 天未复核的 adapter 失败。

## Phase 6 已完成工程交付

- `web-extension/package.json` 成为版本单一事实源；Dev/Alpha/Beta/RC/Stable 共用 TypeScript profile resolver，默认构建
  为 Dev，浏览器 manifest 使用确定性四段数字版本。
- 自有 ZIP32 writer 固定路径顺序、DOS timestamp、`100644` mode 和 CRC32；拒绝隐藏/危险/重复/前缀重叠路径、symlink、
  source map、local range 重叠、header 漂移、多磁盘和额外 metadata。
- release bundle 固定输出 Chrome/Firefox ZIP、checksums、release manifest、SPDX 2.3 SBOM、运行时许可证、测试摘要、
  fixture-only 兼容报告和 unsigned SLSA-compatible provenance。
- artifact inspection 以 allowlist 重新验证 manifest identity/capability、required/optional API、host/CSP、action/options、Firefox
  metadata、background 差异、静态 content script/WAR、远程代码、入口、timestamp/mode/CRC；`release:verify` 检查目录闭包、
  artifact browser 身份、兼容报告重建和全部 digest。
- `release:reproducibility` 执行两个独立 WXT 双端构建并比较全部 9 个发布文件；正式候选要求 clean worktree 与显式
  `SOURCE_DATE_EPOCH`。
- `.github/workflows/` 分为 PR、nightly 和 workflow_dispatch RC，action 固定到 commit SHA、依赖冻结安装、最小
  `contents: read`；RC 明确 no-publish，不 tag/push/sign/store upload。
- ADR-0014、artifact contract、Chrome/Firefox listing、隐私/权限说明、Beta/update/rollback/incident runbook、RC/Stable/
  post-release 模板已进入 `project/`。

任务状态：EXT-121/122 工程实现 Verified；EXT-120/123/124 为工程完成但外部配置/签字/演练待完成；EXT-125 自动化完成但
两轮真实 RC 待证据；EXT-126 已审查为 Stable `NO-GO`；EXT-127 模板完成、真实发布后执行。

## 验证证据（Phase 6.5 当前工作树，2026-08-22）

以下结果用于证明当前实现可进入审查，不代表 UX-ACC 已全部 Verified。最终数字以本轮 fresh 全量门禁输出和
[Phase 6.5 路由首键、腾讯换集与 Bundle Budget 收口审查](../09-reviews/phase-6.5-route-first-hotkey-and-budget-review-2026-08-20.md) 为准。

| 门禁                      | 当前结果/边界                                                                                                                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format / lint / typecheck | Passed；Phase 6.5 新增 TS/Vue/runtime 边界纳入静态门禁                                                                                                                                                                                                                                            |
| Unit                      | 72 files / 390 tests passed；实验下载/取消、音频增益/CORS 门控、长按释放状态保护、autoplay 状态观察/重复 toggle 保护、PiP lease、anchor、feedback、policy/lifecycle/eligibility、前景筛选、connected frame ownership、routed selection、Tencent typed bridge 与安全拒绝路径纳入                   |
| Component                 | 40 tests passed；quick controls、透明 hitbox、feedback presenter、Popup/Options scope、暂停强制收起和前景 Overlay 归属回归纳入                                                                                                                                                                    |
| Integration               | 固定 Node `24.13.0` 下 13 files / 152 tests passed；stale ready report 拒绝、route-first hotkey、routed Tencent 进度恢复/暂停保存与换集 intent 恢复、停用恢复 hydration、top-session reset、global/site 下载门禁与 release-bundle 9/9 通过；dependency boundary 为 180 modules / 589 dependencies |
| Compatibility             | 3 files / 40 tests；10 site fixtures + SHA baseline/report，仍不等于 live smoke                                                                                                                                                                                                                   |
| Chromium real-extension   | fresh build 后完整套件 9 passed / 14 项按环境跳过；hostile polling、BFCache/context invalidation、iframe ownership、anchor、audio fallback 等核心场景通过                                                                                                                                         |
| Lifecycle repeat          | BFCache/context reload、iframe-only owner、late same/cross-origin frame 状态继承各重复 3 次，共 `9/9` 通过；worker 重启以执行上下文 generation 判断，不依赖 target ID 必须变化                                                                                                                    |
| Churn                     | 增强诊断 `1801716ms`：903 cycles、19 次 worker restart（10 populated / 9 empty）；listeners 峰值 `5`、hosts 峰值 `3` 后回零、observer/timer/authority binding 每轮回到基线、Long Task `0`；UQA-005 `PASS`                                                                                         |
| Bundle budget             | Chrome/Firefox background、content、page-main 全部通过；双端 content 为 `255921 / 256000` bytes，仅余 `79` bytes，后续新增能力必须先做拆分、复用或删除，禁止提高预算                                                                                                                              |
| Tier 1 live smoke         | 最终 Run `2026-08-19-tier1-foreground-fix-final`：5 个 strict smoke passed；YouTube/Bilibili 无 warning，Tencent/Youku collision 与 iQIYI no-scroll warning 保留；快捷键、Popup、reload 继承均通过                                                                                                |
| Tier 2 live smoke         | Netflix 最终 Run `2026-08-19-netflix-foreground-owner-final`：passed、无 violation/warning，只有 opacity `1` 的前景实例拥有 UI；AcFun/Sohu/TED/Ixigua 仍沿用既有条件/阻断证据                                                                                                                     |
| Ixigua external evidence  | Run `2026-08-15T00-05-00-000Z`；公开桌面/移动入口 HTTP 200 但无 `<video>`，页面出现“打开 App 看完整内容”；strict `no-media` 负向证据                                                                                                                                                              |
| Expanded live catalog     | 56 站历史批次全部有报告；Qilu full-flow 通过；Dailymotion 最新 targeted run 已覆盖历史 Host/Trigger 功能失败，但 closed ShadowRoot 几何仍为 `probe-limited`；Huya/Kuaishou/Vimeo/Twitch/Douyin Live 等保留失败证据，登录、403、迁移、App-only 和无标准音频仍单独分类                              |
| Firefox UX                | Firefox 153 核心权限/媒体 E2E 与 headed fixture 通过；baseline/scroll/resize anchor distance `0`，pointer 展开、扩展 hitbox、播放自动隐藏、`KeyC 1→1.1×`、feedback expiry、暂停收起和 iframe restore 均通过；真实站点/权限框仍待补                                                                  |
| Review bundle             | `.release/phase-6.5-advanced-parity-2026-08-19` 的 9 文件 `release:verify` 通过；manifest `0.1.7.10000`；工作树为 dirty，仅供本地审查/加载测试，不是发布候选                                                                                                                                      |
| Legacy regression         | Legacy 源码、根构建链和固定版本 pin 未修改；冻结提交 detached worktree 校验通过，主工作树不被改写；冻结产物 SHA-256 `91b5312d7cf150cd852d005b1e5d5f3d8ed2ed7cd8a481dfa1d561d48f7b3f27`，`561788` bytes                                                                                            |

本机默认 Node 为 `24.18.1`，而发布 evidence contract 精确固定 `24.13.0`。本轮使用隔离的 Node `24.13.0` 二进制重跑完整
`pnpm check`，因此 release fixture 与全量门禁均已取得有效证据；仓库 pin 仍不得放宽。

## 权限自动化边界

原生扩展 optional-host 确认框在当前 headless Chrome/Firefox 自动化中不可稳定接受或拒绝。测试采用隔离 harness：

- Chrome grant：复制 production extension，在临时 profile 第一次启动时短暂把目标 origin 放入
  `host_permissions` 生成浏览器授权状态，关闭后恢复原 production manifest，再用同一 profile 启动；测试结束删除临时目录。
- Chrome reject：测试副本移除 `optional_host_permissions`，使真实 `permissions.request()` 确定性返回拒绝；生产 manifest 不变。
- Firefox grant：Selenium `--allow-system-access` 仅在测试 profile 中调用 Firefox
  `ExtensionPermissions` 和 tab manager，分别模拟 optional origin 与 action `activeTab`；生产代码和 manifest 不引用内部 API。
- 所有测试继续检查最终 production manifests、授权集合和动态注册 ID；Beta/商店提交前仍需至少一次 headed 手工权限 smoke。

## 已知项与风险

1. per-media anchor、quick controls、feedback 和 playback policy/lifecycle 已实现；Tencent reload/WASM 真实 pointer 与 Netflix 前景/背景归属已补齐，但 iQIYI/Youku/Niconico 的真实 pointer、Tencent/Sohu/Qilu 宿主碰撞仍未达标，不能因机器 violations 为空而升级为 UX 通过。
2. native fullscreen、200% zoom、深浅主题、reduced-motion、字幕和站点原生控件共存尚未完成 Chromium/Firefox headed 审查。
3. Phase 6.5 增强诊断 30 分钟 churn 已通过：903 cycles、19 次 worker restart；host/pending mount/feedback timer、anchor/discovery observer、presentation timer、authority binding、分段 heap 与 Long Task 诊断均取得长稳态结果。UX-ACC-002/015/019 的工程稳定性证据已补齐，但 headed 几何、宿主碰撞和真实站点边界仍只能判为部分证据。
4. 扩展到 56 站后，Huya/Vimeo 仍缺 Host/Trigger，Kuaishou/Douyin Live 存在非内容媒体 Host，Twitch/Pornhub 面板遮挡，
   Douyin reload 生命周期失败；Dailymotion 功能链已通过最新 targeted run，但 closed ShadowRoot 内部几何仍只能间接取证。广告、更多登录态、站点反向改倍速和多轮反馈安全区仍未完整覆盖。
5. Ixigua 当前公开入口为 App-only/no-media；Douyu/TikTok 只有不可选媒体标签；多个历史首页和 QQ Music MV 列表没有播放器；README 音频页
   没有取得标准 `<audio>`。这些都不能把 adapter fixture、runtime marker 或页面播放按钮当作兼容通过。
6. Firefox 自动化版本为 153.0，核心 headed fixture 已通过；manifest minimum `142.0`、Firefox ESR、Firefox 真实站点、Chrome previous stable 和 Edge 尚未完成
   发布矩阵，Stable 前不可豁免。
7. Headless harness 证明权限状态机与产品代码，但不能取代原生确认框文案、焦点和商店审核体验的 headed/manual 验证。
8. iframe-only media 由 child frame 自己持有 UI，Popup 通过 registry 显示独立状态；top frame 不跨 frame 伪造 active media。capture base64 最大消息体约 5.6 MiB；普通 playback/progress 仍不自动暂停，PiP 控制通过独立 lease 精确路由。
9. 当前 Chrome/Firefox E2E 未覆盖真实解码帧/CORS blocked 截图、native→web fullscreen fallback、PiP unavailable、
   progress restore/complete 和 multi-tab advisory event；这些不能由 unit/contract 结果外推。
10. WXT 仍为 `0.x`；升级必须独立变更并重跑双浏览器 build/lint/security/E2E。
11. iframe 恢复与 MV3 worker 重启竞态已修复：content runtime 在 lifetime-port 重连时 single-flight 刷新设置、等待媒体 hydration
    后再 fresh-report；frame recovery waiter 按 tab 与有效媒体报告隔离，避免 top-frame 空报告或其他 tab 错误唤醒。该链路已有
    fail-closed integration 回归、完整 Chromium E2E 和重复专项 E2E 证据。

## 下一步（完成 Phase 6.5 验收证据）

1. 先关闭 Huya/Vimeo 的 Host/Trigger 缺失，以及 Kuaishou/Douyin Live 的非内容媒体 Host；为这些失败增加最小站点回归样本，并为 Dailymotion 保留 closed-root 外部 oracle 回归。
2. 处理 Twitch/Pornhub 面板覆盖、Kuaishou feedback 安全区和 Douyin reload 生命周期；继续补 Tencent 宿主避让及 iQIYI/Youku 浮层与真实 pointer。
3. 为 Sohu/Qilu/TED 补充 danmaku/controls/advertising 安全区和 reload 外跳策略；外部阻断继续保留，不做伪兼容。
4. 维护可复现的 Ixigua、QQ Music MV 和标准 `<audio>` 内容样本；样本不可得时保持 `未验证`，不扩大支持声明。
5. [x] 在 Firefox headed 完成 fixture 页面定位、feedback、快捷键和 iframe teardown/restore 核心 UX；后续补真实站点、原生权限框、临时扩展重启和最低版本矩阵。
6. [x] 使用现有 typed internal diagnostics 完成完整 30 分钟 churn，冻结 host/pending mount/feedback timer、discovery/anchor observer、presentation timer、authority binding、分段 heap 趋势与 Long Task 结果；后续只在实现变更后回归。
7. 扩展关键站点到换集、广告、登录态、站点 reset、native fullscreen、200% zoom、theme 与 reduced-motion，并保留真实 pointer 证据。
8. 更新 UX-ACC-001..015 与 EXT-139；只有用户确认 `UX GO/CONDITIONAL GO` 后才重新评估 Phase 7。Legacy 继续冻结。

## 当前阻塞

当前无 Phase 6.5 核心代码硬阻塞。主动阻塞是 UX/外部验收证据：Host/Trigger 缺失、非内容媒体 Host、pointer/宿主浮层、面板遮挡、
feedback 安全区、音频/具体内容样本、Firefox 真实站点与跨版本 UX、原生权限/商店体验和用户 Exit Review。仓库分支保护、签名包演练、两轮 Beta RC 和观察窗口仍是独立的 Phase 6
外部门禁；所有这些都不能由本地 fixture、unit/component 或 unsigned candidate 替代。
