# 数据模型与迁移契约

> 文档 ID：ARCH-005  
> 状态：Approved / V3 + Phase 6.5 Policies Implemented
> 负责人：Data/Architecture Owner  
> 最后更新：2026-08-19
> 关联：ADR-0003、FR-CONFIG-001..006、NFR-REL-004

## 1. 数据分类与权威

| 数据类                   | 示例                                              | 权威上下文                                        | 默认持久化                    | 生命周期               |
| ------------------------ | ------------------------------------------------- | ------------------------------------------------- | ----------------------------- | ---------------------- |
| Global settings          | enable、hotkeys、UI 默认值                        | background repository                             | `storage.local`               | 用户清除/卸载          |
| Site overrides           | origin/site enabled、站点能力开关                 | background repository                             | `storage.local`               | 用户清除/站点删除      |
| Progress                 | media identity、position、updatedAt               | background repository                             | `storage.local`               | 可选、按 TTL 清理      |
| Session snapshot         | frame/media/active 状态                           | content/page-main                                 | 内存                          | frame/page 生命周期    |
| Migration metadata       | schemaVersion、backup ID                          | background repository                             | `storage.local`               | 保留当前与最近备份     |
| Diagnostics              | 限量事件 ring buffer                              | 各 runtime                                        | 内存/可选 local               | 用户导出或容量淘汰     |
| Browser permission state | optional origins、动态脚本注册 ID                 | browser permissions API / background registration | 浏览器 profile（非 settings） | 用户授权/撤权/卸载     |
| Page temporary state     | frame session、temporary disabled、media snapshot | content/page-main                                 | 内存                          | 当前 page/frame 或重载 |

页面 `localStorage`、sessionStorage 和全局变量不能作为新扩展配置权威。若为站点行为必须使用页面存储，需单独列为 adapter capability，并禁止与扩展设置同名竞争。

## 2. 持久化包络

所有扩展仓储使用带版本的命名空间：

```ts
interface PersistedEnvelopeV3<T> {
  schema: "h5player.web-extension";
  schemaVersion: 3;
  revision: number;
  updatedAt: number;
  data: T;
}

interface SettingsStoreV3 {
  global: GlobalSettingsV3;
  sites: Record<string, SiteOverrideV3>;
  progress: Record<string, ProgressRecord>;
}
```

`revision` 用于乐观并发控制；`updatedAt` 只作排序/诊断，不作安全凭据。未知顶层字段不能静默执行，允许保留到备份但不进入业务对象。

## 3. GlobalSettingsV3

```ts
interface GlobalSettingsV3 {
  enabled: boolean;
  ui: {
    overlayEnabled: boolean;
    theme: "system" | "light" | "dark";
    locale: "zh-CN" | "en-US";
  };
  hotkeys: {
    enabled: boolean;
    scope: "page" | "player";
    bindings: Record<string, { commandId: string; disabled: boolean }>;
  };
  media: {
    defaultPlaybackRate: number;
    defaultVolume: number;
    restoreProgress: boolean;
  };
  download: {
    enabled: boolean;
  };
  policies: {
    protectPlaybackRate: boolean;
    protectCurrentTime: boolean;
    protectVolume: boolean;
    allowExperimental: boolean;
    allowAcousticGain?: boolean;
    allowMouseLongPress?: boolean;
    mouseLongPressMs?: number;
    allowAutoplay?: boolean;
  };
  diagnostics: {
    localLogLevel: "error" | "warn" | "info" | "debug";
    retainProgressDays: number;
  };
}
```

实现中的 V3 与上述结构一致，但 `hotkeys.bindings` 的 key 必须是规范化 chord，`commandId` 必须来自
`domain/hotkey` 的固定注册表；V1 只接受受限字符串并在迁移时过滤未知 command/chord。高级策略字段在 wire schema 中兼容缺失值，repository/resolver 会补成当前默认值。V3 的默认值为：全局启用、
system theme、`zh-CN`、page scope、playback rate `1`、volume `1`、不恢复进度、保护 playback rate/volume、
实验能力关闭、下载独立开关开启、音频增益/鼠标长按/autoplay 关闭、长按 `600ms`、error 日志和 30 天进度保留。

