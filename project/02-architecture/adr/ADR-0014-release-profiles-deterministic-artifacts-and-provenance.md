# ADR-0014：发布 Profile、确定性产物与 Provenance

> 状态：Accepted for Phase 6 Release Engineering<br>
> 日期：2026-08-11<br>
> 最后更新：2026-08-12<br>
> 决策者：Architecture Owner / Release Manager / Security Reviewer<br>
> 关联：EXT-120～127、NFR-REL-*、NFR-SEC-*、RISK-015

## 背景

Web Extension 在 Phase 5 前只有开发构建，没有统一版本源、候选渠道、可复现 ZIP、供应链证据和分层发布流水线。
继续依赖临时命令或 WXT 默认压缩会造成版本漂移、平台 metadata 不稳定，也无法回答“这个包由哪个提交、锁文件和门禁生成”。

Legacy 油猴脚本已稳定且必须冻结；发布工程只能作用于 `web-extension/`，不能通过改造根 Yarn/Rollup 链获取一致性。

## 决策

### 1. 单一版本源与 Profile

- `web-extension/package.json#version` 是基础 SemVer 的唯一事实源。
- 构建调用只提供 `channel` 与 `sequence`；合法渠道为 `dev`、`alpha`、`beta`、`rc`、`stable`。
- WXT manifest、产物名、release manifest、SBOM 和 provenance 都调用同一 TypeScript profile resolver。
- 浏览器 manifest 使用四段数字版本：前三段来自 package SemVer，第四段为渠道基数加序号：
  `dev=10000`、`alpha=20000`、`beta=30000`、`rc=40000`、`stable=60000`。
- Stable 只接受序号 `0`；package 自带 prerelease 时，channel/sequence 必须与之严格一致。
- 默认构建为 Dev profile，避免普通 `wxt build` 意外生成 Stable 身份。

示例：`0.1.0` + `beta` + `1` 生成发布标识 `0.1.0-beta.1` 与 manifest 版本 `0.1.0.30001`；
`0.1.0` + `stable` + `0` 生成 manifest 版本 `0.1.0.60000`。

### 2. 确定性构建输入

候选产物身份由以下输入共同决定：

- 完整 Git commit SHA；
- `web-extension/package.json` 版本；
- channel 与 sequence；
- `pnpm-lock.yaml` hash 与冻结安装；
- 精确 Node、pnpm、WXT 版本；
- 显式非负 `SOURCE_DATE_EPOCH`，evidence 只接受与其逐字一致的 canonical UTC ISO 时间；
- repository-owned release scripts 与 gate 输入。

墙上时钟不得进入 ZIP 或 evidence。工作树默认必须干净；`--allow-dirty` 只允许本地工程验证，生成的 provenance 必须记录
`sourceTreeClean: false`，不得用于发布批准。`stableEligible` 只有在 profile 为 Stable、工作树干净且全部规范 gate 为
`passed` 时才可进入 `review-required`，其他情况一律 `NO-GO`。

### 3. ZIP 规范

发布 ZIP 由仓库脚本生成，不把 WXT 默认 ZIP 视为可复现性权威。文件按稳定顺序写入，使用 STORE、UTF-8 名称、固定 DOS
timestamp、`100644` mode、CRC32、无 extra/comment/trailing bytes。拒绝绝对路径、穿越、反斜杠、隐藏路径、重复或前缀重叠
路径、符号链接、source map、重叠 local range、local/central header 漂移和多磁盘 ZIP。

### 4. Evidence 与信任边界

每个候选 bundle 必须包含 Chrome/Firefox ZIP、checksums、release manifest、SPDX 2.3 SBOM、运行时许可证清单、测试摘要、
兼容报告和 in-toto/SLSA-compatible provenance。

仓库生成的 provenance 是未签名 metadata：它可描述输入、builder 和 artifact digest，但不等于 GitHub OIDC attestation、商店签名、
维护者签字或第三方可验证身份。商店签名和受保护环境证明属于外部发布证据。

### 5. 门禁与发布语义

- PR workflow 负责 Legacy baseline、静态/测试/构建、双浏览器 package inspection 与 Chrome/Firefox E2E。
- Nightly 增加依赖审计、30 分钟 churn 和双次可复现构建。
- RC workflow 只生成“RC Evidence (No Publish)”，不得 tag、push、签名或上传商店。
- gate 状态只有 `passed`、`failed`、`not-run`、`external-pending`；打包 CLI 输入是自报告，批准时必须回链 CI/人工记录。
- 缺少真实 Tier 1 smoke、目标浏览器版本矩阵、headed 权限 UX、商店签字或 Beta 观察时，Stable 必须为 `NO-GO`。

## 结果

正向结果：

- 版本、manifest 和证据不再重复维护；两端候选包可逐文件核验并进行字节级复现。
- 发布产物采用 deny-by-default manifest capability allowlist；required/optional API、host、CSP、action/options、Firefox metadata、
  background、入口和供应链边界成为可测试契约。
- 本地/CI 候选与真实 Beta、商店提交、Stable 批准有清晰语义隔离。

代价与限制：

- 自有 ZIP32 writer 不支持压缩、ZIP64、目录 entry 或任意 executable mode；扩展产物超过 ZIP32 边界时必须重新评审。
- 可复现性依赖冻结工具链和显式 source date；跨操作系统/跨工具链复现仍需独立证据。
- 未签名 provenance 不能独立抵抗仓库或构建器被攻陷。

## 未采用方案

- 继续在 `wxt.config.ts` 硬编码版本：会造成 package/manifest/evidence 漂移。
- 使用 WXT 默认 ZIP 作为发布权威：无法稳定约束 timestamp、mode 和 extra metadata。
- 在仓库实现远程更新、遥测或远程规则：扩大隐私与执行边界，且不是 Phase 6 发布工程所需。
- 自动 tag、push 或商店发布：需要额外权限、secret 和人工批准，不属于当前授权。

## 复审触发条件

- manifest 版本映射需要改变或接近任一 `65535` 上限；
- 引入签名 attestation、受保护发布环境或商店 API；
- 新增运行时依赖许可证类型、required host permission、远程网络能力或 executable artifact；
- 发布包需要 ZIP64、原生二进制、压缩或跨平台签名。
