# ADR-0003：配置由版本化 Storage Repository 统一管理

> 状态：Accepted  
> 日期：2026-08-10（2026-08-19 更新至 Schema V3）
> 决策人：Architect  
> 关联：REQ-001、ARCH-001

## Context

Legacy 同时使用页面 `localStorage`、GM storage、sessionStorage 和内存状态；不同 Tab 可能读取旧快照并互相覆盖。扩展还需要跨上下文同步、数据导入导出和浏览器更新迁移。

## Decision

由 background 的 `SettingsRepository` 作为扩展配置权威：

- 数据采用 `schemaVersion`、命名空间和显式 metadata 包装。
- 所有读取/写入/订阅经过 repository 和 typed message API。
- 迁移函数按版本顺序执行，迁移前生成备份，失败可恢复。
- 页面只缓存只读快照；修改通过 command/use case 请求 background。
- site override、global settings、session state 分离存储，禁止混写。
- `storage.local` 是 Preview 的唯一权威；`storage.sync` 只保留 ADR-0008 白名单设计，不在 Phase 3 启用。

## Alternatives considered

- 每个页面直接使用 `localStorage`：跨域/跨 Tab 一致性差，且暴露给网页脚本，否决。
- 继续模拟 GM API：只能保留旧行为，无法表达新契约，否决。
- 完全依赖 `storage.sync`：配额、隐私和写入延迟不适合所有状态，否决。

## Consequences

需要异步化 UI 和命令流程，并编写迁移测试；换来一致性、可恢复性、可导出和可审计的数据生命周期。

Phase 6.5 当前实现为 V3：权威 key 为 `h5player.web-extension.settings`，backup key 为
`h5player.web-extension.settings.backup`。background repository 串行 mutation、每次重读权威值并执行字段 patch；落后
revision 在最新数据上 rebase，不丢失无关字段。V0/V1/V2 可向 V3 迁移；V2 已将快捷键 key/command 收紧为 domain Schema，V3 新增 global/site 下载开关和音频增益、鼠标长按时长、autoplay 策略覆盖，
无效旧 binding 被过滤而不是执行。损坏恢复、future schema 不覆盖、checksum backup、262144-byte 原子导入、V1/V2 导入、
分类 reset、rollback、storage change live reload 和 service worker 重启恢复均已有自动化证据。

浏览器 optional host permissions、content-script registration 和本页临时停用不是 Settings 数据：前两者由浏览器
profile/API 管理并从授权集合派生，后者只存在于页面会话。它们不能被导入文件或 settings patch 伪造。

## Follow-ups

- Phase 4 若落地 progress repository，补容量、TTL、媒体 identity 和隐私清理策略。
- Phase 6 前决定是否真正启用 ADR-0008 的 sync envelope；启用必须新增 ADR、opt-in、配额和冲突测试。
- Legacy JSON 一次性转换仍为 EXT-143/Phase 7 独立评估，不直接读取 Tampermonkey 私有存储。
