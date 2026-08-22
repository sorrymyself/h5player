# Web Extension 非功能需求

> 文档 ID：REQ-002  
> 状态：In Review / Phase 6.5 UX Amendment<br>
> 负责人：Architect / Quality Owner  
> 最后更新：2026-08-12

## 1. 可维护性与类型安全

- **NFR-MAINT-001**：新扩展源代码使用 TypeScript `strict`，禁止在业务代码中长期使用隐式 `any`。
- **NFR-MAINT-002**：领域层不得导入浏览器 API、WXT/Vite、Vue 或具体 UI 组件。
- **NFR-MAINT-003**：跨模块只通过公开入口导入，禁止绕过包边界访问内部文件。
- **NFR-MAINT-004**：每个公共接口有 TSDoc、输入/输出类型、错误语义和测试。
- **NFR-MAINT-005**：消息、配置、迁移和导入数据必须同时具备静态类型与运行时 Schema。
- **NFR-MAINT-006**：单文件建议不超过 400 行；超过 600 行必须在审查中说明并登记拆分计划。
- **NFR-MAINT-007**：循环依赖为零；由 CI 静态检查。

## 2. 性能与资源

以下指标在 Phase 0 建立固定硬件/浏览器基线后可校准，但不得无指标发布：

- **NFR-PERF-001**：空白测试页无媒体时，扩展初始化 p95 不超过 50ms，5 秒空闲窗口内不得产生扩展引起的持续长任务。
- **NFR-PERF-002**：媒体插入到可响应核心命令的 p95 不超过 150ms。
- **NFR-PERF-003**：MutationObserver 回调必须批处理/节流；空闲页不得使用短周期轮询发现媒体。
- **NFR-PERF-004**：content、MAIN world 与 background 初始脚本分别设置 gzip 预算；初始建议上限为 250KB、200KB、150KB，UI 与实验模块按需加载。
- **NFR-PERF-005**：连续 30 分钟 SPA/多媒体压力测试后，媒体会话、监听器和 DOM 节点数量回到可解释范围，无单调增长。
- **NFR-PERF-006**：service worker 可随时休眠和重启，不能依赖常驻内存作为唯一状态源。
- **NFR-PERF-007（Phase 6.5 In Review）**：媒体发现到页面 quick controls 可交互 p95 ≤150ms；命令成功到媒体级反馈首次可见 p95 ≤100ms，测量方法和浏览器基线必须归档。
- **NFR-PERF-008（Phase 6.5 In Review）**：反馈默认可见 1.5～2.0 秒；连续同类操作不得形成提示堆叠；页面 UI 默认覆盖媒体主体目标 ≤20%，超出时必须收缩或降级并留有截图证据。

## 3. 可靠性

- **NFR-REL-001**：重复初始化具有幂等性；同一 frame 只存在一个有效会话。
- **NFR-REL-002**：一个站点适配器、UI 组件或实验功能失败不得阻止通用媒体核心工作。
- **NFR-REL-003**：配置写入使用原子更新或冲突合并，跨 Tab 并发修改不得丢失无关字段。
- **NFR-REL-004**：Schema 迁移失败时保留原始备份并回到上一个可读版本或安全默认值。
- **NFR-REL-005**：关键用户操作失败必须返回结构化错误，并在 UI 中提供可行动说明。
- **NFR-REL-006**：浏览器更新或页面 API 缺失时按能力降级，不通过未捕获异常停止整个扩展。
- **NFR-UXREL-001（Phase 6.5 In Review）**：同一 `mediaId` 最多一个 UI host 和一个反馈 presenter；媒体移除、页面停用、权限撤销和 frame 销毁后 host/listener/observer/timer 无残留。
- **NFR-UXREL-002（Phase 6.5 In Review）**：策略应用按 lifecycle generation 幂等去重；website reset 的重试有界，不使用无限 interval 维持倍速保护。
- **NFR-UXREL-003（Phase 6.5 In Progress）**：媒体控制权仲裁必须在 `document_start` 的 MAIN world 安装，getter 行为透明，冲突 setter 不抛出未捕获异常；扩展 teardown 只恢复自己仍持有的 descriptor，不覆盖网站在运行期间合法替换的 descriptor。
- **NFR-UXREL-004（Phase 6.5 In Progress）**：控制保护不得依赖短周期常驻轮询。setter 仲裁是第一道防线，媒体事件/状态观察和有界恢复是第二道防线；单站异常可按属性或 adapter 关闭，不能拖垮 Generic Core。

## 4. 安全与隐私

- **NFR-SEC-001**：禁止远程代码、`eval`、`new Function`、内联动态代码和全站 CSP 改写。
- **NFR-SEC-002**：权限按功能最小化，新增权限必须有 ADR、威胁分析、UI 说明和测试。
- **NFR-SEC-003**：页面世界不可信；任何来自页面的消息都不得直接触发任意存储读取、剪贴板、下载、网络或标签页能力。
- **NFR-SEC-004**：持久化数据默认不包含完整浏览记录；站点键使用规范化 origin/站点 ID，播放进度可由用户关闭和清除。
- **NFR-SEC-005**：默认不上传日志、页面 URL、标题、媒体地址或配置；任何遥测必须单独 opt-in。
- **NFR-SEC-006**：依赖锁定、许可证检查、漏洞扫描、构建哈希和 SBOM 进入发布流程。

