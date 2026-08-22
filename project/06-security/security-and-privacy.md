# 安全、隐私与供应链基线

> 文档 ID：SEC-001  
> 状态：Approved Phase 6 Baseline / Phase 6.5 UX and Experimental Threat Amendment In Review<br>
> 负责人：Security Reviewer  
> 最后更新：2026-08-19
> 关联：ADR-0002、ADR-0005、ADR-0009、ADR-0015、QA-002、RISK-028

## 1. 信任边界

| 边界                       | 不可信输入                           | 允许能力           | 必须控制                                    |
| -------------------------- | ------------------------------------ | ------------------ | ------------------------------------------- |
| 网页 → MAIN                | 页面脚本、DOM 属性、URL、postMessage | 媒体/DOM 受控操作  | nonce、来源、Schema、生命周期               |
| MAIN → content             | 页面运行时快照/请求                  | bridge 白名单      | requestId、frame/session、超时              |
| content → background       | 页面状态、用户操作                   | 最小扩展能力       | sender tab/frame、权限、payload 校验        |
| popup/options → background | 用户表单、导入文件                   | 设置/诊断/当前 Tab | Schema、CSRF-like request context、大小限制 |
| background → 外部网络      | 固定 API（若未来批准）               | 只读且最小字段     | allowlist、HTTPS、超时、响应 Schema         |
| 构建链 → 产物              | npm 包、配置、资源                   | 编译/打包          | lockfile、审计、来源和 hash                 |

## 2. 当前高风险基线（必须消除）

- `web-extension/background.js:9-31` 通过 `declarativeNetRequest` 放宽全站 CSP。
- `web-extension/background.js:57-81` Firefox 使用 `webRequestBlocking` 修改 CSP。
- `web-extension/content.js:4-23` 通过 script `src` 注入构建产物。
- `web-extension/content.js:26-61` 内联、Data URI、`new Function` 多重兜底。
- `web-extension/inject.base.js:8-169` 在页面全局模拟 GM storage/menu/tab API，并把数据写入页面 localStorage。
- `web-extension/content.js:73-125` 接受任意 `h5player_*` 页面消息，缺乏协议版本、nonce 和 payload Schema。

这些路径在新架构中不得复制；旧文件仅作为迁移期基线，删除前必须有替代能力和 E2E 证据。

## 3. 权限最小化清单

每项权限必须登记：用途、代码调用点、替代方案、用户文案、浏览器差异、测试和移除条件。

初始建议：

- `storage`：P0，配置与迁移。
- `activeTab` 或按需 host permission：P0/P1，当前页面操作。
- `tabs`：仅在确实需要读取 Tab 元数据时申请；优先使用 sender/context。
- `clipboardWrite`：截图/复制明确需要时按功能审查。
- `downloads`：实验能力，默认不进入首发权限。
- `webRequest`/`declarativeNetRequest`：除非有经批准的合法、最小用途，否则不申请。
- `<all_urls>`：必须有用户价值、商店说明和按站点替代评估；优先 optional host permissions 或用户触发授权。

## 4. 消息安全要求

- 页面桥每次握手生成至少 128 bit 随机 nonce，不使用时间戳作为唯一 ID。
- 校验 `event.source === window`、origin/targetOrigin、frame/session 和当前 document 生命周期。
- 请求类型采用 allowlist；未知字段默认剥离或拒绝。
- 数字范围、字符串长度、数组数量、URL scheme、导入文件大小全部限制。
- 禁止通过消息传递函数、DOM 节点、Error 实例、脚本文本或任意权限名。
- background 依据 `sender.id`、`sender.tab.id`、`sender.frameId` 和请求能力再次授权，不能信任 payload 自报 tabId。
- 需要异步响应的 listener 明确返回 true/Promise，并处理断开、超时和重复 requestId。

Phase 1 补充：MAIN world 与页面脚本共享 realm，nonce 不能替代 capability authorization。页面桥只允许无特权握手/健康消息；来自 MAIN 的后续媒体数据一律按不可信输入处理，content 不得把任意 page type 翻译为 runtime type，background 仍以真实 sender 和 source allowlist 复核。

