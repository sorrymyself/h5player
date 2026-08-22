# ADR-0004：采用 WXT/Vite + TypeScript + Vitest + Playwright 的多入口体系

> 状态：Accepted  
> 日期：2026-08-10  
> 决策人：Architecture / Engineering / Quality  
> 关联：`NFR-MAINT-*`、`NFR-TEST-*`

## Context

仓库当前使用 Rollup 直接构建油猴产物，没有 TypeScript 配置、测试脚本或扩展真实加载测试。新扩展需要多入口 manifest、快速开发、类型检查、单元/组件测试和浏览器端 E2E。

## Decision

- WXT + Vite：manifest profile、多浏览器入口、开发服务器、静态资源和打包。
- TypeScript：`strict` 类型检查；新业务代码不使用 JavaScript。
- Vue 3：仅用于 popup/options/overlay presentation；领域层不绑定 Vue。
- Vitest + Testing Library：领域、应用、组件和契约测试。
- Playwright：加载真实 unpacked extension，覆盖 Chromium。
- Selenium WebDriver 4 + Selenium Manager：临时安装 Firefox MV3 扩展并执行真实浏览器 core E2E；驱动在运行时解析/下载，不进入 pnpm install 生命周期。
- ESLint + TypeScript ESLint + Prettier：统一静态质量。
- Zod Mini：消息、配置、导入数据运行时校验，同时避开标准 Zod 构建中的 JIT/`Function` 路径。

新扩展使用独立 Node/pnpm 环境和独立锁文件；根目录 Yarn/Rollup 构建不是 workspace 成员，不得被新工程改写。

## Accepted version baseline

| 能力                          | 版本            |
| ----------------------------- | --------------- |
| Node                          | 24.13.0         |
| pnpm                          | 11.21.0         |
| WXT / Vite                    | 0.21.3 / 8.2.1  |
| TypeScript / vue-tsc          | 5.9.3 / 3.3.9   |
| Vue                           | 3.5.41          |
| Vitest / Playwright           | 4.1.10 / 1.62.1 |
| ESLint / typescript-eslint    | 10.8.1 / 8.66.0 |
| Zod Mini                      | 4.4.3           |
| Prettier / dependency-cruiser | 3.9.6 / 18.1.1  |
| web-ext                       | 10.6.0          |
| Selenium WebDriver / types    | 4.46.0 / 4.35.6 |

版本均在 `web-extension/package.json` 精确锁定并由 `pnpm-lock.yaml` 固化。WXT 仍是 `0.x`，升级必须使用独立变更并跑完整双浏览器构建与 E2E。

TypeScript 没有采用 registry 当时提供的 7.0.2：`typescript-eslint@8.66.0` 的受支持范围要求 TypeScript `<6.1.0`。5.9.3 是本次 spike 时最新的兼容稳定版本；待 lint 工具链正式支持后再单独评估升级。

## Spike result

1. WXT 能生成 `.output/chrome-mv3` 与 `.output/firefox-mv3`，background、content、popup、options 与 MAIN-world 页面运行时均有独立入口。
2. Phase 0 的普通 `entrypoints/page-main.ts` spike 被 WXT 视为 unlisted script，因此当时采用 `defineUnlistedScript` + `injectScript()` + WAR。Phase 2 的 hostile-page 验证发现异步注入竞态；生产实现已按 ADR-0006 改为声明式 `world: 'MAIN'` content-script 入口。
3. Chromium Playwright 会加载真实打包扩展，验证 service worker、content、page-main 和 popup 的完整 smoke 链路。
4. Firefox MV3 产物通过 `web-ext lint`，无 error；存在一条来自 Vue runtime 静态 `innerHTML` 优化路径的 `UNSAFE_VAR_ASSIGNMENT` warning。业务源码未使用不可信 HTML，该告警作为工具链已知项跟踪，不允许泛化为业务代码豁免。
5. `zod` 标准入口会令产物包含 `Function('')` 的 JIT 能力检测，不满足动态执行禁令；改用 `zod/mini` 后源码及双浏览器产物安全扫描通过。
6. Legacy 继续由 `corepack yarn@3.7.0 build` 构建；SHA-256、字节数和 Git diff 均保持基线不变。
7. Firefox 153 真扩展 E2E 已通过；Selenium Manager 运行时提供 geckodriver，避免 pnpm 忽略/批准第三方下载脚本。

## Acceptance evidence

Phase 0 已证明：

1. Chrome/Firefox dev profile 都能生成可加载扩展。
2. service worker、content、page-main、popup、options 多入口可调试。
3. Vitest 能运行纯 Node 测试，Playwright 能安装并连接扩展。
4. source map、manifest 权限和 zip 产物可检查。
5. 热更新不会污染 Legacy 构建链。
6. 框架生成的 manifest、权限、入口和资源可被静态检查，且不存在无法绕开的运行时黑盒。

证据命令与结果记录在 `project/09-reviews/phase-0-exit-review-2026-08-10.md`。

## Consequences

- 新扩展可以独立演进现代工程栈，但需要同时维护根 Yarn 与子目录 pnpm 两套明确隔离的开发命令。
- MAIN-world 入口采用 ADR-0006 的声明式 content script，并经过会话桥；不能恢复 Legacy 的 CSP 放宽、WAR/inline/Data URI 或动态函数兜底。
- Firefox 真浏览器 E2E 已纳入 `test:e2e:firefox`；Firefox ESR、Edge 和最低版本仍按兼容矩阵分阶段补齐。
- Vue 仅限 presentation；domain/application 不得导入 Vue、WXT 或浏览器全局。
