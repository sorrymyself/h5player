# 媒体 UI、反馈与媒体控制策略运行时架构

> 文档 ID：ARCH-UX-001  
> 状态：In Review  
> 负责人：Architecture Owner / Runtime Owner / UI Owner  
> 最后更新：2026-08-16  
> 关联：REQ-UX-001、REQ-UX-002、ARCH-004/005、ADR-0002/0003/0009/0015/0016/0017、RISK-016/018/021/028/029/030

## 1. 架构目标

在不修改 Legacy 主线的前提下，为 Web Extension 建立一条完整的体验闭环：

```text
DOM media discovery
  -> media identity + active selection
  -> policy resolver (global/site/page/media)
  -> lifecycle coordinator (new/play/replay/src/reset)
  -> MAIN world media control authority
  -> typed command application through captured native accessors
  -> media snapshot/result
  -> anchored overlay + feedback presenter
```

页面 UI、Popup、Options 只消费 application view model；策略和命令不依赖 Vue 或 DOM。

## 2. 关键边界

### 2.1 Page-main

- 持有 `HTMLMediaElement`、站点 adapter、媒体 controller 和媒体实际状态。
- 持有 `MediaControlAuthority`：在 `document_start` 捕获原生 accessor、安装可撤销 setter 仲裁、维护 per-instance protection state。
- 负责媒体发现、生命周期事件、策略应用的 DOM 侧执行、能力、冲突计数和错误采集。
- 不直接读写 `storage`，不直接创建 Vue UI，不保存页面级持久化策略。

### 2.2 Isolated content

- 持有 `mediaId -> anchor/feedback/overlay` 的映射、页面 UI 生命周期和可访问反馈。
- 负责把 typed command/result 转成 UI view model。
- 不把 `document.documentElement` 作为默认视觉归属；顶层 host 只作为管理节点，具体 UI 必须使用媒体或局部容器 anchor。
- 负责 frame registry 尚未支持时的明确降级，不伪造 iframe-only media 的 top-frame 位置。

### 2.3 Background

- 持有全局设置、站点策略、迁移和权限权威。
- 接受“用户意图变更”而不是高频媒体实际值；媒体 snapshot 不写入 storage。
- 向 content 提供 resolved policy，并在 worker 重启后可重建。

### 2.4 Popup/Options

- Popup：当前页面状态、active media、当前有效倍速、策略来源、保护状态和常用操作。
- Options：全局默认、站点覆盖、页面临时策略说明、快捷键和诊断。
- 不直接操作 `HTMLMediaElement`；所有操作经过 application facade。

## 3. 数据模型增量建议

当前 `SettingsData` 已有 `global.media.defaultPlaybackRate`、站点覆盖和 `protectPlaybackRate`。本需求建议新增或明确以下版本化模型；字段命名最终由 ADR 评审决定：

```ts
type PlaybackRateScope = "global" | "site" | "page" | "media";
type PlaybackRateIntentSource =
  | "product-default"
  | "global-setting"
  | "site-rule"
  | "page-session"
  | "media-session";

interface ResolvedPlaybackRatePolicy {
  readonly value: number;
  readonly scope: PlaybackRateScope;
  readonly source: PlaybackRateIntentSource;
  readonly protectAgainstSiteReset: boolean;
  readonly syncWithinPage: boolean;
  readonly updatedAt: number;
}

interface MediaPlaybackState {
  readonly mediaId: string;
  readonly actualRate: number;
  readonly intendedRate: number;
  readonly policySource: PlaybackRateIntentSource;
  readonly lastAppliedAt: number | null;
  readonly lastObservedExternalRate: number | null;
  readonly applicationStatus:
    "pending" | "applied" | "unsupported" | "blocked" | "failed";
}
```

约束：

- `actualRate` 不进入 settings storage。
- 用户命令产生 `intendedRate` 变更，并带 scope/source；`media` scope 只存于当前媒体 session，不写入 Settings；网站外部写入只产生 observation，不升级为用户意图。
- 所有值通过现有 `[0.1,16]` Schema 和媒体 capability 归一化。
- 站点策略覆盖不能静默清除全局默认；页面临时覆盖关闭后回到 site/global policy。
- 反馈必须引用 command result 的 snapshot 和 policy result，避免 UI 自己推算最终值。

