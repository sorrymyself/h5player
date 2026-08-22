# Phase 6.5 Firefox Headed UX 证据审查（2026-08-22）

> 文档 ID：REVIEW-020  
> 状态：Firefox Fixture Evidence Passed / UX NO-GO  
> 负责人：Project Owner / Quality Owner / UX Owner  
> 关联：EXT-128～139、UX-ACC-001、003～005、012～014、021  
> 范围：Firefox 153 临时安装的生产 MV3 构建、fixture 页面核心 UX 与 frame 生命周期；不包含真实站点、原生权限确认框、商店包或最终用户验收

## 1. 结论

Firefox headed fixture 已建立可重复的真实扩展证据：媒体级 UI 在滚动和 resize 后保持锚定，透明扩展 hitbox 可触发低干扰面板，播放中状态入口会自动隐藏，快捷键更新真实倍速并复用右上角状态区反馈，暂停不会展开面板，iframe 移除与恢复后运行时和媒体 UI 可重新注入。

本轮判定：`FIREFOX FIXTURE EVIDENCE PASSED / UX NO-GO / PHASE 7 HOLD / STABLE NO-GO`。

该结果关闭“Firefox 核心 fixture UX 尚未执行”的证据缺口，但不能外推为 Firefox 真实站点兼容、宿主 UI 共存、原生权限对话框、Firefox ESR/最低版本或用户体验验收通过。

## 2. 验证环境与入口

| 项目 | 结果 |
| --- | --- |
| 工具链 | Node `24.13.0`、pnpm `11.21.0` |
| 浏览器 | Playwright Firefox/Nightly `153.0`，Selenium WebDriver，`headless=false` |
| 视口 | 请求窗口 `1440x900`；页面截图 `1440x815` |
| 扩展 | `.output/firefox-mv3` production build，临时安装 ID `h5player-webext@example.invalid` |
| 页面 | 本地隔离的 `media-anchor.html`、`iframe-only.html` |
| 授权链路 | 测试 profile 内授予 optional origin 与 `activeTab`，随后经产品 `site.reconcile` 协议完成动态内容脚本注册 |
| Manifest lint | `0 errors`、`2 existing warnings` |
| 执行入口 | `H5PLAYER_FIREFOX_HEADLESS=0 pnpm test:e2e:firefox:ux` |

测试使用 Firefox 内部授权 API 只操作一次性测试 profile；生产 manifest、生产运行时代码和权限模型未引入 Firefox 内部 API。

## 3. Headed 断言结果

| 场景 | 结果 | 对应边界 |
| --- | --- | --- |
| 初始、scroll、resize 锚定 | Host 到媒体右上角目标点距离均为 `0` | fixture 几何通过；不代表真实播放器安全区通过 |
| 默认与 pointer 展开 | 默认收起；透明 hitbox hover 后面板展开 | UX-ACC-001/003 fixture 证据 |
| 触发区域 | hitbox 宽高均大于可见倍速 trigger | 证明扩大命中区未扩大可见 UI |
| 播放中自动隐藏 | 播放 `3.1s` 后 trigger opacity 为 `0` | 低干扰状态通过 |
| 快捷键与最终值 | `KeyC` 将真实 `playbackRate` 从 `1` 调至 `1.1`，状态区显示 `1.1×` | UX-ACC-004/013 fixture 证据 |
| 反馈过期 | 状态反馈在等待窗口内恢复透明 | UX-ACC-005 fixture 证据 |
| 暂停收起 | 面板展开后按空格暂停，面板仍为 collapsed | 暂停不阻挡画面 |
| iframe 生命周期 | iframe mount、remove、restore 后 runtime 与 media host 均恢复 | UX-ACC-012/021 fixture 证据 |
| 生命周期回收 | headed 与 headless 两次完整入口均正常退出，无残留 Firefox/geckodriver | harness teardown 通过 |

单次 WebDriver 观测到的 feedback latency 为约 `855ms`，其中包含元素 click、WebDriver 键盘派发和 `100ms` 轮询开销，不能作为产品 p95 指标。UX 矩阵要求的“命令成功到反馈首次可见 p95 ≤100ms”仍需浏览器内时间戳或更低扰动的 headed 测量方法验证。

## 4. 视觉产物

产物目录：`web-extension/test-results/firefox-headed-ux/`，由 `.gitignore` 排除，不进入源码提交。

- `01-baseline.png`：默认收起与媒体锚定；
- `02-pointer-expanded.png`：扩展命中区触发展开；
- `03-shortcut-feedback.png`：快捷键最终倍速反馈；
- `04-paused-collapsed.png`：暂停后面板保持收起；
- `05-iframe-restored.png`：iframe 恢复后的媒体级 UI；
- `report.json`：浏览器版本、模式、几何、交互和截图索引。

## 5. 任务与门禁更新

- `EXT-128～130/133/135`：增加 Firefox headed fixture 证据，状态仍为 `In Review / acceptance partial`。
- `EXT-136`：Firefox 键盘与基础 pointer 证据已补；200% zoom、主题、reduced-motion、字幕、原生控件和站点宿主共存仍待补。
- `EXT-137`：Firefox 核心 fixture UX 自动化通过；外部站点和原生权限 UX 仍是退出条件。
- `EXT-138`：不得把本地 fixture 计作 Firefox live-site smoke；真实 pointer、碰撞和登录/广告/换集场景仍待补。
- `EXT-139`：继续 `HOLD / Exit Review pending`。
- Phase 7：继续 `HOLD`；Stable：继续 `NO-GO`；Legacy：继续冻结。

## 6. 剩余风险

1. Tencent、iQIYI、Youku、Sohu、TED 等真实站点在 Firefox 下的宿主碰撞、遮挡、pointer 可达性和实例归属尚未取证。
2. native fullscreen、200% zoom、深浅主题、reduced-motion、字幕和站点原生控件共存尚未执行。
3. optional-host 原生确认框、临时扩展重启、Firefox ESR/最低支持版本和浏览器商店包尚未执行 headed/manual 验收。
4. 音频增益、长按、autoplay、PiP 和实验下载仍缺 Firefox headed/真实站点证据。
5. 用户 Exit Review 尚未签字，因此不得将 fixture 通过升级为 UX GO。
