# 模块目录与契约

> 文档 ID：ARCH-002  
> 状态：In Review / Phase 6.5 UX Module Amendment
> 负责人：Architect  
> 最后更新：2026-08-12

## 1. 模块职责表

| 模块                                           | 所在层         | 负责                                             | 不负责                              | 主要契约                                                |
| ---------------------------------------------- | -------------- | ------------------------------------------------ | ----------------------------------- | ------------------------------------------------------- |
| `domain/media`                                 | Domain         | 媒体模型、状态、能力和不变量                     | DOM 查询、浏览器 API                | `MediaSession`, `MediaCapabilities`                     |
| `domain/command`                               | Domain         | 命令类型、校验、结果和错误                       | 快捷键监听、按钮渲染                | `MediaCommand`, `CommandResult`                         |
| `domain/visual`                                | Domain         | 画面/展示状态、范围、纯变换与序列化              | DOM style 写入                      | `VisualState`, `MediaPresentationState`                 |
| `domain/capture`                               | Domain         | 截图 options/artifact 上限与错误                 | Canvas/下载                         | `CaptureArtifact`, `CaptureFailure`                     |
| `domain/download`                              | Domain         | 实验下载 disposition、失败码和资源边界           | 页面/浏览器保存副作用               | `MediaDownloadDisposition`, `MediaDownloadFailure`      |
| `domain/progress`                              | Domain         | 匿名 identity、record、TTL/容量策略              | storage 写入                        | `ProgressIdentity`, `ProgressRecord`                    |
| `domain/settings`                              | Domain         | 设置模型、默认值、合并规则                       | storage 读写                        | `Settings`, `SiteOverride`                              |
| `domain/playback-policy`                       | Domain         | 倍速意图、作用域、来源、优先级和保护策略         | DOM/媒体写入                        | `PlaybackRatePolicy`, `PolicyResolution`                |
| `domain/feedback`                              | Domain         | 可序列化反馈事件、合并/过期和错误语义            | DOM 定位与渲染                      | `MediaFeedbackEvent`, `FeedbackResult`                  |
| `domain/adapter`                               | Domain         | 站点适配器接口与能力声明                         | 具体站点选择器                      | `SiteAdapter`                                           |
| `application/media`                            | Application    | 发现、选择 active player、执行用例               | 浏览器 API 细节                     | `MediaService`                                          |
| `application/playback-policy`                  | Application    | 解析策略、写回用户意图、协调生命周期             | 直接操作 HTMLMediaElement           | `PlaybackPolicyService`, `PlaybackLifecycleCoordinator` |
| `application/progress`                         | Application    | progress identity/use case 与 repository port    | DOM/source 读取                     | `ProgressService`, `ProgressRepositoryPort`             |
| `application/media/cross-tab`                  | Application    | advisory event 构造、过滤、分发统计              | 自动暂停/仲裁                       | `CrossTabMediaEventService`                             |
| `application/settings`                         | Application    | 配置读取、更新、迁移用例                         | 直接操作 storage                    | `SettingsService`                                       |
| `application/diagnostics`                      | Application    | 诊断聚合、脱敏和导出                             | UI 文件下载                         | `DiagnosticsService`                                    |
| `infrastructure/dom`                           | Infrastructure | DOM/媒体端口、观察器和清理                       | 业务决策                            | `MediaDomPort`                                          |
| `infrastructure/dom/media-anchor`              | Infrastructure | `mediaId` 到媒体/容器几何、定位、避让和 teardown | 倍速策略与命令决策                  | `MediaAnchorRegistry`                                   |
| `infrastructure/storage`                       | Infrastructure | storage adapter、版本、并发                      | 页面 DOM                            | `StorageRepository`                                     |
| `infrastructure/messaging`                     | Infrastructure | Envelope 编解码、超时、nonce                     | 业务路由决策                        | `MessageBus`                                            |
| `infrastructure/browser`                       | Infrastructure | tabs、permissions、clipboard、downloads          | 领域规则                            | 各 Browser Port                                         |
| `runtime/page-main`                            | Entrypoint     | 页面世界组装和 Hook                              | 扩展全局权限                        | `PageRuntime`                                           |
| `runtime/content`                              | Entrypoint     | 隔离世界桥、overlay、frame 生命周期              | 持久化权威逻辑                      | `ContentRuntime`                                        |
| `runtime/background`                           | Entrypoint     | service worker 路由、持久化、扩展能力            | DOM/媒体对象                        | `BackgroundRuntime`                                     |
| `ui/popup`                                     | Presentation   | 当前 Tab 快速操作                                | 浏览器 API 直调                     | `PopupViewModel`                                        |
| `ui/options`                                   | Presentation   | 全局设置、导入导出、诊断                         | 业务规则                            | `OptionsViewModel`                                      |
| `ui/overlay`                                   | Presentation   | 当前媒体高频操作                                 | 全局设置仓储                        | `OverlayViewModel`                                      |
| `ui/overlay/quick-controls`                    | Presentation   | 折叠/展开的媒体级高频控件                        | HTMLMediaElement、storage           | `MediaQuickControls`                                    |
| `ui/overlay/feedback`                          | Presentation   | 当前媒体短时最终值/错误反馈                      | 全局 toast、命令直调                | `MediaFeedbackPresenter`                                |
| `ui/files/download-capture`                    | Presentation   | Artifact 校验、Blob 下载、URL 清理               | 浏览器 downloads 权限               | `downloadCaptureArtifact`                               |
| `adapters/generic`                             | Adapter        | 通用 HTMLMediaElement 行为                       | 站点特例                            | `GenericAdapter`                                        |
| `adapters/generic/experimental-media-download` | Adapter        | 受开关控制的直链/MSE 捕获、预算与生命周期清理    | 扩展授权与持久化设置、最终安全 sink | `ExperimentalMediaDownloadManager`                      |
| `adapters/registry`                            | Adapter        | 匹配、优先级、fallback、disable、health          | 远程规则与持久化                    | `MediaAdapterRegistry`                                  |
| `adapters/sites/*`                             | Adapter        | 单站点选择器、Hook、测试                         | 修改核心状态模型                    | `SiteAdapter`                                           |
| `test-support`                                 | Test           | fake ports、fixture、页面                        | 生产逻辑                            | 测试工厂                                                |

