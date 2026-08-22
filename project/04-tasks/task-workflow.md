# 任务工作流与完成定义

> 文档 ID：TASK-001  
> 状态：Approved Baseline / Phase 6.5 UX Amendment In Review
> 负责人：Project Owner / Quality Owner  
> 最后更新：2026-08-12

## 1. 任务状态

| 状态        | 含义             | 进入条件                   |
| ----------- | ---------------- | -------------------------- |
| Proposed    | 想法或待分析问题 | 有标题和背景               |
| Ready       | 可以开始         | 满足 Definition of Ready   |
| In Progress | 正在实施         | 有 owner、分支/PR、时间盒  |
| Blocked     | 无法继续         | 记录阻塞、责任方、复查时间 |
| In Review   | 代码和文档已提交 | 自检与本地门禁通过         |
| Verified    | 验收人确认       | 自动化与手工证据齐全       |
| Done        | 已合并并更新台账 | 文档、任务和进度同步       |
| Cancelled   | 不再执行         | 记录原因和替代方案         |

## 2. Definition of Ready

任务进入 Ready 必须具备：

- 唯一 ID、标题、owner 和优先级；
- 关联需求/ADR/Epic；
- 明确范围与不包含内容；
- 可测试验收标准；
- 依赖、风险和涉及文件边界；
- 需要的测试层级；
- 若修改权限、Schema、公共接口或架构，ADR 已存在或被列为前置任务。

Phase 6.5 特别规则：EXT-128～139 在 `REQ-UX-001/002`、`ARCH-UX-001`、`ADR-0015/0016`、`QUAL-UX-001` 经用户审核前一律保持 `Proposed`；不得以已有 Preview 实现或局部单测作为进入 `Ready` 的替代条件。

## 3. Definition of Done

任务完成必须具备：

- 实现满足验收标准，无超范围 Legacy 改动；
- typecheck、lint、unit、integration/E2E（按风险）通过；
- 新增/变更公共契约已有 Schema、文档和契约测试；
- 失败路径、资源清理和浏览器差异已验证；
- 需求矩阵、backlog、progress 或 ADR 已同步；
- PR 有验证证据、风险说明和回滚方法；
- 没有新增未登记的 TODO、跳过测试或权限。

## 4. 任务切分原则

- 一个任务以 0.5～3 个开发日为宜；超过 5 日拆成 Epic/子任务。
- 优先纵向切片：类型/实现/测试/UI/诊断一起交付。
- 避免“重构所有工具函数”“迁移所有站点”等不可验收任务。
- Spike 必须时间盒，并以决策、可运行原型或否决证据结束。
- Bug 修复必须先补复现测试；线上 P0 可先止血，再在 24 小时内补测试和复盘。

## 5. PR 最低信息

```text
Task / Requirement / ADR
What changed
What intentionally did not change
Verification evidence
Permission / data / security impact
Browser matrix
Rollback plan
Documentation updated
```

## 6. 审查分级

- Low：纯文案、无行为变化；常规审查。
- Medium：局部功能/组件；代码 + 测试审查。
- High：消息、存储、权限、DOM Hook、迁移、发布；架构 + 安全 + 质量审查。
- Critical：远程通信、下载、供应链、公开数据格式；独立威胁模型和发布前专项审计。

## 7. 技术债规则

临时妥协必须创建 `DEBT-*` 任务，包含原因、影响、删除条件和最晚处理里程碑。没有任务 ID 的注释性 TODO 不得合并。
