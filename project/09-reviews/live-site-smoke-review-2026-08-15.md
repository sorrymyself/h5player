# Tier 1 / Tier 2 真实站点 Live Smoke 审查

> 后续覆盖说明（2026-08-19）：本文保留 2026-08-14/15 原始观察。Netflix 背景预览误暴露问题已由 [Netflix 前景媒体归属审查](./netflix-foreground-media-ownership-review-2026-08-19.md) 的最终 run 关闭；本文中的 Netflix P0 描述不再代表当前状态。

> 文档 ID：REVIEW-UX-003  
> 状态：In Review / Conditional Evidence / Phase 7 HOLD  
> 负责人：Quality Owner / UI Owner / Web Extension Compatibility  
> 最后更新：2026-08-15  
> 关联：QA-003、QA-006、QUAL-UX-001、QA-002、EXT-138/139、ADR-0015/0016

## 1. 审查目的

本次审查验证 Web Extension 在五个 Tier 1、四个可取得媒体的 Tier 2 真实视频网站，以及 Ixigua 外部内容可用性阻断场景上的四类高风险行为：

1. 真实媒体实例与 per-media Host/Trigger 的一一对应关系。
2. 控件是否锚定到当前媒体，而不是出现视口级大面板。
3. 快捷键、Popup、反馈和 reload 后倍速继承是否形成统一闭环。
4. iframe、站点原生控件、字幕/弹幕、广告、登录层和 Modal 对真实 pointer UX 的影响。

本记录严格区分机器断言、真实 pointer 交互和 DOM fallback。`report.outcome=passed` 且 `violations=[]` 只表示没有机器级违规，
不表示所有站点的用户体验已达标。

## 2. 执行记录

### 2.1 Tier 1

| 字段      | 值                                                                                                                                                             |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run ID    | `2026-08-14T23-25-32-569Z`                                                                                                                                     |
| 命令      | `H5PLAYER_LIVE_HEADLESS=0 H5PLAYER_LIVE_SITES=youtube,bilibili,tencent-video,iqiyi,youku H5PLAYER_LIVE_REQUIRE_MEDIA=1 pnpm --dir web-extension test:e2e:live` |
| 结果      | `5 passed`；五站 report outcome 均为 `passed`，`violations=[]`                                                                                                 |
| OS / 架构 | `darwin 25.5.0` / `arm64`                                                                                                                                      |
| 浏览器    | Playwright bundled Chromium `151.0.7922.34`，headed，viewport `1440x900`                                                                                       |
| 扩展      | version `0.1.0.10000`；fingerprint `b27117abd9471284c1308c2da8c7e78c5d7a6d971a3a53563e1ed573193cc9ab`                                                          |
| 证据目录  | `web-extension/test-results/live-sites/2026-08-14T23-25-32-569Z/`                                                                                              |

测试覆盖 baseline、resize、scroll（页面有可用滚动距离时）、reload、quick controls 折叠/展开、快捷键加速、Popup 站点倍速、
feedback 可见性、reload 后倍速继承和 reload 后 media/UI 重新绑定。每站保存 `report.json` 与六张截图：`baseline.png`、
`quick-controls-collapsed.png`、`quick-controls-expanded.png`、`rate-feedback.png`、`reload-inheritance.png`、
`reload-quick-controls-expanded.png`。

### 2.2 Tier 2

| 字段     | 值                                                                                                                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run ID   | `2026-08-14T23-50-00-000Z`                                                                                                                                                                     |
| 命令     | `H5PLAYER_LIVE_HEADLESS=0 H5PLAYER_LIVE_SITES=netflix,acfun,sohu-video,ted H5PLAYER_LIVE_REQUIRE_MEDIA=1 H5PLAYER_LIVE_RUN_ID=2026-08-14T23-50-00-000Z pnpm --dir web-extension test:e2e:live` |
| 测试结果 | `4 passed (58.2s)`；report outcome 为 3 个 `passed` + TED `blocked`；四站均 `violations=[]`                                                                                                    |
| 环境     | 与 Tier 1 相同：bundled Chromium `151.0.7922.34` headed，`1440x900`，`darwin 25.5.0 arm64`                                                                                                     |
| 扩展     | version `0.1.0.10000`；fingerprint `b27117abd9471284c1308c2da8c7e78c5d7a6d971a3a53563e1ed573193cc9ab`                                                                                          |
| 证据目录 | `web-extension/test-results/live-sites/2026-08-14T23-50-00-000Z/`                                                                                                                              |