实验下载补充：`media.configure-experimental` 与 `media.execute` 的页面侧握手仍经过 MAIN world 共享 `postMessage`，因此 session/nonce 只提供格式、生命周期和重放约束，不能证明消息来自扩展。已落地的缓解包括：默认关闭时不安装 MSE Hook、关闭立即恢复原生方法、capture 资源有界、`endOfStream(error)` 不下载、synthetic `Shift+D` 被拒绝、isolated content 再次按真实 settings 门禁、下载要求浏览器 user activation。实验 manager 只存在于 extension-owned MAIN registry，不挂载到页面 `window`；最终 anchor/fetch sink 已在 isolated content。剩余风险是同 realm 页面仍可在用户激活期间干扰 MediaSource、postMessage 或媒体实例，因此仍需 hostile/live-site 证据，不能宣称绝对隔离。

## 5. DOM 与内容注入

- 新 UI 采用安全 DOM API/框架模板，禁止把不可信内容拼入 `innerHTML`。
- 页面样式使用 Shadow DOM、CSS module 或严格前缀；不修改站点 CSP。
- MAIN world 只通过 manifest 声明的打包内 content script 在 `document_start` 加载；不使用 WAR 动态注入、远程 script、Data URI script、`eval`、`new Function`。
- 对 `document`, `window`, `Object`, `HTMLMediaElement` 等可能被站点改写的对象保存受控引用，并有 hostile fixture 验证。
- Hook 必须有 teardown；页面导航和 frame unload 后不能保留引用。

Phase 4 Overlay 使用 closed ShadowRoot 和 hostile CSS reset，但不把 closed root 视为安全边界。WXT event isolation 主要
阻止冒泡阶段事件离开内部树，页面 capture-phase listener 仍可能先观察用户事件；因此 Overlay 不承载密码、token 或
其他秘密输入。仅 top frame 挂 UI，避免 iframe 重复控件。

## 6. 存储与隐私

- 默认只保存设置、站点规则、必要的进度元数据和版本信息。
- 进度键使用不可逆的规范化站点/媒体标识策略；不保存完整媒体 URL，除非用户明确开启并接受风险。
- 导入/导出文件做 Schema 校验、大小限制和敏感字段提示。
- 日志默认本地 ring buffer，自动移除 query、fragment、标题、媒体源、页面文本、账号标识。
- 任何外部网络请求必须是固定 HTTPS allowlist、最小字段、超时、响应校验和用户可关闭；首发默认关闭。
- 隐私政策必须列出数据类型、用途、存储位置、保留期、清除方式和第三方依赖。

Phase 4 progress 默认关闭；开启后只保存规范化 site、匿名 mediaKey、position/duration 和 TTL，不保存临时 media ID、
原始 page/source URL、query、fragment、标题或账号信息。匿名 hash 仅用于去敏和稳定 key，不宣称密码学不可关联。

截图不修改 `crossorigin`，不代理媒体，不绕过 DRM/CORS。Artifact 最大 4 MiB，isolated content 二次校验 base64 和
byteLength 后下载；错误上下文不包含媒体源。当前通用消息响应最大可能约 5.6 MiB，作为 `RISK-019` 在 Beta 前收敛。

跨 Tab 事件只含匿名 mediaKey、真实 sender 派生的 source tab/frame、bounded timestamp 和 event ID；不持久化、不外联、
不自动控制其他页面。发送失败不改变本地命令结果。

## 7. 供应链与构建

- 锁定 package manager、Node、包管理器和 lockfile 版本。
- PR 检查依赖漏洞、许可证兼容性、恶意包/安装脚本变化和 transitive diff。
- 发布生成 SBOM、许可证清单、提交 SHA、构建环境摘要和产物 hash。
- source map 不随公开包暴露敏感源码；内部诊断包按权限保存。
- 生产构建关闭开发 server、调试开关和未使用权限。

Phase 6 执行基线：

- package.json 为基础版本单一源；Node `24.13.0`、pnpm `11.21.0`、WXT `0.21.3` 和 GitHub Actions commit SHA 固定。
- PR/nightly/RC workflow 只有 `contents: read`，冻结安装；RC 不执行 tag、push、商店 upload/sign。
- 自有 ZIP writer/reader 拒绝路径穿越、隐藏/重复/前缀重叠 entry、symlink、source map、local range 重叠、header 漂移、
  多磁盘、extra/comment/trailing metadata；所有普通文件 mode 固定为 `100644`。
