# 发布产物与证据契约

> 文档 ID：REL-003<br>
> 状态：Approved for Phase 6 Release Engineering<br>
> 负责人：Release Manager / Build Owner / Security Reviewer<br>
> 最后更新：2026-08-12<br>
> 关联需求/任务/ADR：EXT-121、EXT-122、EXT-125、ADR-0014

## 1. 适用范围

本契约定义 `web-extension/` 候选包的输入、文件集合、确定性规则、校验方式和证据边界。它不授权发布，不替代商店签名，
也不把本地 fixture、unpacked E2E 或自报告 gate 解释为真实 Beta/Stable 证据。

## 2. 权威输入

| 输入 | 事实源/约束 |
| ---- | ----------- |
| 基础版本 | `web-extension/package.json#version` |
| 渠道 | `dev` / `alpha` / `beta` / `rc` / `stable` |
| 序号 | `0..9999`；Stable 必须为 `0` |
| 源码 | 完整 Git commit SHA；发布候选要求干净工作树 |
| 时间 | 显式非负整数 `SOURCE_DATE_EPOCH`；JSON evidence 使用逐字 canonical UTC ISO |
| 依赖 | `pnpm-lock.yaml` + `pnpm install --frozen-lockfile` |
| 工具链 | Node `24.13.0`、pnpm `11.21.0`、WXT `0.21.3`，变更须同步本契约与 CI |
| 门禁 | 枚举 gate + 状态；必须回链真实 CI/人工记录 |

候选版本示例：

```text
packageVersion: 0.1.0
channel: beta
sequence: 1
releaseVersion: 0.1.0-beta.1
manifestVersion: 0.1.0.30001
```

## 3. 规范文件集合

每个 bundle 顶层必须且只能包含以下 9 个普通文件：

```text
h5player-webext-<releaseVersion>-chrome.zip
h5player-webext-<releaseVersion>-firefox.zip
checksums.txt
release-manifest.json
sbom.spdx.json
third-party-licenses.txt
test-summary.json
compatibility-report.html
provenance.json
```

不得包含目录、symlink、临时文件、签名密钥、商店凭证、source map 或未登记附件。截图、人工签字、商店回执和 RC 记录应作为
外部 release record 附件保存，并引用 bundle digest，不能偷偷塞入规范 bundle 改变复现结果。

## 4. 文件契约

### 4.1 浏览器 ZIP

- Chrome/Firefox 都来自相同 commit/profile/source date，各自使用 WXT 对应目标输出。
- entry 稳定排序、STORE、UTF-8、固定 DOS 时间、`100644`、CRC32、无 extra/comment/trailing bytes。
- 拒绝危险/隐藏/重复/前缀重叠路径、local range 重叠、symlink、source map 和异常 ZIP32 metadata。
- 必须包含 `manifest.json`、`background.js`、两个 content entry、`popup.html`、`options.html`。
- manifest 必须为 MV3，并使用发布检查器登记的顶层 capability allowlist；新增 `key`、`devtools_page`、override、sandbox 或其他
  未登记字段必须阻断并经过独立 ADR/安全审查。
- required API permissions 精确为 `storage`、`activeTab`、`scripting`；optional API permissions 为空/缺失；required hosts 为空；
  optional hosts 精确为 `<all_urls>`；生产静态 content scripts 与 WAR 为空/缺失。
- action/options 只能指向 `popup.html` / `options.html`；Firefox ID、最低版本、数据收集声明及其对象字段必须逐字 canonical，
  不接受额外 `strict_max_version`、update URL 或其他浏览器 metadata。
- Chrome 使用 service worker；Firefox 使用 background scripts；CSP 必须缺失或精确为 `script-src 'self'; object-src 'self'`，
  不接受 wildcard、`data:`、`blob:`、remote、`unsafe-eval` 或 `unsafe-inline`。
- 文本 entry 扫描 `eval`、Function constructor、远程可执行脚本、JavaScript data URI、CSP relaxation API 和 source-map 引用。
- 文本正则扫描是 defense-in-depth，不宣称可证明所有计算 URL；它必须与源码静态扫描、精确 CSP/权限/manifest policy、
  review 和浏览器 lint 同时通过，不能单独作为“无远程代码”的真实性证明。

### 4.2 `checksums.txt`

