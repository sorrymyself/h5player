# 扩展真实站点兼容性审查

> 后续覆盖说明（2026-08-19）：本文保留 2026-08-15 的 56 站原始证据。Netflix active/background 缺口已由 [Netflix 前景媒体归属审查](./netflix-foreground-media-ownership-review-2026-08-19.md) 覆盖关闭；其它站点结论仍按本文和最新矩阵共同解释。

> 文档 ID：REVIEW-UX-004  
> 状态：Completed / Evidence captured / Promotion blocked  
> 负责人：Web Extension Compatibility / Quality Owner  
> 审查日期：2026-08-15  
> 关联任务：EXT-138、EXT-139

## 1. 审查目标

本轮用于验证 Web Extension 在 README 支持网站列表、README 正文额外点名的网站，以及一组主流视频/音频/直播网站上的真实行为。
重点不是“测试进程是否退出成功”，而是逐站检查：

- 媒体实例是否是当前可见内容媒体，而不是背景、广告、预加载或不可交互媒体；
- 每个可用媒体是否只有一套与其 `mediaId` 绑定的 Host、Trigger、Panel 和 Feedback；
- 控件是否锚定在媒体右上角，滚动、resize、媒体替换和 reload 后仍保持锚定；
- 快捷键、Popup 站点倍速、即时反馈和刷新后的站点倍速继承是否形成闭环；
- 真实 pointer 是否能打开控件；DOM fallback 只能作为诊断证据，不能当作用户体验通过；
- 登录、反爬、App-only、HTTP 错误、站点迁移和没有标准 `HTMLMediaElement` 时，是否被明确记录为外部证据缺口。

## 2. 测试边界与事实源

### 2.1 目录与覆盖

`web-extension/tests/e2e/live-site-catalog.ts` 当前包含 56 个站点：

- README/既有 adapter：YouTube、Bilibili、Tencent Video、iQIYI、Youku、Ixigua、AcFun、Sohu Video、TED；
- README 支持表及正文站点：Douyin、Zhihu Video、Instagram、Twitter/X、Telegram Web、Pornhub、Douyu、Huya、Weibo TV、Kueran、NetEase Open Class、QQ Music MV、Phoenix Video、Fun TV、PPTV、Qilu Net、Sunshine Satellite TV、CCTV、Mango TV、Zhibo.tv、China Sports、Kuaishou、MioMio、56.com、VK、Vine、Magisto、CBS、FC2 Video，以及 6 个 README 音频/网盘入口；
- 未列在 README 表中的主流站点：Vimeo、Dailymotion、Twitch、TikTok、Facebook Watch、Reddit Video、Niconico、Bilibili Live、Douyin Live、Spotify、SoundCloud。

README 表格中的 37 个视频入口和 6 个具体音频入口均已进入目录；README 正文额外提到的 Zhihu Video 也已加入。对于站点已经迁移、要求登录或没有公开播放器的情况，目录仍保留该站点，避免把负向证据静默删除。

### 2.2 冻结环境

| 字段        | 值                                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| OS / 架构   | macOS `darwin 25.5.0` / `arm64`                                                                       |
| 浏览器      | Playwright bundled Chromium `151.0.7922.34`                                                           |
| 模式        | headed，默认 viewport `1440x900`                                                                      |
| Node        | `24.13.0`                                                                                             |
| 扩展        | version `0.1.0.10000`；fingerprint `b27117abd9471284c1308c2da8c7e78c5d7a6d971a3a53563e1ed573193cc9ab` |
| 报告 schema | `3`                                                                                                   |
| 运行入口    | `H5PLAYER_LIVE_HEADLESS=0 H5PLAYER_LIVE_STRICT=0 pnpm test:e2e:live`                                  |

完整 JSON 与截图位于 `web-extension/test-results/live-sites/<run-id>/<site-id>/`。本轮主要运行：

