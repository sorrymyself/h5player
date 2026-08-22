# 浏览器与页面兼容性矩阵

> 文档 ID：QA-003  
> 状态：Approved / Phase 6.5 Live Evidence Boundary<br>
> 负责人：Quality Owner  
> 最后更新：2026-08-20
> 说明：具体版本号在 Phase 0 按发布时最新稳定版本冻结。

## 1. 浏览器矩阵

| 浏览器                 | Dev 目标 | Beta 目标 | Stable 目标 | 当前证据/状态                                                                                                       | 必测层级           |
| ---------------------- | -------- | --------- | ----------- | ------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Chrome Stable          | 需要     | 需要      | 需要        | bundled Chromium `151.0.7922.34` headed live smoke 已通过；品牌 Chrome 不能由当前 Playwright harness 侧载未打包扩展 | full E2E           |
| Chrome previous stable | 需要     | 需要      | 需要        | Phase 4 未执行，Stable 前补齐                                                                                       | smoke + core       |
| Edge Stable            | 需要     | 需要      | 需要        | 未执行；品牌 Edge 与品牌 Chrome 侧载限制相同，需独立安装/手工路径                                                   | core + popup       |
| Firefox Stable         | 需要     | 需要      | 需要        | Firefox 153.0 临时安装 MV3 已通过                                                                                   | full E2E           |
| Firefox ESR            | 需要     | 需要      | 需要        | Phase 4 未执行；最低版本暂定 142.0                                                                                  | core + permissions |
| Safari                 | 不承诺   | 不承诺    | 不承诺      | 单独评估                                                                                                            | —                  |
| 移动浏览器             | 不承诺   | 不承诺    | 不承诺      | 单独评估                                                                                                            | —                  |

### Phase 2 已执行子矩阵（2026-08-10）

| 浏览器/运行时                  | 版本                            | 扩展验证              | 页面与命令范围                                                                                   | 结果                           |
| ------------------------------ | ------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------ |
| Chromium（Playwright bundled） | 当前 bundled                    | unpacked MV3          | basic、multi/SPA、open Shadow DOM、same/cross-origin iframe、hostile、strict CSP、worker restart | 通过                           |
| Firefox（Playwright bundled）  | 153.0；manifest minimum `142.0` | Selenium 临时安装 MV3 | basic；声明式 MAIN/content/background/popup；seek、rate、volume、mute、play、pause               | 通过                           |
| Firefox ESR                    | 发布时冻结                      | build/lint 计划       | core + permissions                                                                               | Phase 2 未执行，Stable 前补齐  |
| Edge Stable                    | 发布时冻结                      | 未执行                | core + popup                                                                                     | Phase 2 未执行，Phase 5/6 补齐 |

Firefox E2E 入口为 `pnpm test:e2e:firefox`，使用 Selenium Manager 解析 geckodriver；测试不把浏览器驱动作为带 postinstall 下载脚本的项目依赖。

每次发布在 `release-manifest.json` 固化实际版本、OS、架构和测试时间；“最新版”不能作为唯一证据。

### Phase 3 已执行子矩阵（2026-08-11）

| 浏览器/运行时      | 安装方式                                           | 权限与 UI 范围                                                                                                                                             | 结果                                                |
| ------------------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Chromium bundled   | Playwright persistent context，unpacked Chrome MV3 | 未授权/拒绝/受限页；当前站点与 all-sites grant；Popup 命令、快捷键、临时/永久停用、worker restart、撤权；multi/SPA/Shadow/hostile/CSP/iframe；Options 撤权 | 3 个 E2E 场景通过                                   |
| Firefox 153.0      | Selenium 临时安装 `.output/firefox-mv3`            | optional origin + `activeTab` harness、动态 registration/bootstrap、seek/rate/volume/mute/play/pause、撤权和重载后 absence                                 | 通过                                                |
| Firefox 153.0 lint | `web-ext lint`                                     | manifest、权限、产物静态规则                                                                                                                               | 0 errors；1 条 Vue 生成 runtime warning，已登记风险 |

