# 版本、发布与回滚策略

> 文档 ID：REL-001  
> 状态：Approved / Phase 6 Repository Baseline<br>
> 负责人：Release Manager  
> 最后更新：2026-08-11

## 1. 版本边界

- 油猴脚本与 Web Extension 使用独立版本序列和独立 Changelog。
- Web Extension 采用 SemVer：`MAJOR.MINOR.PATCH`。
- manifest 版本、package workspace 版本、构建 metadata 和商店版本必须由单一版本源生成。
- 预发布使用 `alpha.N`、`beta.N`、`rc.N`；浏览器 manifest 若不支持预发布字符串，使用 profile 映射并在 metadata 保留完整版本。

## 2. 渠道

| 渠道   | 用途         | 受众          | 数据兼容承诺        |
| ------ | ------------ | ------------- | ------------------- |
| Dev    | 本地/CI      | 开发者        | 可清空，不保证升级  |
| Alpha  | 内部功能验证 | 维护者/贡献者 | 同一 minor 尽量迁移 |
| Beta   | 真实使用验证 | opt-in 用户   | 保证可升级/可回滚   |
| RC     | 候选证据冻结 | 发布评审者    | 与目标渠道 Schema 一致 |
| Stable | 公开分发     | 全部用户      | 严格迁移与回滚      |

## 3. 构建产物

每次候选发布输出：

```text
h5player-webext-<version>-chrome.zip
h5player-webext-<version>-firefox.zip
checksums.txt
release-manifest.json
sbom.spdx.json
third-party-licenses.txt
test-summary.json
compatibility-report.html
provenance.json
```

`release-manifest.json` 包含提交 SHA、Node/pnpm/WXT、锁文件 hash、manifest profile、Schema 版本、兼容证据边界、构建时间和
artifact hash。完整契约见 [发布产物与证据契约](./release-artifact-and-evidence-contract.md)。

## 4. 自动化流水线

1. 校验工作树/标签/版本源。
2. 安装锁定依赖，运行静态、单元、组件、集成和 E2E。
3. 生成 Chrome/Firefox production profiles。
4. 解包检查 manifest、权限、CSP、资源和禁止模式。
5. 安装产物做最终 smoke 与升级迁移。
6. 生成 hash、SBOM、许可证和 provenance metadata。
7. RC workflow 只上传 no-publish evidence；人工确认商店文案、隐私、截图和签名环境。
8. 获得独立 Go/No-Go 后才分批提交商店/灰度；监控缺陷后扩大。

Phase 6 repository baseline 已实现 PR/nightly/RC 三层 workflow、固定 action SHA、冻结依赖、双端 deterministic bundle 和
reproducibility。它没有创建 tag、GitHub Release、商店上传、签名或 rollout，也不自动把 gate 输入视为真实证据。

## 5. 灰度策略

- Alpha：每个纵向切片可发布，不宣传稳定。
- Beta：先小规模，至少观察一个完整使用周期；收集 opt-in 反馈，不默认遥测。
- Stable：若商店支持 staged rollout，按 5% → 25% → 100%；每步至少观察既定窗口并检查 P0/P1。
- 浏览器渠道独立推进；Firefox 审核或能力差异不阻塞 Chrome hotfix，但版本说明必须清晰。

## 6. 发布前检查

- 需求矩阵：P0 Verified，P1 未完成项已批准。
- 数据：从上一 Stable 升级、降级/回滚和损坏恢复通过。
- 权限：没有新增未说明权限，listing 与 manifest 一致。
- 兼容：目标浏览器与 Tier 1 通过，Tier 2 限制已记录。
- 支持：已准备已知问题、诊断步骤、回滚包和 Issue 模板。
- 法务/隐私：第三方许可证、数据说明、截图/文案真实。

## 7. 回滚

### 7.1 触发条件

- 数据损坏/丢失；
- 扩展无法启动或核心媒体命令大面积失效；
- 新高危安全漏洞或权限误用；
- 浏览器商店拒绝/下架风险；
- P0 缺陷且无法在允许窗口内修复。

### 7.2 回滚动作

1. 停止灰度和自动推广。
2. 发布/恢复上一稳定扩展包。
3. 保留新版本数据备份，不做不可逆清理。
4. 发布已知问题和用户自救指引（禁用站点/恢复配置/导出诊断）。
5. 建立 incident 记录，补复现测试和根因分析。

若商店不允许真正降级，发布向前修复版本，并通过兼容迁移读取新旧 Schema。任何时候都不能要求修改油猴脚本来修复扩展事故。

## 8. Hotfix

- 站点选择器/adapter 局部修复：可缩小回归矩阵，但必须通过该站点、generic、消息和构建门禁。
- 配置/协议/权限/安全 hotfix：必须完整 RC 流程。
- Hotfix 后 5 个工作日内完成复盘、补齐测试和文档。

## 9. Changelog

按 Added / Changed / Fixed / Security / Compatibility / Deprecated / Removed 分类；明确浏览器、站点、权限和数据迁移影响。不写“优化体验”等不可核验描述。

## 10. 当前 Phase 6 决策

- Release-engineering baseline：`Conditional GO`，允许进入真实 Beta 取证。
- Stable：`NO-GO`。
- 未完成：两个连续真实 Beta RC、Tier 1 live、Firefox ESR/最低版本、Chrome previous stable、Edge、headed 权限、真实商店
  签字/签名包 update/rollback 和观察窗口。
- Beta opt-in、rollback 和 incident 执行见 [运维手册](../08-operations/beta-update-rollback-incident-runbook.md)；商店材料见
  [Listing 包](./store-listing-package.md) 与 [隐私/权限披露](./privacy-and-permission-disclosure.md)。
