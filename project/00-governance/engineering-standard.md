# Web Extension 工程开发规范

> 文档 ID：GOV-004  
> 状态：Approved  
> 负责人：Engineering Owner  
> 最后更新：2026-08-10  
> 关联：ADR-0004、QA-001、QA-002

## 1. 工作区策略

目标是在同一仓库维护两个相互隔离的产品线：

```text
root package / legacy scripts    # 现有油猴构建，保持命令和目录稳定
web-extension package           # 新扩展源码、测试和产物
project                          # 项目治理文档
docs                             # 面向用户/现有工程说明
```

Phase 0 已决定采用嵌套独立 package/lockfile：

- 根目录继续使用 Yarn 3.7.0、现有 `package.json`/`yarn.lock` 和 Rollup 配置，命令及依赖解析语义保持不变。
- `web-extension/` 使用 Node 24.13.x、pnpm 11.21.0、独立 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml` 和 `.npmrc`。
- 两套 package 不互相声明 workspace，不提升、复用或改写对方依赖；CI 分别执行 immutable/frozen install。
- 新扩展 PR 不得顺带修改 `src/h5player/`、`src/libs/`、`config/rollup*` 或 Legacy 产物。确需修改时必须建立独立 Legacy 任务、评审和回归基线。
- Legacy 保护基线为 `dist/h5player.user.js` SHA-256 `91b5312d7cf150cd852d005b1e5d5f3d8ed2ed7cd8a481dfa1d561d48f7b3f27`、561788 bytes；仅在批准的 Legacy 发布变更中更新。

## 2. 推荐技术栈

以下为 ADR-0004 已接受基线：

| 领域             | 推荐                                              | 说明                                                |
| ---------------- | ------------------------------------------------- | --------------------------------------------------- |
| 扩展框架/构建    | WXT（Vite-based）或等价薄封装                     | manifest profile、多入口、Chrome/Firefox 开发与打包 |
| 语言             | TypeScript strict                                 | 新业务代码强制；避免先 JS 后补类型                  |
| UI               | Vue 3 Composition API                             | 复用团队经验；只存在于 presentation 层              |
| Runtime Schema   | Zod 或等价库                                      | 消息、配置、导入、环境变量                          |
| Unit/Integration | Vitest                                            | 与 Vite/TS 一致，支持 fake timers/coverage          |
| Component        | Testing Library + axe                             | 以用户行为和可访问性测试                            |
| E2E              | Playwright                                        | 加载真实扩展与 fixture 页面                         |
| Static           | ESLint flat config + typescript-eslint + Prettier | 代码质量、import/安全规则                           |
| Release          | GitHub Actions + release-please/Changesets 二选一 | 单一版本源、可审查发布 PR                           |
| Supply chain     | audit + license check + SBOM                      | 进入 RC 门禁                                        |

不用框架生成器的内部全局状态作为领域状态；不用大型状态库解决简单 popup/options 状态。只有出现多页面共享复杂 client state 时，才以 ADR 引入 Pinia 等依赖。

## 3. 标准命令契约

新扩展 package 至少提供：

```text
dev                 Chromium 开发模式
dev:firefox         Firefox 开发模式
build               生产 profile 构建
build:chrome        Chrome 包
build:firefox       Firefox 包
typecheck           TS strict 检查
lint                ESLint
format              格式化
format:check        格式检查
test                快速单元/组件测试
test:unit           领域与应用单测
test:component      UI 组件测试
test:integration    runtime/port 集成测试
test:e2e            Chrome 扩展 E2E
test:e2e:firefox    Firefox build + web-ext lint + Selenium 真扩展 core E2E
test:coverage       覆盖率报告
test:security       禁止模式、消息与 manifest 安全检查
test:compat         浏览器/页面/adapter 矩阵
check               PR 本地总门禁
package             zip + metadata + hash
```

根目录可增加 `webext:*` 编排命令，但不得改变现有 `build`、`start` 和 docs 命令语义。

## 4. TypeScript 规范

- `strict: true`，并开启 `noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`useUnknownInCatchVariables` 等高价值规则；个别关闭需 ADR/注释。
- 禁止 `as any`、双重断言和非空断言作为常规逃生口；确有需要封装在 infrastructure 边界并测试。
- 外部输入先解析为 `unknown`，通过 Schema 后再进入 domain。
- 使用判别联合表达消息、命令和状态；避免通用 `Record<string, any>`。
- 业务错误使用 typed result/error code；不靠字符串匹配浏览器异常。
- 类型只从模块公共 `index.ts` 导出，防止深层路径耦合。
- 扩展浏览器全局类型集中在 infrastructure/entrypoint，不污染 domain tsconfig。

