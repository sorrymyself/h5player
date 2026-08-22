# Web Extension 发布后复盘：VERSION（YYYY-MM-DD）

> 状态：Draft<br>
> 负责人：Release Manager / Quality Owner<br>
> 发布渠道与时间：TODO<br>
> 最后更新：YYYY-MM-DD<br>
> 关联任务：EXT-127

## 1. 发布身份与范围

- commit、release/manifest version、Chrome/Firefox artifact hash：TODO。
- 商店签名版本、审核回执、rollout 阶段：TODO。
- 实际功能、站点、浏览器、Schema/权限变化：TODO。
- 未包含能力与对外限制：TODO。

## 2. 计划与实际

| 项目 | 计划 | 实际 | 偏差原因 |
| ---- | ---- | ---- | -------- |
| 审核时间 | TODO | TODO | TODO |
| rollout | TODO | TODO | TODO |
| 观察窗口 | TODO | TODO | TODO |
| 浏览器/站点矩阵 | TODO | TODO | TODO |
| rollback/forward-fix | TODO | TODO | TODO |

## 3. 信号与反馈

项目默认无遥测。只记录已声明、聚合、去敏的来源：scripted smoke、opt-in 测试表、Issue、商店反馈/聚合崩溃信号、支持记录。

| 信号 | 观察窗口 | 结果 | 数据边界/局限 |
| ---- | -------- | ---- | ------------- |
| 安装/升级成功 | TODO | TODO | TODO |
| P0/P1/P2 缺陷 | TODO | TODO | TODO |
| 权限拒绝/投诉 | TODO | TODO | TODO |
| 数据损坏/恢复 | TODO | TODO | TODO |
| 浏览器/站点回归 | TODO | TODO | TODO |
| 供应链/商店异常 | TODO | TODO | TODO |

不得把“没有收到反馈”写成“没有问题”，也不得为了复盘临时收集未披露数据。

## 4. Incident 与回滚

| Incident | 等级 | 影响时间/范围 | 检测 | 响应 | 回滚/forward-fix | RCA |
| -------- | ---- | ------------- | ---- | ---- | ---------------- | --- |
| TODO 或明确 N/A | TODO | TODO | TODO | TODO | TODO | TODO |

检查：是否停止推广及时、是否保全 bundle/hash/CI/store 证据、用户数据是否被不必要收集、商店限制是否影响恢复。

## 5. 质量与工程结论

- 哪些自动化提前发现了问题：TODO。
- 哪些问题只能在真实浏览器/站点/商店发现：TODO。
- flaky、覆盖率、预算、churn、compat、许可证或复现性变化：TODO。
- listing、隐私、权限或支持文档是否与实际偏离：TODO。

## 6. 行动项

| Action | 等级 | Owner | 到期日/版本 | 追踪链接 | 完成证据 |
| ------ | ---- | ----- | ----------- | -------- | -------- |
| TODO | TODO | TODO | TODO | TODO | TODO |

P0/P1 和安全行动项必须进入 backlog/risk register；不能只留在复盘文档。

## 7. Legacy 后续决策输入

- Web Extension 是否已达到连续稳定窗口：TODO。
- 双实现维护成本与重复修复证据：TODO。
- 可抽取的纯领域模块、风险和收益：TODO。
- 是否启动 Legacy TypeScript/共享核心评估：`继续冻结 / 启动 ADR/Spike / 否决`。

单次发布成功不足以触发 Legacy 重构；必须依据多版本稳定、用户/维护成本和迁移风险作独立 ADR。

## 8. 结论与签字

结论：TODO。下一次复查日期：TODO。

Product / Architecture / Security / Quality / Release / Support：TODO。
