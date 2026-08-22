# Release Candidate 证据记录：RC-YYYYMMDD-NN

> 状态：Draft<br>
> 负责人：Release Manager<br>
> 候选渠道/版本：TODO<br>
> 候选 commit：TODO（40 位 SHA）<br>
> 最后更新：YYYY-MM-DD<br>
> 关联任务：EXT-125

## 1. 身份与范围

| 字段 | 值 |
| ---- | -- |
| package version | TODO |
| release / manifest version | TODO / TODO |
| channel / sequence | TODO / TODO |
| `SOURCE_DATE_EPOCH` | TODO |
| commit / worktree clean | TODO / true |
| lockfile SHA-256 | TODO |
| Node / pnpm / WXT | TODO |
| Chrome ZIP SHA-256 / size | TODO |
| Firefox ZIP SHA-256 / size | TODO |
| bundle `checksums.txt` SHA-256 | TODO |
| 前一连续候选 | TODO 或 N/A（首个候选） |

本记录是：`工程候选 / 内部 Alpha / 外部 Beta RC / Stable RC`（保留一个）。不是商店发布或 Stable 批准，除非相应回执和 Go/No-Go
记录均已附上。

## 2. 自动化门禁

| Gate | 状态 | 证据 URL/artifact/hash | 浏览器/OS/时间 | Owner |
| ---- | ---- | ---------------------- | --------------- | ----- |
| format/lint/typecheck | TODO | TODO | TODO | TODO |
| unit/component/integration | TODO | TODO | TODO | TODO |
| coverage | TODO | TODO | TODO | TODO |
| compatibility fixtures/report | TODO | TODO | TODO | TODO |
| security/boundaries/audit | TODO | TODO | TODO | TODO |
| bundle budget | TODO | TODO | TODO | TODO |
| Chromium E2E | TODO | TODO | TODO | TODO |
| Firefox E2E + web-ext lint | TODO | TODO | TODO | TODO |
| 30-minute churn | TODO | TODO | TODO | TODO |
| Legacy hash baseline | TODO | TODO | TODO | TODO |
| artifact verify/install | TODO | TODO | TODO | TODO |
| byte reproducibility | TODO | TODO | TODO | TODO |

状态只允许 `passed`、`failed`、`not-run`、`external-pending`；不得仅粘贴 CLI 自报告而缺少可回链证据。

## 3. 人工/外部矩阵

| 检查 | 结果 | 环境/范围 | 证据与限制 |
| ---- | ---- | --------- | ---------- |
| Chrome Stable | TODO | TODO | TODO |
| Chrome previous stable | TODO | TODO | TODO |
| Firefox Stable | TODO | TODO | TODO |
| Firefox ESR / manifest minimum | TODO | TODO | TODO |
| Edge Stable（若宣称） | TODO | TODO | TODO |
| headed current-site/all-sites permission UX | TODO | TODO | TODO |
| Tier 1 live-site smoke | TODO | TODO | 不记录账号、cookie、token、完整敏感 URL |
| clean install / upgrade / uninstall | TODO | TODO | TODO |
| signed store package rollback/forward-fix | TODO | TODO | TODO |
| store listing/privacy/screenshots | TODO | TODO | TODO |

## 4. Beta 观察窗口

- 渠道与 opt-in cohort：TODO。
- 开始/结束时间：TODO。
- 无遥测情况下的信号来源：scripted smoke / opt-in test sheet / Issue / store aggregate / other（说明）。
- P0/P1/P2、权限投诉、数据/供应链异常：TODO。
- 退出/扩大条件：TODO。

## 5. 缺陷与风险

| ID | 等级 | 影响 | 状态/修复 commit | 接受人和到期版本 | 回退条件 |
| -- | ---- | ---- | ---------------- | ---------------- | -------- |
| TODO | TODO | TODO | TODO | TODO | TODO |

P0、安全远程执行、数据损坏和不可解释 artifact 不可豁免。

## 6. 连续候选判定

- [ ] 本候选所有必需 gate 通过。
- [ ] 与上一候选之间没有改变待验证范围；若改变，连续计数从本候选重新开始。
- [ ] 观察窗口完整结束，无未接受 P0/P1。
- [ ] artifact/commit/store package 身份可以互相追踪。

连续候选编号：`0 / 1 / 2`。只有两个连续真实 Beta RC 满足条件后，才可作为 Stable 审查输入。

## 7. 签字

| 角色 | 姓名/账号 | 结论 | 时间 | 备注 |
| ---- | --------- | ---- | ---- | ---- |
| Product Owner | TODO | TODO | TODO | TODO |
| Architecture Owner | TODO | TODO | TODO | TODO |
| Security Reviewer | TODO | TODO | TODO | TODO |
| Quality Owner | TODO | TODO | TODO | TODO |
| Release Manager | TODO | TODO | TODO | TODO |

最终结论：`REJECTED / ENGINEERING-ONLY / BETA-APPROVED / STABLE-REVIEW-INPUT`（保留一个）。