## 5. 兼容性

- **NFR-COMPAT-001**：核心用例在 Chrome、Edge、Firefox 支持矩阵中通过。
- **NFR-COMPAT-002**：浏览器差异只能出现在 platform adapter、manifest 生成和少量入口层。
- **NFR-COMPAT-003**：普通 DOM、Shadow DOM、同源 iframe、跨源 iframe、多播放器和 SPA 都有固定集成测试页面。
- **NFR-COMPAT-004**：站点适配器声明支持等级：Tier 0 通用、Tier 1 自动化保护、Tier 2 手工验证、Tier 3 社区维护/尽力支持。
- **NFR-COMPAT-005**：公开版本必须记录最低浏览器版本，不沿用当前 manifest 中未经验证的 Firefox 57 声明。

## 6. 可测试性

- **NFR-TEST-001**：时间、存储、浏览器能力、DOM 观察器和媒体对象通过可替换端口注入。
- **NFR-TEST-002**：站点适配器可使用静态 fixture 测试，不要求访问真实网站才能验证基本逻辑。
- **NFR-TEST-003**：核心命令具有确定输入输出；随机、时间与异步重试可控制。
- **NFR-TEST-004**：关键用户路径必须使用真实打包扩展 E2E，而不是仅在普通网页中 import 源码。
- **NFR-TEST-005**：Legacy 差分测试仅比较可观测行为，并保留允许差异清单。

## 7. 可访问性与国际化

- **NFR-A11Y-001**：popup/options/overlay 可用键盘完整操作，焦点顺序可预测且有可见焦点。
- **NFR-A11Y-002**：交互控件具有名称、状态和错误提示；颜色不是唯一信息载体。
- **NFR-A11Y-003**：文本与背景达到 WCAG 2.1 AA 对比度目标。
- **NFR-A11Y-004（Phase 6.5 In Review）**：媒体级控件和反馈在键盘焦点、触控、200% 缩放、reduced-motion、深色/浅色和 zh-CN/en-US 长文本下不遮挡、不截断且语义可读。
- **NFR-I18N-001**：UI 不直接硬编码面向用户的文本；至少完整支持 `zh-CN` 和 `en-US`。
- **NFR-I18N-002**：快捷键名称、数字、日期和复数规则通过国际化层格式化。

## 8. 可观测性与支持

- **NFR-OBS-001**：日志包含时间、上下文、模块、事件码和关联 ID，不记录敏感正文。
- **NFR-OBS-002**：诊断包大小有上限且默认脱敏，用户在导出前可预览。
- **NFR-OBS-003**：每个 P0/P1 故障模式有可识别状态码和排障建议。
- **NFR-OBS-004**：版本、构建提交、浏览器、manifest profile 和 Schema 版本可从关于/诊断页读取。

## 9. 质量目标

- 领域核心总体行/函数覆盖率不低于 85%，分支覆盖率不低于 80%。
- config、migration、message contracts、command registry 等关键包分支覆盖率不低于 95%。
- P0 用户路径 E2E 覆盖率 100%，P1 不低于 90%。
- Stable 发布时 Critical/High 已知安全漏洞为 0，P0/P1 未接受缺陷为 0。
- 所有构建产物通过 manifest lint、禁止模式扫描、依赖/许可证检查和安装验证。

## 10. 发布工程与证据

- **NFR-REL-007**：`web-extension/package.json#version` 是版本单一事实源；manifest、artifact name、release manifest、SBOM 和
  provenance 不得各自硬编码版本。
- **NFR-REL-008**：相同 commit、package/profile、冻结 lockfile、工具链和显式 `SOURCE_DATE_EPOCH` 的两次候选构建，规范 9
  文件 bundle 必须逐文件 SHA-256 一致；ZIP 必须拒绝危险路径、symlink、source map、重叠 entry、额外 metadata 和模式漂移。
- **NFR-REL-009**：候选 evidence 至少包括双浏览器 ZIP、checksums、release manifest、SPDX 2.3 SBOM、第三方许可证、测试摘要、
  兼容性报告和 provenance，并可由独立 verifier 重算 digest 和 manifest/权限/远程代码策略。
- **NFR-REL-010**：PR/nightly/RC CI 使用冻结依赖、最小只读权限、固定 action commit SHA；RC 不自动 tag、push、签名或商店上传。
- **NFR-REL-011**：真实站点、浏览器版本、headed 权限、商店签字、连续 Beta RC 与观察窗口必须有独立记录；fixture/local package
  证据不得提升为 Stable 资格。
- **NFR-REL-012**：无签名 provenance 必须明确标注 unsigned；Stable Go 必须额外获得受保护构建/商店签名、完整 gate 和人工审批。
