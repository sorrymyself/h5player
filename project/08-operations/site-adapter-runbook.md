# 站点适配问题与快速回退手册

> 文档 ID：OPS-002  
> 状态：Approved for Phase 5 Preview  
> 负责人：Compatibility / Release / Support Owner  
> 最后更新：2026-08-11

## 1. 问题记录最小字段

- Adapter id/version、Tier、扩展版本、提交 SHA、浏览器/版本、OS、复测时间。
- 只记录 hostname 与 URL 类别，不保存完整路径/query、账号、标题、媒体 URL、cookie、token 或用户页面内容。
- GenericAdapter 是否仍可控制；失败 feature；diagnostics 中 selected/status/failureCount/disabledFeatures。
- 固定脱敏 fixture 是否可复现；真实站点问题不得直接复制私有页面 DOM 或用户数据进仓库。

## 2. 处置顺序

1. 复现并确认 generic core 是否健康。
2. 更新/新增脱敏 fixture，使问题可稳定自动化。
3. 优先修正 selector；只有 selector 无法表达时才增加静态、受限且有 teardown 的 Hook。
4. 单 feature 失败时先在 `rollback-policy.ts` 禁用 feature；adapter 整体破坏页面或高频失败时按精确 version 禁用。
5. kill switch 属于发布时代码，不允许从远程配置、页面数据或用户函数加载。
6. 回退后必须运行 unit、compatibility report、security、双浏览器 build/E2E 和 Legacy regression。

## 3. 恢复条件

- 修复包含 fixture、回归测试、owner 和验证日期更新。
- 移除禁用项前验证 selector/Hook 故障隔离、SPA 重匹配和 teardown。
- 真实站点恢复声明仍需单独 smoke；fixture 通过不自动恢复生产支持声明。

## 4. 紧急回退模板

```text
BUG/INCIDENT:
adapter id/version:
affected feature:
generic fallback result:
sanitized fixture:
disable policy change:
owner / expiry version:
verification commands:
live smoke status:
```
