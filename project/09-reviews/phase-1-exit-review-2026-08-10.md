# Phase 1 Exit Review（2026-08-10）

> 文档 ID：REVIEW-003  
> 状态：Approved  
> Reviewers：Architecture / Security / Data / Quality / Product

## 目标与范围

先完成跨上下文契约、配置权威与安全边界，使 Phase 2 之后的媒体功能没有理由绕过 Schema、sender、Ports 或 repository。本阶段不宣告媒体控制功能完成，也不扩大真实站点运行范围。

## 完成交付

| Task         | 状态     | 主要证据                                                                        |
| ------------ | -------- | ------------------------------------------------------------------------------- |
| EXT-020      | Verified | protocol v1 Envelope、response/error、strict Schema、correlation tests          |
| EXT-021      | Verified | 256-bit nonce、origin/source/session/frame、replay guard、bridge/security tests |
| EXT-022      | Verified | timeout、AbortSignal、scoped cancel、reconnect/new ID、真实 worker restart E2E  |
| EXT-023      | Verified | runtime/storage/tabs/permissions/time/logger Ports；dependency rules            |
| EXT-024～025 | Verified | Settings V1/default/resolve/patch/revision/rebase/concurrent writer tests       |
| EXT-026～027 | Verified | N/N-1/corrupt/future、checksum backup、atomic import/export/rollback            |
| EXT-028～029 | Verified | permission inventory、MV3 manifest allowlist、forbidden-code/output scan        |
| EXT-030      | Verified | structured local ring logger and redaction tests                                |
| EXT-031      | Verified | forged sender/type/payload/tab/frame/nonce/replay/oversize adversarial tests    |
| EXT-032      | Verified | 本评审、ADR、风险、追踪、backlog 和 progress 同步                               |

## 退出条件核对

- [x] 页面伪造消息、错误 payload、未知 type、错误 nonce/session 和重复 requestId 被安全拒绝或忽略。
- [x] content/popup/options 具有独立 source allowlist；background 使用真实 extension ID/URL/tab/frame 授权，不信任 request 自报上下文。
- [x] 多调用方并发写不同配置路径不丢失，落后 revision 明确返回 `rebased`。
- [x] Chromium 中实际终止 extension service worker 后，Popup 能从 storage 恢复 revision 和设置。
- [x] Settings V1 的 N、N-1、损坏、future schema、备份、导入失败原子性和 rollback 测试通过。
- [x] manifest 不含 `webRequestBlocking`、`declarativeNetRequest`、downloads、clipboard、tabs 或 required all-sites 权限。
- [x] 源码与双浏览器产物不含 `eval`、Function constructor、远程脚本、Data URI script、unsafe-eval 或 CSP 放宽。
- [x] Domain/Application/UI 依赖边界和循环依赖扫描通过。
- [x] `EXT-020`～`EXT-032` 全部 Verified。

## 测试与指标

| 检查                  | 结果                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------- |
| Unit                  | 10 files / 23 tests passed                                                               |
| Component             | 1 file / 1 test passed                                                                   |
| Integration           | 3 files / 21 tests passed                                                                |
| Compatibility         | 7 fixtures passed                                                                        |
| Adversarial security  | 2 tests passed                                                                           |
| Coverage              | Statements 87.80%；Branches 76.43%；Functions 94.40%；Lines 92.03%                       |
| Protocol coverage     | 100% statements/lines/functions；90.9% branches                                          |
| Storage module        | 90.58% statements；78.35% branches；96.66% functions；97.26% lines                       |
| Chromium E2E          | 1 real-extension scenario passed：bridge/runtime/UI/settings/worker restart              |
| Firefox               | MV3 build passed；`web-ext lint` 0 errors / 1 known Vue warning                          |
| Security scan         | 58 source/output files and 2 manifests passed                                            |
| Dependency boundaries | 43 modules / 100 dependencies，0 violations                                              |
| Artifact footprint    | Chrome/Firefox unpacked output 199.99 KB each                                            |
| Legacy regression     | SHA-256 `91b5312d7cf150cd852d005b1e5d5f3d8ed2ed7cd8a481dfa1d561d48f7b3f27`；561788 bytes |

验证命令：

```bash
cd web-extension
corepack pnpm@11.21.0 check
corepack pnpm@11.21.0 test:coverage
corepack pnpm@11.21.0 build:all
corepack pnpm@11.21.0 test:e2e
corepack pnpm@11.21.0 test:e2e:firefox
corepack pnpm@11.21.0 test:legacy
cd ..
corepack yarn@3.7.0 build
```

## 架构审查

- Runtime contract、Settings contract 和 Browser Ports 已分别落在 shared/application/infrastructure/runtime 层，dependency-cruiser 阻止反向依赖。
- UI 通过 `RuntimeApiPort` 获取能力，不直接导入 browser/WXT/storage。
- background repository 是设置唯一权威；页面没有 localStorage/GM 双写。
- request retry 使用新 requestId；service worker 内存不作为配置、迁移或授权的持久化事实源。
- Phase 2 必须扩展现有 bridge message union 和 command capability，而不能引入第二套 postMessage/runtime message 格式。

## 安全审查

- MAIN world nonce 被正确限定为 session correlation/replay control。由于同 realm 站点脚本可观察页面通信，它不是特权凭据；页面桥当前无 storage/download/permissions 映射。
- Popup/Options 的身份由 extension ID + 精确 URL 验证。真实 Chromium 证明测试 Tab 会提供 `sender.tab`，策略不依赖错误的“扩展页必无 tab”假设。
- `<all_urls>` 只在 optional host permissions；未实现授权 UX 前静态运行范围仅 fixture。
- Logger 与 error response 不包含 stack、原始 import、query/fragment、title、token/cookie/media source。

## 遗留问题与风险

1. Firefox 真扩展 E2E 尚未落地。Owner：Quality；期限：Phase 2 Exit；Stable 前不可豁免。
2. V8 branch coverage 76.43% 通过当前 75% 门禁，但低于 Stable 最终目标。Owner：Quality；后续每阶段保持不回退，并优先补 request/background/bridge failure branches。
3. 跨上下文 settings live subscription 尚未接入 UI；repository event 已存在，Phase 3 实现 UI 同步。
4. Permission onboarding 和真实站点 content registration 尚未实现；Owner：Runtime/Product；Preview 扩大站点范围前完成。
5. Firefox Vue runtime `UNSAFE_VAR_ASSIGNMENT` warning 继续精确跟踪，禁止业务源码豁免。

## 结论

`GO`

批准进入 Phase 2 通用媒体核心。批准条件是复用本阶段平台内核，并把 Firefox 真浏览器 E2E、branch coverage 和权限 onboarding 作为后续明确任务；不批准扩大 Legacy 改动范围。
