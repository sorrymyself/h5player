# UI 组件化架构与设计规范

> 文档 ID：ARCH-004  
> 状态：In Review / Phase 6.5 Overlay UX Reassessment
> 负责人：UI Owner / Architect  
> 最后更新：2026-08-12
> 适用：Popup、Options、页面 Overlay 及共享组件

## 1. 组件化目标

- 同一功能在 popup/options/overlay 中共享领域语义，而不是复制浏览器调用。
- 组件可在无扩展环境的 Story/测试中渲染。
- 页面 overlay 与宿主站点样式、事件和层级隔离。
- 错误、权限、空状态、加载和降级都是一等 UI 状态。
- 组件能够被键盘、屏幕阅读器和高缩放用户使用。

## 2. 组件层级

```text
design-tokens/
  color / typography / spacing / radius / z-index / motion
primitives/
  Button / Toggle / Select / Slider / Dialog / Tooltip / Field
patterns/
  PermissionPrompt / EmptyState / ErrorNotice / ShortcutRecorder
domain-components/
  MediaSummary / PlaybackControls / SiteSwitch / DiagnosticsPanel
features/
  settings-editor / hotkey-editor / data-management / overlay-controls
pages/
  PopupPage / OptionsPage / AboutPage
```

依赖只能从 pages → features → domain-components/patterns → primitives → tokens。Primitives 不知道 H5Player、浏览器 API 或媒体命令。

## 3. 状态模型

UI 使用显式判别状态：

```ts
type Loadable<T> =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; data: T }
  | { state: "empty"; reason: string }
  | { state: "error"; error: ViewError };
```

- 组件 props 是可序列化 view model；不传 DOM、browser port 或 mutable domain object。
- 组件 emit 用户意图，例如 `command-requested`、`settings-submitted`；application facade 处理业务。
- Popup/overlay 的 optimistic UI 只用于可回退的低风险命令；设置和迁移等待 background 确认。
- 权限拒绝、无媒体、站点禁用和功能不支持不可混成同一个“无法连接”。

## 4. 共享与差异

- 共享：tokens、primitives、icons、i18n、view model、命令描述、错误映射。
- Popup：宽度有限、快速操作、不可承载复杂表单。
- Options：路由、长表单、批量编辑、数据管理和诊断。
- Overlay：按需挂载、触控/鼠标友好、低干扰、可关闭；不得依赖 popup 窗口存活。

同一业务规则只在 application/domain 实现一次；不同 UI 可有不同布局和交互。

## 5. 页面 Overlay 隔离

- 使用单一宿主 custom element + Shadow Root；宿主类名/属性统一 `h5p-ext-*` 前缀。
- 样式使用 design tokens 和 adoptedStyleSheets/打包静态 CSS；不从 CDN 加载。
- z-index 目标使用有限 token；Phase 4 Preview 暂用 `2147483000` 保证 hostile fixture 可见，Beta 前必须以真实站点矩阵收敛并提供冲突诊断。
- 事件在 Shadow 边界内处理；需要冒泡到 runtime 的事件使用 typed CustomEvent，不泄露内部 DOM。
- 销毁时移除宿主、listener、observer、timer、portal 和 object URL。
- 对 closed Shadow DOM、fullscreen element、Picture-in-Picture 和 iframe 分别定义挂载策略与降级。

## 6. 设计 Token 与主题

- 首发 light/dark/系统主题；颜色由语义 token 命名，如 `surface`, `text-primary`, `danger`。
- 字号、间距和控件尺寸支持 200% 缩放；避免固定高度截断多语言。
- 动效遵循 `prefers-reduced-motion`，控制反馈不依赖动画完成。
- Overlay 的站点适配只能调整受限 token/placement，不允许注入任意 CSS 字符串。

## 7. 可访问性

- 所有按钮/开关/滑块有 accessible name、状态和键盘行为。
- Shortcut Recorder 明确开始/结束录制，支持 Esc 取消和冲突朗读。
- Dialog 管理 focus trap、初始焦点、恢复焦点和 Escape。
- 错误通过文本与 `aria-live` 提示；颜色不是唯一状态。
- 组件测试运行 axe 或等价审查，E2E 验证真实焦点顺序。

