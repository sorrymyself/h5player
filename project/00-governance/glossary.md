# Web Extension 重构术语表

> 文档 ID：GOV-005  
> 状态：Approved  
> 最后更新：2026-08-12

| 术语                        | 定义                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| Legacy / 油猴主线           | 现有 `src/` 油猴脚本及其构建/发布行为；本项目默认保护的稳定基线。                         |
| Web Extension / 扩展        | 本项目新建的 Manifest V3 浏览器扩展产品线；与 Legacy 独立发布。                           |
| Page MAIN world             | 网页脚本所在的页面世界，可接触原生媒体对象和站点脚本行为，但不应直接拥有扩展权限。        |
| Isolated world              | content script 所在的扩展隔离世界，负责页面桥、overlay 和 frame 生命周期。                |
| Service worker / background | 扩展后台上下文，负责权限、消息路由、持久化和扩展级能力。                                  |
| Popup                       | 点击扩展图标打开的短生命周期页面，用于当前 Tab 快速操作。                                 |
| Options                     | 扩展设置页，用于全局设置、站点规则、数据管理和诊断。                                      |
| Overlay                     | 注入网页的页面内 UI，通常挂载在 Shadow DOM 中。                                           |
| Media Anchor                | 与具体 `mediaId` 绑定的媒体元素或局部容器几何锚点；页面控件和反馈据此定位，不等同于视口。 |
| Media Quick Controls        | 绑定当前媒体的低干扰高频控件，默认折叠或低可见；不包含全局设置面板。                      |
| Media Feedback              | 由命令结果/媒体快照产生、归属于 `mediaId` 的短时最终值或错误提示。                        |
| Playback Intent             | 用户明确希望持续应用的倍速意图，与某媒体当前实际倍速分离。                                |
| Playback Policy             | 根据 global/site/page scope、能力和保护开关解析出的有效倍速策略。                         |
| Lifecycle Coordinator       | 监听媒体/设置/站点生命周期并幂等应用策略、处理有界重试和 teardown 的应用服务。            |
| UX Gate                     | 以定位、遮挡、反馈、继承、焦点和视觉证据为条件的体验质量门禁；不是单元测试替代品。        |
| MediaSession                | 一个可被扩展管理的媒体实例及其可序列化状态快照，不等同于浏览器的 Media Session API。      |
| Active player               | 当前获得快捷键和默认命令目标的媒体实例；选择规则必须可测试。                              |
| Capability                  | 媒体/站点明确声明的能力，如 seek、fullscreen、capture；UI 不通过猜测显示功能。            |
| Command                     | 由快捷键、UI 或适配器发出的类型化用户意图；由 Command Registry 执行。                     |
| SiteAdapter                 | 针对某站点或页面形态的受控适配器，包含匹配、能力、Hook 和 teardown。                      |
| Generic adapter             | 不依赖特定网站的 HTMLMediaElement 通用实现。                                              |
| Adapter registry            | 对静态站点 adapter 做确定性匹配、优先级选择、Generic 回退、健康记录和生命周期管理。       |
| Adapter kill switch         | 随扩展发布、按精确 version/feature 禁用站点增强的本地回退策略；不是远程配置。             |
| Adapter health              | 当前匹配/选中/降级/禁用及失败计数的 bounded 诊断元数据，不代表生产支持等级。              |
| Port                        | Domain/Application 定义的能力接口，由浏览器、DOM、存储或消息基础设施实现。                |
| Envelope                    | 跨上下文消息的统一外壳，包含协议版本、type、requestId、来源和 payload。                   |
| Nonce                       | 每次页面桥会话生成的随机一次性值，用来拒绝伪造或重放消息。                                |
| Schema                      | 对运行时输入/输出的结构、范围和语义约束；与 TypeScript 类型配套但不互相替代。             |
| Settings                    | 用户可持久化的全局配置与站点覆盖；由 background repository 作为权威。                     |
| Session state               | 当前 Tab/frame/媒体的可重建短期状态，不作为扩展重启后的唯一数据源。                       |
| Fixture                     | 仓库内可重复加载的测试页面、DOM 结构或数据样本。                                          |
| Differential test           | 对 Legacy 与新扩展执行同一可观测操作并比较结果的测试，不比较内部实现。                    |
| Tier 0/1/2/3                | 兼容支持等级：通用、重点 fixture+发布 smoke、best-effort fixture/手工、仅反馈记录。       |
| P0/P1/P2/P3                 | 缺陷/需求优先级：发布阻塞、核心目标、后续/实验、低优先体验。                              |
| Quality gate                | 合并、夜间、候选发布或 Stable 发布必须通过的自动/人工检查。                               |
| Optional permission         | 用户触发或明确选择后才申请的浏览器权限，避免安装时静默扩大能力。                          |
| Feature flag                | 有 owner、默认值、到期版本和删除任务的受控开关；不是永久配置替代品。                      |
| Stable boundary             | 不因 Web 重构而修改的 Legacy 文件、行为和发布链路边界。                                   |

## 术语使用规则

- 文档首次出现缩写时同时写中文/英文全称。
- “支持”必须说明是 Tier、浏览器版本还是功能能力支持。
- “兼容”必须指向可观察行为和测试矩阵，不表示复刻旧内部实现。
- “插件”“脚本”“扩展”在正式文档中分别按上表使用，避免混称造成权限/运行时误解。