### Phase 3 权限生命周期子矩阵

| 场景                                    | Chrome           | Firefox               | 备注                                                             |
| --------------------------------------- | ---------------- | --------------------- | ---------------------------------------------------------------- |
| 授权前页面无 runtime marker             | 通过             | 通过                  | 不允许未授权页面执行                                             |
| 当前 origin 显式授权 + 当前页 bootstrap | 通过             | 通过                  | 保留非默认端口；注册两个固定脚本                                 |
| all-sites 显式授权                      | 通过             | 未单独执行            | Firefox 已覆盖 origin grant；`<all_urls>` 发布矩阵待补           |
| 用户拒绝授权                            | 通过（拒绝副本） | 浏览器 E2E 未单独执行 | 两端 application/port contract 均验证返回 `false` 后不 reconcile |
| 撤权、注销、页面重载后 absence          | 通过             | 通过                  | permission event 与显式 reconcile 串行化                         |
| restricted page                         | 通过             | 由浏览器能力矩阵补齐  | `chrome://`/商店/内置页只显示降级原因                            |

headless harness 的证据边界、内部 API 隔离和 headed 手工门禁见 [Phase 3 Exit Review](../09-reviews/phase-3-exit-review-2026-08-11.md) 与
`06-security/permission-inventory.md`；不能把 harness 结果写成原生确认框 UX 已完成。

## 2. 页面形态矩阵

| 页面形态               | Basic | Core | UI           | Security | 长稳 |
| ---------------------- | ----- | ---- | ------------ | -------- | ---- |
| 单 video               | ✅    | ✅   | ✅           | ✅       | ✅   |
| 多 video/音频          | ✅    | ✅   | ✅           | ✅       | ✅   |
| 动态 SPA               | ✅    | ✅   | ✅           | ✅       | ✅   |
| open Shadow DOM        | ✅    | ✅   | ✅           | ✅       | ✅   |
| same-origin iframe     | ✅    | ✅   | Overlay 降级 | ✅       | ✅   |
| cross-origin iframe    | ✅    | ✅   | Overlay 降级 | ✅       | ✅   |
| 严格 CSP/Trusted Types | ✅    | ✅   | ✅           | ✅       | ✅   |
| 页面 Hook/恶意消息     | —     | —    | —            | ✅       | ✅   |
| 无媒体页面             | ✅    | —    | 状态         | ✅       | ✅   |

## 3. 站点支持等级

- Tier 0：通用 HTMLMediaElement；每次 PR 的 fixture 必过。
- Tier 1：高使用量/关键站点；有自动化 fixture、发布前 smoke 和 owner。
- Tier 2：有适配器和手工回归；问题按尽力支持处理。
- Tier 3：仅社区反馈或历史记录；不作为稳定版承诺。

## 4. Phase 5 站点 Adapter 矩阵

固定脱敏 fixture 的详细 owner、Tier、支持等级、验证日期和限制见 [站点 Adapter 支持矩阵](./site-adapter-matrix.md)。
当前 Tier 1 为 YouTube、Bilibili、Tencent Video、iQIYI、Youku；Tier 2 为 Netflix、Ixigua、AcFun、Sohu Video、TED。
`pnpm test:compat:report` 校验 catalog、support level、owner、lastVerified、fixture、SHA-256 baseline 和 183 天复核时效。
2026-08-14/15 已在 bundled Chromium headed 环境完成 Tier 1 live smoke、四个 Tier 2 媒体页面 smoke 和 Ixigua 外部阻断探测；2026-08-19 又完成 Netflix 前景 owner 与五个 Tier 1 的覆盖性回归；
该证据只证明冻结环境下的页面行为，不能外推为品牌 Chrome/Edge、所有登录态、广告态或所有播放器版本的完整支持。

