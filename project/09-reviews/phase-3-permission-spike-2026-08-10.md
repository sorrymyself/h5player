# Phase 3 权限 Spike 记录：静态脚本与可选 host permission

> 日期：2026-08-10  
> 状态：Completed  
> 负责人：Runtime / Security

## 问题

验证把 `<all_urls>` 同时放进 `content_scripts.matches` 和 `optional_host_permissions` 是否会在用户授权前停止脚本执行。

## 实验

1. 临时把 `entrypoints/content.ts` 和 `entrypoints/page-main.content.ts` 的 `matches` 改为 `<all_urls>`。
2. 分别构建 Chrome MV3 与 Firefox MV3，在新 profile/临时扩展中打开固定 `basic.html` fixture。
3. 读取页面运行时 marker，并从 extension page 查询 `permissions.contains()`。

## 结果

| 浏览器                  | content/page-main marker               | optional grant 结论                                       | 结论               |
| ----------------------- | -------------------------------------- | --------------------------------------------------------- | ------------------ |
| Chrome Chromium channel | `ready`                                | `<all_urls>` 未由 `permissions.request()` 授予            | 静态脚本已提前执行 |
| Firefox 153             | `ready`（Phase 2 真扩展 E2E 启动路径） | 静态 `content_scripts` 关联 host access；不能作为按需门控 | 静态脚本已提前执行 |

Chrome 官方参考：

- [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [chrome.scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)

Firefox/MDN 参考：

- [scripting.registerContentScripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/scripting/registerContentScripts)
- [host_permissions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/host_permissions)

## 决策影响

采用 ADR-0007：生产构建移除真实站点静态 matches，增加 `scripting` + `activeTab` 作为最小动态授权所需能力；
`<all_urls>` 仍为 optional host，所有 grant/revoke/拒绝路径纳入自动化门禁。
