# 实验与高级能力差距审查

> 文档 ID：REV-2026-08-19-EXPERIMENTAL-GAPS  
> 日期：2026-08-19  
> 范围：Web Extension；Legacy `src/h5player/` 只读对照，未修改  
> 结论：autoplay scope、音频失败回滚与长按状态保护已完成工程修正；真实站点/headed 验收仍保持 Acceptance pending，不得标记 Stable

## 1. 结论摘要

本次对照 Legacy 的真实实现、Web Extension 当前代码和已有测试后，确认下载/MSE 边界已基本形成，但以下差距不能用“已有 typed command”替代：

| 优先级 | 差距                                                                                         | 影响                                                                | 当前决策                                                                                  |
| ------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| P1     | autoplay 曾对所有 active paused media 直接调用 `play()`，缺少 Legacy 的站点任务/按钮前置条件 | 可能在广告、用户主动暂停或不应自动播放的站点产生惊扰                | 已改为 adapter 声明式 page action；仅 Bilibili 启用站点按钮，未声明站点终止且 iframe 禁用 |
| P1     | 跨域无 CORS 时 Web Audio 可能静默输出，API 存在本身不能证明音频链路可用                      | UI/命令可能把不可用能力报告为成功                                   | 建图/增益失败已原子回滚并降级 capability；仍需同源/CORS/无 CORS headed 证据               |
| P2     | 长按释放只抑制一次 click，缺少 Legacy 的短时 play/pause 状态锁                               | 站点在 `pointerup`、`mouseup` 或异步 handler 中可能反向切换播放状态 | 已增加 600ms 有界状态保护与回归测试；真实控件/触控仍待验收                                |
| P2     | Legacy `allowCrossOriginControl` 没有独立 Web 设置字段                                       | 用户无法明确关闭跨 frame 聚合/远程控制，产品语义不透明              | ADR-0019 已明确以浏览器 host/frame 授权和精确 owner 路由替代，暂不复制旧开关              |

## 2. 证据与边界

- Legacy autoplay 仅在 `taskConf.autoPlay`、顶层可见媒体和站点 TCC 播放按钮存在时执行；证据见 `src/h5player/h5player.js:508-550`、`src/h5player/h5PlayerTccInit.js:33,256`。
- Web autoplay 已由 `src/application/playback/autoplay-coordinator.ts` 改为请求 adapter page action，不再发送通用 `media.play`；声明/selector 执行位于 `src/adapters/registry/adapter-registry.ts`，当前仅 `src/adapters/sites/catalog.ts` 的 Bilibili adapter 声明 Legacy 播放按钮 selector，content 顶层门禁位于 `src/runtime/content/content-runtime.ts:1675-1681`。
- Legacy 音量增益在实际创建放大器失败时回退到 1×，证据见 `src/h5player/h5player.js:1106-1125`；Web 先声明可尝试的 capability，运行时建图/增益失败会释放图、回滚到 1×、移除当前实例的 capability 并拒绝命令，代码位于 `src/adapters/generic/generic-media-controller.ts:356-383`，图实现位于 `src/adapters/generic/audio-gain.ts:35-59`。跨域无 CORS 的“静默输出”仍不能由异常路径可靠识别。
- Legacy 长按释放会按按下前状态调用 `lockPlay/lockPause`，证据见 `src/h5player/mouseEvent.js:9-59`。Web 现已在 `src/infrastructure/dom/mouse-long-press-controller.ts` 增加 `pointerup` 和 600ms 状态漂移保护。
- Legacy 跨域开关默认开启但可由用户关闭，证据见 `src/h5player/configManager.js:344-350`、`src/h5player/globalFunctional.js:240-248`；Web 跨 frame 路由由站点权限和 `FrameRuntimeRegistry` 控制，不应默认为“任意跨域可控”。

## 3. 后续验收任务

1. 站点 adapter 声明式 autoplay intent、顶层/iframe 限制、用户主动暂停与 generation 规则已完成；Bilibili 基础顶层 `autoplay=0` headed 入口已证明只点击一次并保持播放。继续为登录态、广告/换集和 selector 演进补 headed 回归，其他站点在取得 Legacy/实测证据前不开放。
2. 为 `GenericMediaController` 的音频图建立失败增加 capability 降级、图释放和 gain 值原子回滚（已完成并有 unit 证据）；继续对同源、CORS、无 CORS、页面已有 Web Audio 图分别取 headed 证据。
3. 为长按补原生控件、拖出窗口、异步 click 和触控 pointer 序列的 headed 回归。
4. “浏览器 host/frame 授权替代 Legacy `allowCrossOriginControl`”已由 ADR-0019、产品需求和权限披露固化；后续只需为原生权限 UI、复杂嵌套 frame 和可能的限制型细粒度策略补验收，不隐式扩大权限。

## 4. 阶段结论

上述差距不解除 Phase 6.5 UX NO-GO、Phase 7 HOLD 或 Stable NO-GO。长按、autoplay scope correction 和音频失败原子回滚已进入工程门禁；真实控件、音频链路、广告/换集及跨 frame 产品验收仍需 headed 证据后才能改变交付状态。

## 5. 本轮验证证据

- 固定 Node `24.13.0` 完整 `pnpm check`：unit `363`、component `40`、integration `139`、compatibility `40`、security `3`；format、ESLint、TypeScript 和 dependency boundary（179 modules / 589 dependencies）通过。
- fresh Chrome MV3 构建后的 real-extension E2E：`9 passed / 14 skipped by configuration`；覆盖权限生命周期、BFCache/context invalidation、iframe ownership、媒体锚点、audio fallback 和 hostile rate/volume/seek polling。
- Bilibili headed：Run `2026-08-19-autoplay-bilibili-reverify` 为 `passed / violations=[] / warnings=[]`；顶层 `player.bilibili.com?...&autoplay=0` 定向探针记录 `.bpx-player-ctrl-play` `clickCount=1`，3 秒后媒体 `paused=false`、runtime content/main/media 均为 `ready`，未出现二次 toggle。
- Firefox 153：核心权限/媒体扩展 E2E 通过；`web-ext lint` 为 `0 errors / 2 warnings`，warning 仍来自生成 bundle 的动态 `innerHTML` 规则。
- Chrome/Firefox manifest 版本均为 `0.1.7.10000`；最终 content bundle 在双端一致，SHA-256 为 `4bf515c6480f58b9674fac7a07194bc5c26e37d9cd092219b77e6cd3d577592d`；page-main 为 `6b9a816c6df7748986d486426f0273b2311c1fc8932d0034efa69dfb1ce0caa2`。
- 本地审查 bundle 位于 `web-extension/.release/phase-6.5-advanced-parity-2026-08-19/`，`release:verify` 检查 9 个规范文件通过；Chrome ZIP SHA-256 `b5e38813333ba5c951eb63cb656442ce46a469de1455abf5ff98e5238ecb6149`，Firefox ZIP SHA-256 `77d8e0e063c090c0622d63ea7f75855c39703bca0b7fc6d78cf8cdb57a71bf55`。该 bundle 的 `sourceTreeClean=false`，只能用于本地审查和加载测试，不是 Stable/商店发布候选。
- Legacy 冻结校验通过：`dist/h5player.user.js` SHA-256 `91b5312d7cf150cd852d005b1e5d5f3d8ed2ed7cd8a481dfa1d561d48f7b3f27`，`561788` bytes。
