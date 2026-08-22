# 项目审查清单

> 文档 ID：REVIEW-002  
> 状态：Approved Baseline / Phase 6.5 UX Supplement In Review
> 最后更新：2026-08-12

## 1. 需求审查

- [ ] 用户、场景、优先级和非目标明确。
- [ ] 验收标准可自动化或记录手工缺口。
- [ ] 与 Legacy 的等价/差异边界明确。
- [ ] 权限、隐私、数据和浏览器差异已考虑。
- [ ] 需求已映射任务和测试层级。

## 2. 架构审查

- [ ] 运行上下文和信任边界明确。
- [ ] Domain 无浏览器/UI/DOM 反向依赖。
- [ ] 状态有唯一 owner，生命周期与 teardown 明确。
- [ ] 消息、存储和公共 API 有类型、Schema、错误和兼容策略。
- [ ] 无循环依赖、全局可变单例或隐式跨模块通道。
- [ ] 失败可隔离、可诊断、可回退。

## 3. 安全与隐私审查

- [ ] 权限逐项有用途、调用点、测试和用户文案。
- [ ] 无远程代码、`eval`、`new Function`、CSP 绕过。
- [ ] 页面消息不可信，sender/nonce/payload 全校验。
- [ ] 导入/URL/HTML/日志均有校验或脱敏。
- [ ] 数据最小化、清除、导出和保留期明确。
- [ ] 依赖、许可证、SBOM 和产物检查通过。

## 4. 测试审查

- [ ] 先有失败复现或契约测试。
- [ ] 正常、边界、错误、并发和 teardown 场景齐全。
- [ ] 真扩展 E2E 覆盖关键路径。
- [ ] Chrome/Firefox 差异已验证。
- [ ] 测试不依赖生产站点或固定长 sleep。
- [ ] 覆盖率和 flaky 指标达到门槛。

## 5. UI/组件审查

- [ ] 组件只依赖 view model/application facade。
- [ ] loading/empty/error/permission denied 状态齐全。
- [ ] 键盘、焦点、ARIA、对比度和缩放通过。
- [ ] 文案国际化，无不可信 innerHTML。
- [ ] 页面 overlay 样式隔离且可销毁。

### 5.1 Phase 6.5 媒体体验专项

- [ ] 页面控件和反馈先绑定稳定 `mediaId`/anchor，不以 `document.documentElement` fixed panel 作为默认交付形态。
- [ ] 播放中默认折叠/低可见；hover/focus/pause/touch/hidden 的状态和延迟收起可测试。
- [ ] 快捷键、Overlay、Popup 使用同一命令结果和反馈事件，展示最终值而非“已发送”。
- [ ] global/site/page/media 倍速作用域、来源、写回和“仅当前媒体”行为已由产品确认。
- [ ] 新媒体、重播、SPA 换集、`src` 变化和 website reset 的策略应用幂等、有界、可诊断。
- [ ] 多媒体、广告/背景音频、audio、iframe/no-anchor、字幕/原生控件有支持或明确降级。
- [ ] headed 视觉、焦点、触控、30 分钟 churn 和 Tier 1 live smoke 均有冻结环境与 artifact。

## 6. 站点适配器审查

- [ ] 匹配范围不过宽，优先级可解释。
- [ ] capability 声明与实际一致。
- [ ] setup 返回 teardown，异常被隔离。
- [ ] 优先声明式 selector，命令式 Hook 有理由。
- [ ] fixture、owner、Tier 和最近验证日期齐全。
- [ ] generic adapter 未被破坏。

## 7. 发布审查

- [ ] P0/P1 状态符合 Go 条件。
- [ ] 升级、迁移、恢复和回滚演练成功。
- [ ] 产物可复现、可安装、hash/SBOM 完整。
- [ ] 权限/隐私/store listing 与代码一致。
- [ ] 已知问题、支持与 incident 路径准备好。
- [ ] 两轮候选目标矩阵通过。
