# H5Player Web Extension

该目录同时保留旧的注入原型和新的 WXT 工程。根目录 Legacy 油猴构建仍可运行
`corepack yarn@3.7.0 build` / `build:inject`；新工程不会读取 Legacy 运行时，也不会改写根
`package.json`、`yarn.lock` 或 Rollup 配置。

## 新工程基线

- Node 24.13.x
- pnpm 11.21.0（独立 `pnpm-lock.yaml`）
- WXT 0.21.3 + Vite 8.2.1
- TypeScript 5.9.3 strict（TypeScript 7 暂不满足 typescript-eslint 兼容范围）
- Vue 3.5.41
- Vitest 4.1.10 + Playwright 1.62.1 + Selenium WebDriver 4.46.0
- ESLint 10.8.1 + typescript-eslint 8.66.0
- Zod Mini 4.4.3，用于运行时边界校验且避免标准构建中的 Function/JIT 路径

所有版本精确锁定。WXT 仍处于 `0.x`，升级必须独立 PR 并运行完整构建与 E2E。

## 常用命令

```bash
corepack pnpm@11.21.0 install --frozen-lockfile
corepack pnpm@11.21.0 check
corepack pnpm@11.21.0 test:coverage
corepack pnpm@11.21.0 test:security
corepack pnpm@11.21.0 test:compat:report
corepack pnpm@11.21.0 build:all
corepack pnpm@11.21.0 test:e2e
corepack pnpm@11.21.0 test:e2e:firefox
corepack pnpm@11.21.0 test:churn:smoke
corepack pnpm@11.21.0 test:churn
corepack pnpm@11.21.0 test:legacy
```

Chrome 与 Firefox 均构建 Manifest V3。Chromium E2E 加载真实打包扩展并实际终止 service
worker，验证媒体生命周期、设置恢复和长稳态；Firefox E2E 使用 Selenium Manager 与 Firefox
153 临时安装真实 MV3 包，覆盖核心媒体命令。Phase 2 证据与已知项见
`../project/09-reviews/phase-2-exit-review-2026-08-10.md`。

当前 required permissions 为 `storage`、`activeTab`、`scripting`，`<all_urls>` 仅为 optional host permission 且不会
静默请求。生产 manifest 没有静态 content script、required host 或 WAR；用户授权后由 background 动态注册固定的
isolated/MAIN 脚本。

Phase 5 增加静态 site adapter registry、Generic fallback、版本/功能 kill switch、运行时健康诊断，以及 5 个 Tier 1、
5 个 Tier 2 脱敏 fixture。`test:compat:report` 校验 catalog metadata、lastVerified、fixture SHA-256 baseline 和 183 天
复核时效。该证据不访问真实生产站点，不能表述为真实站点完整支持；详见
`../project/05-quality/site-adapter-matrix.md`。

## 目录边界

- `entrypoints/`：background、isolated content、page-main、popup、options。
- `src/domain/`：纯领域逻辑，不依赖 Vue、WXT 或浏览器 API。
- `src/application/`：用例和 runtime/settings/browser Port 契约。
- `src/infrastructure/`：WebExtension adapter、消息客户端、存储迁移、日志和时间实现。
- `src/runtime/`：background、content、page-main 的组装与信任边界。
- `src/adapters/`：Generic controller、站点 registry、静态 catalog 和本地 rollback policy。
- `src/shared/`：协议基础、ID、Result 等无副作用工具。
- `src/ui/`：Vue 展示组件。
- `tests/`：unit、component、integration、security、compatibility、E2E 和固定页面。
- `scripts/`：安全扫描、兼容报告、Firefox 真扩展 E2E 与 Legacy 构建回归。
- 旧 `background.js`、`content.js`、`inject.*`、`manifest.json`、`popup.*`：Legacy prototype，
  只供旧 `build:inject` 使用；新代码不得导入。
