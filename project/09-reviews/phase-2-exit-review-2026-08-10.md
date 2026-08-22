# Phase 2 Exit Review（2026-08-10）

> 文档 ID：REVIEW-004  
> 状态：Approved  
> Reviewers：Product / Architecture / Quality / Security / Release  
> 关联：ADR-0002、ADR-0004、ADR-0005、ADR-0006、EXT-040..051

## 目标与范围

在不修改 Legacy 油猴主线的前提下，完成 Web Extension 从页面媒体发现、生命周期管理到核心命令
执行和最小 Popup 控制的真实扩展纵向切片。本评审只覆盖 Tier 0 通用 HTMLMediaElement 与固定
fixture；不宣告站点 adapter、快捷键编辑器、真实站点权限 onboarding、视觉增强或发布资格完成。

## 完成交付

| Task    | 状态     | 主要证据                                                                                                                           |
| ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| EXT-040 | Verified | `src/domain/media` model/schema/invariants；`tests/unit/media-model.spec.ts`                                                       |
| EXT-041 | Verified | `src/infrastructure/dom` discovery/teardown；`tests/integration/media-discovery.spec.ts`；SPA/Shadow/churn E2E                     |
| EXT-042 | Verified | `src/domain/adapter/active-player-scoring.ts`；multi-player unit/E2E                                                               |
| EXT-043 | Verified | `src/adapters/generic` native bindings/controller；generic adapter unit + dual-browser core E2E                                    |
| EXT-044 | Verified | `src/domain/command` registry/schema/error；`tests/unit/command-registry.spec.ts`                                                  |
| EXT-045 | Verified | play/pause/seek handlers；Chrome E2E + Firefox Selenium core E2E                                                                   |
| EXT-046 | Verified | rate/volume/mute handlers；Legacy differential + dual-browser E2E                                                                  |
| EXT-047 | Verified | declarative MAIN/content runtime、幂等 marker、frame teardown；hostile/CSP/iframe tests                                            |
| EXT-048 | Verified | page-media/runtime/tab protocol schemas；Popup state integration/E2E                                                               |
| EXT-049 | Verified | `tests/baselines/legacy-core-media.json` + `tests/compatibility/core-media-differential.spec.ts`，13 cases + oracle integrity test |
| EXT-050 | Verified | 30 分钟 media churn：8056 cycles、161 worker restarts、listener 上界稳定                                                           |
| EXT-051 | Verified | `scripts/firefox-e2e.ts`；Firefox 153.0 临时 MV3 安装和 6 类核心命令                                                               |

## 退出条件核对

- [x] P0 核心命令在 basic/multi/SPA/Shadow/iframe fixtures 通过；Chrome 覆盖完整 fixture 矩阵，
      Firefox 覆盖真实扩展 basic core smoke。
- [x] 30 分钟 churn 无 listener/session 单调增长：listener `4→4`，媒体移除后 state 数量回到 0，
      heap 在测试预算内（`3,353,988→5,559,956` bytes）。
- [x] Legacy 核心命令差分通过；所有已登记精度/步长/解除静音语义均有 oracle，未引入未批准差异。
- [x] Chrome/Firefox 核心真实扩展 E2E 全绿；Firefox 不是仅 `web-ext lint`，而是 Selenium 临时安装
      unpacked MV3 后实际访问 fixture、Popup 和命令链。
- [x] required permission 仍只有 `storage`；没有新增 `tabs`、`activeTab`、网络拦截、下载或 required
      host permission。
- [x] Legacy SHA-256、大小和构建 diff 与冻结基线一致。
- [x] `EXT-040`～`EXT-051`、需求追踪矩阵、风险台账、ADR、进度和 backlog 已同步。

## 测试与指标

