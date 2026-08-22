# ADR-0017：MAIN world 媒体控制权仲裁与分层恢复

> 状态：Accepted for Phase 6.5 implementation  
> 日期：2026-08-16  
> 决策人：Project Owner（依据用户 2026-08-16 实测反馈）  
> 关联：FR-CORE-003/006..009、NFR-UXREL-002..004、EXT-145..147、RISK-010/016/029/030

## Context

Web Extension 已能通过提前捕获的原生 setter 修改媒体，但这只保证“扩展写入不受网站后来改写原型影响”，不能阻止网站随后通过普通 setter、定时轮询、播放器初始化、换集或自定义媒体元素重新覆盖倍速、音量和进度。现有 `PlaybackLifecycleCoordinator` 只能观察后重写倍速，且没有形成 MAIN world 的控制权仲裁；音量和进度保护开关也尚未落到运行时。

用户要求已确认：当用户通过扩展明确设置播放控制后，扩展意图应优先于网站默认和轮询逻辑，同时保持可撤销、可诊断和站点兼容，不能照抄 Legacy，也不能用无限轮询维持表面稳定。

## Decision drivers

1. 用户明确意图在保护开启时不能被网站静默覆盖。
2. 普通页面和未受保护媒体必须保持透明，避免全局副作用。
3. 扩展内部写入必须绕过自身拦截，并以读取到的真实值确认成功。
4. 倍速/音量与进度具有不同时间语义，不能采用同一种永久锁。
5. 实现必须可撤销、可测试、可降级，不依赖无界 interval。
6. 腾讯 `<fake-video>` 等自定义实例必须控制真实目标，不能依赖隐藏辅助实例或伪成功消息。

## Options considered

### Option A：只增加 LifecycleCoordinator 重试次数

- 优点：改动小。
- 缺点：网站每次轮询后扩展再写回，产生抖动、资源消耗和竞态；预算最终仍会耗尽，或退化为无限轮询。

### Option B：对所有媒体属性做不可撤销全局劫持

- 优点：表面控制力最强。
- 缺点：破坏宿主页面和未受控媒体；`currentTime` 永久锁会阻止自然播放、换集和直播追帧；无法安全 teardown。

### Option C：per-instance MAIN world authority + lifecycle fallback（采用）

- 在 `document_start` 捕获原生 accessor，安装 getter 透明、setter 有条件仲裁的 prototype wrapper。
- 只对已由 discovery/adapter attach 的实例维护 WeakMap 状态；未绑定实例全部透传。
- 扩展命令通过捕获的原生 setter 或经验证 adapter 写入，成功后登记 intended value。
- 倍速、音量和静音使用持续保护；进度只在扩展 seek/恢复后的短时租约内保护，且默认关闭。
- 网站缓存旧 setter、替换实例或使用自定义元素绕过 wrapper 时，由媒体事件/状态观察触发有界恢复；adapter 可绑定受限自定义 accessor。

## Decision

采用 Option C。控制链为：

```text
Settings / site rule / page intent
  -> content policy resolver
  -> typed media.configure-authority
  -> MAIN MediaControlAuthority
  -> native controller or verified adapter write
  -> actual-value confirmation
  -> event-driven bounded recovery when prevention is bypassed
```

属性规则：

| 属性           | 默认策略           | 保护形式                   | 允许透传                         |
| -------------- | ------------------ | -------------------------- | -------------------------------- |
| `playbackRate` | 开启               | 持续 intended value        | 无 binding、保护关闭、写入相同值 |
| `volume`       | 开启               | 持续 intended value        | 无 binding、保护关闭、写入相同值 |
| `muted`        | 随 `protectVolume` | 持续 intended value        | 无 binding、保护关闭、写入相同值 |
| `currentTime`  | 关闭               | seek 后短时租约 + 推进容差 | 租约外、保护关闭、目标在容差内   |

站点 adapter 可以针对单一属性声明 custom accessor、站点原生写入或 unsupported；任何“已处理”返回都必须以 actual value 确认。属性级失败不得停用整个 adapter 或扩展。

## Consequences

- 正面：普通网站轮询不能再夺回已保护的倍速/音量；新实例与换集仍由 policy/lifecycle 继承；进度保护不会冻结自然播放。
- 正面：不新增浏览器权限，不修改 Legacy，不引入远程代码或全局自定义消息协议。
- 代价：page media protocol 增加 authority configure；discovery/controller lifecycle 增加 binding；测试需覆盖 descriptor 与 hostile timing。
- 限制：网站在扩展安装前缓存原生 setter、使用不可配置 descriptor 或原生/WASM 私有通道时仍可能绕过；此时依赖 adapter 和有界恢复，并在诊断中明确降级。
- UX：保护开启时，网站自带控件若写入与扩展 intended value 冲突可能被阻止；用户可按站点关闭对应保护。这是可见策略，不应静默猜测调用来源。

## Verification

- Unit：原生 descriptor 捕获、getter 透明、per-instance 隔离、保护开关、相同值透传、冲突阻止、currentTime lease、custom accessor、teardown。
- Integration：typed configure、媒体 attach/detach、成功/失败命令提交、换源 generation、routed frame lifecycle、扩展 reload。
- Hostile E2E：页面每 50～200ms 重写倍速/音量，保护开启保持用户值，关闭后网站值生效；无扩展常驻短周期 interval。
- Live：腾讯正常与 WASM/fake-video 模式，播放一段时间、切片/换集后连续快捷键仍生效；记录真实 rate 与时间增量，无 `Extension context invalidated` 未处理错误。

## Rollback

按属性或 adapter kill switch 关闭 authority，保留 Generic Controller、Popup 和快捷键的单次控制；若 prototype wrapper 引发站点回归，可仅保留 lifecycle fallback 并冻结 Beta，不能回退到无界轮询。
