# iframe 生命周期、页面控制与 Session 竞态审查

> 文档 ID：REVIEW-017
> 状态：Conditional Pass
> 日期：2026-08-20
> 范围：Web Extension `0.1.7.10000`；Legacy 油猴主线冻结

## 1. 审查目标

- 避免 iframe 导航、frameId 复用、旧 content session teardown 或 dormant report 删除当前真实媒体 owner。
- 保证页面临时停用和 UI 隐藏在 top/child frame、late iframe、乱序响应和 MV3 worker restart 下保持同一页面语义。
- 保证恢复运行后重新 hydration 媒体状态，Overlay、快捷键目标和 Popup 状态不依赖下一次偶然媒体事件。
- 在不放宽 bundle budget、不修改 Legacy 的前提下完成收口。

## 2. 根因与实现

1. `FrameRuntimeRegistry` 的 frame slot 由 `{tabId, frameId, sessionId}` 精确标识。新 session `connect()` 后立即成为 connected owner；先到的 dormant report 进入 pending record，连接后再提升。connected replacement 建立后，旧 session 的 dormant 或 `ready=true` late report 均被拒绝，report/remove 不能覆盖、夺回或删除 replacement。
2. 只有 tab teardown 才删除整个 tab registry；child-frame 导航只删除对应 frame。`PAGE_RUNTIME_UNAVAILABLE` 是可恢复的页面边界失败，不再等同于 owner 已死亡。
3. 页面停用与 UI 隐藏按 Tab 串行下发，命令携带 issued-at/revision；content 使用本地 `frameStateRevision` 拒绝旧 report response 回写。remembered media frame 在停用期间保持可寻址，恢复命令可以唤醒原 owner。
4. top-frame session 成为页面状态所有者：同一 document 的 worker 重连保留 hidden/disabled 状态；新的 top document/session 会重置旧页面状态，防止跨导航泄漏。
5. content runtime 在 `site.set-temporary-disabled(false)` 后先刷新有效设置，再主动读取 page-main 媒体状态。恢复不再等待 `timeupdate`、`play` 或 DOM mutation 才重新挂载媒体 UI。
6. lifetime-port 重连保持 single-flight；等待 page runtime 与 media hydration 后才 fresh-report，旧 session teardown 和空 top-frame report 不会唤醒或清理错误 owner。
7. Tencent routed child media 现在与 local media 共用完整 progress observation：启动/恢复时读取存储进度并通过 background 精确路由 seek，active→paused 时立即保存，不再因 routed state 的早退跳过 restore/save/transition。
8. bundle 收口未提高预算：content 只导入窄 storage key/subscription 与 runtime transport；媒体文案改为 namespace tuple 并去重 feedback 映射。业务 message key 与用户文案保持不变。

## 3. Fresh 验证

| 门禁 | 结果 |
|---|---|
| `pnpm check` | Format/lint/typecheck 通过；Unit `372`、Component `40`、Integration `147`、Compatibility `40`、Security `3` |
| Dependency boundary | `180 modules / 589 dependencies`，无违规 |
| Chromium build/E2E | Chrome MV3 build 通过；核心 `9 passed / 14 configured skips` |
| Lifecycle repeat | BFCache/context reload、iframe-only owner、late same/cross-origin iframe 各重复 3 次，共 `9/9` 通过 |
| Churn smoke | 3 cycles、2 worker restarts、listeners 峰值 `5`、Long Task `0`；host/observer/timer/authority binding 每轮回到基线 |
| Firefox | Firefox MV3 build 通过；Firefox 153 权限生命周期和 seek/rate/volume/mute/pause/play 通过；`web-ext lint` 为 `0 errors / 2 existing warnings` |
| Bundle budget | Chrome/Firefox content 均为 `255250 / 256000` bytes；余量 `750` bytes；background/page-main 通过 |
| Patch hygiene | `git diff --check` 通过 |
| Legacy freeze | `dist/h5player.user.js` SHA-256 `91b5312d7cf150cd852d005b1e5d5f3d8ed2ed7cd8a481dfa1d561d48f7b3f27`，`561788` bytes；Legacy 目录零 diff |

## 4. 保留风险

- 增强 observer/timer/authority/heap 诊断当前只完成短时 smoke；完整 30 分钟复跑仍是长时验收门禁。
- 真实站点的登录、广告、换集、DRM/AB player、跨源 frame 重建和系统休眠恢复不能由本地 fixture 外推。
- Firefox headed 页面定位、feedback、快捷键和 frame teardown 仍待人工/可视化验收。
- content bundle 只剩 `750` bytes 余量；下一项 content 能力不得直接堆入同一 bundle，应优先删除、拆分或下沉到按需入口。
- `web-ext lint` 的两条动态 `innerHTML` 告警已定位到 Vue runtime 的通用 `insertStaticContent` 和 mount fallback；业务源码扫描没有 `innerHTML =`、`v-html` 或 `insertAdjacentHTML`。彻底移除需要独立评估 runtime-only Vue/build 方案，不能在本轮无回归证据下替换框架运行时。

## 5. 判定

frame owner/session 生命周期、页面级停用/UI 状态顺序、恢复 hydration、worker restart 与 bundle 预算问题达到工程自动化 `Conditional Pass`。这关闭了当前 Phase 6.5 的核心代码硬阻塞，但不替代真实站点、Firefox headed、增强 30 分钟 churn 和用户 Exit Review。整体结论继续保持 `ACCEPTANCE EVIDENCE PARTIAL / UX NO-GO / PHASE 7 HOLD`。