- 覆盖除自身之外的全部 8 个文件；每行格式为 `<64位小写sha256><两个空格><文件名>`。
- 文件名只允许安全顶层名称；不得重复、遗漏或登记额外文件。

### 4.3 `release-manifest.json`

Schema v1 至少记录 profile、commit、source date、clean 状态、Node/pnpm/WXT、lockfile hash、两端 artifact hash/size/inspection、
权限摘要、兼容边界、evidence 文件 digest 和全部 gate。`releaseDecisionBoundary` 必须明确“生成产物不等于 Beta 分发、商店批准或
Stable Go”。

### 4.4 `sbom.spdx.json` 与许可证

- SBOM 使用 SPDX 2.3，覆盖扩展根包和 `package.json` 声明的完整运行时依赖闭包。
- verifier 从当前验证 checkout 的 package/lockfile 重建运行时依赖图，并要求 SBOM、relationship、许可证清单逐字一致；只改内部
  checksum 不能把删减闭包伪装为有效 evidence。
- build/test-only 依赖由 lockfile 与完整 CI audit 覆盖；两个尚无上游修复版本的 `image-size@2.0.2` advisory 只按 RISK-027
  显式临时例外，不得写成 High=0，也不得跨越 Stable 审查。
- 运行时许可证 allowlist 当前仅接受 MIT、Apache-2.0、BSD-2-Clause、BSD-3-Clause、ISC；未知或其他表达式必须人工复核并阻断。
- `third-party-licenses.txt` 使用稳定顺序列出包名、版本、许可证和 repository/homepage，不替代上游完整 LICENSE 文本义务。

### 4.5 测试、兼容和 Provenance

- `test-summary.json` 的 gate 值是 packaging input；`external-pending` 不能被自动提升为 `passed`。
- `compatibility-report.html` 必须由当前 checkout 的 adapter catalog、fixture SHA baseline 和固定 source date 重新生成并逐字比较；
  固定标记 `sanitized-fixture-only` 与 `liveSmoke: not-verified`，直到真实 smoke 由独立记录证明。
- `provenance.json` 使用 in-toto Statement v1 / SLSA provenance v1 兼容结构，记录 artifact subjects、源码与 lockfile digest、builder、
  profile 和 clean 状态；`provenanceTrust.status=unsigned`、`signed=false` 为 verifier 强制字段，不记录伪造的实际 build start/end，
  也不冒充 CI/商店签名。

## 5. Gate 语义

| 状态 | 含义 |
| ---- | ---- |
| `passed` | 有可回链、与候选 SHA/hash 一致的证据 |
| `failed` | 已执行且失败；候选不可晋级 |
| `not-run` | 自动化或人工检查未运行 |
| `external-pending` | 必须在真实浏览器、站点、商店或 Beta 窗口外部完成 |

Stable 必须使用 Stable profile、clean worktree、全部 gate 为 `passed`，且由 Stable Go/No-Go 记录人工批准；JSON 中
`review-required` 不是自动发布授权，非 Stable profile 即使 gate 全绿也必须保持 `NO-GO`。

## 6. 命令与复现

```bash
pnpm release:bundle -- --channel beta --sequence 1 --source-date-epoch <epoch> --output .release/beta-1
pnpm release:verify -- .release/beta-1
pnpm release:reproducibility -- --channel beta --sequence 1 --source-date-epoch <epoch> --output .release/beta-1
```

- `release:verify` 必须重新计算 checksums、解析 release manifest、核对 artifact 文件名/browser/inspection/digest，重新生成兼容报告，
  并再次运行 artifact inspection。
- `release:reproducibility` 必须执行两次独立 WXT 构建，比较规范目录中全部 9 个文件的 SHA-256，并删除 secondary 临时目录。
- 正式候选和 PR package smoke 都不得跳过 packager 内部构建；`--allow-dirty` 仅限明确标注的本地工程验证。

## 7. 保留与失效

- PR evidence 建议保留 7 天，nightly 14 天，RC 30 天；正式发布记录按项目发布历史长期保留。
- 任一源码、lockfile、版本、profile、source date、gate 结论或 release script 变化都会使旧 bundle 失效，必须重建。
- checksum/manifest/provenance 不一致、许可证策略失败、危险 ZIP metadata 或权限漂移时立即停止晋级并按 incident runbook 处理。
