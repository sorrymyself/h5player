# Web Extension 重构现状基线审查（2026-08-10）

> 文档 ID：REVIEW-001  
> 状态：Approved  
> 审查人：Codex / 项目维护者待复核  
> 审查范围：仓库当前油猴主线、Web Extension、构建、测试、CI、权限与文档

## 1. 执行摘要

当前 Web Extension 是一个 Legacy 兼容壳，而不是独立工程：构建入口直接导入油猴运行时，content script 向页面注入单一 bundle，`inject.base.js` 模拟 GM API，background 通过放宽 CSP 提高注入成功率。该方式保留功能快，但类型、测试、权限、数据一致性、模块边界和商店合规均不足。

建议结论：保留油猴主线稳定发布；Web Extension 独立绿地重构；先建设消息/存储/权限/测试基础，再按纵向功能切片迁移。

## 2. 代码事实

### 2.1 构建与入口

- 油猴构建由 `package.json:13` 的 `build` 驱动，入口 `config/rollup.tree.config.js:25-33`，输出 `dist/h5player.user.js`。
- 扩展注入构建由 `package.json:14` 的 `build:inject` 驱动，入口 `config/rollup.tree.config.js:35-43`。
- `web-extension/inject.main.js:1-2` 先引入兼容层，再直接引入 `src/h5player/index.js`。
- `src/h5player/index.js:3-35` 用最多 200 次定时重试启动 Legacy 主线。
- `bin/build-web-extension.js:29-53` 直接 zip 整个目录，Chrome/Firefox 产物内容相同，未见 manifest profile 或校验。

### 2.2 扩展权限和运行方式

- `web-extension/manifest.json:20-29` 声明 storage、clipboard、DNR、webRequest、webRequestBlocking、activeTab 和 `<all_urls>`。
- `web-extension/manifest.json:34-49` 对全站在 document_start 注入 content，并公开 `inject.js`。
- `web-extension/background.js:9-31` 在 Chrome 修改所有主 frame/subframe CSP 为允许 `unsafe-inline`/`unsafe-eval`。
- `web-extension/background.js:57-81` 在 Firefox 使用 blocking webRequest 修改 CSP。
- `web-extension/content.js:4-61` 依次尝试外链、内联、Data URI 和 `new Function` 执行注入代码。

结论：这是高风险、难上架且与最小权限相冲突的注入策略，必须在新架构中删除。

### 2.3 GM 兼容层和数据一致性

- `web-extension/inject.base.js:8-69` 把 GM 存储同时映射到页面 localStorage 和异步 extension storage。
- `web-extension/inject.base.js:71-79` 的 value change listener 是空实现。
- `web-extension/inject.base.js:95-150` 把带函数的菜单项保存在页面数组，并尝试把 items 发送到扩展存储。
- `web-extension/inject.base.js:152-169` 对 tab API 仅提供空对象/简化实现，并把 `unsafeWindow` 设为 `window`。
- `web-extension/content.js:73-125` 通过字符串 type 接受页面消息，没有 nonce、协议或 payload 校验。

结论：兼容层不能完整模拟 GM 语义，并引入双存储、序列化和消息信任问题。

### 2.4 Legacy 复杂度与耦合

- `src/h5player/h5player.js:1-53` 汇聚原始方法、配置、TCC、FullScreen、媒体核心、UI、跨 Tab、Hook、下载、远程助手等大量依赖。
- `src/h5player/h5player.js:60-104` 以大型可变对象保存当前播放器、画面、配置和观察器状态。
- `src/h5player/h5player.js:212-226` 把调试对象挂到页面全局。
- `src/h5player/h5player.js:2657-2705` 允许页面外部自定义配置和函数入口。
- `src/h5player/h5PlayerTccInit.js:75-600` 在单一站点表中混合选择器、函数、Hook 和站点副作用。
- `src/h5player/monkeyMsg.js:98-131` 用 GM storage + 2 秒间隔实现跨 Tab 广播。
- `src/libs/monkey/configManager.ts:10-18` 自身说明旧聚合配置存在多页面覆盖问题；TS 文件仍大量使用 `Record<string, any>`。

结论：Legacy 适合作为行为资料，不适合直接成为新扩展领域模型。

### 2.5 UI、远程与实验能力

- `src/h5player/h5player.js:2805-2829` 初始化编译后的页面 UI 和远程 helper，兼容条件与运行时核心耦合。
- `src/h5player/remoteHelper.js:13-61` 通过隐藏远程 iframe 交换推荐/版本信息。
- `src/h5player/mediaSource.js` 与 `mediaDownload.js` 是实验能力，页面 Hook 和资源开销高。

结论：UI 应独立组件化；远程助手不应默认迁移；下载/MediaSource 必须后置并独立审查。

### 2.6 工程化基础

- `package.json:7-24` 只有构建、开发服务和文档脚本，没有 lint、typecheck、test、E2E、extension build/release 命令。
- `package.json:35-62` 已有 ESLint、Rollup、Vue 等依赖，但无 TypeScript、测试 runner 或 Playwright。
- `.eslintrc.cjs:1-25` 只有 Standard 基础配置，无 TS、边界和测试规则。
- 仓库没有 `tsconfig.json`、测试/spec 文件或 GitHub Actions workflow；`.github` 仅有 Issue 模板。
- `package.json:3` 版本为 4.3.5，而 `web-extension/manifest.json:4` 为 4.3.3。

结论：新扩展需要独立完整的工程闭环，版本与产物必须单一来源。

## 3. 可复用资产

可作为行为/设计输入，而非直接运行时依赖：

- 默认快捷键与功能语义：`src/h5player/configManager.js`。
- 通用媒体控制经验：`src/h5player/h5player.js`、`src/libs/utils/mediaCore.js`。
- 站点选择器和问题知识：`src/h5player/h5PlayerTccInit.js`。
- 多语言词条：`src/h5player/locale/`。
- 现有图标、品牌素材和用户文档。
- `src/libs/monkey/configManager.ts` 中关于多 Tab 配置冲突的领域知识。

## 4. 主要缺口

| 领域     | 当前缺口                               | 风险                    |
| -------- | -------------------------------------- | ----------------------- |
| 架构     | 页面、content、background、UI 混合     | 无法隔离故障/权限       |
| 类型     | JS 为主、TS 无 strict 工程             | 数据/消息错误运行时暴露 |
| 测试     | 单元、组件、集成、扩展 E2E 均无        | 重构无法证明行为        |
| 权限     | 全站 CSP/网络拦截/全 URL               | 安全与商店审核          |
| 数据     | localStorage + GM + extension storage  | 丢失、覆盖、迁移困难    |
| 站点适配 | 巨型 TCC 混合函数/选择器               | 难测试、单点故障        |
| 发布     | 手工 zip、版本漂移、无 artifact 元数据 | 不可复现/难回滚         |
| 运维     | 无结构化诊断和兼容矩阵                 | 用户问题难定位          |

## 5. 基线判定

- Legacy 状态：Stable / Protect。
- 当前 Web Extension 状态：Prototype / No stable-user compatibility obligation。
- 重构风险：High，但可通过独立边界和阶段门禁控制。
- 推荐首个执行目标：Phase 0 + Phase 1，而不是先迁移站点特例或 UI。