`4 passed` 表示测试用例完成且没有机器 violation，不表示四个站点都取得完整生命周期证据。TED 初次媒体、UI、快捷键、Popup 和反馈通过，
但 reload 后导航到站外，因此 report outcome 正确记录为 `blocked`，不能写成 reload 继承通过。

### 2.3 Ixigua 负向证据

| 字段     | 值                                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Run ID   | `2026-08-15T00-05-00-000Z`                                                                                                                                               |
| 命令     | `H5PLAYER_LIVE_HEADLESS=0 H5PLAYER_LIVE_SITES=ixigua H5PLAYER_LIVE_REQUIRE_MEDIA=1 H5PLAYER_LIVE_RUN_ID=2026-08-15T00-05-00-000Z pnpm --dir web-extension test:e2e:live` |
| 结果     | strict smoke 按预期失败；report outcome=`no-media`，violation=`No controllable media was available on any candidate URL`                                                 |
| URL 证据 | `www.ixigua.com/` 与公开 `m.ixigua.com/video/...` 均返回 HTTP 200，但 `mediaObserved=false`                                                                              |
| DOM 证据 | 扩展 content/MAIN/background runtime 均为 `ready`；最终页面 `media=[]`、`hosts=[]`                                                                                       |
| 视觉证据 | [blocked-or-no-media.png](../../web-extension/test-results/live-sites/2026-08-15T00-05-00-000Z/ixigua/blocked-or-no-media.png) 显示“打开 App 看完整内容”阻断层           |

该结果是站点公开 Web 内容可用性阻断，不是扩展兼容通过，也不能据此判定 adapter 失效。只有取得可复现的桌面 Web `<video>` 样本后，
才允许继续验证实例/UI 映射、反馈与倍速继承。

## 3. Tier 1 逐站结论

| 站点          | 实例/UI 映射                                                                                                                     | 真实 pointer                                                                    | 倍速与反馈                                                                   | warning / 限制                                                      | 当前判定                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------- |
| YouTube       | `media-0-1` 与 Host/Trigger 一对一；baseline、resize、scroll、reload 无 orphan/duplicate；anchor distance `0`                    | `hover` 真实打开 quick controls                                                 | 快捷键 `1→1.1`；Popup `1.5`；feedback 可见；reload 后 `1.5` 继承             | 无 warning                                                          | 冻结环境条件通过              |
| Bilibili      | `media-0-1` 与 Host/Trigger 一对一；baseline、resize、scroll、reload 无 orphan/duplicate；anchor distance `0`                    | `hover` 真实打开 quick controls                                                 | 快捷键 `1→1.1`；Popup `1.5`；feedback 可见；reload 后 `1.5` 继承             | 无 warning                                                          | 冻结环境条件通过              |
| Tencent Video | 初始 `media-0-1`；reload 后变为 child frame 的 `media-13-1`；两次均一对一且无 orphan/duplicate；anchor distance `0`              | 父页面原生控制层/弹幕相关层遮挡 child-frame 控件；报告使用 `hover+dom` fallback | 快捷键 `1→1.1`；Popup `1.5`；feedback 可见；reload 后 `1.5` 继承到新 mediaId | `native control/subtitle/danmaku/ad collision`；真实 pointer 未打开 | 条件通过，需 frame 架构决策   |
| iQIYI         | `media-0-2` 与 Host/Trigger 一对一；resize/reload 无 orphan/duplicate；anchor distance `0`                                       | 兼容性提示 Modal 和 reload 新手遮罩阻断 pointer；报告使用 `hover+dom` fallback  | 快捷键 `1→1.1`；Popup `1.5`；feedback 可见；reload 后 `1.5` 继承             | 页面没有可用 scroll 距离；真实 pointer 未打开                       | 条件通过，scroll/pointer 待补 |
| Youku         | 一个视觉 slot 同时观察 `media-0-1`/`media-0-2`，但 Host/Trigger 只绑定当前 `media-0-2`；无 orphan/duplicate；anchor distance `0` | 登录/会员/广告浮层阻断 pointer；报告使用 `hover+dom` fallback                   | 快捷键 `1→1.1`；Popup `1.5`；feedback 可见；reload 后 `1.5` 继承             | advertising collision；真实 pointer 未打开                          | 条件通过，浮层策略待补        |

