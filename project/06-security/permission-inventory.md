# Web Extension 权限清单

> 文档 ID：SEC-002  
> 状态：Approved through Phase 6 Release Engineering<br>
> 负责人：Security / Product Owner  
> 最后更新：2026-08-11  
> 关联：ADR-0005、EXT-028、DECISION-001

## 当前 manifest 权限

| 权限/匹配    | 类型                     | 当前使用点                                                                          | 最小替代与理由                                                     | 用户可见目的                             | Chrome / Firefox                                             | 自动化证据                                                                                                  | 移除条件                                            |
| ------------ | ------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `storage`    | 常规权限                 | background `WxtStoragePort`、版本化 SettingsRepository；UI change trigger           | 页面 localStorage/GM 模拟不满足隔离、并发与迁移要求                | 在本机保存设置、站点规则、备份与后续进度 | 两端统一 WebExtension API                                    | repository migration/concurrency/restart、UI live reload、manifest scan                                     | 若产品不再持久化任何用户设置                        |
| `activeTab`  | 常规权限（用户手势临时） | action 打开 Popup 后读取当前 tab origin；授权后的当前页 bootstrap                   | 不申请 `tabs`；未发生 action 用户手势时无当前 tab URL/host 能力    | 只在用户点击扩展时识别并启用当前站点     | Chrome/Firefox 均由 action 用户手势临时授予，导航后失效      | 未授权/当前站点 grant/reject/restricted page、bootstrap、撤权 E2E；manifest scan                            | 若产品取消“当前站点启用”并只保留手工站点输入        |
| `scripting`  | 常规权限                 | background 注册/更新/注销两个内置 content scripts；授权后当前页执行打包文件         | 静态真实站点 matches 会提前形成 host access；WAR/inline 被禁止     | 仅把扩展自带媒体控制代码运行在已授权站点 | Chrome MV3 / Firefox 101+ 支持动态注册；最低版本矩阵继续验证 | registration idempotency、permission event/reconcile queue、worker restart、grant/revoke、MAIN/isolated E2E | 若浏览器提供无需该权限的等价 optional-host 声明机制 |
| `<all_urls>` | optional host permission | 用户主动选择当前 origin 或所有站点后请求；registration service 只读取已授予 origins | 不把全站访问写入 required host permissions；默认无持久 host access | 用户明确授权后在选定网页控制媒体         | Chrome/Firefox permissions API；拒绝与撤销可恢复             | manifest/contract；Chrome all-sites/reject/revoke E2E；Firefox origin grant/revoke E2E                      | 若产品改为只支持 `activeTab` 单次启用或固定站点列表 |

## 明确不申请

当前 manifest 不含：`tabs`、`downloads`、`clipboardWrite`、`webRequest`、`webRequestBlocking`、`declarativeNetRequest`、`cookies`、
任何 `optional_permissions`、远程网络域名或 externally connectable；也不含 `host_permissions`、静态真实站点 `content_scripts`
或 WAR。发布检查器对顶层 manifest capability 采用 allowlist，未登记的 devtools、override、sandbox、key 等字段同样阻断。

Phase 4 截图和跨 Tab 没有扩大权限：截图由用户在 Overlay 触发，MAIN world 生成 bounded artifact，isolated content
使用 Blob + 临时 `<a download>` 保存；不调用 `browser.downloads` 或剪贴板。跨 Tab 使用现有 tabs port 在 background
向其他已授权 content runtime 发送 typed advisory event；manifest 仍不申请 `tabs`，Tab 枚举/消息能力由既有
`activeTab`/host permission/scripting 架构和浏览器 API 实际授权约束，页面 payload 不能指定目标 tab。

任何 required/optional API、host 或 manifest capability 新增项必须在合入前补齐：代码调用点、威胁场景、替代方案、用户文案、
Chrome/Firefox 差异、权限撤销行为、自动化测试、ADR 和商店声明。页面消息不得传入任意权限名；background 只接受固定消息类型，
并以真实 sender context 二次授权。

## Host permission 决策

`DECISION-001` 采用“显式可选授权”方向：不在安装时静默获得全站访问。当前 Preview 已提供首次引导与两种模式：

1. 按当前站点启用并可随时撤销；
2. 用户主动选择“所有站点”后请求 `<all_urls>`。

实现采用 ADR-0007：生产 manifest 不声明真实站点静态 `content_scripts`，background 只为已授予 origins 动态注册打包脚本；Chrome 已覆盖 grant/reject/revoke/worker restart，Firefox 已覆盖 origin grant、bootstrap、revoke 与重载隔离。扩展仍保持 Preview，不得描述为已完成任意生产站点或 Stable 支持。

## 自动化证据与生产隔离

headless 浏览器无法稳定控制原生扩展权限确认框，因此测试将“产品权限状态机”和“原生确认框 UX”分开取证：

| 浏览器          | 测试 harness                                                                                                                                    | 取证内容                                                                                   | 生产隔离保证                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Chrome/Chromium | `tests/e2e/extension-harness.ts`：临时 profile 预置 optional origin；拒绝副本移除 optional host 声明                                            | 未授权 absence、当前 origin/all-sites grant、拒绝、撤权、动态 registration、worker restart | 临时目录和测试副本在测试后清理；生产 manifest 扫描仍要求 `content_scripts: []`、无 `host_permissions`/WAR       |
| Firefox         | `scripts/firefox-e2e.ts`：测试 profile 通过 `ExtensionPermissions.add(..., extensionEmitter)` 与 `tabManager.addActiveTabPermission()` 建立状态 | optional origin、`activeTab`、动态注册/bootstrap、媒体命令、撤权/注销和重载后 absence      | `--allow-system-access`、内部 API、extension emitter 只在 Selenium harness；生产源码、manifest 和打包产物不引用 |

上述内部 API 不是 WebExtension 产品接口，禁止复制到 `web-extension/src`、entrypoint 或发布包。Beta/商店提交前必须增加至少一次 headed 手工 smoke，核对浏览器原生确认框的文案、焦点、接受/拒绝和撤销体验；该限制记录在 `RISK-017`/`DECISION-006`。

## 复核入口

- `project/09-reviews/phase-3-exit-review-2026-08-11.md`
- `project/09-reviews/phase-4-exit-review-2026-08-11.md`
- `project/02-architecture/adr/ADR-0010-capture-artifact-and-permission-boundary.md`
- `web-extension/scripts/security-scan.ts`
- `web-extension/tests/e2e/extension-harness.ts`
- `web-extension/scripts/firefox-e2e.ts`