### Phase 6.5 Tier 1 headed live smoke（2026-08-14）

| 项目      | 记录                                                                                                                                                           |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run ID    | `2026-08-14T23-25-32-569Z`                                                                                                                                     |
| 命令      | `H5PLAYER_LIVE_HEADLESS=0 H5PLAYER_LIVE_SITES=youtube,bilibili,tencent-video,iqiyi,youku H5PLAYER_LIVE_REQUIRE_MEDIA=1 pnpm --dir web-extension test:e2e:live` |
| OS / 架构 | `darwin 25.5.0` / `arm64`                                                                                                                                      |
| 浏览器    | Playwright bundled Chromium `151.0.7922.34`，headed，viewport `1440x900`                                                                                       |
| 扩展      | version `0.1.0.10000`；fingerprint `b27117abd9471284c1308c2da8c7e78c5d7a6d971a3a53563e1ed573193cc9ab`                                                          |
| 总结果    | `5 passed`；每站 `violations=[]`；warnings 仍按站点保留，不得静默清零                                                                                          |

每站的完整 JSON、截图和 warning 解释见 [live-site-smoke-review-2026-08-15](../09-reviews/live-site-smoke-review-2026-08-15.md)。

| 站点          | 实例/UI 映射                                                                  | resize / scroll / reload                                                 | 快捷键 / Popup / 继承                                   | 真实 pointer                                                                    | 结论                                    |
| ------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------- |
| YouTube       | `media-0-1` 一对一；无 orphan/duplicate                                       | 全部通过；anchor distance `0`                                            | `1→1.1`、Popup `1.5`、reload `1.5`                      | hover 通过                                                                      | headed preview 通过                     |
| Bilibili      | `media-0-1` 一对一；无 orphan/duplicate                                       | 全部通过；anchor distance `0`                                            | `1→1.1`、Popup `1.5`、reload `1.5`                      | hover 通过                                                                      | headed preview 通过                     |
| Tencent Video | 初始 `media-0-1`；专项 reload/WASM 为 `media-*-tencent-viewport`              | 顶层代理匹配真实 fake-video iframe；登录态 720P native/fake 跨帧仲裁已补 | `1→1.1`、Popup `1.5`、reload `1.5`、登录 720P `2→2.1→2` | 初始与 reload 透明边缘真实 hover 通过；保留原生控件/字幕/弹幕 collision warning | 条件通过，宿主避让/广告与可重复 AB 待补 |
| iQIYI         | `media-0-2` 一对一；无 orphan/duplicate                                       | resize/reload 通过；页面无可用 scroll 距离                               | `1→1.1`、Popup `1.5`、reload `1.5`                      | 被浏览器兼容 Modal/新手遮罩阻断，使用 DOM fallback                              | 条件通过，scroll/pointer 待补           |
| Youku         | 一个视觉 slot 含 `media-0-1`/`media-0-2`，Host/Trigger 只绑定当前 `media-0-2` | 全部通过；anchor distance `0`                                            | `1→1.1`、Popup `1.5`、reload `1.5`                      | 登录/会员/广告浮层阻断，使用 DOM fallback；有 advertising warning               | 条件通过，需浮层策略                    |

2026-08-19 覆盖性 Run `2026-08-19-tier1-foreground-fix-final` 使用扩展 `0.1.7.10000` 与 bundled Chromium `151.0.7922.34`，五站 strict smoke 全部通过。YouTube/Bilibili 无 warning；Tencent/Youku 保留 collision warning；iQIYI 保留 no-scroll-distance warning。五站快捷键、Popup `1.5` 和 reload `1.5` 继承均通过，说明前景媒体筛选未回归 Tier 1。

### Phase 6.5 Tier 2 headed live smoke 与 Ixigua 阻断（2026-08-15）

