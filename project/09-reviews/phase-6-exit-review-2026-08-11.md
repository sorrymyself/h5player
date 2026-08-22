# Phase 6 Exit Review（2026-08-11）

> 文档 ID：REVIEW-008
>
> 状态：Approved / Release Engineering Conditional GO / Stable NO-GO
>
> 评审责任：Project / Architecture / Security / Quality / Release Owner
>
> 最后更新：2026-08-12
>
> 关联：EXT-120～127、ADR-0014、RISK-015、RISK-024～027
>
> 评审范围：repository 发布工程能力与本地候选证据，不是实际 Beta、商店提交、签名或 Stable 发布审查

## 1. 结论摘要

Phase 6 已建立独立 Web Extension 的版本/profile、确定性双浏览器 ZIP、规范 9 文件 evidence bundle、供应链/许可证证据、
artifact/evidence 语义校验、PR/nightly/no-publish RC CI，以及商店、隐私、Beta、回滚、incident 和复盘治理材料。

阶段结论：

- repository release-engineering baseline：`CONDITIONAL GO`，允许进入真实 Beta 取证和外部演练；
- Stable：`NO-GO`；
- Legacy 油猴脚本：继续冻结，未修改其源码、根构建链或固定产物。

本地 `0.1.0-beta.1` bundle 是工程验证候选，明确记录 dirty/unsigned/self-reported gate；它不是已分发 Beta，也不是商店包或
Stable artifact。提交后的 clean HEAD 可复现 bundle 作为本地忽略目录证据生成，其 SHA 不回写本提交，避免形成 commit 自引用。

## 2. 任务状态

| Task | 状态 | 已完成证据 | 未完成外部证据 |
| ---- | ---- | ---------- | -------------- |
| EXT-120 | Engineering verified / external enforcement pending | PR、nightly、RC workflow；固定 action SHA；冻结安装/cache；只读权限；CI policy/actionlint | GitHub required checks 与 branch protection 实际配置/导出 |
| EXT-121 | Verified | package.json 单一版本源；Dev/Alpha/Beta/RC/Stable profile；manifest 映射与 artifact name 测试 | 候选版本由 Release Manager 冻结 |
| EXT-122 | Verified for unsigned repository evidence | deterministic ZIP、verify/reproducibility、checksums、manifest、SPDX、licenses、test/compat/provenance | 受保护 CI attestation、商店签名与平台重打包映射 |
| EXT-123 | Engineering complete / store sign-off pending | Listing、隐私/权限、截图/审核说明、manifest inspection | 公开隐私 URL、真实截图、账号签字、Chrome/AMO 提交回执 |
| EXT-124 | Engineering complete / external drill pending | opt-in/update/rollback/forward-fix/incident runbook；Schema/backup/corrupt 自动化 | 真实签名包 install/upgrade/rollback 或 forward-fix 演练 |
| EXT-125 | Automation verified / external evidence pending | RC no-publish 编排、gate schema、候选记录模板、双次复现 | 两个连续真实 Beta RC 与完整观察窗口 |
| EXT-126 | Reviewed / NO-GO | Stable gate policy、Go/No-Go 模板、本评审 | 所有外部门禁通过与全角色签字 |
| EXT-127 | Template ready / post-release pending | post-release review 模板、无遥测指标边界、Legacy 冻结决策输入 | 首次真实发布后执行并回写行动项 |

## 3. 架构与实现证据

- [ADR-0014](../02-architecture/adr/ADR-0014-release-profiles-deterministic-artifacts-and-provenance.md) 冻结版本、profile、ZIP、
  provenance 与 no-publish 边界。
- `web-extension/src/release/profile.ts` 是纯 TypeScript release domain；WXT 和 scripts 共用，无 manifest/package 双写。
- `scripts/release/archive.ts` 生成并读取 canonical ZIP32：稳定顺序/timestamp/mode/CRC，拒绝路径穿越、隐藏/重复/前缀重叠、
  symlink、source map、header/layout/mode/flag 漂移、多磁盘和额外 metadata。
- `scripts/release/release-bundle.ts` 只允许 `.release/` 的 plain child directory，拒绝 symlink parent/output；正式候选要求 clean
  Git，显式 source date，精确 Node/pnpm/WXT。
- `artifact-inspection.ts` 对两端 manifest 使用 deny-by-default capability allowlist，并精确检查 required/optional API、hosts、CSP、
  action/options、Firefox metadata、remote code、background、WAR/static scripts、入口、timestamp/mode。
