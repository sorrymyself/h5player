# 实验性能力对齐与交付边界

> 文档 ID：REQ-EXPERIMENTAL-001  
> 状态：Engineering Implemented / Security and Live-Site Acceptance Pending
> 最后更新：2026-08-19
> 范围：仅 Web Extension；Legacy `src/h5player/`、`src/libs/`、`config/` 不修改

## 1. 结论

Legacy 的 `enhance.allowExperimentFeatures` 总开关直接控制的能力只有两类：

1. `Shift+D` 媒体下载入口。
2. `MediaSource`/`SourceBuffer` 分段捕获，并在 `endOfStream()` 后完成下载。

Legacy 的音量增益、鼠标长按加速、autoplay、跨标签控制、外部配置和普通截图不是这个总开关的子能力，分别由独立配置或核心模块控制，不应被误并入本需求。

Web Extension 已将上述两类能力纳入 typed command、capability、adapter、settings、feedback 和自动化测试边界。实验开关默认关闭，关闭时不安装 MSE monkey patch。

### 1.1 实验与高级能力盘点

下表把 Legacy 中容易被统称为“实验功能”的能力拆开记录，避免把不同的权限、生命周期和验收条件混在一个总开关里：

| 能力                     | Web Extension 当前实现                                                                                                                                                                                                                    | 工程状态                                          | 剩余验收                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 下载/MSE 捕获            | `allowExperimental` 总门禁 + global/site `download.enabled` 独立开关、同源/短跨域直链、MSE 分轨、queued 完成、取消与资源回收                                                                                                              | Engineering implemented                           | hostile page、真实站点下载和浏览器 headed 验收                                              |
| 音频增益                 | Web Audio 延迟建图，1×～6×，站点级策略、capability 和 typed command；建图/增益失败时释放图、回滚到 1× 并移除该实例 capability                                                                                                             | Engineering implemented / acceptance pending      | API 存在不等于跨域音频可用；跨域静音输出仍需同源/CORS/无 CORS/headed 证据                   |
| 鼠标长按 3×              | 左键长按临时 3×、释放恢复、600ms 有界播放状态保护、底部控制栏排除、站点级开关及时长校验                                                                                                                                                   | Engineering implemented / acceptance pending      | 原生控件共存、触控/拖动、异步 pointerup/click 和真实站点验收                                |
| autoplay                 | 顶层可见媒体、有界重试和 generation 隔离；仅显式声明 adapter page action 的站点可执行，目前 Bilibili 通过 Legacy 播放按钮 selector 启用，不调用通用 `media.play()`；已处理的 DOM 动作需先等新的媒体状态观察，避免异步 toggle 控件重复点击 | Engineering implemented / acceptance pending      | Bilibili 基础顶层按钮 headed 已通过；登录态/广告/换集、真实按钮变化和浏览器策略差异仍待验收 |
| 跨 frame/跨域控制        | 由浏览器 host/frame 授权、FrameRuntimeRegistry 和 per-frame owner 约束；不复制 Legacy 任意跨域广播开关                                                                                                                                    | Explicit product replacement / acceptance pending | ADR-0019 与权限披露已固化替代关系；原生权限 UI/复杂 frame headed 待验收                     |
| PiP 跨 Tab 控制          | background owner lease、heartbeat/grace、generation、精确 tab/frame 路由和远程命令 allowlist                                                                                                                                              | Engineering implemented                           | headed PiP、跨浏览器行为、页面/worker 重启                                                  |
| 任意外部 JavaScript 配置 | 不提供函数注入或页面全局配置 API                                                                                                                                                                                                          | Explicitly rejected                               | 不得迁移                                                                                    |

## 2. Legacy 证据与行为差异

| 能力              | Legacy 证据                                                      | Web Extension 行为                                                                                          | 状态                    |
| ----------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------- |
| 实验总开关        | `src/h5player/configManager.js:335-347`、`h5player.js:2735-2739` | `global.policies.allowExperimental`，默认 `false`；content 层再次门禁                                       | Engineering implemented |
| 下载独立开关      | `configManager.js:335-337`、`globalFunctional.js:400-417`        | `global.download.enabled` + site override，默认 `true`；必须与实验总开关同时开启                            | Engineering implemented |
| 直链下载          | `src/h5player/mediaDownload.js:15-95`                            | 同源 URL 由 anchor 下载；短媒体跨域尝试带 credentials 的 bounded fetch，失败明确返回 `DOWNLOAD_UNAVAILABLE` | Engineering implemented |
| MSE 捕获          | `src/h5player/mediaSource.js:58-156`                             | `URL`、`MediaSource`、`SourceBuffer` hook 只在启用后安装；视频/音频分轨保存                                 | Engineering implemented |
| 未结束流          | `mediaSource.js:199-217`                                         | 请求返回 `queued`；正常 `endOfStream()` 后自动完成；等待有界超时                                            | Engineering implemented |
| 失败结束          | Legacy 未严格区分                                                | `endOfStream('network'/'decode')` 进入 `DOWNLOAD_FAILED`，不自动下载                                        | Engineering implemented |
| 清理              | `mediaSource.js:24-55`                                           | revoke、sourceclose、媒体切源、停用、teardown、下载完成均释放记录和字节预算                                 | Engineering implemented |
| 过大流            | Legacy 依赖运行时清理                                            | 单流 128 MiB、页面 256 MiB、20,000 chunks，超限返回 `DOWNLOAD_TOO_LARGE`                                    | Engineering implemented |
| 重复下载/标题确认 | Legacy `confirm`/`prompt`                                        | Web 使用 isolated content 非阻塞确认队列；重复/进行中状态明确提示，文件名可编辑并自动保留扩展名             | Engineering implemented |
| 未结束流取消      | Legacy 可通过确认流程取消自动下载                                | Web 提供 `media.cancel-download` typed 协议、page-main/content/UI 链路；取消后不会再触发 ready              | Engineering implemented |