## 8. 国际化

- 组件只引用 message key 与参数；禁止拼接语法依赖强的句子片段。
- 快捷键标签使用平台映射，Mac/Windows/Linux 可分别呈现。
- 文案资源按 feature 分组，删除功能时同步删除 key。
- Story/视觉测试包含中文、英文、长文本和缺失翻译 fallback。

## 9. 组件文档与测试

每个 primitives/domain component 至少具备：

- props/events/slots 与可访问性说明；
- default/loading/empty/error/disabled/permission-denied stories；
- 交互和键盘测试；
- i18n 长文本与深色主题用例；
- 若用于 overlay，宿主样式污染 fixture 和 visual regression。

可使用 Storybook/Histoire 或更轻的 Vite playground；工具不进入生产 bundle，具体选择在 Phase 0 UI spike 确认。

## 10. 禁止模式

- 组件内直接访问 `chrome.tabs`、`browser.storage`、`HTMLMediaElement`。
- 用全局 event bus 代替 typed application service。
- 大型“万能设置组件”用路径字符串读写任意配置。
- `innerHTML` 渲染站点标题/诊断数据。
- 依赖 DOM 顺序或数组 index 识别命令；必须使用稳定 command ID。
- 把函数回调序列化到 storage/message。

## 11. 组件完成定义

- API 小且稳定，状态/事件语义文档化；
- application facade 可替换，独立 Story 可运行；
- 单元/交互/a11y/visual（按风险）通过；
- popup/options/overlay 至少一个真实消费方验证；
- bundle 增量和依赖影响符合预算；
- teardown、错误和权限拒绝状态有测试。

## 12. Phase 4 Overlay 实现记录（技术 Preview，UX 未达标）

- `MediaOverlay.vue` 只消费版本化 `OverlayViewModel`，发出 `OverlayEvent`；`ContentOverlayController` 负责 typed
  command、busy、notice、fallback 和 capture download 协调。
- WXT UI 使用 `mode:'closed'`、`position:'inline'`、`document.documentElement` anchor，并在 content-script 固定
  `cssInjectionMode:'ui'`；CSS 通过 `?inline` 交给 UI helper 注入 ShadowRoot，因此生产 manifest 无 WAR。
- host reset 覆盖 all/position/size/pointer-events/direction/unicode-bidi/z-index；组件内部再执行 box-sizing、主题和
  reduced-motion 规则。
- 仅 top frame 挂载；iframe-only media 显示为 top-frame empty 是 Preview 已知限制，不计作跨 frame 完整支持。
- event isolation 主要阻止 ShadowRoot 内事件向页面冒泡；页面 capture-phase listener 仍可能先观察事件，closed root
  也不是安全沙箱。
- download 按钮在 Preview 明确 disabled；截图按钮只在 capability 存在时启用。

## 13. Phase 6.5 Overlay 修正边界（In Review）

- Phase 4 的 `document.documentElement` anchor 和 fixed 大面板只作为技术 Preview 历史记录，不再是交付目标。
- 默认页面 UI 改为 `mediaId` 级 host：视频优先局部容器/媒体右上角，空间不足按受控 placement fallback；audio/no-anchor 使用紧凑反馈或 Popup 入口。
- `MediaQuickControls` 只负责高频命令和显隐状态；`MediaFeedbackPresenter` 负责短时最终值/错误反馈；二者不得共用一个全局 panel controller。
- 页面 UI 必须支持折叠、hover、focus、pause、touch、hidden、reduced-motion 和 host teardown；播放中不能持续遮挡媒体主体。
- Popup/Options 可展示策略来源、保护状态和当前实际值，但不能替代页面反馈；快捷键、Overlay、Popup 使用同一 application command/feedback contract。
- iframe-only、fullscreen、PiP、字幕/原生控件避让需有明确支持或降级状态，不能把 top-frame empty 伪装为正确 media placement。
