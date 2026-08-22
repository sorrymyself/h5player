# ADR-0009：Overlay Closed Shadow Root 与 Frame 策略

> 状态：Accepted for Preview  
> 日期：2026-08-11  
> 决策人：Architecture / UI / Security Owner  
> 关联：EXT-082、FR-VISUAL-004、FR-UI-003、RISK-018

> Phase 6.5 复核：本 ADR 仍记录 Phase 4 Preview 的已实现安全边界；`document.documentElement` 默认视觉锚点与单一全局面板的交付方案正由 [ADR-0015](./ADR-0015-media-anchored-overlay-and-feedback.md) 提议替代。ADR-0015 未批准前不得实施，ADR-0009 也不得继续作为 UX 达标证据。

## 背景

页面 Overlay 必须运行在任意第三方页面中。宿主页面可能包含全局 reset、极高 z-index、捕获阶段事件监听、
Shadow DOM、同源或跨源 iframe。若直接把 Vue 组件挂到页面 DOM，会同时暴露样式污染、事件冲突和内部 DOM 被页面脚本
遍历修改的问题。

## 决策

1. Overlay 仅在 top frame 创建；所有 frame 仍运行媒体发现和命令 runtime。
2. 使用 WXT `createShadowRootUi`，`mode: 'closed'`、`position: 'inline'`，锚点为
   `document.documentElement`。
3. Overlay CSS 以 `?inline` 编译进 isolated content bundle，并直接传入 Shadow Root；同时在 WXT
   content-script 声明中固定 `cssInjectionMode: 'ui'`，使 UI 样式生命周期由 `createShadowRootUi` 管理。
   生产构建仍必须保持 WAR 数量为 0；不得把样式改成公开资源或通过页面 `<link>` 注入。
4. Shadow host 与 UI container 使用 `h5p-ext-*` 前缀，并在 mount 时应用显式 hostile-CSS reset。
5. 组件只接收可序列化 `OverlayViewModel`，只发出版本化 `OverlayEvent`；业务命令由
   `ContentOverlayController` 映射。
6. dismiss 仅属于当前 document session；重载或新导航后恢复，不写入持久化设置。
7. Preview 不实现跨 frame 媒体聚合。因此 iframe-only 媒体不会出现在 top-frame Overlay 中，Popup/每个 frame
   runtime 仍按既有路径工作。

## 后果

- 页面样式不能直接进入 Overlay，Overlay CSS 也不进入页面样式树；生产 manifest 保持无 WAR。
- closed root 降低页面脚本意外修改内部 DOM 的机会，但不是安全沙箱。
- WXT event isolation 使用冒泡阶段 `stopPropagation`；页面 capture-phase listener 仍可能先观察事件。
- top-frame-only 避免每个 iframe 重复挂载 UI，但 Phase 5 之前不能宣称 iframe-only media 的 Overlay 体验完整。
- 当前 host/panel z-index 为 `2147483000`。它用于 Preview 可见性验证；Beta 前必须结合真实站点矩阵评估更有限的 token、
  冲突诊断和用户可配置 placement。

## 拒绝的方案

- 页面 light DOM：无法稳定隔离样式与内部结构。
- 每个 frame 都挂 Overlay：会出现重复控件和归属不清。
- 通过 WAR 加载样式：扩大产物暴露面，且本阶段没有必要。
- 把业务规则放进 Vue 组件：破坏 application/domain 边界与可测试性。

## 验证

- `tests/component/overlay.spec.ts`
- `tests/unit/content-overlay-controller.spec.ts`
- Chrome hostile/CSP/iframe runtime lifecycle E2E；该套件不等价于 iframe-only Overlay 聚合验证
- bundle budget manifest guard：WAR 数量必须为 0
