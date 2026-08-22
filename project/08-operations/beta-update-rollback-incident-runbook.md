# Beta、更新、回滚与 Incident Runbook

> 文档 ID：OPS-003<br>
> 状态：Approved for Engineering Drills / External Beta Pending<br>
> 负责人：Release Manager / Incident Commander / Quality Owner<br>
> 最后更新：2026-08-11<br>
> 关联需求/任务：EXT-124～127

## 1. 范围与原则

本手册用于 Web Extension Alpha/Beta/RC 及未来 Stable；不适用于 Legacy 油猴脚本。当前仓库只完成候选包和工程演练能力，
尚无真实 Beta 用户、商店 rollout 或 Stable。任何执行记录必须关联候选 SHA、artifact hash、浏览器/OS 和时间窗口。

- Beta 必须 opt-in；不通过静默遥测或远程更新服务识别用户。
- Chrome 与 Firefox 渠道可独立推进，数据 Schema 必须向后可读或有 forward-fix。
- 优先停止推广和 forward-fix；商店不允许降级时不得假装“已回滚”。
- 事故处置只修改 Web Extension，不以翻修 Legacy 作为恢复手段。

## 2. Beta 准入

工程预检：

1. 在候选 SHA 运行 PR、nightly/RC gate，并保存规范 9 文件 bundle。
2. `release:verify` 与双次 `release:reproducibility` 通过，工作树为 clean。
3. Chrome/Firefox artifact inspection、unpacked E2E、迁移/损坏恢复测试和 30 分钟 churn 通过。
4. 完成目标 Chrome Stable/previous、Firefox Stable/ESR/最低版本、Edge（若宣称）真实矩阵。
5. 完成 Tier 1 真实站点 smoke，记录 URL 类别而非敏感 URL/账号；保存失败 screenshot/trace/console 的脱敏 artifact。
6. 用 headed 原生 UI 验证当前站点/all-sites 的提示、焦点、接受、拒绝、撤销和受限页行为。
7. Product/Security/Quality/Release 签字；商店 listing、隐私 URL、权限说明和截图与包一致。

任一项缺失时只能做维护者本地工程验证，不能称为外部 Beta。

## 3. Opt-in 分发

优先级：

1. 商店官方 Beta/测试渠道或受限测试名单；
2. 明确说明风险的手工 unpacked/temporary install，仅面向测试人员；
3. 不托管自定义自动更新 manifest，不实现远程脚本/规则服务。

邀请说明必须包含：候选版本/hash、支持浏览器、已知限制、数据清除、撤回方式、反馈入口、观察窗口和“不要与 Stable 身份混淆”。
手工包只从已核验 bundle 取出，不通过即时重打包分发。

## 4. 更新流程

1. 冻结候选 commit、package version、channel/sequence 和 `SOURCE_DATE_EPOCH`。
2. 生成/核验 bundle；创建 release-candidate record，关联全部 CI/人工证据。
3. 用全新 profile 安装；再从上一候选/Stable profile 升级，验证设置、授权、进度开关、诊断和 worker restart。
4. 对 V0/V1/V2、corrupt、future Schema、backup/rollback fixture 执行自动化；禁止不可逆清理。
5. 上传对应商店测试渠道，记录商店生成的签名/版本/审核回执和与仓库 ZIP 的差异。
6. 先扩展到最小 opt-in cohort；每个观察窗口检查 P0/P1、Issue、商店审核、权限投诉和兼容性报告，再决定继续/暂停。

没有遥测时，采用维护者 scripted smoke、opt-in 测试表、Issue/反馈、商店可用的聚合崩溃信号和人工版本盘点。不得为了指标临时加入
未声明采集。

## 5. 回滚与 Forward-fix

触发条件：数据损坏/丢失、核心命令大面积失败、未授权执行、权限/CSP/远程代码漂移、高危漏洞、商店拒绝/下架风险、P0 无法在
批准窗口修复、不可解释的产物或供应链差异。

动作顺序：

1. Incident Commander 宣布 `STOP-PROMOTION`，停止扩大渠道和新提交。
2. 固定受影响 version、artifact hash、浏览器/OS、首次发现时间和影响范围；保全 bundle/CI/商店证据，禁止上传敏感用户数据。
3. 禁用/撤回受影响商店渠道；若允许回退则恢复已签名上一版本，验证其 hash 与数据兼容。
4. 若商店不允许降级，发布递增版本的 forward-fix，继续读取新旧 Schema；不得通过降低 manifest version 规避商店规则。
5. 为用户提供：暂停扩展、撤销站点权限、导出/清除诊断、恢复设置备份、关闭进度、切回上一可用渠道的明确步骤。
6. 修复后重跑完整 RC；P0/P1 复盘和测试必须进入 post-release review。

当前自动化覆盖版本化设置迁移/backup/corrupt 恢复与 unpacked extension 行为，但真实商店签名包 downgrade/roll-forward 尚未演练；
`artifact-install` gate 在该证据完成前保持 `not-run` 或 `external-pending`。

## 6. Incident 分级与响应

| 等级 | 示例 | 首次响应目标 | 发布动作 |
| ---- | ---- | ------------ | -------- |
| P0 | 数据丢失、远程代码、未授权特权操作、大面积无法启动 | 立即；目标 30 分钟内建立指挥记录 | 停止全部推广，撤回/forward-fix |
| P1 | 核心命令在主要浏览器/站点失效、权限流程阻断、严重性能回归 | 4 小时内 | 暂停受影响渠道，评估修复或回退 |
| P2 | 有绕行方案的局部站点/UI 问题 | 2 个工作日内 | 可保持 cohort，不扩大 |
| P3 | 文案、小范围非核心问题 | 正常 backlog | 下个计划版本 |

角色：Incident Commander 决策；Release Manager 操作渠道；Security Reviewer 处理安全/隐私；Quality Owner 冻结复现矩阵；
Support Owner 发布去敏沟通。任何账号、token、签名密钥只在 secret manager/商店后台操作，不写入记录。

## 7. 演练清单

- [x] 设置 migration、checksum backup、corrupt/future no-overwrite 自动化存在。
- [x] 候选 bundle checksum、inspection、SBOM/license/provenance 与双构建复现能力存在。
- [x] RC workflow 明确 no-publish、只读权限、不 tag/push/sign。
- [ ] 从真实上一商店签名版本升级到候选。
- [ ] 在 Chrome/Firefox 商店限制下完成 rollback 或 forward-fix 演练。
- [ ] 执行两个连续真实 Beta RC 与观察窗口。
- [ ] 完成 headed 权限、Tier 1 live smoke 和完整浏览器版本矩阵。
- [ ] 验证公开状态页/支持渠道/隐私 URL 和事故联系路径。

未勾选项是 Stable `NO-GO`，不可用“本地包已通过”替代。
