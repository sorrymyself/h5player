# ADR-0012：跨 Tab Advisory Media Event 语义

> 状态：Accepted for Preview  
> 日期：2026-08-11  
> 决策人：Architecture / Product Owner  
> 关联：EXT-085、FR-MEDIA-003

## 背景

Legacy 通过定时轮询和 GM 广播协调页面，事件真实性和资源成本都不适合扩展架构。Phase 4 需要先建立可控、可验证、
不会改变本地命令成功语义的跨 Tab 基础设施。

## 决策

1. background 提供 `CrossTabMediaEventService`，只接受来自真实 content sender context 的
   `media.cross-tab.publish`。
2. 事件种类仅为 `playback-started`、`playback-paused`、`progress-saved`。
3. payload 只含匿名 mediaKey、source tab/frame、bounded timestamp 和随机 event ID。
4. background 枚举其他 Tab，向 frame 0 发送 typed advisory event；没有 content runtime 或发送失败时隔离失败。
5. 事件不保证送达、不持久化、不重试、不改变发布者的本地媒体命令结果。
6. Preview 没有“自动暂停其他 Tab”、冲突仲裁或 Overlay 消费策略；这些必须由后续独立产品决策定义。

## 后果

- 不再需要 2 秒轮询或伪造 GM 事件。
- service worker 重启不会损坏权威状态，因为事件本身不是权威状态。
- 当前只发到其他 Tab 的 top frame；跨 frame 聚合和播放协调属于 Phase 5/后续范围。

## 验证

- `tests/unit/cross-tab-event-service.spec.ts`
- background/content typed contract tests
- sender policy、payload Schema 和发送失败隔离