### 3.1 YouTube

- 报告：[youtube/report.json](../../web-extension/test-results/live-sites/2026-08-14T23-25-32-569Z/youtube/report.json)。
- 关键截图：`youtube/quick-controls-expanded.png`、`youtube/rate-feedback.png`、`youtube/reload-quick-controls-expanded.png`。
- 折叠 Host 覆盖率约 `0.23%`，展开约 `8.84%`；均无 viewport overflow 或碰撞分类。
- 真实 hover 与 DOM 结构一致，当前可以作为 per-media overlay 的正向基线。

### 3.2 Bilibili

- 报告：[bilibili/report.json](../../web-extension/test-results/live-sites/2026-08-14T23-25-32-569Z/bilibili/report.json)。
- 关键截图：`bilibili/quick-controls-expanded.png`、`bilibili/rate-feedback.png`、`bilibili/reload-quick-controls-expanded.png`。
- 折叠 Host 覆盖率约 `0.24%`，展开约 `9.16%`；无 viewport overflow 或碰撞分类。
- 真实 hover 通过，说明当前 host/trigger 与播放器 DOM 的锚定方式在该站点可达。

### 3.3 Tencent Video

- 报告：[tencent-video/report.json](../../web-extension/test-results/live-sites/2026-08-14T23-25-32-569Z/tencent-video/report.json)。
- 关键截图：[reload-quick-controls-expanded.png](../../web-extension/test-results/live-sites/2026-08-14T23-25-32-569Z/tencent-video/reload-quick-controls-expanded.png)。
- 初始媒体在顶层观察为 `media-0-1`，reload 后 child frame 重新发现为 `media-13-1`；绑定没有串到旧实例。
- 自动化可读到 Host/Trigger 和 feedback，但父页面原生标题/弹幕/播放控制层覆盖 child-frame 右上区域；这是用户实际不能点击的风险。
- 当前架构保持 child frame 自持 UI。是否引入受控 top-frame proxy 必须先形成 ADR/决策，不能在本轮未经评审直接改变边界。

### 3.4 iQIYI

- 报告：[iqiyi/report.json](../../web-extension/test-results/live-sites/2026-08-14T23-25-32-569Z/iqiyi/report.json)。
- 关键截图：`iqiyi/quick-controls-expanded.png`、`iqiyi/reload-quick-controls-expanded.png`。
- 播放器实例为 `media-0-2`，resize/reload 映射稳定；页面滚动高度没有提供可用滚动距离，因此 scroll 项只能标记未测量。
- 爱奇艺浏览器兼容提示和 reload 新手遮罩覆盖了 pointer 路径；DOM fallback 不能替代真实用户可达性。

### 3.5 Youku

- 报告：[youku/report.json](../../web-extension/test-results/live-sites/2026-08-14T23-25-32-569Z/youku/report.json)。
- 关键截图：`youku/quick-controls-expanded.png`、`youku/rate-feedback.png`、`youku/reload-quick-controls-expanded.png`。
- 同一视觉 slot 中存在两个 eligible media，但 active-media 选择只给 `media-0-2` 生成一套 Host/Trigger；这是正确的唯一 UI 绑定，
  不是重复控件。
- 登录/会员/广告浮层产生真实碰撞风险；pointer 通过不了时不能用 DOM fallback 把站点标成 UX 通过。

## 4. Tier 2 与 Ixigua 逐站结论