约束示例：

- `defaultPlaybackRate` 建议 `[0.1, 16]`，实际站点能力可更窄。
- `defaultVolume` 为 `[0, 1]`。
- `retainProgressDays` 有上限，`0` 表示不保存。
- command ID 必须来自注册表，未知 ID 导入时标记错误而不执行。

## 4. Site identity 与进度 identity

### 4.1 SiteId

使用规范化结构而不是裸 `location.host`：

```ts
interface SiteId {
  origin: string;
  hostname: string;
  includePath?: string;
}
```

规范化规则：scheme 与 hostname 小写、去除默认端口、保留非默认端口、只允许 `http/https`、不保存 query/fragment；
若站点需要路径区分，使用受控 `includePath` 并限制长度。权限匹配模式由 origin 生成（例如
`http://127.0.0.1:47173/*`），不可由页面或导入文件任意传入。

### 4.2 ProgressId

```ts
interface ProgressRecordV2 {
  site: string;
  mediaKey: string;
  positionSeconds: number;
  durationSeconds: number | null;
  updatedAt: number;
  expiresAt: number;
}
```

`mediaKey` 优先使用经 adapter 审查的稳定内容 ID；其次使用去 query/fragment 的 source path hash；最后使用页面
origin+pathname hash。当前 Tier 0 runtime 使用最后一种，不发送运行时 `media-0-1` ID，也不保存完整源地址。
兼容读取 Schema 仍暂时接受旧数据中的 `titleHint`，以便 V1/V2 迁移和旧备份不因未知字段整体失败；策略层在读取、写入、
导入和导出路径会立即剥离该字段，当前实现不会新写入或持久化观看标题。

Phase 4 策略：

- `restoreProgress=false` 或 `retainProgressDays=0` 时不读写，并在 repository mutation 中清除受影响记录。
- 保存节流 5 秒；`positionSeconds <= 3` 不保存；接近结束 `duration-5s` 时优先删除记录。
- TTL 按全局保留天数计算，读取/写入/显式 prune 均执行规范化；达到容量时淘汰最旧记录并保护当前 key。
- progress 不进入跨设备 sync、不发送到外部网络、不进入默认诊断导出。

## 5. 读写与并发

- 所有 mutation 以 `expectedRevision` 或事务 API 提交。
- 冲突时进行字段级合并；同一字段采用 latest revision 或用户可见冲突提示，不能整包覆盖。
- 写入顺序：校验 → 计算迁移/合并 → 写备份（必要时）→ 写新 envelope → 发布变更事件。
- 事件包含 key、revision、changedPaths 和 source，不包含完整数据。
- 订阅者断线后通过 revision 重新拉取 snapshot，不依赖事件必达。
- `SettingsRepository` 通过 mutation queue 串行化读改写；`SiteAccessService` 另有 reconcile queue，避免浏览器
  `permissions.onAdded/onRemoved` 与 Popup/Options 显式 reconcile 并发注销/注册同一脚本 ID。

## 6. Schema migration

迁移函数必须是纯函数或显式接受 `Clock/Logger` 的可测试函数：

```ts
type Migration = (input: unknown) => Result<unknown, MigrationError>;

const migrations: Record<number, Migration> = {
  1: migrateV0ToV1,
  2: migrateV1ToV2,
  3: migrateV2ToV3,
};
```

规则：

1. 当前生产 Schema 为 V3；支持 `V0`、`V1`、`V2` 显式迁移至 V3，不在运行时猜测未知字段含义。
2. 迁移前保存原 envelope 的校验和和备份 ID。
3. 每个迁移有 golden fixtures、边界/损坏测试和逆向恢复演练。
4. 迁移失败保留原数据，使用安全默认启动，并在 options 显示恢复入口。
5. 删除字段要经过至少一个 minor 版本的弃用期；无法读取的未来版本不得覆盖。

## 7. 导入、导出与 Legacy 格式

Legacy 导入使用独立文件格式：