| Run ID                                   | 范围                                           |
| ---------------------------------------- | ---------------------------------------------- |
| `2026-08-14T23-25-32-569Z`               | YouTube、Bilibili、Tencent Video、iQIYI、Youku |
| `2026-08-14T23-50-00-000Z`               | Netflix、AcFun、Sohu Video、TED                |
| `2026-08-15T00-05-00-000Z`               | Ixigua                                         |
| `2026-08-15-expanded-cn-short-live`      | Douyin、Douyu、Huya、Kuaishou                  |
| `2026-08-15-expanded-douyin-rerun`       | Douyin 生命周期复测                            |
| `2026-08-15-expanded-global-video`       | Vimeo、Dailymotion、Twitch、TikTok、Niconico   |
| `2026-08-15-expanded-audio`              | README 音频入口初测                            |
| `2026-08-15-expanded-readme-discovery-a` | README 发现级站点第一批                        |
| `2026-08-15-expanded-readme-discovery-b` | README 发现级站点第二批                        |
| `2026-08-15-expanded-final-video`        | Qilu 完整流程、Pornhub、QQ Music MV            |
| `2026-08-15-expanded-final-access-audio` | Instagram、Twitter/X、Weibo TV、音频内容页复测 |
| `2026-08-15-expanded-final-instagram`    | Instagram 登录页分类复测                       |
| `2026-08-15-expanded-final-extra-live`   | Zhihu Video、Bilibili Live、Douyin Live        |
| `2026-08-15-expanded-final-extra-rerun`  | Zhihu 403、Bilibili Live 动态验证码复测        |

## 3. 汇总结论

| 结果类别              | 站点数 | 含义                                                                                             |
| --------------------- | -----: | ------------------------------------------------------------------------------------------------ |
| 完整流程通过          |     10 | video profile 报告 `passed`，并完成倍速、反馈、reload 等完整流程；仍需结合 warnings 判断条件限制 |
| 仅媒体发现            |      3 | discovery profile 报告 `passed`，但没有执行完整倍速、反馈、reload 闭环                           |
| 功能/交互 `failed`    |      9 | 页面取得媒体，但 Host/Trigger/Feedback/继承/遮挡等交付条件失败                                   |
| 外部阻断 `blocked`    |     10 | 登录、HTTP 错误、站点迁移或 reload 外部跳转，不能归因于扩展                                      |
| 无可测媒体 `no-media` |     24 | 没有可选择的可见内容媒体；其中一部分是 App-only、Web Audio、登录态或首页无播放器                 |
| **合计**              | **56** | 以上类别互斥，按每站最新报告统计                                                                 |

`Playwright 通过` 只表示报告成功写出；本矩阵的站点结论以 `outcome`、`evidenceLevel`、`warnings`、`violations`、`terminalPhase` 和截图为准。

## 4. 完整流程通过站点

下表中的“通过”不等于 Stable 承诺；有 warning 的站点仍是条件通过。

| 站点          | Profile | 真实证据                                                                             | 关键限制                                                                |
| ------------- | ------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| YouTube       | video   | Host/Trigger 一对一；快捷键、Popup `1.5`、feedback、reload 继承通过；真实 hover 通过 | 当前只覆盖冻结公开视频与单一页面状态                                    |
| Bilibili      | video   | 同上；真实 hover 通过                                                                | 未覆盖直播/登录/广告换集状态                                            |
| Tencent Video | video   | 实例映射、快捷键、Popup、feedback、reload 通过                                       | child frame 被父页面原生层/弹幕层遮挡，pointer 使用 DOM fallback        |
| iQIYI         | video   | 实例映射、快捷键、Popup、feedback、reload 通过                                       | 站点 Modal 阻断真实 pointer；页面无可用 scroll 距离                     |
| Youku         | video   | active media 与 Host/Trigger 一对一；生命周期通过                                    | 视觉 slot 含多个 media；登录/会员/广告层阻断 pointer，使用 DOM fallback |
| Netflix       | video   | 两个视觉 slot 各自有绑定；快捷键、Popup、reload 通过                                 | 背景/预览媒体也暴露控件，active/background 策略仍未冻结                 |
| AcFun         | video   | 当前冻结样本无 warning，基础闭环通过                                                 | 仅代表该公开视频和当前播放器版本                                        |
| Sohu Video    | video   | 完整闭环、真实 hover 通过                                                            | 展开面板与 danmaku/宿主区域有碰撞 warning                               |
| Qilu Net      | video   | 完整闭环；截图确认工具条和 feedback 在播放器右上角；reload `1.5` 继承                | 展开面板检测到原生 controls 碰撞 warning                                |
| Niconico      | video   | 快捷键、Popup、feedback、reload 继承通过                                             | 页面无可用 scroll 距离；真实 pointer 使用 DOM fallback                  |

