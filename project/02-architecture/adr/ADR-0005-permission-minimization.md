# ADR-0005：权限最小化并取消远程执行能力

> 状态：Accepted  
> 日期：2026-08-10  
> 最后更新：2026-08-11  
> 决策人：Architecture / Security / Product  
> 关联：SEC-001、SEC-002、NFR-SEC-*

## Context

当前 manifest 声明 `<all_urls>`、`webRequestBlocking`、`declarativeNetRequest`、`clipboardWrite` 等权限；background 还尝试修改 CSP，content 通过内联/Data URI/Function 多路注入。这扩大了攻击面和商店审核风险。

## Decision

- 先用 content script + `world: MAIN`（或浏览器等价受控入口）验证是否能满足页面 Hook，只有必要时才增加权限。
- 删除全站 CSP 修改和任意代码执行兜底。
- 将 `webRequest`、downloads、clipboard、tabs、host permissions 拆成按功能证明的能力；实验能力默认不申请或按可选权限启用。
- 页面消息只能请求白名单命令，不能传函数、脚本、任意 URL 或权限名。
- 远程推荐/助手不纳入首发；若未来需要，使用固定 HTTPS API、响应 Schema、超时、隐私声明和内容安全审查。

Phase 1 manifest 只保留 `storage` 常规权限，并将 `<all_urls>` 放入 `optional_host_permissions`；这是历史基线。
Phase 3 已完成后续验证并由 ADR-0007 批准 `activeTab` 与 `scripting` 两个常规权限。当前 Chrome/Firefox production
manifest 的 required permissions 精确为 `storage`、`activeTab`、`scripting`；`host_permissions` 不存在，
`content_scripts` 为 `[]`，`<all_urls>` 只存在于 `optional_host_permissions`。

Phase 3 的双浏览器 spike 已证明：真实站点若继续使用静态 `content_scripts.matches`，会在 optional grant 前执行，无法实现上述显式授权。ADR-0007 因此批准 `activeTab` 与 `scripting` 两个常规权限，分别用于 action 用户手势下读取/临时访问当前 tab，以及把已打包的 content/page-main 文件注册到已授权 origins。该修订不批准 `tabs`、静态真实站点 matches、required host permission、WAR 或任意代码注入。Phase 3 Exit 已通过 Chrome 的 grant/reject/revoke、注册与 worker restart，以及 Firefox 的 origin grant/revoke、注册和权限生命周期；Firefox all-sites/原生拒绝弹窗仍需发布前补证。

权限事实源为 `project/06-security/permission-inventory.md`，构建产物由 `scripts/security-scan.ts` 对 manifest、CSP、远程资源和禁止代码执行模式进行检查。

## Consequences

- 用户首次安装不会获得持久真实站点访问；Phase 3 通过 action 用户手势与 optional host grant 实现明确授权和内容脚本注册流程。
- `<all_urls>` 只是可选能力，不代表 background 可以执行任意页面请求；sender、消息类型、payload 和具体 capability 仍要逐层校验。
- production profile 保持空静态 matches；fixture 权限只存在于隔离 E2E profile，不进入产物。
- 没有登记到权限清单的权限不得进入任何 Stable manifest。
