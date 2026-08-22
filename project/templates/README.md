# 项目文档模板

复制模板到对应领域目录后再填写；不要直接在 `templates/` 中记录真实任务。

| 模板                                                           | 用途                                      | 目标目录                                    |
| -------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------- |
| [需求模板](./requirement-template.md)                          | 新功能、行为变更、非功能要求              | `01-requirements/`                          |
| [任务模板](./task-template.md)                                 | 可执行任务或 Spike                        | `04-tasks/` 或 Issue/PR                     |
| [ADR 模板](./adr-template.md)                                  | 架构、权限、数据、公共 API 决策           | `02-architecture/adr/`                      |
| [风险模板](./risk-template.md)                                 | 新增/更新 Critical/High 风险              | `00-governance/risk-register.md` 或独立记录 |
| [里程碑评审模板](./milestone-review-template.md)               | Phase Exit Review                         | `09-reviews/`                               |
| [发布检查模板](./release-checklist-template.md)                | Alpha/Beta/Stable 发布记录                | `07-release/` 或 Release artifact           |
| [事故复盘模板](./incident-template.md)                         | P0/P1 事故                                | `09-reviews/`                               |
| [RC 证据记录模板](./release-candidate-record-template.md)      | 连续候选、矩阵、观察窗口与签字            | `07-release/` 或外部 Release record         |
| [Stable Go/No-Go 模板](./stable-go-no-go-template.md)          | Stable 不可豁免门禁与批准                 | `09-reviews/`                               |
| [发布后复盘模板](./post-release-review-template.md)            | 发布信号、事故、行动项与 Legacy 决策输入  | `09-reviews/`                               |

模板中的 `TODO` 必须在进入 In Review 前清理；不适用的章节写明 `N/A + 原因`，不得直接删除关键审查项。
