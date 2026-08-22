# ADR-0010：截图 Artifact 与权限边界

> 状态：Accepted for Preview  
> 日期：2026-08-11  
> 决策人：Architecture / Security / Product Owner  
> 关联：EXT-083、FR-MEDIA-001、RISK-019

## 背景

Legacy 截图能力依赖 Canvas。Web Extension 需要在不修改媒体 `crossorigin`、不放宽 CSP、也不新增
`downloads`/`clipboardWrite` 权限的前提下提供用户触发截图，并对 CORS、DRM 和未就绪画面给出可解释失败。

## 决策

1. Canvas draw/encode 在 MAIN world generic adapter 执行，不修改 `<video crossorigin>`。
2. 截图命令固定为 typed `media.capture`，输入只允许 PNG/JPEG 和 `[0,1]` quality。
3. Artifact 上限：8192×8192、16,777,216 pixels、4 MiB 二进制；包含 MIME、宽高、byteLength、base64。
4. isolated content 再次校验 Schema、base64 字符集和解码长度，以 Blob + 临时 `<a download>` 保存；随后撤销
   object URL。
5. 不申请 `downloads`、`clipboardWrite`，不允许页面消息直接触发任意 URL/文件名下载。
6. CORS/受保护媒体、readyState、尺寸、Canvas context、encode timeout/null blob 等错误转换为有限错误码，不返回
   原始 source URL 或浏览器异常堆栈。

## 后果与限制

- 权限面保持不变，用户操作路径清晰。
- 4 MiB 二进制经过 base64 后通用命令响应可能约 5.6 MiB；这是 Preview 可接受但必须监控的消息体风险。
- Preview 只在当前 content session 内传递 Artifact，不经过 background 跨 Tab 广播。
- Beta 前应评估降低上限、分块/专用二进制通道或在 MAIN/isolated 边界就地消费的方案。
- CORS/DRM 失败是浏览器安全模型的一部分，不能通过修改 CSP、强制 crossorigin 或代理远程媒体绕过。

## 验证

- `tests/unit/visual-media-commands.spec.ts`
- `tests/unit/download-capture.spec.ts`
- `src/adapters/generic/native-capture-bindings.ts` 的边界分支
- security scan、manifest 权限清单和双浏览器构建检查