- artifact inspection 对 manifest 顶层 capability 采用 allowlist，并精确检查 required/optional API、hosts、CSP、action/options、
  Firefox metadata、background 差异、static content scripts/WAR、入口和禁止代码；源码/构建扫描同步执行同一安全边界。
- SPDX 2.3 覆盖运行时依赖闭包；许可证 allowlist 为 MIT、Apache-2.0、BSD-2-Clause、BSD-3-Clause、ISC，其他表达式阻断人工复核。
- provenance 为 unsigned in-toto/SLSA-compatible metadata，只描述输入与 digest，不冒充 GitHub OIDC、维护者签名或商店签名。
- 正式候选必须 clean worktree；本地 `--allow-dirty` 产物只能用于工程验证并明确记录 `sourceTreeClean: false`。

## 8. 威胁模型用例

| 威胁                   | 影响                    | 防护                                                                                                                                         | 验证                                                 |
| ---------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 页面伪造 setValue 消息 | 篡改配置                | nonce + typed bridge + sender check                                                                                                          | security E2E                                         |
| 恶意页面触发下载       | 本地文件滥用            | content settings + trusted intent + user activation；最终 anchor/fetch sink 位于 isolated content，保留 hostile-page 验收                    | adversarial test                                     |
| XSS 进入 popup/options | 扩展权限窃取            | 安全渲染、CSP、Schema、无 innerHTML                                                                                                          | static + E2E                                         |
| CSP 绕过导致任意脚本   | 页面/扩展被利用         | 删除改写规则和动态执行                                                                                                                       | forbidden scan                                       |
| worker 重启丢配置      | 数据损失                | storage authority + backup/migration                                                                                                         | restart test                                         |
| 依赖供应链投毒         | 全量用户影响            | lockfile、审计、SBOM、review                                                                                                                 | release gate                                         |
| 诊断包泄露 URL/内容    | 隐私泄露                | 默认脱敏、预览、用户确认                                                                                                                     | redaction test                                       |
| 站点 Hook 被污染       | 功能/安全异常           | 原始引用、能力隔离、teardown                                                                                                                 | hostile fixture                                      |
| 大截图耗尽消息/内存    | 卡顿或命令失败          | 像素/维度/4 MiB 上限、encode timeout、二次校验                                                                                               | capture unit + budget/risk                           |
| 进度泄露观看 URL       | 隐私泄露                | 匿名 identity、默认关闭、TTL/容量、raw-source import 拒绝                                                                                    | progress tests                                       |
| 页面干扰 Overlay 事件  | 操作冲突                | per-media anchor、closed ShadowRoot、event isolation、无秘密输入、可停用                                                                     | component/runtime lifecycle + ADR-0009/0015          |
| 页面伪造实验配置/下载  | 安装 Hook、触发本地保存 | 当前：默认关闭、bounded capture、trusted hotkey、content settings gate、user activation；MAIN 仅 capture/prepare，isolated content 执行 sink | unit/integration 已有；EXT-154 hostile/live E2E 待补 |

## 9. 安全发布门槛

- Critical/High 漏洞为 0，或有 Security Reviewer 明确接受和短期缓解。
- 当前构建链 `image-size@2.0.2` 的 GHSA-w3rx-r6r6-pgpr、GHSA-5p2g-fcmc-qvqq 尚无已发布修复版本；CI 必须审计完整
  dev/build closure，只能按 RISK-027 精确忽略这两个 ID。该临时接受不等于 High=0，修复版本出现后立即到期，且 Stable
  Go/No-Go 必须重新裁决。
- 禁止模式扫描为 0 命中（测试 fixture 中的示例需有白名单路径且不进产物）。
- 权限列表、商店描述、隐私政策和实际代码调用点一致。
- 安全回归和升级/卸载数据处理已演练。
- 候选 bundle byte reproducibility、checksum、SBOM/license/provenance 和 ZIP metadata 检查通过。
- 真实商店签名、账号/环境保护、headed 权限 UX 和 rollback/forward-fix 仍是外部 Stable 门禁，仓库自动化不得伪造其状态。
