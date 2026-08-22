# 腾讯登录态 720P 跨帧路由修复审查

> 文档 ID：REVIEW-016  
> 状态：Pass（本次修复范围）  
> 日期：2026-08-17  
> 范围：Web Extension `0.1.4.10000`；Legacy 油猴主线不变

## 1. 用户现象

腾讯视频登录后使用 `720P` 时，播放器可能同时保留顶层原生 `<video>`，并在子 frame 中创建实际播放的 `<fake-video>`。旧顶层实例仍可见、可写且可能处于暂停状态，导致快捷键看似执行成功，但真实播放实例的倍速没有变化。

目标页面：`https://v.qq.com/x/cover/zgexd0mcj7at1fc/g00248hvnae.html`。

## 2. 根因

后台 `media.get-state` 按 frame report 顺序查询媒体状态。顶层 frame 优先，并且暂停但可见的媒体仍属于可路由候选。旧实现把能力完整、带时间线证据的顶层腾讯原生实例判定为 definitive，后台因此在 frame `0` 提前停止查询，实际播放的 `media-*-tencent-viewport` 从未进入最终仲裁。

快捷键随后在顶层本地执行。旧原生实例仍接受 `playbackRate` 写入，所以命令返回成功，`MEDIA_NOT_FOUND` 恢复路径不会触发，形成“操作成功但真实视频不受控”的假成功。

## 3. 修复决策

- 顶层 `tencent-video` 状态不再作为跨 frame 查询的提前终止条件。
- `media-*-tencent-viewport` 继续保持 provisional，确保 native 与 fake-video 都被收集后再仲裁。
- 普通非腾讯媒体及普通腾讯子 frame 仍保留既有 definitive 早停，避免无必要扩大所有站点的查询范围。
- 最终候选排序不改：当真实 viewport proxy 与旧顶层实例同时存在时，既有选择器继续选择 proxy；仅有单个腾讯实例时仍正常返回该实例。
- 不修改 Legacy 油猴脚本、站点权限模型或通用媒体协议。

## 4. 自动化证据

新增或补充：

- `tests/unit/routed-media-selection.spec.ts`
  - 暂停的顶层 Tencent native 不是 definitive；
  - 活跃的顶层 Tencent native 同样不能提前终止 sibling-frame 探测；
  - Tencent viewport proxy 保持 provisional；
  - native 与 proxy 同时收集后选择 proxy；
  - 单独的 Tencent native 仍可返回；
  - 强非腾讯原生媒体仍保持 definitive。
- `tests/integration/background-contract.spec.ts`
  - 顶层暂停 Tencent native 和 frame `17` active viewport 同时上报媒体；
  - 后台请求顺序为 `[0, 17]`，最终返回 frame `17`，不再停在旧顶层实例。
- `tests/unit/tencent-viewport-media-controller.spec.ts`
  - 旧 fake-video 移除后的空窗保留已记录倍速，新实例插入后继承同一意图。

修复前新增用例稳定失败：后台返回 `media-0-1`；修复后定向验证为 5 files / 54 tests passed。

本轮完整工程验证：

| 门禁                                              | 结果                                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Unit                                              | 62 files / 288 tests passed                                                                      |
| Component                                         | 6 files / 36 tests passed                                                                        |
| Integration（排除 Node 固定版本 release fixture） | 11 files / 108 tests passed                                                                      |
| Compatibility                                     | 3 files / 36 tests passed；catalog report passed                                                 |
| Security / boundaries                             | 176 files + 2 manifests scanned；3 security tests passed；162 modules / 529 dependencies，无违规 |
| Typecheck / ESLint / Prettier                     | passed                                                                                           |
| Chromium extension E2E                            | 23 tests passed                                                                                  |

`release-bundle-verification.spec.ts` 的 3 个 fixture 在本机 Node `v24.18.1` 下固定失败，因为它们显式要求 `v24.13.0`；非 release 集成与所有本次相关验证均通过，未修改该版本门禁。

## 5. 登录态真实站点证据

- 使用持久化 Chromium profile，页面顶部登录入口为隐藏状态 `quick_login none`。
- 实际加载扩展版本为 `0.1.4.10000`。
- 后台 `media.get-state` 在指定页面返回 active `media-0-1` 和 paused `media-0-2`，二者均为 `adapterId=tencent-video`，与本次旧实例仲裁条件一致。
- `480P -> 720P` 后 100ms 发送 `Digit2`，一轮转换中真实播放实例约 350ms 内变为 `2x`，随后 12 秒持续为 `2x` 且时间线前进；另一轮在约 1.8 秒内无 active surface，5 秒后新 `720P` 实例恢复为 `2x`，证明切换空窗不会丢失用户意图。
- 在同一指定页面，`KeyC` 返回 `2.1x`，600ms 后 `KeyX` 返回 `2x`；另一次延迟 `KeyC` 取得 16 次连续 `2.1x` 样本。
- 腾讯 A/B 播放路径会在 native 与 `fake-video-element-iframe.html` 之间动态变化；本轮登录态运行已观察到该 frame 创建，但 post-fix active fake-video 分支未能稳定重复触发。因此其并存仲裁由失败优先的 unit/integration 回归锁定，不将单次 frame 出现外推为完整 A/B 验收。

## 6. 结论与保留风险

本次“登录态 720P 仍控制旧顶层实例”的跨帧早停根因已修复。EXT-147 可维持 `In Review / Tencent acceptance evidence passed`，并新增登录态 720P 原生路径证据。

仍需继续覆盖：可重复的 active fake-video 登录态样本、广告前后、连续换集、多次 native/fake 往返、后台标签页、品牌 Chrome 默认 profile 和 Firefox headed。Phase 7 继续 HOLD，不能仅凭本次腾讯专项修复解冻。
