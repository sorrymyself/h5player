# ADR-0007：使用动态内容脚本注册实现可选站点授权

> 状态：Accepted / Implemented  
> 日期：2026-08-10  
> 最后更新：2026-08-11  
> 决策人：Architecture / Runtime / Security / Product / Quality  
> 关联：ADR-0005、ADR-0006、EXT-064、EXT-068、DECISION-001

## Context

Phase 2 的静态入口只匹配本地 fixture。Phase 3 需要支持“按当前站点授权”和“所有站点授权”，但不能因为把
`<all_urls>` 写进 `content_scripts.matches` 而在安装时获得全站访问。本 ADR 已在 Phase 3 落地，以下决策也是
当前生产构建和权限测试的事实源。

2026-08-10 的最小双浏览器 spike 将静态 `content_scripts.matches` 临时改为 `<all_urls>`，并在未调用
`permissions.request()` 的全新扩展 profile 中观察到：Chrome 与 Firefox 都执行了 content/page-main，且
`permissions.contains()` 尚未确认 optional grant。Chrome 官方文档同时明确：静态 `content_scripts.matches`
会关联 host permission；程序化注入需要 `scripting` 加目标 host 或 `activeTab`。Firefox 文档也要求
`scripting` 与 host/activeTab 权限。

因此静态 content script 不是 optional host onboarding 的安全实现。

## Decision

1. Manifest required permissions 增加 `scripting` 和 `activeTab`，保留 `storage`；不增加 `tabs`、下载、网络
   拦截或剪贴板权限。
2. `<all_urls>` 只保留在 `optional_host_permissions`。生产 manifest 不声明可覆盖真实站点的静态
   `content_scripts`。
3. WXT content entrypoint 只作为构建产物，使用 runtime registration/空 match 配置避免 WXT 自动把 host
   patterns 提升为 required host permissions。background 的 `ContentScriptRegistrationService` 负责：
   - 根据 `permissions.getAll()` 的已授予 origins，注册两个稳定 ID：isolated content 与 MAIN page-main；
   - 使用 `document_start`、`allFrames`、`persistAcrossSessions: true`；
   - permission grant/revoke 后幂等更新或注销注册；service worker 启动时重建注册；
   - 对当前 active tab 在用户确认后执行一次内置文件 bootstrap，使用户不必手动刷新页面。
4. Popup 由 action 用户手势打开后，通过 `activeTab` 读取当前 tab 的 URL/标题元数据（仅用于当前站点引导），
   先展示权限解释，再调用 `permissions.request()`；用户拒绝时保持只读状态，不重试/静默请求。
5. Options 的“所有站点”入口同样必须由明确用户操作触发。权限撤销后停止新页面注册，并向已知当前 frame 发送
   typed teardown；已有页面最多保留到导航/重载，background 不再接受其特权请求。
6. 仍禁止 WAR、CSP 改写、inline/Data URI、`eval`、`new Function` 和远程脚本。动态注册只引用打包产物文件名，
   不接受页面传入的文件名、权限名或代码。

## Alternatives considered

### A. 静态 `<all_urls>` content scripts + optional host permission

实现简单，但在两端都会提前执行脚本并将 matches 关联为 host access；与显式授权目标冲突，否决。

### B. WXT `registration: 'runtime'` 直接使用 `<all_urls>` matches

WXT 会把 entrypoint matches 加入 `host_permissions`，仍形成 required host 权限；否决。采用空 match 构建产物 +
自有 registration service。

### C. 只申请 `activeTab`，不提供持久站点授权

能降低安装警告，但导航后会失效，无法满足站点规则、跨页面使用和“所有站点”模式；否决。

### D. 保留 `tabs`/`webNavigation` 以发现当前站点

能简化 URL 查询，但扩大可观察面；`activeTab` 已足够覆盖 action 触发的当前 tab，否决。

## Consequences

- 正面：安装无全站 host 警告；授权是可解释、可撤销、可审计的；未来站点注册只在已授权 origin 执行。
- 代价：需要维护跨 Chrome/Firefox 的 registration、当前页 bootstrap、撤销和 worker restart 测试；当前页
  bootstrap 会尝试所有可访问 frame，未获得对应 origin 权限的跨源 frame 仍按浏览器权限模型降级。
- 约束：Popup 必须保留 activeTab 用户手势；Options 不得假装能读取未授权 tab 的 URL；特殊页面（`chrome://`、商店页、
  Firefox 内置页）显示受限原因。

## Verification

- `project/09-reviews/phase-3-permission-spike-2026-08-10.md`
- `project/09-reviews/phase-3-exit-review-2026-08-11.md`
- Chrome/Firefox manifest scan：required permissions 为 `storage`、`activeTab`、`scripting`，`<all_urls>` 只在
  optional host，`content_scripts: []`，无 required host permissions 或 WAR。
- EXT-064/068：Chrome 未授权/grant/reject/revoke/worker restart/bootstrap/restricted，Firefox 未授权/origin
  grant/revoke/bootstrap，以及 permission event 与显式 reconcile 并发 E2E/集成测试。

## Implementation status and follow-ups

- 已完成：EXT-064 的 registration service、权限引导、站点/本页停用与撤权；EXT-068 的 Chrome
  restricted/reject、Firefox origin grant/revoke、共享 contract 与组件 a11y；EXT-069 的 Phase 3 Preview 安全审查。
- 当前自动化限制：headless 浏览器不能稳定操作原生权限确认框。Chrome 使用临时 profile 预置授权和确定性拒绝副本；
  Firefox 测试 profile 使用 `ExtensionPermissions` 与 tab manager 模拟 optional origin/`activeTab`。这些能力只存在于
  test harness，不进入扩展源码、manifest 或产物。
- 发布前跟进：Beta/商店提交必须补 headed 原生确认框与文案 smoke，并补 Firefox ESR/最低版本、Chrome previous
  stable 和 Edge 权限矩阵；这些是发布门禁，不影响当前 Preview 范围进入 Phase 4。
