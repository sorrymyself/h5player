# Phase 6.5 长稳态 Churn 与 Legacy 构建隔离审查（2026-08-22）

> 文档 ID：REVIEW-019  
> 状态：Engineering Evidence Passed / UX NO-GO  
> 负责人：Project Owner / Quality Owner / Release Owner  
> 关联：EXT-137、EXT-139、UX-ACC-002、UX-ACC-015、UX-ACC-019、UQA-005  
> 范围：增强诊断 30 分钟 churn、Legacy 冻结构建校验的工作树隔离；不修改 Legacy 源码和冻结产物

## 1. 结论

本轮关闭了两个工程证据缺口：

1. 增强诊断版本的 30 分钟媒体 churn 完整通过，证明 host、observer、timer、authority binding、worker restart 与 Long Task 诊断在长时间媒体插拔下保持有界；
2. `test:legacy` 改为在冻结提交的 detached 临时 worktree 中安装依赖和构建，主工作树的 Legacy 产物不再被校验过程改写；成功、失败、源漂移和哈希不匹配均经过统一清理。

本轮判定：`ENGINEERING EVIDENCE PASSED / UX NO-GO / PHASE 7 HOLD / STABLE NO-GO`。

## 2. 30 分钟 Churn 证据

固定工具链：Node `24.13.0`、pnpm `11.21.0`、Chromium extension E2E。

| 指标                     | 结果                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 持续时间                 | `1,801,716 ms`（约 30 分钟）                                                                                                 |
| 媒体 churn 周期          | `903`                                                                                                                        |
| worker restart           | `19`（populated `10`、empty `9`）                                                                                            |
| listeners                | baseline `5`、maximum `5`                                                                                                    |
| hosts                    | baseline `2`、maximum `3`；每轮 teardown 后回到基线                                                                          |
| worker target            | 19 次 generation transition，target ID 复用场景均被正确识别                                                                  |
| observer/timer/authority | pending mount、feedback/presentation timer 和 authority binding 回零；discovery/anchor observer 回到预期 baseline |
| Long Task                | `count=0`、`duration=0`                                                                                                      |
| heap                     | baseline `5,704,420`、final `11,875,892`；最近窗口均值 `10,811,966 -> 11,586,804`，未触发测试宽限额                          |
| 结果                     | Playwright `1 passed`，无断言失败或早退                                                                                      |

该结果关闭 UQA-005 的“增强诊断连续 30 分钟”部分，并为 UX-ACC-002/015/019 提供工程长稳态证据。它不等于真实站点登录态、广告态、换集、Firefox headed 或用户 UX 签字通过。

## 3. Legacy 构建隔离

`web-extension/scripts/verify-legacy-build.ts` 现在调用 `scripts/legacy/legacy-build-verifier.ts`：

- 从 `legacy-userscript.json` 读取冻结提交、Node/Yarn 版本、artifact hash/size 与 Legacy source paths；
- 先检查冻结提交到当前 `HEAD` 以及当前工作树的 Legacy source paths 无漂移；
- `git worktree add --detach <tmp> 0571852`，在临时 checkout 中执行 `yarn install --immutable` 和 `yarn build`；
- 在临时 checkout 内校验 SHA-256、字节数和 artifact diff；
- `finally` 中强制移除 detached worktree 和临时目录；
- 真实回归测试覆盖成功、构建失败、源漂移三条路径，确保主工作树 `dist/h5player.user.js` 保持不变。

冻结基线复核结果：SHA-256 `91b5312d7cf150cd852d005b1e5d5f3d8ed2ed7cd8a481dfa1d561d48f7b3f27`，`561788` bytes；校验前后主工作树状态和产物哈希一致。

## 4. 任务与门禁更新

- `EXT-137`：增强诊断 30 分钟工程证据已通过；继续保留 Firefox headed UX 和外部站点验收为剩余条件。
- `UQA-005`：由 `PARTIAL / enhanced rerun pending` 更新为 `PASS`。
- `UX-ACC-002/015/019`：长稳态工程证据补齐，但仍不能替代 headed 几何、宿主碰撞和真实站点矩阵证据。
- `EXT-139`：继续 `HOLD / Exit Review pending`，等待 Firefox headed、站点/宿主 UI 风险和用户签字。
- Phase 7：继续 `HOLD`；Stable：继续 `NO-GO`；Legacy：继续冻结。

## 5. 验证命令

```bash
corepack pnpm@11.21.0 test:churn
corepack pnpm@11.21.0 test:legacy
corepack pnpm@11.21.0 exec vitest run tests/unit/legacy-build-verifier.spec.ts
corepack pnpm@11.21.0 typecheck
corepack pnpm@11.21.0 exec eslint scripts/legacy/legacy-build-verifier.ts scripts/verify-legacy-build.ts tests/unit/legacy-build-verifier.spec.ts --max-warnings=0
```
