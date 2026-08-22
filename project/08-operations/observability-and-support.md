# 可观测性、缺陷与用户支持

> 文档 ID：OPS-001  
> 状态：Approved as Planning Baseline  
> 负责人：Quality Owner / Support Owner  
> 最后更新：2026-08-11

## 1. 可观测性原则

- 默认本地、最小、脱敏；没有用户 opt-in 不远程上传。
- 日志服务于定位状态和边界故障，不记录页面内容。
- 诊断事件使用稳定 event code，便于 Issue 和测试引用。
- service worker、content、page-main 和 UI 各有 context 字段与关联 request ID。

## 2. 日志结构

```ts
interface DiagnosticEvent {
  timestamp: number;
  level: "error" | "warn" | "info" | "debug";
  context: "background" | "content" | "page-main" | "popup" | "options";
  module: string;
  code: string;
  requestId?: string;
  sessionId?: string;
  details?: Record<string, string | number | boolean | null>;
}
```

禁止字段：完整 URL/query/fragment、页面标题、媒体 URL、用户输入、cookie/token、DOM HTML、异常对象原文。必要站点信息使用规范化 hostname 或哈希，并让用户在导出前可见。

## 3. 诊断事件分类

- `BOOT-*`：初始化、会话、worker 重启。
- `BRIDGE-*`：握手、协议、超时、拒绝。
- `MEDIA-*`：发现、active 切换、命令失败、能力降级。
- `CONFIG-*`：读取、写入、冲突、迁移、回滚。
- `ADAPTER-*`：命中、setup、异常、禁用。
- `PERMISSION-*`：缺失、拒绝、可选授权。
- `UI-*`：连接、渲染、用户输入校验。
- `RELEASE-*`：版本、Schema、构建 metadata。

## 4. 诊断导出

导出包至少包含：

- 扩展版本、构建 SHA、Schema/协议版本；
- 浏览器/OS 大版本和 manifest profile；
- 当前权限（不含 token）；
- 当前站点规范化标识、frame 数和媒体数量；
- 命中的 adapter、version/tier/status、能力、failureCount/disabledFeatures 和最近错误码；
- 限量 ring buffer、配置结构摘要和迁移结果；
- 用户主动勾选的附加信息。

导出前展示预览和隐私提醒；默认 JSON 大小上限建议 1MB。

## 5. 缺陷分级

| 等级 | 定义                                   | 响应目标         | 发布影响         |
| ---- | -------------------------------------- | ---------------- | ---------------- |
| P0   | 数据损坏、安全、扩展普遍无法运行       | 立即止血/回滚    | 阻塞所有发布     |
| P1   | 核心能力在目标浏览器/Tier 1 大面积失效 | 1 个工作日内定位 | 阻塞 Stable      |
| P2   | 局部站点/次要功能/有明确绕过           | 进入近期迭代     | 可带已知问题发布 |
| P3   | 体验、文案、低频兼容                   | Backlog          | 不阻塞           |

## 6. Issue 最低信息

- 扩展版本、浏览器/版本、OS；
- 页面类型或脱敏 URL；
- 是否 iframe/Shadow DOM/多媒体/SPA；
- 预期与实际行为、稳定复现步骤；
- 当前站点是否禁用/权限状态；
- 脱敏诊断包或错误码；
- 是否可在固定 fixture 复现。

不要要求用户公开账号、付费内容、完整媒体 URL、cookie 或控制台中的敏感对象。

## 7. 兼容性维护流程

1. 通过诊断确认 generic 或 site adapter 故障。
2. 建立最小 DOM fixture 或页面形态复现。
3. 先补失败测试，再修改 adapter/core。
4. 运行该站点 + generic + 同类站点回归。
5. 更新兼容矩阵、adapter 最近验证日期和 Changelog。

站点适配问题必须同时记录 fixture 证据和真实站点 smoke 状态。诊断中的 `degraded` 或 `disabled` 只表示当前 runtime
命中/回退状态，不等于站点生产支持等级；需要回退时按 [站点适配问题与快速回退手册](./site-adapter-runbook.md) 执行。

## 8. Incident 复盘

P0/P1 事故记录：影响、时间线、检测方式、根因、为什么门禁没发现、止血/回滚、永久修复、测试补充、文档/流程改进和 owner。复盘禁止只归因于“站点变化”或“浏览器问题”，必须说明系统为何未安全降级。