## 5. 代码与模块规范

- 一个文件一个核心职责；大文件按领域语义拆分，不按“utils2”拆分。
- `utils` 只放无领域语义的纯函数；媒体、设置、快捷键逻辑归属对应 domain。
- 禁止可变 module singleton 作为跨页面或跨测试状态。
- listener、observer、timer、port、object URL 和 DOM 节点必须有 teardown。
- 异步操作接受 `AbortSignal` 或明确取消/超时策略。
- 统一使用原始方法封装处理 hostile page，不在各功能重复保存 `window.*` 引用。
- 生成文件与源码分离；构建产物不进入代码审查 diff，除非发布策略明确要求。

## 6. 配置与环境

- dev/beta/prod 差异通过 typed profile，不通过散落的 `process.env` 字符串判断。
- manifest、版本、远程 endpoint、debug 开关和功能 flag 有单一来源。
- `.env` 只能保存非秘密本地配置；商店密钥/签名凭据使用 CI secret，不进入日志或 artifact。
- feature flag 必须定义 owner、默认值、到期版本和删除任务；禁止永久旗标墓地。

## 7. 依赖治理

- 引入依赖前记录：用途、体积、维护活跃度、许可证、安全历史、替代方案、是否进入页面 bundle。
- 优先 Web Platform/小型专用库，避免仅为一个函数引入大型依赖。
- 生产依赖和开发依赖严格区分；浏览器 bundle 禁止包含 Node polyfill 意外依赖。
- 依赖升级由 Renovate/Dependabot 或等价机器人创建独立 PR；major 升级必须跑完整 E2E。
- 删除未使用依赖，CI 检查 dead dependency 和重复版本。

## 8. Git、PR 与审查

- 一个 PR 对应一个任务或紧密相关任务集合。
- 不在扩展 PR 中格式化 Legacy 目录或提交无关产物。
- Commit 可采用 Conventional Commits，release 工具从批准的变更记录生成版本，不直接从任意 commit 文本自动发布。
- 高风险 PR 至少包含 Architecture/Security/Quality 三种审查视角；单人项目使用分时清单保存自审证据。
- PR 必须可独立回滚；破坏性迁移和功能代码尽量分开提交。

## 9. CI 作业图

```text
changes
  ├─ legacy-build
  ├─ static (format/lint/type/boundaries/security)
  ├─ unit + component + coverage
  ├─ build-chrome ─┐
  └─ build-firefox ├─ artifact-inspect ── e2e-smoke
                   └─ manifest-check
nightly: full-e2e + compatibility + stress + supply-chain
release: all gates + package + provenance + draft release
```

所有 required checks 使用相同锁文件和 Node/Yarn 版本；CI 不能依赖维护者本机已有全局工具。

## 10. 本地开发体验

- 一条命令启动目标浏览器和 fixture 服务。
- 可在 popup/options/page-main/content/background 分别看到带上下文的日志。
- 提供最小 seed settings、清理 profile 和重置 storage 命令。
- 开发文档记录 debugger 连接、service worker 重启、frame/Shadow DOM 测试和常见 CSP 问题。
- 本地 hook 可加速反馈，但合并依据始终是 CI，不把关键门禁只放在 pre-commit。

## 11. 工程规范验收

Phase 0 Exit 时必须证明：全新 clone 按 README 能完成 install、typecheck、test、build 和至少一个 E2E；Legacy build 同时通过；无隐式全局依赖、未记录安装步骤或维护者本机专属路径。