| 站点       | 实例/UI 映射                                                                                                    | 真实 pointer               | 倍速与反馈                                                 | warning / 限制                                                                   | 当前判定                            |
| ---------- | --------------------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------- |
| Netflix    | 两个 eligible media 形成两个独立视觉 slot；每个 slot 各有且仅有一个同 mediaId Host/Trigger，无 orphan/duplicate | `hover` 打开目标 slot 控件 | 快捷键 `1→1.1`、Popup `1.5`、feedback、reload `1.5` 均通过 | 背景预览和主视觉媒体都暴露控件；实例映射正确但 active/background UX 未解决       | 条件通过，P0 多媒体筛选风险         |
| AcFun      | `media-0-1` 与 Host/Trigger 一对一；resize/scroll/reload 映射稳定                                               | `hover` 通过               | 快捷键、Popup、feedback、reload 继承通过                   | 无 warning                                                                       | 冻结环境条件通过                    |
| Sohu Video | 顶层 `media-0-1` 与 Host/Trigger 一对一；另有无内容媒体 frame                                                   | `hover` 通过               | 快捷键、Popup、feedback、reload 继承通过                   | 展开面板与 danmaku 区域存在潜在碰撞                                              | 条件通过，宿主共存待处理            |
| TED        | 初始 `media-0-2` 与 Host/Trigger 一对一                                                                         | `hover` 通过               | 初始快捷键、Popup 和 feedback 通过                         | 展开面板与 advertising 区域潜在碰撞；reload 跳转站外并记为 `external-navigation` | `blocked`，不能宣称 reload 继承通过 |
| Ixigua     | 两个公开候选入口均无 `<video>`，因此没有可评估的媒体实例或 UI host                                              | 不适用                     | 不适用                                                     | “打开 App 看完整内容”阻断；`media=[]`、`hosts=[]`                                | 未验证，不计兼容通过                |

Netflix 报告：[report.json](../../web-extension/test-results/live-sites/2026-08-14T23-50-00-000Z/netflix/report.json)；
AcFun 报告：[report.json](../../web-extension/test-results/live-sites/2026-08-14T23-50-00-000Z/acfun/report.json)；
Sohu 报告：[report.json](../../web-extension/test-results/live-sites/2026-08-14T23-50-00-000Z/sohu-video/report.json)；
TED 报告：[report.json](../../web-extension/test-results/live-sites/2026-08-14T23-50-00-000Z/ted/report.json)；
Ixigua 报告：[report.json](../../web-extension/test-results/live-sites/2026-08-15T00-05-00-000Z/ixigua/report.json)。

## 5. 验收映射

| 验收项                      | 本轮证据                                                                                                   | 判定                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------ |
| 实例与 UI 一一对应          | 9 个取得媒体的站点 baseline 无 orphan/duplicate；Netflix 两个视觉 slot 分别正确绑定；Ixigua 无媒体不能评价 | 真实证据部分通过         |
| 不出现全局大面板            | 9 个媒体页面均为媒体锚定控件；Netflix 暴露两套 slot UI，仍需 active/background 策略                        | 部分通过，有多媒体风险   |
| 低干扰即时反馈              | 9 个媒体页面快捷键/Popup feedback 可见并归属目标 mediaId                                                   | 冻结环境通过             |
| 全局/站点倍速继承           | Tier 1 五站、Netflix、AcFun、Sohu reload `1.5`；TED reload 外部跳转，Ixigua 无媒体                         | 8 站通过，2 站未取得证据 |
| pointer 打开 quick controls | YouTube、Bilibili、Netflix、AcFun、Sohu、TED 为 `hover`；Tencent/iQIYI/Youku 为 `hover+dom`                | 6 站通过，3 站阻断       |
| 站点原生 UI 共存            | Tencent/Youku/iQIYI 浮层或父层阻断；Sohu danmaku、TED advertising 碰撞；Netflix 背景媒体误暴露             | 未通过，需处理           |
| scroll/resize/reload 锚定   | 多站通过；iQIYI 无 scroll 距离，TED reload 外跳，Ixigua 无媒体                                             | 部分通过                 |

