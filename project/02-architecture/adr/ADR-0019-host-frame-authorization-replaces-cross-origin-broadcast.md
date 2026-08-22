# ADR-0019：Host/Frame 授权替代 Legacy 跨域广播开关

> 状态：Accepted for Phase 6.5 engineering preview  
> 日期：2026-08-19  
> 关联：FR-BOOT-004、FR-CORE-009、EXT-135、EXT-146、EXT-157、ADR-0005、ADR-0007、ADR-0017

## 背景

Legacy 的 `enhance.allowCrossOriginControl` 默认开启，并通过脚本内部广播协调其它 frame。Web Extension 的权限和进程模型不同：跨源 frame 是否允许扩展代码运行，首先由浏览器 host permission、动态 content-script 注册和 sender frame 身份决定。扩展设置不能绕过或替代浏览器授权。

若原样迁移同名开关，会产生两个相互冲突的“授权事实源”：用户可能在扩展内开启跨域控制，但浏览器并未授权目标 origin；也可能撤销浏览器权限后仍看到一个表面开启的设置。更严重的是，把页面广播当作控制授权会让宿主脚本伪造目标、扩大命令范围或控制未获授权的 frame。

## 决策

Web Extension 不新增 `allowCrossOriginControl` 持久化字段，也不复制 Legacy 的任意跨域广播。采用以下替代边界：

1. 浏览器 host permission 是跨源 frame 运行资格的唯一外部授权事实源。用户可按 origin 授权、授权所有站点或在浏览器/扩展入口撤销权限。
2. 只有已授权 origin 才注册固定的 content/page-main 脚本；未授权 child frame 不运行媒体发现、UI、authority 或远程命令接收端。
3. 每个 frame 独立建立 session、nonce、媒体状态和 authority。`FrameRuntimeRegistry` 只接受 background 根据真实 sender 推导出的 tab/frame 身份，不信任页面自报 frameId。
4. 跨 frame 控制只允许 typed allowlist 中的命令，并路由到精确 tabId、frameId、mediaId/generation owner。不得使用页面全局广播、任意字符串命令或“第一个响应者”作为控制目标。
5. autoplay 始终限制在顶层 document 和顶层媒体；跨 frame 聚合不能间接触发顶层站点播放按钮。
6. 临时停用、站点停用、host permission 撤销、frame unload、BFCache/context invalidation 和扩展 teardown 必须清理 registry、owner lease、authority binding、UI 与 listener，后续请求 fail-closed。
7. 未来若产品需要“在已授权站点内禁止跨 frame 协调”，只能新增一个缩小能力的策略开关；该开关不能授予浏览器未授权的 origin，也不能恢复任意广播语义。

## 后果

- 正面：浏览器权限、实际脚本运行和控制路由保持同一授权链；撤权立即生效，设置无法静默扩大权限。
- 正面：跨源 iframe、Tencent child-frame owner 和 PiP 跨 Tab lease 使用同一精确 sender/owner 原则，页面脚本不能自行声明为控制目标。
- 取舍：Web Extension 不提供与 Legacy 同名的一键开关；用户通过站点授权/撤权管理外部权限，通过站点停用和临时停用管理当前扩展行为。
- 限制：只授权顶层 origin 时，来自其它 origin 的 child frame 不可控；这属于权限边界，不应伪装为兼容故障或通过页面代理绕过。
- 验收边界：当前自动化证明协议、路由和撤权 fail-closed；浏览器原生权限提示、复杂嵌套 frame 和更多真实站点仍需 headed 验收。

## 验证

- Chrome same/cross-origin iframe、late-frame inheritance、iframe-only ownership、撤权和 worker restart E2E。
- `FrameRuntimeRegistry`、sender policy、routed media selection、runtime reconnect 与 authority lifecycle unit/integration tests。
- autoplay coordinator 顶层 frame/顶层媒体硬门禁回归。
- Firefox 权限生命周期与核心媒体 E2E；原生权限 UI 和复杂跨源播放器继续保留人工/真实站点门禁。

## 回滚

若跨 frame 路由产生兼容回归，按站点 adapter/功能关闭远程路由并保留 frame 独立运行；不得回滚为页面广播、页面自报身份或绕过 host permission 的代理控制。