```ts
interface LegacyImportFile {
  format: "h5player.legacy-export";
  formatVersion: 1;
  exportedAt: string;
  sourceVersion?: string;
  global?: unknown;
  sites?: unknown;
}
```

导入流程：选择文件 → 大小/JSON 解析 → Schema 校验 → 字段映射预览 → 用户确认 → 备份当前设置 → 原子写入 → 输出迁移报告。

Web Extension 原生导出格式为 `h5player.web-extension.settings` / `formatVersion: 3`，兼容读取 V1/V2；单文件上限
262,144 bytes。导出、下载和 Blob URL 生命周期在 UI 层完成，浏览器不申请 downloads 或 clipboard 权限。

自动拒绝：函数、脚本字符串、远程 URL、未知权限、DOM/Window 对象、超出范围的数值和不可识别站点规则。

## 8. 清除、卸载与隐私

- options 提供按类别清除：设置、站点规则、进度、诊断、迁移备份。
- 清除操作显示影响范围并支持短时撤销（若实现成本允许）；至少在操作前备份可恢复数据。
- 卸载前无法可靠执行 UI 确认时，不新增外部清理请求；保留浏览器标准卸载行为，并在文档说明用户如何清除站点 localStorage（若旧数据存在）。
- 不把密码、token、cookie、完整观看历史或付费媒体信息写入扩展存储。
- 浏览器 optional host origins 和动态脚本注册不写入 Settings envelope；撤权必须调用 Permissions API 并由
  registration service 派生注销，避免产生“设置显示已关闭但浏览器仍有页面访问权”的双重事实源。

## 9. 数据模型验收

- 所有持久化对象能由 Schema 解析，且静态类型从同一模型生成/维护。
- N、N-1、空、未知字段、损坏 JSON、超大导入和并发冲突测试通过。
- service worker 重启、浏览器升级和发布回滚不会丢失已确认配置。
- 诊断导出和日志测试确认敏感字段被移除。

## 10. 实现记录（Phase 1～6.5）

- Schema V3 与静态类型事实源：`web-extension/src/domain/settings/schema.ts`；V1/V2/V3 export contract 和严格 patch schema
  同源维护。
- 默认值、字段级合并和优先级：`defaults.ts`、`merge.ts`、`resolve.ts`。
- V0/V1/V2→V3 migration、checksum 与 repository：`src/infrastructure/storage/`；V1 旧字符串 binding 会过滤为合法 chord/command，V2 补入 download 与高级策略默认值。
- V3 支持 global/site `download.enabled`，并支持 `allowAcousticGain`、`allowMouseLongPress`、`mouseLongPressMs`、`allowAutoplay` 的站点覆盖、继承与单字段恢复。
- `revision` 冲突采用 background 队列中的 field patch rebase；无变化不增加 revision。
- 当前保存最近一次 migration/corrupt/import/rollback/reset backup；多代备份保留策略可在真实升级需求出现后扩展。
- `storage.local` 是当前唯一权威；ADR-0008 的 sync 白名单已冻结但 Preview 不启用 `storage.sync`。
- 端侧证据包含实际终止 Chromium service worker 后重新打开 Popup，并恢复 revision 2 与媒体设置；Chrome/Firefox
  E2E 也验证权限撤销后的注册注销和页面重载隔离。

## 11. Phase 4 会话数据契约

`MediaSnapshot` 新增两个可选、可序列化字段：

- `visual`：zoom、pan、rotation、flip、brightness/contrast/saturation/hue/blur；所有值有 Schema 上限。
- `presentation`：`fullscreen: none|native|web` 与 `pictureInPicture`。

截图 Artifact 不是持久化数据：只在当前 page-main → content 命令响应中短暂存在，最大 4 MiB 二进制、8192 维度、
16,777,216 pixels；isolated content 校验后创建 Blob 并撤销 object URL。跨 Tab advisory event 也不持久化，只含
匿名 mediaKey、source tab/frame、bounded timestamp 和 event ID。

进度兼容读取中的遗留 `titleHint` 由 `enforceProgressPolicy` 强制清除；repository 落盘与设置导出均使用清理后的
progress map。对应回归测试验证导入、规范化落盘和导出文件均不包含观看标题。
