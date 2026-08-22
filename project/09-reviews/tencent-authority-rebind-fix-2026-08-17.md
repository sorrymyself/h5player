# 腾讯视频实例替换与控制权迁移修复审查

> 文档 ID：REVIEW-015  
> 状态：Pass（本次修复范围）  
> 日期：2026-08-17  
> 范围：Web Extension `0.1.3.10000`；Legacy 油猴主线不变

## 1. 用户现象与根因

腾讯 WASM 播放器会在切片、延迟初始化或 AB 播放阶段替换 `<fake-video>` 实例，但对外仍表现为同一个稳定的媒体会话。旧实现的 `TencentViewportMediaController` 在发现替换时先释放旧 authority，再绑定新实例；`MediaControlAuthority` 的 `bindingsById` 因此先被清空，已记录的倍速意图随之丢失。若腾讯先移除旧实例、稍后才插入新实例，短暂无目标的快照也会提前释放 binding。新实例回到 `1x` 后，腾讯自身的后续写入不再受扩展保护，表现为“第一次调速有效，过一会儿失控”。

## 2. 修复决策

- 绑定顺序改为：新实例先通过同一 `mediaId` 接管 authority，完成 intent 继承和立即 reconcile，再执行旧实例 release。
- 短暂找不到 `<fake-video>` 时保留旧 binding，把它视为同一媒体会话的过渡态；新实例接管或 controller teardown 时再释放。
- 旧 release 闭包在新 binding 已接管后自动失效，避免误删新状态。
- 不修改 Legacy 油猴脚本、通用媒体控制协议或站点权限模型。
- 延续既有 per-instance authority：保护开启时，腾讯新实例和站点连续写回均以用户意图为准；未绑定实例仍保持透明。

## 3. 自动化证据

新增单测 `tests/unit/tencent-viewport-media-controller.spec.ts`，验证：

1. 旧实例只设置并记录一次 `1.75x`；
2. 新旧实例直接重叠替换时，仅由 `getSnapshot()` 触发重绑定；
3. 旧实例先移除、新实例后插入时，中间 `removed` 快照不清除 intent；
4. 没有第二条控制命令，新实例直接继承用户倍速；
5. 旧实例恢复普通写入，新实例连续两次被站点写 `1x` 仍保持 `1.75x`，并记录冲突次数。

本地验证：

| 门禁                                              | 结果                                                         |
| ------------------------------------------------- | ------------------------------------------------------------ |
| Unit                                              | 61 files / 285 tests passed                                  |
| Integration（排除既有 release toolchain fixture） | 11 files / 107 tests passed                                  |
| Typecheck / lint                                  | passed                                                       |
| Compatibility                                     | 3 files / 36 tests passed                                    |
| Security                                          | scan 176 files + 2 manifests passed；security 3 tests passed |
| Dependency boundaries                             | 162 modules / 529 dependencies，no violations                |
| Hostile Chromium E2E                              | 连续 rate/volume/seek 保护通过                               |

发布包集成测试仍受本机 Node 版本差异阻断：fixture 固定要求 `v24.13.0`，当前运行时为 `v24.18.1`；该失败与本次源代码无关。

## 4. 腾讯真实站点证据

页面：`https://v.qq.com/x/cover/zgexd0mcj7at1fc/g00248hvnae.html`

- 构建：Chrome manifest `0.1.3.10000`。
- 切片后先由 `media-14-tencent-viewport` 返回，随后路由到当前可见播放实例 `media-0-1`。
- `2x` 连续采样 30,002ms，共 114 次，所有采样均为 `2x`，无失败样本；采样对象必须为腾讯适配器返回的可见媒体且至少包含两次独立观测。
- 稳定窗口结束后再次发送 `KeyC`，延迟快捷键成功，目标实例仍可调速。
- 腾讯页面原生倍速菜单在观察窗口结束时标记 `2x` 为当前值。
- 报告：`web-extension/test-results/live-sites/2026-08-17-tencent-final/tencent-video/report.json`。

另一次 45 秒观察获得 167 次连续 `2x` 样本并通过同一延迟快捷键检查。

用户卸载并重新加载扩展后再次反馈“初始可调，随后不可控”。复验期间首轮 live probe 在切片边界产生误报：探针只等待 8 秒，但运行时允许最多 12 秒完成 staged intent 的 child-frame → top-frame 控制权迁移；首轮报告没有进入稳定采样，随后腾讯原生菜单已显示 `2x`，且 `KeyC` 已能把顶层真实实例调至 `2.1x`。探针现已改为等待 15 秒、允许同一腾讯播放会话迁移 `mediaId`，并分别记录初始快捷键和延迟快捷键状态，不再把零采样错误归类为“网站轮询重置”。

修正后的复验报告：`web-extension/test-results/live-sites/2026-08-17-tencent-reverify-2/tencent-video/report.json`。结果 `outcome=passed`、`violations=[]`；控制从 `media-14-tencent-viewport` 迁移到 `media-0-1` 后，30,000ms 内 114 次采样全部为 `2x`，随后 `KeyC` 成功调至 `2.1x`。

## 5. 结论与保留风险

本次“同媒体会话实例替换导致意图丢失”已修复并有单测与真实站点证据，EXT-147 的腾讯实例迁移稳定性可更新为 `In Review / fix verified`。仍需单独覆盖登录态、广告/AB 播放器、多次连续 fake-video 替换、后台标签页和 Firefox headed 场景；这些不因本次修复自动关闭。Phase 7 继续按既定评审门禁保持 HOLD。
