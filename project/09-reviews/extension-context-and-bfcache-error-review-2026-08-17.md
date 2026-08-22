# 扩展上下文与 BFCache 错误审查

> 文档 ID：REVIEW-014  
> 状态：Pass  
> 日期：2026-08-17  
> 范围：Web Extension `0.1.2.10000`；Legacy 油猴主线不变

## 1. 用户问题

Chrome 扩展管理页记录两类运行时错误：

1. `Unchecked runtime.lastError: The page keeping the extension port is moved into back/forward cache...`
2. `Uncaught (in promise) Error: Extension context invalidated.`，上下文指向 `content-scripts/content.js`。

这两类错误分别发生在页面进入 BFCache 导致 lifetime Port 被浏览器关闭，以及扩展更新/重新加载后旧 content world 继续运行异步任务时。

## 2. 根因与修复

- content lifetime Port 的 disconnect 回调必须在回调同步阶段读取 `chrome.runtime.lastError`；否则 Chrome 会把浏览器主动关闭消息通道记录为 unchecked error。
- background 接收端采用同一消费规则，避免不同 Chromium 版本把 disconnect 原因暴露在另一端时漏报。
- `subscribeRuntimeReconnect` 将 BFCache 关闭视为可恢复断连并有界重连；精确匹配 `Extension context invalidated` 时永久停止并触发 teardown。
- content world 增加精确 `unhandledrejection` boundary，仅拦截 context invalidation，不隐藏普通 Promise 错误。
- WXT 的 `ctx.isInvalid` 是按访问触发；增加 250ms validity probe，并在重连前再次检查。扩展更新/卸载后旧 UI、timer、listener、runtime、bridge 和 pending mount 均 fail-closed 清理。

## 3. 自动化证据

新增 Chromium real-extension 生命周期用例：

1. 允许 BFCache，页面前进后返回，确认 `pageshow.persisted=true`、媒体控制仍可用。
2. 通过 `chrome.developerPrivate.getExtensionInfo` 读取扩展错误集合，确认没有新增 BFCache/message-channel 错误。
3. 使用 CDP `Extensions.uninstall` + `Extensions.loadUnpacked` 使旧 content context 真实失效并重新加载同一路径扩展。
4. 确认旧媒体 UI host 清零，新实例完成动态 content-script 注册，刷新后 runtime 恢复。
5. 再次读取错误集合，确认没有新增 `Extension context invalidated`。

验证结果：

| 门禁         | 结果                                                                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check` | Passed；Unit `61 files / 284 tests`，Component `6 / 36`，Integration `12 / 116`，Compatibility `3 / 36`，Security `1 / 3`，dependency boundaries `162 modules / 529 dependencies` |
| Chromium E2E | `9 passed / 14 configured skips`；新增 BFCache/reload/error-panel 场景通过                                                                                                        |
| Firefox E2E  | Firefox `153.0` 权限与媒体命令链路通过；`web-ext lint` 为 `0 errors / 2 existing warnings`                                                                                        |
| 双浏览器构建 | Chrome/Firefox manifest 均为 `0.1.2.10000`                                                                                                                                        |
| Toolchain    | Node `24.13.0`，pnpm `11.21.0`，bundled Chromium `151.0.7922.34`                                                                                                                  |

## 4. 手工复核说明

Chrome 会保留旧版本已经记录的扩展错误。加载 `0.1.2.10000` 后，应先在扩展错误页清除历史记录，再执行 BFCache 前进/后退、扩展重新加载和页面刷新；验收标准是相同两类错误不再新增，而不是旧记录自动消失。

构建目录：

- Chrome：`web-extension/.output/chrome-mv3`
- Firefox：`web-extension/.output/firefox-mv3`

## 5. 判定与保留风险

EXT-148 判定为 `Verified`。本轮只证明 MV3 Port/BFCache/context invalidation 生命周期错误已收敛，不改变 Phase 6.5 的整体 `UX NO-GO / Phase 7 HOLD`：真实站点宿主碰撞、更多站点实例映射、Firefox headed、30 分钟 churn 和用户 Exit Review 仍按原计划继续。
