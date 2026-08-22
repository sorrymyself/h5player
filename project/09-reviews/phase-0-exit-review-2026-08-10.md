# Phase 0 Exit Review（2026-08-10）

> 文档 ID：REVIEW-002  
> 状态：Approved  
> Reviewers：Product / Architecture / Quality / Security / Release

## 目标与范围

在不修改 Legacy 油猴源码、Yarn/Rollup 选择、构建命令或产物语义的前提下，为绿地 Web Extension 建立可独立安装、类型检查、测试、构建和审查的工程闭环。本阶段只验证运行上下文和工具链，不迁移业务功能。

## 完成交付

| Task             | 状态     | 证据                                                                   |
| ---------------- | -------- | ---------------------------------------------------------------------- |
| EXT-001～EXT-002 | Verified | 独立 WXT 多入口、Chrome/Firefox MV3、TypeScript strict                 |
| EXT-003～EXT-004 | Verified | ESLint/Prettier/dependency-cruiser、Vitest/coverage                    |
| EXT-005～EXT-006 | Verified | Chromium 真扩展 Playwright smoke；Firefox build + `web-ext lint` spike |
| EXT-007～EXT-008 | Verified | basic/multi/SPA/Shadow/iframe/hostile/CSP 固定 fixtures                |
| EXT-009          | Verified | Legacy userscript、快捷键和允许差异 baselines                          |
| EXT-010～EXT-011 | Verified | 双构建 CI、固定环境/产物目录/source map 约束                           |
| EXT-012          | Verified | 本评审及 ADR、风险、进度、backlog 同步                                 |

## 退出条件核对

- [x] Chrome 与 Firefox MV3 dev/build 包生成；background、content、page-main、popup、options 入口齐全。
- [x] Chromium 真实 unpacked extension smoke 覆盖 service worker、isolated content、MAIN world bridge 和 popup。
- [x] Firefox 包通过 `web-ext lint`，0 errors；浏览器级自动化缺口已登记，不误报为完整 E2E。
- [x] Legacy `corepack yarn@3.7.0 build` 成功，产物 SHA/size 与 Git diff 未变化。
- [x] 新业务代码全部为 TypeScript/Vue TypeScript，strict、no-explicit-any 和 unsafe lint 基线通过。
- [x] dependency-cruiser 无循环依赖或 domain → runtime/UI/framework 越界。
- [x] 固定 fixture、Legacy 行为 Oracle、CI 和基础安全扫描已建立。
- [x] `EXT-001`～`EXT-012` 全部标记 Verified。

## 指标与测试结果

| 检查                      | 结果                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| Format / lint / typecheck | Passed                                                                                   |
| Unit                      | 3 files，5 tests passed                                                                  |
| Component                 | 1 test passed                                                                            |
| Integration               | 1 test passed                                                                            |
| Compatibility             | 7 fixture checks passed                                                                  |
| Coverage                  | Statements 80.95%；Branches 90%；Functions 80%；Lines 83.33%                             |
| Chromium E2E              | 1 real-extension smoke passed                                                            |
| Firefox                   | MV3 build passed；`web-ext lint` 0 errors / 1 known warning                              |
| Security scan             | 30 source/output files passed；禁止动态执行、远程脚本、Data URI、CSP 放宽                |
| Dependency boundaries     | 15 modules cruised，0 violations                                                         |
| Legacy regression         | SHA-256 `91b5312d7cf150cd852d005b1e5d5f3d8ed2ed7cd8a481dfa1d561d48f7b3f27`；561788 bytes |
| Artifact footprint        | Chrome and Firefox unpacked outputs are about 106.49 KB each                             |

执行命令：

```bash
cd web-extension
corepack pnpm@11.21.0 check
corepack pnpm@11.21.0 build:all
corepack pnpm@11.21.0 test:coverage
corepack pnpm@11.21.0 test:e2e
corepack pnpm@11.21.0 test:e2e:firefox
corepack pnpm@11.21.0 test:legacy
cd ..
corepack yarn@3.7.0 build
```

## 架构与安全结论

- 接受 WXT/Vite、TypeScript、Vue presentation、Vitest、Playwright、Zod Mini 和独立 pnpm package，详见 ADR-0004。
- MAIN-world 通过 `defineUnlistedScript` + `injectScript` + 精确 `web_accessible_resources` 注入；禁止恢复 Legacy 的 CSP 修改、inline/Data URI/`Function` 兜底。
- manifest 当前只有 `storage` 常规权限和 `<all_urls>` 可选 host permission；实际授权与能力检查必须在 Phase 1 完成。
- 普通 Zod 产物的 JIT 检测不符合动态执行禁令，已切换 `zod/mini` 并用构建产物扫描保护。

## 遗留问题与风险

1. `web-ext lint` 的 `UNSAFE_VAR_ASSIGNMENT` warning 位于 Vue runtime 静态 `innerHTML` 优化代码。Owner：UI/Build；处理期限：Phase 3 Exit；不得为业务源码增加通配豁免。
2. Firefox 真浏览器扩展 E2E 尚未进入自动门禁。Owner：Quality；处理期限：Phase 2 Exit，Stable 前必须覆盖目标 stable/ESR。
3. WXT 为 `0.x`。Owner：Build；升级仅限独立 PR，并要求 manifest diff、双浏览器构建和 E2E。
4. service worker 恢复、消息攻击、配置损坏与并发写仍未实现，分别由 Phase 1 `EXT-020`～`EXT-031` 阻断后续业务迁移。

## 结论

`GO`

批准进入 Phase 1。该结论只表示工程脚手架满足下一阶段开发条件，不表示扩展已具备可发布功能，也不批准修改 Legacy 主线。