- `verify-bundle.ts` 与 `evidence-verification.ts` 要求目录恰为 9 文件，并交叉核对 checksum、profile、canonical source date、工具链、
  权限、gate、clean Stable eligibility、artifact file/browser、重建后的 fixture-only HTML、SPDX、license inventory、inspection 和
  provenance。
- runtime dependency closure 当前覆盖 Vue/Vue Router/Zod 及其传递运行时包；未知或非 allowlist 许可证阻断候选。
- CI action 使用 checkout/setup-node/cache/upload-artifact 的 40 位 commit SHA；workflow 只授予 `contents: read`，未包含
  `git push`、`git tag`、商店 publish/sign。

## 4. 规范发布文件

每个候选必须且只能包含：

1. Chrome ZIP；
2. Firefox ZIP；
3. `checksums.txt`；
4. `release-manifest.json`；
5. `sbom.spdx.json`；
6. `third-party-licenses.txt`；
7. `test-summary.json`；
8. `compatibility-report.html`；
9. `provenance.json`。

预提交本地工程候选使用 `0.1.0-beta.1` / manifest `0.1.0.30001`，两次 WXT Chrome/Firefox 构建的 9 文件逐字节一致，
`release:verify -- <dir>` 通过。该候选的 `sourceTreeClean: false`、`churn-30m: not-run`、`artifact-install: not-run`，并保留
真实站点/浏览器/权限/商店/Beta gate 为 `external-pending`，因此 `stableDecision: NO-GO`。提交后的 clean-HEAD 候选必须重新生成，
不能沿用这个 dirty 候选的 commit、digest 或批准结论。

## 5. 自动化验证记录

最终数值以本评审完成前的 fresh run 与提交后 clean reproducibility 为准；当前已验证范围包括：

| 检查 | 结果 |
| ---- | ---- |
| Release unit/integration | 10 个文件 / 43 个测试；profile、archive、output path、CI、evidence、toolchain、manifest capability、artifact、dependency、bundle tamper tests 通过 |
| Composite `check` | format/lint/typecheck、unit 44 文件 / 177 测试、component 4 / 19、integration 12 / 80、compatibility 3 / 33、report、security、boundaries 全部通过 |
| Coverage | 64 个文件 / 312 个测试；statements 85.41%、branches 77.57%、functions 86.83%、lines 88.88%；超过 80/75% 全局门槛 |
| Build/budget | Chrome/Firefox production build 通过；required hosts=0、WAR=0、static content scripts=0；三入口 raw budget 通过 |
| Chromium E2E | 3 个主场景通过；configured churn 在普通套件中按配置跳过 |
| Firefox E2E/lint | Firefox 153.0 权限生命周期与 6 类媒体命令通过；lint 0 error，2 条生成代码 warning |
| Churn smoke | 5046 ms、84 cycles、1 次 worker restart、listeners `4→4`，最大 listeners 未增长 |
| Security/boundaries | 静态扫描 152 个文件 + 2 个 manifest；security tests 3 passed；dependency-cruiser 138 modules / 433 dependencies、0 violations |
| Legacy baseline | SHA-256 `91b5312d7cf150cd852d005b1e5d5f3d8ed2ed7cd8a481dfa1d561d48f7b3f27`；561788 bytes |
| Release reproducibility | 9 文件双构建 byte-for-byte 一致；bundle verifier 通过 |
| Dependency audit | 2 High / 2 ignored；仅按 RISK-027 精确临时接受，明确不等于 High=0，且 Stable 前到期 |
| Workflow syntax/policy | Ruby YAML parser 解析 4 个 workflow/action YAML；actionlint v1.7.7；CI policy tests 通过；project 70 个 Markdown 文件的 85 个相对链接通过 |

## 6. 已发现并修复的问题

- Phase 常量从 5 更新到 6 时，4 个 E2E `currentTime === 5` 断言被误改为 6，导致 seek 场景失败；已恢复媒体断言，目标用例和
  Chromium 全套重新通过。
- ZIP reader 原本允许部分非规范 flags/mode/layout 和中央目录空隙；现要求 canonical version/flag/mode/order/continuous layout，
  并增加 local header、overlap、gap、symlink 和路径前缀篡改测试。
- bundle verifier 原本主要依赖 `checksums.txt`，未强制全部 evidence 语义闭环；现强制 9 文件集合和跨文件 identity/gate/SBOM/
  provenance 一致，并增加删除、篡改、伪造 inspection、checksum 顺序和 symlink 目录测试。