## 4. Policy Resolver

`resolvePlaybackRatePolicy(settings, site, pageSession, mediaSessionIntent, adapterCapabilities)` 是纯函数，输入输出均可序列化。

优先级：

```text
current-media temporary intent
  > page session override
  > site override
  > global default
  > 1x
```

输出还必须说明：

- 来源是哪一层；
- 是否保护外部重置；
- 是否在页面内同步新增媒体；
- 当前站点/媒体是否支持；
- 不支持时的结构化降级原因。

该函数不得读取 `window`、`location`、storage 或 DOM；站点身份由调用方传入规范化 `SiteId`。

## 5. Lifecycle Coordinator

生命周期协调器按 `mediaId` 建立幂等状态机：

```text
discovered -> awaiting-capability -> applying-intent -> applied
                                      |                 |
                                      v                 v
                                  unsupported       observing
                                                        |
                             external-reset <----------+
                                  |
                   protect=true -> reapply-with-budget
                   protect=false -> report-observation
```

必须处理的触发：

- media discovered / controller attached；
- loadedmetadata / canplay / playing；
- pause 后重新播放；
- `src`/duration 变化和 SPA 换集；
- active media 切换；
- settings/site policy 变更；
- controller snapshot 观察到外部倍速变化；
- teardown、权限撤销、站点停用和 frame 销毁。

重试规则：

- 同一 `mediaId + intendedRate + lifecycleGeneration` 去重；
- 只允许有界次数和有界时间窗口；
- 每次重试可产生诊断计数，但不产生重复用户反馈；
- 失败后状态为 `blocked/failed`，不得无限 MutationObserver/interval 轮询。

## 6. MediaControlAuthority

`MediaControlAuthority` 是 MAIN world 的页面内控制权仲裁器，不是 storage 或产品策略权威。它只执行 content 已解析并通过 typed protocol 下发的保护配置。

```text
resolved protection policy
  -> media.configure-authority
  -> MediaControlAuthority.configure()

extension command
  -> captured native setter / verified adapter write
  -> record intended value on media binding
  -> read actual value
  -> command result

site setter
  -> wrapped accessor
  -> no binding/protection: pass through
  -> same intended value: pass through
  -> conflicting protected value: reject + bounded diagnostic
```

核心结构：

```ts
type MediaAuthorityPolicy = Readonly<{
  playbackRate: boolean;
  volume: boolean;
  currentTime: boolean;
}>;

interface MediaAuthorityBinding {
  readonly mediaId: string;
  readonly generation: number;
  readonly intendedPlaybackRate: number | null;
  readonly intendedVolume: number | null;
  readonly intendedMuted: boolean | null;
  readonly seekLease: {
    target: number;
    issuedAt: number;
    expiresAt: number;
  } | null;
}
```

实现约束：

- 使用 `WeakMap<HTMLMediaElement, Binding>` 保存实例状态，并用显式 attach/detach 映射 `mediaId`；移除媒体时不得保留强引用。
- 原型 getter 保持原始实现；wrapper setter 只对已 attach 且对应保护开启的实例生效，其他页面媒体透明透传。
- 扩展内部继续使用模块加载时捕获的原生 setter，因此不会被自己的 wrapper 阻断。
- `playbackRate`、`volume`、`muted` 是持续保护；`currentTime` 是短时 seek lease，按 elapsed time 与播放速率计算容差，绝不永久冻结时间。
- 自定义媒体元素由 adapter 提供受限 accessor binding；例如腾讯 `<fake-video>` 绑定真实实例并验证实际 `playbackRate`，不能使用可被站点误解析的全局自定义消息。
- configure 关闭某属性时立即停止阻断，但可保留非敏感的当前会话意图供重新启用；页面停用、撤权、frame teardown 时释放全部 binding。
- teardown 仅在当前 descriptor 仍是本实例安装的 wrapper 时恢复原 descriptor；若网站已替换 descriptor，不得覆盖网站后续状态。
- 页面若提前缓存原生 setter、重建实例或使用不可包装 accessor，进入 lifecycle 有界恢复与 adapter 降级，不承诺绝对不可绕过。

诊断仅保留 bounded counter、最后冲突属性/值、mediaId、generation、策略来源和降级原因，不记录完整 URL、媒体标题或播放内容。