## 3. 用户可见契约

- 下载命令只在 effective `allowExperimental=true`、effective `download.enabled=true` 且媒体 capability 已声明时可用；站点开关可独立继承或覆盖全局值。
- `Shift+D`、overlay 和 popup 共享 `media.download` command；命令结果明确区分 `started`、`queued` 和四类下载错误。
- 合成 `Shift+D` 不触发下载；真实键盘事件由 `isTrusted` 标记，content 层仍以持久化设置为最终门禁。
- MSE 只从开关启用后的新捕获代次开始记录。关闭再打开不会把缺失初始化片段的旧流拼接进来。
- 跨域直链不能仅凭 anchor click 报告成功；只有 bounded fetch 真实得到可组装 Blob 才返回 `started`。
- 音频增益不会把 Web Audio API 的存在误当作可用输出：首次建图或后续增益设置失败时，当前操作拒绝，图被释放，增益原子回滚到 `1×`，并从该媒体快照移除 `audioGain` capability；跨域无 CORS 可能静默输出的情况仍只能由 headed 音频证据确认。
- queued MSE 可从当前媒体控制区取消；取消只释放当前媒体的未完成 pending intent，不影响其它媒体或已完成下载。
- 页面标题和扩展生成的文件名会过滤路径控制字符，并保留扩展名。

## 4. 资源与失败策略

| 场景                                      | 结果                           | 用户反馈/后续                                                     |
| ----------------------------------------- | ------------------------------ | ----------------------------------------------------------------- |
| 没有 source 或页面已卸载                  | `DOWNLOAD_UNAVAILABLE`         | 不消费命令；保留当前媒体状态                                      |
| MSE 尚未结束                              | `queued`                       | 复用当前媒体 feedback 区域；最多等待 60 分钟，可点击取消          |
| 用户取消 queued 下载                      | `DOWNLOAD_CANCELLED`           | 清除 pending intent 和定时器；后续 `endOfStream()` 不再触发 ready |
| `endOfStream(error)`                      | `DOWNLOAD_FAILED`              | 不触发自动保存；下一次操作返回同一终态，直到源被清理              |
| 单流/页面预算超限                         | `DOWNLOAD_TOO_LARGE`           | 清空已捕获字节，记录保持可诊断但不继续增长                        |
| 跨域无 CORS、HTTP 非 2xx 或超过短媒体窗口 | `DOWNLOAD_UNAVAILABLE`         | 不误报 started，不打开新标签                                      |
| 开关关闭、站点停用、临时停用或 teardown   | `DOWNLOAD_BLOCKED`/unavailable | 恢复原生 API，废弃当前 capture generation                         |

## 5. 非目标与后续任务

本轮不复制 Legacy 的页面全局对象、阻塞式 `confirm/prompt`、任意函数配置、原型污染、远程下载代理或 DRM 绕过。

后续独立任务：

- 对 YouTube、Bilibili、腾讯视频、爱奇艺、优酷及主流直播站点完成 headed live download smoke；登录、DRM、广告和跨 frame MSE 分别记录证据。
- 真实站点 headed 下载/MSE 验收，以及下载队列在站点换源/换集时的 UX 复核仍需补齐；global/site 下载策略、独立继承与恢复已经接入，不得回到阻塞式页面 `confirm/prompt` 或页面全局对象。
- 为音频增益、长按、autoplay 和 PiP 补充真实浏览器/站点验收；长按状态保护已有工程回归，但其余 live/headed evidence 未完成前不得标记 Stable。
- autoplay 已收窄为 adapter 声明式站点播放动作：未声明的站点第一次探测后终止，iframe 不启用，目前只有 Bilibili 使用 `.bpx-player-ctrl-play`、`.squirtle-video-start`、`.bilibili-player-video-btn-start`；广告、换集和真实按钮演进仍需 headed 证据。
- Legacy `allowCrossOriginControl` 的 Web 替代是浏览器 host/frame 授权与精确 frame 路由，不提供同名设置字段；该替代关系必须在 ADR、设置说明和差异基线中保持可追踪。
- 对同 realm 页面可能篡改 MediaSource、SourceBuffer、postMessage 或媒体 setter 的场景补充 hostile-page 回归；该风险不能由 nonce 宣称为绝对隔离。

## 6. 验收引用

- 单元：`web-extension/tests/unit/experimental-media-download.spec.ts`
- 快捷键安全：`web-extension/tests/unit/hotkey-controller.spec.ts`、`dom-hotkey-event-source.spec.ts`
- content policy：`web-extension/tests/integration/content-runtime-progress.spec.ts`
- 实现：`web-extension/src/adapters/generic/experimental-media-download.ts`
- 命令：`web-extension/src/domain/command/types.ts`、`src/application/commands/media-command-handlers.ts`