- release output 的 lexical child check 原本未拒绝 `.release`/`.output` symlink；现每个 destructive path component 必须是 plain
  directory，降低越界删除/写入风险。
- runtime dependency identity collision 检查顺序不可达；已调整为同 name/version 不同真实路径时阻断。
- artifact inspection 原本只检查已知权限字段，未知顶层 capability 与 `optional_permissions` 可绕过；现改为 allowlist，并精确冻结
  action/options、Firefox metadata 与双浏览器 background，增加 tamper tests，源码/构建 security scan 同步守卫。
- `stableEligible` 原本只看 gate 自报告；现同时要求 Stable profile 与 clean worktree，dirty/non-Stable 候选即使 gate 全绿仍为
  `NO-GO`。
- verifier 原本只搜索兼容报告固定文本，且未绑定 artifact `browser` 字段或 canonical ISO source date；现从当前 catalog/fixture
  baseline 重建 HTML 逐字比较，并增加跨文件 identity/time tamper tests。
- `wxt.config.ts` 中的 `options_ui.open_in_tab: true` 会被 HTML entrypoint 默认值静默覆盖为 `false`；现改用 WXT 支持的
  `manifest.open_in_tab` entrypoint metadata，双端产物和 release inspection 都固定为 `true`。
- security scan 对缺失的 action/options/background/Firefox metadata 原本会从 `stableJson(undefined)` 抛内部异常；现使用
  `matchesJson` 记录明确违规并保持 fail-closed。reproducibility secondary 输出也改为 `finally` 清理，失败路径不再残留临时目录。

## 7. Stable 外部门禁

| Gate | 当前 | Stable 所需证据 |
| ---- | ---- | --------------- |
| 两个连续 Beta RC | 未执行 | 两个未改变待验证范围的真实 opt-in 候选、无未接受 P0/P1、完整观察窗口 |
| Tier 1 live smoke | 未执行 | YouTube/Bilibili/Tencent/iQIYI/Youku 的冻结浏览器/OS/候选 hash/URL 类别与脱敏 artifact |
| 浏览器版本矩阵 | 部分 | Chrome Stable/previous；Firefox Stable/ESR/142 minimum；Edge 若公开宣称 |
| headed permissions | 未执行 | 原生 current-site/all-sites 提示、焦点、接受、拒绝、撤销、受限页 |
| artifact install/update/rollback | 未执行 | 真实商店签名包 clean install、N-1 upgrade、rollback 或递增 forward-fix |
| store sign-off | 未执行 | 公开 privacy URL、真实截图、权限说明、账号/环境审批、Chrome/AMO 回执 |
| Beta observation | 未执行 | 无遥测边界下的 scripted smoke、opt-in 反馈、Issue/商店聚合信号和窗口结论 |
| branch protection | 未确认 | GitHub required checks/branch protection 实际配置证据 |

任一项缺失均保持 Stable `NO-GO`；不能把 fixture、headless harness、unpacked build、unsigned provenance 或本地 ZIP 替代为上述证据。

## 8. 独立复核

架构、安全、代码质量三类独立复核均已完成，结论均为 `APPROVE`，Blocker/Major 为 0。架构复核保留一个非阻断 Minor：
artifact inspector 与 security scan 的 Manifest allowlist 尚有少量重复，后续可抽成共享策略模块；当前发布权威仍是 artifact
inspector。安全复核确认 capability closure、optional API permission、dirty Stable eligibility 与 Unicode ZIP alias 问题已关闭，
并要求 RISK-027 的 2 High / 2 ignored 持续如实披露。初始代码质量 reviewer 的外部 503/400 失败未被计作批准，最终由可用的
独立 reviewer 对最新 diff、release tooling、workflow 与测试闭包重新复核；其发现的两个 Minor（缺失 Manifest 字段错误信息、
secondary 失败路径清理）均已修复，针对性复核后为 Blocker/Major/Minor `0/0/0` 并明确 `APPROVE`。

## 9. 最终决定

`CONDITIONAL GO`（仅 Phase 6 repository release-engineering baseline）

`STABLE NO-GO`

下一步是执行真实 Beta 准入和外部证据，不是直接进入 Stable，也不是启动 Legacy 重构。只有 Stable Go/No-Go 全部通过后，
Phase 7 才能对实验能力和是否共享/重构 Legacy 做独立立项决策。