## 7. Command 与 Feedback Pipeline

```text
UI/shortcut
  -> MediaCommand { commandId, mediaId, source, scope? }
  -> Application policy gate
  -> Page-main controller
  -> MediaCommandResult { result, snapshot, policyEffect? }
  -> FeedbackEventFactory
  -> MediaFeedbackPresenter(mediaId, anchor)
```

- `source` 至少包括 `overlay`、`popup`、`shortcut`、`options`、`lifecycle`。
- `scope` 明确 `current-media`、`page-policy`、`site-policy`、`global-policy`。
- lifecycle 自动应用默认不显示普通成功提示；只有用户命令或策略冲突/失败才显示反馈。
- 反馈 presenter 使用 per-media queue，最新同类值替换旧值，错误可覆盖成功但不能阻塞操作。
- result 失败不修改 settings 意图；用户需通过 UI 显式重试或修改策略。

## 8. Anchored Overlay 组件边界

建议拆分为：

```text
MediaAnchorRegistry
  - mediaId -> element/container/geometry
  - observe resize/scroll/fullscreen/removal
MediaQuickControls
  - play/seek/rate/volume/mute
MediaFeedbackPresenter
  - per-media transient feedback
MediaAdvancedMenu
  - visual/fullscreen/PiP/capture
OverlayVisibilityPolicy
  - collapsed/expanded/hidden + hover/focus/touch/pause rules
```

组件输入输出仍保持 serializable ViewModel/typed event；anchor/DOM handle 只存在 content infrastructure 层。`MediaOverlay.vue` 不应直接访问媒体元素。

## 9. 与现有架构的兼容关系

- 复用 `MediaSnapshot`、`MediaController`、`CommandRegistry`、`resolveSettings`、`ContentOverlayController` 的分层边界。
- 扩展现有 `ContentOverlayController` 的职责应拆开：业务命令协调、媒体锚点注册和反馈展示不应继续由一个全局 panel controller 承担。
- 现有 `createShadowRootUi`、closed ShadowRoot 和 CSS injection 保留，但 anchor 从顶层管理 host 改为按媒体实例创建受控 host/portal。
- `MediaDiscoveryService` 已有 active scoring 和 controller lifecycle；新增 coordinator 应订阅其 `added/updated/removed/active` 更新，而不复制发现逻辑。
- `MediaDiscoveryService` attach/detach 时注册和释放 authority binding；`MediaPageRuntime` 在成功命令后以最终 snapshot 提交 intended value。
- Popup/Options 的 `defaultPlaybackRate` 和 site override 页面保留；新增 policy source/作用域/保护状态展示。

## 10. 禁止的替代方案

- 一个 `position: fixed` 大面板默认覆盖视口。
- 在 content runtime 中维护一个“当前媒体之外”的全局 DOM 指针。
- UI 点击后直接给 `HTMLMediaElement.playbackRate` 赋值并另行写 storage。
- 用全局 EventBus 或未版本化 `window.postMessage` 传递反馈。
- 用无限轮询不断重设倍速以对抗网站逻辑。
- 永久锁死 `currentTime`、将所有网站 setter 一律吞掉，或把未绑定媒体也纳入全局拦截。
- 把扩展内存状态、sessionStorage 或隐藏辅助实例的值当成实际播放已生效的证据。
- 为了让 overlay 显示而修改宿主页面样式、CSP、closed Shadow DOM 或原生控件。

## 11. 架构验收

- policy resolver 可在无 DOM/浏览器环境下完成全覆盖单测。
- lifecycle coordinator 对新媒体、重播、src 变化、站点反向改值和 teardown 有确定状态转移测试。
- authority 对 getter 透明、protected/unprotected setter、相同值透传、持续 rate/volume、短时 currentTime lease、custom element、descriptor 替换和 teardown 有单测。
- hostile fixture 证明短间隔轮询不能覆盖已保护值，且无持续扩展 interval；腾讯 routed media 的每次观察进入同一 playback lifecycle。
- `MediaAnchorRegistry` 在多媒体、Shadow DOM、SPA、滚动/resize/fullscreen 下无重复 host、listener 或 timer。
- feedback presenter 的消息合并、过期、错误和无 anchor 降级有组件/集成测试。
- dependency-cruiser 不出现 domain/application → Vue/DOM 反向依赖。