## 5. 仅媒体发现站点

| 站点         | 发现证据                                              | 不能宣称的能力                                           |
| ------------ | ----------------------------------------------------- | -------------------------------------------------------- |
| CCTV         | 发现 1 video + 1 audio，但没有可见 content-video slot | 无法证明媒体锚定、pointer、feedback 或倍速闭环           |
| China Sports | 1 video，Host/Trigger 与 `media-0-1` 一对一           | 只执行 discovery，不代表快捷键、Popup 或 reload 继承通过 |
| CBS          | 发现 4 video，但没有可见 content-video slot           | 不能把媒体标签存在写成用户可操作播放器兼容               |

## 6. 功能与交互失败站点

| 站点          | 主要失败证据                                                                                                     | 归因边界                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Douyin        | 初始实例映射、快捷键和 Popup 倍速可用；reload 重定向到精选/登录模态，生命周期阶段失败；pointer 使用 DOM fallback | 站点导航/登录态变化与产品继承问题同时存在，暂不升级支持                     |
| Pornhub       | 年龄确认页后探测到媒体；展开面板覆盖约 `63.5%` 可见媒体；hotkey/Popup feedback 不可见；reload 后 `1.0` 未继承    | 年龄门和动态广告/媒体状态使结果不可作为干净播放器样本；仍暴露真实 UX 风险   |
| Huya          | 媒体可见但没有可见 Host/Trigger，anchor 与 feedback 均失败                                                       | 真实页面结构下 generic overlay 不可交付                                     |
| Kuaishou      | 非内容媒体出现额外 Host；Trigger/Panel 溢出 viewport；feedback 离开可见媒体安全区                                | 实例筛选、边界布局和反馈安全区均需修复                                      |
| Vimeo         | 可见媒体存在，但所有阶段均缺 Host assessment，hotkey 阶段 fatal                                                  | 需要补 child/frame 或播放器内部宿主解析                                     |
| Dailymotion   | media 在 child frame；Host 存在但 Trigger 缺失，Panel 无法打开                                                   | frame ownership/触发器注入链路不完整                                        |
| Twitch        | 基础控制与继承可用，但展开 quick controls 覆盖超过可见媒体 `20%`                                                 | 面板尺寸/边缘自适应未达验收线                                               |
| Bilibili Live | 页面媒体存在，但动态图片验证码覆盖播放器；Trigger 缺失并在 hotkey 阶段 fatal                                     | 明确的动态反爬/验证码阻断；截图为主要证据，不把 UI 失败归因于普通播放器兼容 |
| Douyin Live   | 5 个内容视频均有一对一 Host/Trigger，但另有一个非内容媒体 Host 未分配                                            | discovery 证明实例筛选仍有误报，不能升级 full-flow                          |

关键截图：

- Qilu 工具条/反馈：[quick-controls-expanded.png](../../web-extension/test-results/live-sites/2026-08-15-expanded-final-video/qilu-video/quick-controls-expanded.png)、[rate-feedback.png](../../web-extension/test-results/live-sites/2026-08-15-expanded-final-video/qilu-video/rate-feedback.png)；
- Bilibili Live 动态验证码：[baseline.png](../../web-extension/test-results/live-sites/2026-08-15-expanded-final-extra-rerun/bilibili-live/baseline.png)；
- Douyin Live 非内容媒体 Host：[media-discovery.png](../../web-extension/test-results/live-sites/2026-08-15-expanded-final-extra-live/douyin-live/media-discovery.png)；
- Pornhub 年龄门：[quick-controls-expanded.png](../../web-extension/test-results/live-sites/2026-08-15-expanded-final-video/pornhub/quick-controls-expanded.png)。

## 7. 外部阻断站点

