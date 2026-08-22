# ADR-0018：实验下载的捕获代次与最终保存边界

> 状态：Accepted for engineering preview / Security follow-up required  
> 日期：2026-08-18  
> 关联：REQ-EXPERIMENTAL-001、EXT-153、EXT-154、RISK-031

## 背景

Legacy 的实验总开关只在用户明确开启后初始化 MediaSource 捕获。Web Extension 最初在 page-main 启动时无条件替换原生 API，并通过共享 `window.postMessage` 接收实验开关和下载命令。MAIN world 与宿主页面共享 JavaScript realm，session/nonce 可被页面观察，因此它们不能作为授权能力。

## 决策

当前工程预览先采用以下可回滚边界：

1. `ExperimentalMediaDownloadManager` 默认不安装 Hook。启用时建立新的 `captureGeneration`；关闭时恢复所有原生方法、清空记录、取消 pending、重置 WeakMap 和字节预算。
2. 只接受当前 generation 的 MediaSource；开关关闭期间发生的 append、切源和旧 URL 不得在重新启用后继续组成下载。
3. 直链跨域下载必须经过短媒体 bounded fetch；失败、非 2xx、CORS 或超限不报告 `started`。
4. MSE 正常 `endOfStream()` 可完成 queued 下载；错误终止、超限和等待超时进入显式失败终态。
5. isolated content 以持久化 settings 再次阻断 `media.download`，并拒绝 `isTrusted=false` 的下载快捷键。
6. 最终安全架构仍需演进为：MAIN 只做 bounded capture/prepare，isolated content 或受审查的 background downloads port 执行 anchor/download。该拆分完成前，实验功能保持 Beta/Stable 阻断。

## 取舍

- 当前实现保留了对 Legacy 直链/MSE 语义的较高兼容度，不改 Legacy 源码，也不新增 `downloads` 权限。
- 共享 MAIN bridge 的剩余风险被明确登记为 RISK-031；user activation 和 content settings 只是缓解，不是认证。
- 最终 sink 拆分可能需要新的 typed artifact 协议、Blob URL 生命周期管理和真实 Chrome/Firefox headed 证据，不能用单元测试代替。

## 验收

- `tests/unit/experimental-media-download.spec.ts`：默认关闭、代次、revoke/切源、错误终止、超时、预算、同源/跨域路径。
- `tests/unit/hotkey-controller.spec.ts`、`dom-hotkey-event-source.spec.ts`：synthetic `Shift+D` 拒绝。
- `tests/integration/content-runtime-progress.spec.ts`：持久化实验策略关闭时 content 层拒绝下载。
- EXT-154 关闭条件：hostile page 不能在无本地用户 intent 时触发最终保存；MAIN 不再调用 anchor.click；Tier 1/主流站点 headed download smoke 具备可复现报告。