| 检查                      | 结果                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| Format / lint / typecheck | Passed                                                                                   |
| Unit                      | 21 files / 73 tests                                                                      |
| Component                 | 1 file / 2 tests                                                                         |
| Integration               | 5 files / 32 tests                                                                       |
| Compatibility             | 2 files / 21 tests                                                                       |
| Coverage                  | Statements 88.53%；Branches 77.53%；Functions 92.58%；Lines 91.67%                       |
| Core domain/application   | lines ≥85%、branches ≥80% 门槛通过                                                       |
| Security                  | 83 source/output files + 2 manifests；security tests 2 passed                            |
| Boundaries                | 66 modules / 176 dependencies；0 violations                                              |
| Chrome E2E                | 3 passed；basic/worker restart、multi/SPA/Shadow、hostile/CSP/iframe                     |
| Firefox E2E               | Firefox 153.0；`FIREFOX_EXTENSION_E2E_RESULT`；seek/rate/volume/mute/play/pause          |
| Firefox lint              | 0 errors；1 条已知 Vue runtime warning                                                   |
| Churn smoke               | 5 秒：109 cycles、2 restarts、listeners 4→4                                              |
| Churn long run            | 1800711 ms、8056 cycles、161 restarts、listeners 4→4、heap 3353988→5559956               |
| Artifact                  | Chrome 262755 bytes；Firefox 262750 bytes                                                |
| Legacy                    | SHA-256 `91b5312d7cf150cd852d005b1e5d5f3d8ed2ed7cd8a481dfa1d561d48f7b3f27`；561788 bytes |

## 架构审查

- 页面层分为声明式 MAIN world、isolated content 和 background；`page-main.content.ts` 在
  `document_start`/`allFrames` 运行，生产链路不再依赖异步 `injectScript()` 或 WAR（ADR-0006）。
- 原生媒体 prototype/accessor 在 page-main 模块加载时捕获；generic adapter 不信任页面后续替换，
  跨上下文只传 Zod 校验的快照、命令和固定错误。
- discovery service 对 Mutation/Resize/Intersection/document observer、controller subscription、
  Shadow hook 和 frame runtime 提供显式 teardown；generation guard 防止异步 flush 在 teardown 后回写。
- active player scoring 使用当前媒体、焦点、可见性、交互时间和 discovery order；并列时保持现任 player
  以降低生命周期 churn。
- command registry 按 mediaId 串行化执行，先校验 snapshot/capability，再校验 handler result；Popup
  只通过 `RuntimeApiPort`/协议调用，不直接访问 browser、DOM 或 Legacy。
- service worker 内存不是设置事实源；重启 E2E 证明 storage revision 和页面连接可重建。

## 安全审查

- manifest allowlist、源码/双浏览器产物扫描通过；无 `eval`、`Function`、远程脚本、unsafe-eval、CSP
  放宽或业务 innerHTML assignment。
- Firefox 测试使用 geckodriver 的 `--allow-system-access` 仅作为本地自动化 harness 打开后台 Popup
  tab；该参数不进入扩展 manifest、生产代码或用户权限。
- MAIN world nonce 只做 session correlation/replay control，不被当作同 realm 页面脚本的秘密；页面数据
  仍经过 content/background Schema 与 sender policy。
- 已知 `UNSAFE_VAR_ASSIGNMENT` 来自 Vue 生成 runtime，未对业务代码设置宽泛豁免；Phase 3 Exit 前继续
  跟踪版本升级或替代构建策略。

## 遗留问题与风险

1. Firefox 当前自动化版本为 153.0；最低 142.0、Firefox ESR、Edge 尚未纳入本阶段执行矩阵，Stable 前
   由 Quality Owner 补齐。
2. content script matches 仍只覆盖 localhost fixture；Phase 3 完成显式 optional host onboarding、
   拒绝/撤销路径和商店权限文案后才扩大真实站点范围。
3. Legacy 默认快捷键只作为冻结 oracle；快捷键解释器、冲突编辑和输入框/重复键策略属于 Phase 3。
4. Tier 1 站点 adapter（YouTube/Bilibili/Tencent/iQIYI/Youku）属于 Phase 5，本阶段不宣告站点兼容。
5. WXT 0.x、Vue runtime lint warning 和跨平台产物复现继续按风险/发布门禁跟踪。

## 验证命令

```bash
cd web-extension
corepack pnpm@11.21.0 check
corepack pnpm@11.21.0 test:coverage
corepack pnpm@11.21.0 test:e2e
corepack pnpm@11.21.0 test:e2e:firefox
corepack pnpm@11.21.0 test:churn:smoke
corepack pnpm@11.21.0 test:churn
corepack pnpm@11.21.0 test:legacy
```

## 结论

`GO`

上述门禁已在当前工作树重新执行并保持全绿，批准进入 Phase 3。该结论不批准修改 Legacy 主线、
不批准扩大真实站点权限，也不批准提前抽取共享核心。