| 站点         | 报告信号                                              | 说明                                         |
| ------------ | ----------------------------------------------------- | -------------------------------------------- |
| TED          | reload `external-navigation`；初始流程有媒体证据      | 站点 reload 后外跳，缺少继承证据             |
| Zhihu Video  | HTTP `403`                                            | 公开 `zvideo` URL 被当前网络/站点策略拒绝    |
| Instagram    | `page-login-required` + `login-required`              | 登录表单页，无公开内容媒体；已补分类器并复测 |
| Twitter / X  | `login-required`，重定向 `/i/flow/login`              | 未登录无法取得公开 feed 媒体                 |
| Weibo TV     | `login-required`，重定向 `passport.weibo.com/visitor` | 访客页无可测播放器                           |
| MioMio       | `external-navigation`                                 | 入口迁移到外部站点                           |
| VK           | `external-navigation`                                 | 入口进入非允许宿主/登录流                    |
| Magisto      | `external-navigation`                                 | 入口迁移到 Vimeo 视频编辑页                  |
| Reddit Video | HTTP `403`                                            | 当前浏览器/网络被 Reddit 拒绝                |
| Spotify      | `page-login-required` + `login-required`              | 页面明确提示登录后才能收听完整曲目           |

这些站点的结果应保留为外部条件证据，不应作为扩展功能回归缺陷；但在产品支持声明中必须写明限制。

## 8. 无可测媒体站点

### 8.1 发现了媒体标签但没有可选内容实例

- Douyu：观察到 media tag，但没有可见 selectable content video；
- TikTok：观察到 media tag，但没有可见 selectable content video。

### 8.2 App-only、首页或迁移后没有公开播放器

Ixigua 的公开入口显示“打开 App 看完整内容”，报告为 `no-media`；Telegram Web、Kueran、NetEase Open Class、QQ Music MV、Phoenix Video、Fun TV、PPTV、Sunshine Satellite TV、Mango TV、Zhibo.tv、56.com、Vine、FC2 Video、Facebook Watch 也没有在冻结页面取得可选择内容媒体。

QQ Music MV 实测页面是 MV 列表，截图显示缩略图网格而非已打开的播放器；这不能作为 QQ Music 播放器兼容失败，后续若要纳入支持承诺，应提供稳定 MV 详情 URL。

### 8.3 音频/网盘入口没有标准 HTMLMediaElement

Ximalaya、Lazy to Listen、Qingting FM、Kugou Audiobook、Baidu Netdisk Audio、AliYun Drive Audio、SoundCloud 均未在公开页面/点击播放后取得标准 `<audio>` 或 `<video>` 实例。手工截图显示 Ximalaya/Qingting 使用页面播放器或可能的 Web Audio，Spotify 则被登录门阻断；当前扩展只能声明“未验证”，不能宣称音频兼容。

## 9. 测试基础设施改进

- `live-site-catalog.ts` 统一管理 URL、profile、tier、play selector、来源和覆盖清单；catalog unit test 保证 README 与主流扩展项不丢失。
- 报告 schema 升级到 `3`，记录 `source`、`profile`、`evidenceLevel`、`terminalPhase`、访问信号和 fatal screenshot。
- `classifyPageAccessSignals` 增加 Instagram 本地化登录页和图片点击验证码识别；导航阶段对 anti-bot、geo、service unavailable、unsupported browser 进行硬阻断标记。
- screenshot 在 Playwright 截图超时后回退到 CDP `Page.captureScreenshot`，因此登录页、空白页和验证码页也保留可审查图像。
- live smoke 继续保留 DOM fallback 的方法名和 warning；不会将 fallback 自动折算为真实 pointer 通过。

## 10. 接受标准与下一步

本轮结论：`LIVE COVERAGE BROAD / EVIDENCE PARTIAL / UX NO-GO / PHASE 7 HOLD`。

在重新评估 Phase 7 前，至少需要：

1. 修复 Huya、Kuaishou、Vimeo、Dailymotion、Douyin Live 的实例筛选或 Host/Trigger 归属问题；
2. 为 Twitch、Pornhub 以及 Netflix 多媒体 slot 建立面板覆盖与 active/background 安全线；
3. 为 feedback 建立站点原生层/年龄门/广告态下的可见性和安全区回归；
4. 为 Bilibili Live、Douyin、TED 明确登录/验证码/外跳状态的可重复测试前置条件；
5. 为音频站点补充真正公开、能创建标准 `<audio>` 的稳定内容样本，或明确 Web Audio 不在当前承诺范围；
6. 在 Firefox headed、品牌 Chrome/Edge 手工安装、换集/广告/登录态和长稳 churn 上取得独立证据；
7. 用户完成 UX Exit Review，明确 `GO` 或 `CONDITIONAL GO` 后才解冻 Phase 7。

Legacy 油猴脚本及其 `src/h5player`、`src/libs`、`config`、`dist` 目录在本轮未修改。
