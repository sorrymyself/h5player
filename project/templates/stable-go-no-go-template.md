# Stable Go/No-Go：VERSION（YYYY-MM-DD）

> 状态：Draft / NO-GO<br>
> 主持：Release Manager<br>
> 目标 commit / artifact：TODO<br>
> 最后更新：YYYY-MM-DD<br>
> 关联任务：EXT-126

## 1. 决策摘要

结论：`GO / NO-GO / CONDITIONAL GO`。Stable 只允许 `GO`；Conditional GO 只能授权补证或继续 Beta，不得上传/扩大 Stable。

一句话依据：TODO。

## 2. 不可豁免门禁

| 门禁 | 要求 | 证据 | 结论 |
| ---- | ---- | ---- | ---- |
| 候选身份 | clean commit、版本/profile/source date/lockfile/toolchain/hash 可追踪 | TODO | TODO |
| 可复现性 | 两次独立构建全部规范文件 hash 一致 | TODO | TODO |
| 安全 | Critical/High=0；无远程代码/权限/CSP 漂移；SBOM/license 清晰 | TODO | TODO |
| 核心质量 | PR/nightly/RC、覆盖率、预算、30 分钟 churn 全绿 | TODO | TODO |
| 连续候选 | 两个连续真实 Beta RC 完成观察窗口 | TODO | TODO |
| 浏览器矩阵 | Chrome Stable/previous、Firefox Stable/ESR/minimum；Edge 若宣称 | TODO | TODO |
| 真实站点 | Tier 1 live smoke，失败和限制已记录 | TODO | TODO |
| 权限 UX | headed 原生接受/拒绝/撤销/受限页通过 | TODO | TODO |
| 数据生命周期 | clean install、N-1 upgrade、corrupt restore、store rollback/forward-fix | TODO | TODO |
| 商店/隐私 | listing、截图、权限、公开隐私 URL、签名/账号回执获签字 | TODO | TODO |
| 支持/事故 | 支持入口、已知问题、回滚包、Incident Commander 可用 | TODO | TODO |

任一行不是 `Passed`，默认结论为 `NO-GO`。

## 3. 缺陷与风险接受

| ID | 等级 | 用户影响 | 缓解 | Owner/到期版本 | 接受人 | 回退触发 |
| -- | ---- | -------- | ---- | ---------------- | ------ | -------- |
| TODO | TODO | TODO | TODO | TODO | TODO | TODO |

P0、未解释 required/host permission、远程执行、数据损坏、来源不明或不可复现 artifact 不接受风险豁免。

## 4. 渠道计划

- Chrome / Firefox 独立 rollout：TODO。
- 若商店支持 staged rollout：`5% -> 25% -> 100%`，每步观察窗口和扩大条件：TODO。
- 停止推广与 rollback/forward-fix owner：TODO。
- 用户沟通、已知问题与隐私变更：TODO。

## 5. 签字

| 角色 | 结论 | 姓名/账号 | 时间 | 备注 |
| ---- | ---- | --------- | ---- | ---- |
| Product Owner | TODO | TODO | TODO | TODO |
| Architecture Owner | TODO | TODO | TODO | TODO |
| Security Reviewer | TODO | TODO | TODO | TODO |
| Quality Owner | TODO | TODO | TODO | TODO |
| Release Manager | TODO | TODO | TODO | TODO |
| Store/Compliance Owner | TODO | TODO | TODO | TODO |

## 6. 决策记录

- 决策时间：TODO。
- `GO` 时允许的精确 artifact hash/商店版本：TODO。
- `NO-GO` 时阻塞项、owner、复查日期：TODO。
- 禁止通过重新打包、替换文件或使用另一个 commit 绕过本记录；身份变化必须重新审查。