## 2. 依赖规则

允许：

- `domain/*` 互相依赖有限的 shared value objects。
- `application/*` 依赖 domain 和抽象 ports。
- `infrastructure/*` 实现 domain/application 定义的 ports。
- `runtime/*` 组装 application、infra 和 adapters。
- `ui/*` 依赖 application facade 与共享 view model。
- `infrastructure/dom/media-anchor` 可以持有 DOM handle，但只能向 application/UI 提供稳定 `mediaId`、几何和 teardown port；domain/application 不得反向导入 DOM。
- `ui/overlay/quick-controls` 与 `ui/overlay/feedback` 不得自行解析 DOMRect、写 settings 或直接给媒体赋值；所有意图和结果经过 facade/command/policy。

禁止：

- Domain 导入 `chrome`、`browser`、`document`、`window`、Vue、Shoelace。
- Site adapter 直接写 storage、发送 runtime message 或修改全局 UI。
- UI 直接操作 `HTMLMediaElement` 或调用 `tabs.sendMessage`。
- Page-main 直接访问扩展资源 URL 或 service worker 内存。
- 任意新模块导入 `web-extension/inject.js`、`inject.base.js` 或 Legacy `src/h5player`。

## 3. 公共接口最低要求

每个公共接口必须定义：

- 输入类型与运行时校验；
- 成功结果与错误码；
- 生命周期（创建、更新、销毁）；
- 并发和幂等语义；
- 日志/诊断事件；
- 单元或契约测试位置。

## 4. SiteAdapter 契约草案

```ts
interface SiteAdapterContext {
  readonly origin: string;
  readonly url: URL;
  readonly frameId: number;
  readonly media: MediaDomPort;
  readonly logger: LoggerPort;
}

interface SiteAdapter {
  readonly id: string;
  readonly priority: number;
  readonly match: (context: SiteAdapterContext) => boolean;
  readonly capabilities?: Partial<MediaCapabilities>;
  readonly setup?: (context: SiteAdapterContext) => Teardown;
  readonly resolveAction?: (
    action: SiteAction,
    context: SiteAdapterContext,
  ) => Result<ActionResult, DomainError>;
}
```

适配器必须是纯注册对象或可控工厂；`setup` 返回清理函数，所有异步任务与 listener 都绑定生命周期。

## 5. 命令注册表

命令注册表是唯一的功能入口：

```ts
interface CommandHandler<C extends MediaCommand = MediaCommand> {
  readonly type: C["type"];
  readonly requiredCapability?: keyof MediaCapabilities;
  execute(command: C, context: CommandContext): Promise<CommandResult>;
}
```

快捷键、popup、overlay、站点适配器和扩展命令都只能 dispatch 命令。这样可以在没有 UI 的情况下测试行为，也能统一权限和错误处理。

