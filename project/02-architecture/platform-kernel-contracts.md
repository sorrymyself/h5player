# Phase 1 平台内核契约

> 文档 ID：ARCH-006  
> 状态：Approved  
> 负责人：Architecture / Runtime / Data Owner  
> 最后更新：2026-08-10  
> 关联：ADR-0002、ADR-0003、ADR-0005、EXT-020..032

## 1. 目的

本文件记录 Phase 1 已实现、后续功能必须复用的平台契约。媒体、快捷键、UI 和站点适配不得绕过这些边界直接调用浏览器 API、storage 或任意 `postMessage`。

## 2. Runtime Envelope

所有 extension runtime 请求使用协议版本 `1`，包含：

```ts
type RuntimeRequestEnvelope = {
  protocol: 1;
  type: RuntimeRequestType;
  requestId: string;
  source: "content" | "popup" | "options";
  tabId?: number;
  frameId?: number;
  sessionId?: string;
  nonce?: string;
  payload: unknown;
};
```

`requestId` 至少 16 字符；外部输入先由严格 Envelope Schema 解析，再由每个 `type` 的 payload Schema 解析。响应统一为 `protocol.response` 或 `protocol.error`，错误只暴露固定 code、message key 和 retryable，不传 Error、stack、URL 或原始数据。

Phase 1 注册的请求：`system.ping`、`settings.get/update/export/import/restore-backup`、`protocol.cancel`。未知 type、未知字段、错误协议版本、无效 nonce/session 和错误 payload 安全拒绝。

## 3. Sender 与能力矩阵

| Source  | 真实 sender 要求                                                  | 允许请求                                |
| ------- | ----------------------------------------------------------------- | --------------------------------------- |
| content | `sender.id` 为当前扩展；真实 tab/frame 存在；request 有 sessionId | ping、settings.get、取消自身请求        |
| popup   | 当前扩展的 `/popup.html`；可位于浏览器 popup 或测试 Tab           | ping、settings.get/update、取消自身请求 |
| options | 当前扩展的 `/options.html`                                        | 全部 settings 管理操作和取消自身请求    |

background 不信任 request 自报的 tab/frame；若携带，必须与真实 sender 一致。Popup/Options 不得携带 tab/frame/session/nonce。重放键包含 source、真实 sender context、session 和 requestId，默认保存 5 分钟并有容量上限。

页面 MAIN world 永远不直接进入 runtime API。Phase 1 页面桥只允许 `bridge.init/ready/ping/pong/dispose`，没有 storage、permissions、tabs、download 或任意命令映射。

## 4. 页面桥握手

1. isolated content 与声明式 MAIN world 入口均在 `document_start`、`allFrames` 启动；content 生成 session ID 和 256-bit 随机 nonce，先注册 listener。
2. content 发送 `bridge.init`；page-main 绑定首个 session 并返回同 requestId 的 `bridge.ready`。生产入口不调用运行时 `injectScript()`，也不依赖 WAR。
3. content 校验 `event.source === window`、精确 origin、协议、source、session、nonce、requestId/replay 后才建立连接。
4. frame 失效或 content teardown 时发送 `bridge.dispose` 并移除 listener。

重要边界：MAIN world 与站点脚本处于同一 JavaScript realm，nonce 只能关联当前 document/session、拒绝误路由和陈旧重放，不能作为对同页恶意脚本的绝对身份秘密。因此 MAIN→content 数据仍按不可信输入处理，且页面桥不得触发扩展特权；真正授权发生在 content allowlist 与 background sender/capability 校验。

## 5. 请求生命周期

- 默认超时 5 秒，可由调用方传入 `AbortSignal`。
- 超时或取消会发送 `protocol.cancel`；background 只允许同 sender scope 取消对应 requestId。
- transport 唤醒失败时，客户端调用 reconnect 并使用新 requestId 最多重试一次，避免旧 requestId 被重放保护拒绝。
- response 必须匹配 requestId、request type、background source；content 还校验响应 sessionId。
- service worker 内存中的 replay/in-flight 状态允许丢失；持久化设置不依赖该内存，重新请求即可恢复。

## 6. Browser Ports

公共抽象位于 `src/application/ports/`：

- `BrowserStoragePort`
- `RuntimeTransportPort`
- `TabsPort`
- `PermissionsPort`
- `ClockPort` / `SchedulerPort`
- `LoggerPort`

WXT/WebExtension 具体实现只位于 `src/infrastructure/browser/`。Domain 和 Application 的依赖边界由 dependency-cruiser 阻断，UI 只接收 `RuntimeApiPort`，不导入 `browser`、WXT 或 infrastructure。

## 7. Settings V1

权威 key：

```text
h5player.web-extension.settings
h5player.web-extension.settings.backup
```

主数据 Envelope 固定 `schema: 'h5player.web-extension'`、`schemaVersion: 1`、递增 `revision`、`updatedAt` 和严格 `data`。数据包含 global、sites、progress 三个命名空间；Phase 1 只开放 global/sites mutation，progress 由后续受控仓储使用。

写入规则：

1. background 单一 repository 对 mutation 排队；每次操作重新读取权威值。
2. patch 只修改显式字段，两个 Tab 修改不同路径不会整包覆盖。
3. `expectedRevision` 落后时在最新数据上重放字段 patch，响应 `rebased: true`；相同字段采用队列中的后写值。
4. 无实际变化不增加 revision。
5. 事件只包含 revision、changedPaths 和 source，不发布整份设置。

## 8. 迁移、备份、导入与回滚

- N：严格解析 V1；N-1：纯函数迁移 V0→V1并先保存 raw backup。
- 损坏数据：保存带 checksum 的 raw backup，写安全默认值并记录脱敏告警。
- Future schema：返回 `FUTURE_SCHEMA`，不得覆盖、迁移或创建替代数据。
- 导入：上限 256 KiB，JSON + strict Schema +规范化 site origin 校验；失败零写入。
- 成功导入：同一次 storage set 写当前备份和新 Envelope；restore 使用 checksum、重新校验 Schema，并以新 revision 恢复。
- 导出：只包含设置 Schema 数据和时间，不包含日志、完整 URL、页面标题、媒体源、token、cookie 或权限名。

## 9. Structured logging

记录字段为 timestamp、level、runtime context、module、eventCode、correlationId 和有限 details。内存 ring buffer 默认 200 条、限制递归深度/数组/对象数量/字符串长度；URL query/fragment、title、text、media source、token、cookie、authorization 等字段自动移除。默认无网络上传。

## 10. 验证入口

- Protocol/security：`tests/unit/protocol.spec.ts`、`tests/security/adversarial-messages.spec.ts`
- Bridge/replay：`tests/unit/bridge-security.spec.ts`、`tests/integration/page-runtime.spec.ts`
- Request lifecycle：`tests/unit/request-client.spec.ts`
- Settings/migration/concurrency：`tests/unit/settings-*.spec.ts`、`tests/integration/settings-repository.spec.ts`
- Background sender/capability：`tests/integration/background-contract.spec.ts`
- Worker restart：`tests/e2e/extension-smoke.spec.ts`
- Manifest/forbidden patterns：`scripts/security-scan.ts`
