# 媒体控制权优先级与腾讯切片稳定性审查

> 文档 ID：REVIEW-013  
> 状态：Conditional Pass  
> 日期：2026-08-17  
> 范围：Web Extension `0.1.1.10000`；Legacy 油猴主线不变

## 1. 审查目标

- 验证网站通过 setter、轮询、延迟初始化或实例替换重置倍速、音量和进度时，用户在扩展中表达的 intent 仍具有更高优先级。
- 验证腾讯视频播放一段时间并切换新片段后，控制目标迁移到真实新实例，快捷键不会继续命中旧隐藏实例。
- 验证 reload/child frame 重建期间的测试探测降级不会放宽真实倍速、轮询稳定性和反馈断言。

精确页面：`https://v.qq.com/x/cover/zgexd0mcj7at1fc/g00248hvnae.html`。

## 2. 实现结论

1. `MediaControlAuthority` 在 MAIN world 按媒体实例维护 binding 与用户 intent。受保护的 `playbackRate`、`volume`、`muted` 可在网站后续写入后有界重申；`currentTime` 仅在用户 seek 后使用短租约，避免永久冻结正常播放进度。
2. content 向 page-main 下发解析后的保护策略，命令成功后提交最终 snapshot；实例 attach/detach、custom element、source generation、停用、撤权、reload 与 teardown 均有明确生命周期和 fail-closed 清理。
3. 腾讯 DOM 视频与 WASM viewport proxy 使用同一用户策略，但控制目标按当前可见播放实例重新仲裁。切片时 child frame、mediaId 或 top-frame surface 改变，不继承旧实例对象，只继承站点级 intent。
4. live probe 在直连旧 child frame 遇到“Receiving end does not exist”等 stale-frame 传输错误时回退到 background 全局路由；其他协议、Schema、命令或扩展运行时错误继续抛出。零尺寸不可见 frame 不再执行 closed-shadow CDP 探测。
5. Legacy 油猴脚本及其构建链未修改；本轮实现和证据只属于 `web-extension/`。

## 3. 自动化与真实站点证据

| 项目           | 结果                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit           | `61 files / 280 tests` 通过；包含 authority、策略、生命周期、Tencent bridge/controller、stale-frame probe guard                                               |
| Component      | `6 files / 36 tests` 通过                                                                                                                                     |
| Integration    | `12 files / 116 tests` 通过；包含 page-main protocol、background frame arbitration、child→top authority 迁移、快捷键与 feedback                               |
| Compatibility  | `3 files / 36 tests` 通过；security scan 与 dependency boundaries 通过                                                                                        |
| Chromium E2E   | `8 passed`、`14 configured skips`；hostile 页面持续 rate/volume/seek 保护通过                                                                                 |
| 双浏览器构建   | `.output/chrome-mv3` 与 `.output/firefox-mv3` 构建成功；manifest version 均为 `0.1.1.10000`                                                                   |
| Tencent Run    | `2026-08-16-tencent-stale-frame-fix`；Chromium `151.0.7922.34`、`darwin 25.5.0 arm64`、headless `1440x900`；`outcome=passed`、`violations=[]`                 |
| 初始与 Popup   | 可见 `media-0-1` 快捷键 `1→1.1`、feedback 可见；Popup 设置 `1.5x`，命令成功且实际值 `1.5`                                                                     |
| 切片与网站轮询 | 点击 `[dt-params*="vid=m00246emesy"]` 后目标为 `media-15-tencent-viewport`；继承 `1.5x`；快捷键目标 `2x`，`hotkeyApplied=true`、`stableAfterSitePolling=true` |
| 反馈与 reload  | 切片后 feedback 可见且 owner 为新实例；reload 后目标回到 `media-0-1`，目标/实际均为 `1.5x`，`inherited=true`                                                  |

报告：`web-extension/test-results/live-sites/2026-08-16-tencent-stale-frame-fix/tencent-video/report.json`。

## 4. 保留风险

- 腾讯展开面板仍报告与原生 controls/subtitle/danmaku/ad 的潜在碰撞 warning；这不是控制权失败，但仍阻断完整 UX GO。
- 当前真实控制权证据集中于腾讯公开页面和本地 hostile fixture；iQIYI、Youku、Netflix、直播站点及更多自定义播放器仍需相同强度的 reset/实例替换验证。
- 登录、广告、DRM、AB 播放器、长时间播放、后台标签页和系统休眠恢复尚未形成冻结证据。
- Firefox headed UI/快捷键/实例迁移、品牌 Chrome/Edge 手工安装、30 分钟 churn 与反馈时延门禁仍未关闭。

## 5. 判定

EXT-145 与 EXT-146 可标记为 `In Review / engineering implemented`；EXT-147 可标记为 `In Review / Tencent acceptance evidence passed`。本轮证明控制权优先级、腾讯切片迁移、站点轮询稳定性和 reload 继承在冻结环境中成立，但不代表全部站点与全部宿主状态已验收。结论保持：`CONTROL AUTHORITY CONDITIONAL PASS / UX NO-GO / PHASE 7 HOLD`。