## 6. 模块验收

模块完成需满足：

- 公开入口和依赖方向通过静态检查；
- 输入/输出类型和 Schema 已登记；
- 生命周期清理测试通过；
- 失败场景有结构化错误；
- 至少一个消费方通过契约测试；
- 文档中的禁止依赖扫描无新增例外。

## 7. Phase 4 边界补充

- native media/capture binding 属于 `adapters/generic`，因为它实现 generic controller 的 DOM 边界；不得放入
  `infrastructure/dom` 后再反向依赖 adapter。
- Overlay component 不导入 content runtime、browser API 或 `HTMLMediaElement`；controller 负责 view model/intent，
  entrypoint 只组装 Vue、ShadowRoot 和 runtime port。
- progress repository 复用 SettingsRepository 的串行 mutation/revision/Schema，不建立独立 localStorage 或内存权威。
- cross-tab event 是 advisory transport，不得被 application/domain 当作播放权威状态。

## 8. Phase 5 Adapter 实现契约

- Production runtime 只注入一个 `MediaAdapterRegistry`；MediaDiscovery、CommandRegistry 和 PageBridge 不感知站点分支。
- Registry 必须先创建 Generic controller，再由 site controller 包装；站点 selector/Hook 未命中、抛错或被禁用时回退 Generic。
- 匹配规则是静态 hostname/path prefix；priority 降序，同优先级按 id 排序。不得从页面、网络或用户函数加载规则。
- Registry 对 catalog、disable policy 和 Hook 表做运行时校验与防御性冻结；adapter 数量、selected count 和 failure count
  必须与 application Schema 上限一致。
- Site catalog 只声明 owner/version/tier/support/fixture/date/features/selectors；静态受限 Hook 通过 registry 工厂注册，必须
  有 attach/detach 测试，且不能写 storage、runtime message 或全局 UI。
- selector 先在目标媒体父容器内解析，再回退 document；Hook 使用同一受控查询函数，避免直接持有可变 selector 来源。
- disable policy 只支持精确 adapter version 和 feature，随扩展构建发布；不建立远程 kill switch。
- runtime diagnostics 只传递 bounded adapter metadata、selected/status/failureCount/disabledFeatures，不传 URL path、title、
  media source、DOM 文本或异常堆栈。
- 当前 target 仍为 `HTMLMediaElement`；非原生 player target、closed Shadow DOM 穿透和任意 player API 不在 Phase 5。

## 9. 实验下载边界补充

- `ExperimentalMediaDownloadManager` 只在 resolved `allowExperimental=true` 时安装 URL/MediaSource/SourceBuffer Hook；关闭、站点停用、临时停用和 teardown 必须同步恢复原生方法并废弃当前 capture generation。
- 只允许启用后新建且从首个 append 开始捕获的 MediaSource 下载；禁止关闭再开启后继续拼接旧流。
- 单流、页面和 chunk 数均有硬上限；revoke、sourceclose、媒体切源、等待超时、下载完成和 teardown 必须释放引用与字节预算。
- `endOfStream('network'|'decode')` 是失败终态，不得触发 queued 自动下载。
- 当前 MAIN bridge 不是 capability authorization。isolated content 必须按持久化 settings 再次门禁，并拒绝 synthetic 下载快捷键。
- EXT-154 完成前，MAIN 中的最终 anchor sink 是已登记风险；目标结构是 MAIN bounded prepare、isolated/background 最终保存，页面响应按不可信 artifact 处理。

## 9. Phase 6.5 UX 模块边界（In Review）

- `MediaAnchorRegistry` 按 `mediaId` 管理 host、geometry observer、placement fallback、visibility 和 teardown；不得恢复 document-level fixed panel。
- `PlaybackPolicyResolver` 是纯函数；Settings Repository 保存 global/site 用户意图，page session 只在 content runtime，media actual 只在 page-main controller。
- `PlaybackLifecycleCoordinator` 订阅 MediaDiscovery 生命周期和 policy change，向 controller 发出幂等 apply intent；它不以定时轮询替代事件生命周期。
- `MediaFeedbackPresenter` 只消费 `MediaFeedbackEvent + AnchorSnapshot`；无 anchor/audio/iframe-only 使用显式 fallback，不把错误反馈升级为全局大面板。
- 所有新增模块必须有无 DOM 单测、生命周期集成测试、至少一个真实扩展消费方和 dependency boundary 扫描；实现前需通过 `ARCH-UX-001` 审核。