## 6. 浏览器通道边界

本轮浏览器是 Playwright bundled Chromium，不是品牌 Google Chrome。尝试使用品牌 Chrome 通道时，扩展 Service Worker 在启动前无法加载；
手工移除 `--disable-extensions` 后品牌 Chrome 可以启动，但仍不接受当前自动侧载参数。官方 Playwright 文档明确说明 Chrome 和 Edge
已移除自动侧载扩展所需的命令行 flags，应使用 bundled Chromium：<https://playwright.dev/docs/chrome-extensions>。

因此：

- 本轮可以写成“bundled Chromium headed live smoke”；不能写成“品牌 Chrome/Edge 已通过”。
- 品牌浏览器要么使用已打包并手工安装的扩展，要么建立专用自动化环境；两者都需要单独记录版本、安装方式和扩展 hash。
- 当前 harness 已在 `web-extension/tests/e2e/extension-harness.ts` 对 `chrome`/`msedge` 通道给出明确错误，避免误报。

## 7. 风险与后续门禁

1. Tencent：评审 child-frame 自持 UI 与 top-frame proxy 的取舍，重点验证父页面原生层、弹幕、字幕和广告的遮挡关系。
2. iQIYI：处理兼容 Modal/新手遮罩的延迟打开、避让或可解释降级；补充有实际滚动距离的页面样本。
3. Youku：处理登录/会员/广告浮层，并验证 active media 切换时 Host/Trigger/feedback 不串控。
4. Netflix：区分主播放媒体、背景预览和 hover preview；不能仅凭几何可见就给每个视觉 slot 永久暴露控件。
5. Sohu/TED：补做弹幕、广告结束后内容媒体、字幕和播放器原生工具区的安全区策略；TED reload 外跳必须继续保留为阻断。
6. Ixigua：等待或维护一个可复现桌面 Web `<video>` 样本；App-only 页面只能作为外部可用性证据，不能升级 adapter 支持声明。
7. Tier 1/2 补做换集、SPA/source 变化、广告、登录态、站点 reset 和反馈安全区；保留真实 pointer 证据。
8. Firefox headed 补做定位、feedback、快捷键、iframe teardown 和 worker restart。
9. Phase 6.5 fresh 30 分钟 churn 仍是 P0 门禁；完成前 Phase 7 保持 `HOLD`。

## 8. 结论

本轮已经把“扩展能控制媒体”推进为可审查的 Tier 1/Tier 2 真实站点证据：9 个取得媒体的页面能够验证实例/UI 绑定、控件锚定、
反馈归属和基础倍速闭环，Ixigua 也留下了明确的 App-only/no-media 负向证据。但 Netflix 多槽位筛选、Tencent/iQIYI/Youku pointer、
Sohu/TED 宿主碰撞、TED reload 外跳、Firefox headed 和长稳门禁仍未关闭。结论保持：
`LIVE SMOKE CONDITIONAL / UX NO-GO / PHASE 7 HOLD`。不得把 DOM fallback、外部阻断、无滚动距离或机器 `violations=[]` 写成完整用户体验通过。

## 9. 扩展覆盖补充

在本审查完成后，live catalog 已继续扩展到 56 个 README/主流视频、音频和直播站点，并补做 Qilu 完整流程、Pornhub、QQ Music MV、
Instagram/X/微博登录分类、音频内容页、Zhihu Video、Bilibili Live 和 Douyin Live。最新汇总为：10 个完整 video flow 通过、3 个仅
media-discovery、9 个功能/交互失败、10 个外部阻断、24 个 no-media。

新增证据没有改变本审查的 `Phase 7 HOLD` 结论，反而进一步暴露 Huya/Vimeo/Dailymotion Host/Trigger 缺失、Kuaishou/Douyin Live
实例误报、Twitch/Pornhub 面板遮挡、音频页无标准 `<audio>`、登录/验证码/年龄门和站点迁移等限制。完整逐站矩阵见
[扩展真实站点兼容性审查](./expanded-live-site-compatibility-review-2026-08-15.md)。