| 站点       | Run / report outcome                                   | 实例与 UI                                                                    | pointer / 宿主共存                  | 倍速生命周期                                   | 判定                               |
| ---------- | ------------------------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------- | ---------------------------------- |
| Netflix    | `2026-08-19-netflix-foreground-owner-final` / `passed` | opacity `0.25` 背景预览无 UI；opacity `1` 前景 `media-0-2` 独占 Host/Trigger | hover 通过；无 warning              | `media-0-2` 快捷键 `1→1.1`、Popup/reload `1.5` | 前景归属通过；账号/DRM/AB 仍未外推 |
| AcFun      | 同上 / `passed`                                        | `media-0-1` 一对一                                                           | hover 通过，无 warning              | 快捷键、Popup、reload 继承通过                 | 冻结环境条件通过                   |
| Sohu Video | 同上 / `passed`                                        | `media-0-1` 一对一                                                           | hover 通过；与 danmaku 区域潜在碰撞 | 快捷键、Popup、reload 继承通过                 | 条件通过；安全区待补               |
| TED        | 同上 / `blocked`                                       | 初始 `media-0-2` 一对一                                                      | hover 通过；advertising collision   | 初始快捷键/Popup 通过；reload 外跳，无继承证据 | 外部跳转阻断                       |
| Ixigua     | `2026-08-15T00-05-00-000Z` / `no-media`                | runtime ready，但 `media=[]`、`hosts=[]`                                     | 页面显示打开 App 看完整内容         | 无可测媒体                                     | 未验证，不计兼容通过               |

Tier 2 Playwright 批次显示 `4 passed`，是因为 blocked/no-media 状态由报告分层记录；兼容声明必须读取 report outcome、warnings 和截图，
不能只读取测试进程退出码。Ixigua 使用 strict `REQUIRE_MEDIA=1`，因此按预期以失败退出保留负向证据。

Netflix 的 2026-08-14 双 slot/P0 记录是历史缺陷证据，已由 2026-08-19 最终 run 覆盖：baseline、resize、scroll、reload 只有 `media-0-2` eligible，且无 orphan、unassigned、duplicate Host/Trigger。rate 原生菜单优先；公开预览页菜单缺失时使用 captured native setter，seek 无原生控件则显式降级。

### Phase 6.5 README 与主流站点扩展实测（历史批次：2026-08-15）

真实站点目录已扩展到 56 个站点，覆盖 README 表格全部视频/音频入口、README 正文点名的 Zhihu Video，以及 Vimeo、Dailymotion、
Twitch、TikTok、Facebook Watch、Reddit Video、Niconico、Bilibili Live、Douyin Live、Spotify、SoundCloud 等主流补充项。

| 2026-08-15 历史证据分类 | 数量 | 代表性结论                                                                                                                                            |
| -------------------- | ---: | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 完整 video flow 通过 |   10 | YouTube、Bilibili、Tencent、iQIYI、Youku、Netflix、AcFun、Sohu、Qilu、Niconico；Netflix 前景归属最新复测无 warning，其余条件站点限制继续保留          |
| 仅 media-discovery   |    3 | CCTV、China Sports、CBS；只能证明媒体发现或实例映射，不能证明 feedback/reload 闭环                                                                    |
| 功能/交互失败        |    9 | Huya/Vimeo/Dailymotion 缺 Host/Trigger；Kuaishou/Douyin Live 有实例误报；Twitch/Pornhub 面板遮挡；Douyin 生命周期失败；Bilibili Live 被动态验证码覆盖 |
| 外部阻断             |   10 | 登录、HTTP 403、站点迁移或 reload 外跳；不计兼容通过，也不直接归因于扩展                                                                              |
| 无可测媒体           |   24 | App-only、首页无播放器、没有可见 content slot、Web Audio/非标准音频或需要具体登录内容                                                                 |

