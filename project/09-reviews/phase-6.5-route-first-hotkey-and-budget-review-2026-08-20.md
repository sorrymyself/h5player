# Phase 6.5 路由首键、腾讯换集与 Bundle Budget 收口审查（2026-08-20）

> 文档 ID：REVIEW-018  
> 状态：In Review / Engineering Gates Passed / UX NO-GO  
> 负责人：Project Owner / Architecture Owner / Quality Owner  
> 最后更新：2026-08-20  
> 关联：EXT-132/133/137/138/147、ADR-0016/0017/0019、QUAL-UX-001  
> 审查范围：Web Extension 当前工作树的 routed media 首次快捷键、腾讯换集 authority 恢复、Dailymotion 跨域播放器和双端 bundle budget；不修改 Legacy 主线

## 1. 结论

本轮关闭了 Phase 6.5 当前唯一工程硬阻塞：Chrome/Firefox `content.js` 已重新进入 `256000 bytes`
预算，route-first hotkey、腾讯换集后的 staged playback intent 和 Dailymotion 跨域首键均取得 fresh 自动化与真实站点证据。

当前判定为：`ENGINEERING GATES PASSED / LIVE SMOKE PASSED FOR TARGETED SITES / UX NO-GO / PHASE 7 HOLD`。

这不是 Phase 6.5 Exit Review。腾讯仍保留原生控件/字幕/弹幕/广告潜在碰撞 warning，Dailymotion 的 closed ShadowRoot
只能得到 `probe-limited` 几何证据；Firefox headed、完整 30 分钟增强诊断和用户签字仍未完成。

## 2. 本轮实现与约束

- routed 命令不再只相信 setter 返回成功；最终 snapshot 未达到目标倍速时返回
  `COMMAND_EXECUTION_FAILED`，并允许 staged intent 在新实例上继续恢复。
- 顶层快捷键缓存为空但跨域 frame 已可路由时，第一次按键会异步解析并执行，不再要求用户按第二次。
- 腾讯旧 child frame 响应过时、authority 迁移至新 viewport 或顶层实例时，命令重新绑定实际 active media；数字倍速累积、
  `Shift+R` 和 PiP remote 规划状态保持独立。
- content runtime 的重复下载失败响应、命令反馈、状态提交、延迟调度、一次性策略比较和不可达条件被合并或删除；
  `vite.config.ts` 不保留临时 minifier 覆盖，预算通过来自代码收敛而非放宽阈值。
- `src/h5player/`、Legacy 构建链和冻结产物未修改。

## 3. 自动化证据

固定工具链：Node `24.13.0`、pnpm `11.21.0`。

| 门禁 | fresh 结果 |
| --- | --- |
| `pnpm check` | Passed；format、ESLint、typecheck、compat report、security scan、dependency boundary 全部通过 |
| Unit | `71 files / 386 tests` passed |
| Component | `7 files / 40 tests` passed |
| Integration | `13 files / 152 tests` passed |
| Compatibility | `3 files / 40 tests` passed |
| Security | `1 file / 3 tests` passed；`195 files / 2 manifests` 扫描通过 |
| Dependency boundary | `180 modules / 589 dependencies`，无 violation |
| Chrome/Firefox build | Passed；扩展版本 `0.1.7.10000` |
| Bundle budget | Chrome/Firefox content 均为 `255921 / 256000 bytes`，余量 `79 bytes`；其它入口通过 |

`79 bytes` 仅证明当前提交通过预算，不构成后续功能增长空间。任何新增 content 能力必须先删除、复用或拆分代码，禁止提高预算。

## 4. Headed 真实站点证据

Run：`2026-08-20-phase65-budget-final`  
环境：bundled Chromium `151.0.7922.34` headed、macOS `darwin 25.5.0 arm64`、viewport `1440x900`  
扩展 fingerprint：`89980eb25919422ba5c1e113e504df80211576d30293ec1cd675d73682d60b3f`

### Tencent Video

- URL：`https://v.qq.com/x/cover/zgexd0mcj7at1fc/g00248hvnae.html`
- report：`outcome=passed`、`violations=[]`。
- 基础快捷键：`media-0-1` 从 `1x` 到 `1.1x`；Popup 写入并读回 `1.5x`。
- 换集后 `media-14-tencent-viewport` 继承 `1.5x`，首次快捷键达到 `2x`。
- authority 随后迁移到 `media-0-1`，延迟快捷键达到 `2.1x`。
- 3 秒稳定窗口内保持目标值，`stableAfterSitePolling=true`；reload 后
  `media-17-tencent-viewport` 继续继承 `1.5x`。
- 保留 1 条 warning：展开面板可能与原生控制、字幕、弹幕或广告区域碰撞。

### Dailymotion

- URL：`https://www.dailymotion.com/video/x84sh87`
- report：`outcome=passed`、`violations=[]`。
- 跨域播放器实例 `media-3-1` 第一次快捷键从 `1x` 到 `1.1x`。
- Popup 写入并读回 `1.5x`；reload 后新实例 `media-11-1` 继承 `1.5x`。
- 18 条 warning 均为 closed ShadowRoot `probe-limited`，表示自动化无法读取内部几何，不是命令或继承失败。

报告与截图位于：

- `web-extension/test-results/live-sites/2026-08-20-phase65-budget-final/tencent-video/`
- `web-extension/test-results/live-sites/2026-08-20-phase65-budget-final/dailymotion/`

## 5. 残余风险

1. Content bundle 只剩 `79 bytes` 余量，下一次功能变更极易重新触发预算失败。
2. 腾讯宿主 UI 碰撞仍未关闭，广告态、更多登录态画质和可重复 AB fake-video 仍需继续取证。
3. Dailymotion closed ShadowRoot 使 Host/Trigger/feedback 几何只能通过外部状态与命令结果间接验证。
4. Firefox headed、品牌 Chrome/Edge、native fullscreen、200% zoom、theme、reduced-motion 和长时资源趋势仍未完成。
5. 本轮 targeted live smoke 不能替代 56 站矩阵的其它失败项和用户 Exit Review。

## 6. 决定

- EXT-132/133/147：新增回归与真实站点证据已通过，继续保持 `In Review`，不因单站通过升级为全局 Verified。
- EXT-137：fresh 工程门禁与双端 budget 通过；长时增强诊断和 Firefox headed 仍是退出条件。
- EXT-138：Tencent 与 Dailymotion 的最新 targeted smoke 通过；其它站点兼容缺口继续保留。
- EXT-139：继续 `HOLD / Exit Review pending`。
- Phase 7：继续 `HOLD`；Stable：继续 `NO-GO`；Legacy：继续冻结。
