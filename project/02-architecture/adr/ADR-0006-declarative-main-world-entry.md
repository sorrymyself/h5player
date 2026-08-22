# ADR-0006：使用声明式 MAIN world content script 消除注入竞态

> 状态：Accepted  
> 日期：2026-08-10  
> 决策人：Architecture / Runtime / Security / Quality  
> 关联：ADR-0002、ADR-0004、EXT-047、EXT-051

## Context

Phase 0 的浏览器 spike 使用 WXT `defineUnlistedScript`、`injectScript()` 和最小
`web_accessible_resources`（WAR）来加载 page-main。该方案能复用既有桥接逻辑，但资源注入是异步的：在 `document_start`
之后到脚本真正执行之间，页面脚本可能先重写 `HTMLMediaElement` 原生属性或方法。对 hostile page 而言，这会造成不可预测的原始引用捕获结果，也让 WAR 成为不必要的权限/资源面。

## Decision

生产扩展使用 WXT 的声明式 content-script 入口声明 MAIN world：

- `entrypoints/page-main.content.ts`：`world: 'MAIN'`、`runAt: 'document_start'`、`allFrames: true`。
- `entrypoints/content.ts`：isolated world 同样在 `document_start`、`allFrames: true` 启动桥和页面运行时。
- 删除运行时 `injectScript()`、`defineUnlistedScript` 入口及 `web_accessible_resources` 中的 `page-main.js`。
- MAIN world 仍只处理页面媒体和不可信页面数据；所有特权操作继续经 isolated content、版本化 Envelope 和 background sender/capability policy。

这只替代 page-main 的装载机制，不改变 ADR-0002 的上下文边界、nonce/replay 校验或消息协议。

## Alternatives considered

- **保留异步 `injectScript()` + WAR**：存在 hostile page 竞态，否决。
- **重新引入 inline/Data URI/动态函数注入**：违反 CSP、商店安全和本项目禁止动态执行规则，否决。
- **只在 isolated world 读取媒体**：无法稳定处理页面同 realm 对原生属性的重写，否决。

## Consequences

正面影响：

- 浏览器在声明的执行时机装载 MAIN world，原生引用捕获不再依赖异步网络/资源注入完成时间。
- 不需要 WAR，manifest 资源面更小，CSP/hostile/Cross-frame 测试更直接。
- Chrome 与 Firefox 共享同一 manifest 语义；每个 frame 独立初始化和 teardown。

代价与约束：

- 需要继续维护 WXT 入口元数据和双浏览器 manifest 构建验证。
- `document_start` 不是对同 realm 页面脚本的秘密隔离；页面输入仍必须视为不可信，不能把 nonce 当作特权凭据。
- 真实站点授权/注册仍由 Phase 3 权限 onboarding 负责，当前 fixture matches 不代表扩大运行范围。

## Evidence

- Chrome：`tests/e2e/extension-smoke.spec.ts` 的 basic、SPA/Shadow、hostile/CSP/iframe 场景通过。
- Firefox 153：`scripts/firefox-e2e.ts` 临时安装 `.output/firefox-mv3`，验证 MAIN/content/background/popup 与核心媒体命令。
- `web-ext lint`：0 errors；Vue runtime 保留 1 条已登记 `UNSAFE_VAR_ASSIGNMENT` warning。
- `scripts/security-scan.ts`：双浏览器产物无动态执行、远程脚本或业务 innerHTML assignment。