Qilu 完整流程截图确认控件和即时反馈位于播放器右上角，reload 后站点倍速 `1.5` 继承；Kuaishou 则出现 viewport overflow 和 feedback
离开媒体安全区，Huya 没有可见 Host/Trigger，Douyin Live 对非内容 media 产生额外 Host。音频公开页没有取得标准 `<audio>`，因此当前不能
对外宣称音频站点兼容。完整逐站矩阵、run ID、截图索引和解释见
[扩展真实站点兼容性审查](../09-reviews/expanded-live-site-compatibility-review-2026-08-15.md)。

上述分类是 2026-08-15 的历史快照，不能覆盖后续 targeted evidence。2026-08-20 Run
`2026-08-20-phase65-budget-final` 在 bundled Chromium headed 环境重新验证了 Tencent 与 Dailymotion：两站均为
`outcome=passed`、`violations=[]`。Tencent 换集后的 staged rate intent、首次/延迟快捷键、站点轮询稳定性与 reload 继承通过；
Dailymotion 跨域实例首次快捷键、Popup `1.5x` 与 reload 继承通过。Dailymotion 的 18 条 warning 均为 closed ShadowRoot
`probe-limited` 几何边界，不再归类为功能/交互失败。历史 56 站计数保持不变，以便追溯原始批次；当前结论以 targeted report 与本矩阵的最新覆盖说明共同读取。

### Phase 6.5 targeted route-first / authority smoke（2026-08-20）

| 站点 | 实例与路由 | 关键证据 | 当前判定 |
| --- | --- | --- | --- |
| Tencent Video | `media-14-tencent-viewport` 换集后接管，随后 authority 迁移到 `media-0-1`；旧 frame 响应不会覆盖新 intent | `1x→1.1x`、Popup `1.5x`、换集继承 `1.5x`、首次快捷键 `2x`、延迟 `2.1x`、3 秒 `stableAfterSitePolling=true`、reload 继承 `1.5x` | targeted passed；原生控件/字幕/弹幕/广告碰撞 warning 与广告态/更多登录态待补 |
| Dailymotion | 跨域实例 `media-3-1` 首键路由成功，reload 后 `media-11-1` 接管 | 首次快捷键 `1x→1.1x`、Popup `1.5x`、reload 继承 `1.5x`、`violations=[]`；18 条 closed-root `probe-limited` warning | targeted passed；内部 ShadowRoot 几何仍需外部 oracle |

| 能力                                | 自动化证据                      | 当前结果           | 真实站点边界                 |
| ----------------------------------- | ------------------------------- | ------------------ | ---------------------------- |
| hostname/path match + priority      | `adapter-registry.spec.ts`      | Passed             | 未覆盖站点实时路由漂移       |
| selector play/pause/fullscreen      | `site-adapter-fixtures.spec.ts` | 10 fixtures passed | 点击事件不等价于真实业务状态 |
| version/feature disable             | registry unit + rollback policy | Passed             | 需发布候选复测               |
| lifecycle/action/selector isolation | failure injection unit          | Passed             | 未覆盖生产站点恶意/DRM 行为  |
| diagnostics hit/health              | diagnostics integration         | Passed             | 仅输出 bounded metadata      |

## 5. 兼容性证据

每个矩阵单元至少记录：提交 SHA、扩展版本、浏览器版本、OS、页面 fixture/URL 类别、结果、失败日志 artifact、已知限制和复测日期。真实站点报告不得保存账号、完整媒体 URL 或用户内容。

Phase 4/5 当前证据补充：

- Chrome/Firefox production manifest 均为 required `storage`、`activeTab`、`scripting`，optional `<all_urls>`，
  `content_scripts: []`，无 required host permission 与 WAR。
- Chrome lifecycle E2E 固定单 worker，3 个场景通过；并行 persistent profile 会引入启动资源争抢和假性 timeout。
- 独立 5 秒 smoke 为 5051 ms、94 cycles、1 次 worker restart、listeners `4→4`；Phase 2 的 30 分钟结果仍是继承证据。
- Chrome/Firefox raw bundles：background 90150/90151 B、content 191669 B、page-main 77976 B；manifest guardrail 通过。
- Overlay 仅 top frame；same/cross-origin iframe runtime 通过，但 iframe-only media 的 Overlay 聚合未实现。
- Phase 5 增加 10 个固定站点 fixture、adapter registry、Generic fallback、SPA rematch、disable policy 和 health diagnostics；
  Tier 1 与四个 Tier 2 媒体页面已有冻结环境 live smoke，Ixigua 有 no-media/App-only 阻断证据；Firefox ESR/最低版本、Chrome previous stable 和 Edge 仍待补。
- fullscreen/PiP/capture/progress/cross-tab 的 domain、adapter、repository 与 runtime contract 已验证；真实解码帧截图、
  CORS blocked 截图、native→web fullscreen fallback、PiP unavailable、progress restore/complete、multi-tab advisory event
  和 iframe-only media Overlay 的专项浏览器矩阵仍待补。

Phase 6 发布工程补充：

- Chrome/Firefox 构建现在进入独立确定性 ZIP，并由 artifact inspection 检查 manifest identity、权限、CSP、远程代码、
  background 目标差异、入口、timestamp、mode 和 source map。
- `compatibility-report.html` 由固定 `SOURCE_DATE_EPOCH` 生成，schema 明确为 `sanitized-fixture-only`、
  `liveSmoke: not-verified`；该 evidence 被纳入 release bundle 和 checksum。
- PR/nightly/RC workflow 已建立双浏览器 lane；当前 live smoke 仅证明 bundled Chromium，Firefox 153.0 的既有证据仍未覆盖本轮真实站点 UX。
- Firefox manifest minimum `142.0` 只是配置，不是实际最低版本承诺；Firefox ESR/142、Chrome previous stable、Edge、
  headed permission UX 和真实 Tier 1 的换集/广告/登录态仍未完成，Stable 继续 `NO-GO`。
- 品牌 Chrome/Edge 的侧载边界已由官方 Playwright 文档确认：Chrome/Edge 移除了自动侧载扩展所需的命令行 flags，
  当前 harness 必须使用 bundled Chromium；详见 <https://playwright.dev/docs/chrome-extensions>。品牌浏览器不能写成已实测通过。
- 商店签名 ZIP/XPI 与仓库规范 ZIP 可能因平台重打包不同；提交时必须记录签名包 hash、平台版本和与源码 bundle 的映射。

## 6. 支持策略

若浏览器或站点变更导致能力下降：

1. 先确认 generic adapter 是否仍工作。
2. 按 `BUG-*` 记录最小复现和 Tier。
3. 能力不可用时在 UI 显示降级原因，不静默修改用户设置。
4. 对高频站点可发布 adapter hotfix；涉及权限/协议/数据则走完整 RC 门禁。

## 7. 当前支持声明

Phase 6.5 当前结论为“bundled Chromium headed live smoke 已取得广覆盖但条件化的证据，UX 仍为 NO-GO，Phase 7 HOLD”。当前只承诺
Tier 0 通用 `HTMLMediaElement`、列出的固定 adapter fixture，以及历史十站完整流程与最新 Tencent/Dailymotion targeted run 在对应冻结环境中的实例映射/基础倍速行为；CCTV、
China Sports、CBS 仅为 discovery 证据。Dailymotion 历史 Host/Trigger 功能失败已被最新 run 覆盖，但 closed ShadowRoot 几何仍是 `probe-limited`，不能写成完整 UI 验收。
56 站扩展矩阵中的其它失败、登录/反爬、站点迁移、App-only、无标准媒体、DOM fallback、Host/Trigger 缺失、面板遮挡和 feedback 安全区问题均不得被对外文案省略。
仍不承诺音频站点、Bilibili/Douyin Live、Firefox ESR/最低版本、Chrome previous stable、品牌 Chrome/Edge 或 Stable 商店发布。任何对外文案必须与此边界一致。
