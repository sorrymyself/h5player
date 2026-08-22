# Phase 5 Exit Review（2026-08-11）

> 文档 ID：REVIEW-007  
> 状态：Approved / Conditional GO  
> 评审责任：Project / Architecture / Quality / Security / Compatibility Owner  
> 最后更新：2026-08-11  
> 关联：FR-ADAPTER-002～004、EXT-100～108  
> 评审范围：固定脱敏 fixture 的 Preview 工程基线，不是 Beta、Stable、商店或真实站点发布审查

## 1. 结论摘要

Phase 5 建立了 TypeScript site adapter metadata、确定性 registry、Generic fallback、版本/功能 kill switch、SPA
重匹配、生命周期/selector/action 故障隔离、typed diagnostics、Tier 1/Tier 2 固定 fixture 和冻结兼容报告。

阶段结论在完整门禁全部通过后为 `Conditional GO`，只授权进入 Phase 6 发布工程。Tier 1 真实生产站点 smoke、Firefox
ESR/最低版本、Chrome previous stable、Edge、headed 权限 UX 和商店发布仍未完成。

## 2. 任务与退出条件

| Task         | 状态                 | 证据                                                                                                    |
| ------------ | -------------------- | ------------------------------------------------------------------------------------------------------- |
| EXT-100      | Verified             | priority/id 稳定排序、hostname/path match、duplicate guard、registry 接入 page-main                     |
| EXT-101～104 | Verified for fixture | YouTube/Bilibili/Tencent/iQIYI/Youku 独立脱敏 fixture 与 selector 契约                                  |
| EXT-105      | Verified for fixture | Netflix/Ixigua/AcFun/Sohu/TED best-effort fixture batch                                                 |
| EXT-106      | Verified             | attach/detach/action/selector failure injection、Generic fallback、version/feature disable、SPA rematch |
| EXT-107      | Verified             | catalog metadata、fixture SHA baseline、`test:compat:report`、diagnostics health                        |
| EXT-108      | Verified             | 全量门禁、三类复核、治理文档与证据边界                                                                  |

- [x] Tier 1 五个 adapter 均有固定自动化 fixture。
- [x] Tier 2 五个 adapter 有 fixture、owner、best-effort 等级和明确的 live smoke 未验证状态。
- [x] adapter attach/detach/action/selector 异常不会阻断 Generic controller。
- [x] 每个 adapter 有 id/version/owner/tier/support/fixture/lastVerified/matches/features。
- [x] compatibility report 对 catalog、fixture、版本、Tier、support level、owner、lastVerified 和 SHA drift 失败，并阻断超过 183 天未复核项。
- [ ] 真实站点 smoke 未执行，因此不宣称生产站点完整支持。

## 3. 架构与安全

- 架构复核（本次交付）：registry 保持在 adapter/runtime 组装边界，domain/application 没有 hostname 分支；dependency-cruiser 为
  136 modules / 432 dependencies / 0 violations。
- 代码复核（本次交付）：已补 runtime metadata 校验、防御性冻结、默认不匹配子域的反例、局部 selector、多播放器隔离和 bounded
  selected count；fixture 范围无 blocker/major 代码问题。
- 安全复核（本次交付）：站点规则与 rollback 仅来自构建内静态代码，未新增 eval/远程代码/远程 selector/权限；150 files + 2
  manifests 静态扫描和 3 个 adversarial tests 通过。
- Registry 实现现有 `MediaAdapter<HTMLMediaElement>`，MediaDiscovery/CommandRegistry/PageBridge 不需要站点分支。
- Site controller 始终包装已创建的 Generic controller；站点 selector/Hook 未命中或失败时返回 Generic 操作。
- SPA URL 每次 snapshot/command 同步匹配；detach/attach 有显式生命周期和异常隔离。
- Catalog、rollback policy 与 Hook 表在构造时校验并防御性冻结；selector 先局部容器、再 document fallback，诊断计数按
  typed Schema 上限饱和。
- Catalog 与 disable policy 都是随扩展构建发布的静态 TypeScript；无远程代码、远程 selector 或任意用户函数。
- selector 长度/数量和诊断数组有界；failureCount 有上限；diagnostics 只包含 adapter 元数据和计数。
- required/optional permissions 未扩大；Legacy 主线和冻结产物未修改。

## 4. 证据边界与剩余风险

- 脱敏 fixture 不包含真实媒体 URL、账号、cookie、token 或用户内容，也不覆盖登录态、DRM、AB 实验和站点实时 DOM 漂移。
- 站点 selector 点击成功不代表站点业务状态一定完成；Beta 前必须补真实站点 smoke 与失败 artifact。
- 当前目标仍为原生 `HTMLMediaElement`；closed Shadow DOM 内不可见媒体、非原生 custom target 和 player API 不在本阶段。
- Phase 4 遗留的高级能力专项 E2E、浏览器版本矩阵、headed 权限和 30 分钟 RC churn 继续作为 Phase 6/Stable 门禁。

## 5. 验证记录

| 检查                       | 结果                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| Composite `check`          | Passed；含 format/lint/typecheck/unit/component/integration/compat/report/security/boundaries |
| Unit                       | 37 files / 151 tests                                                                          |
| Component                  | 4 files / 19 tests                                                                            |
| Integration                | 9 files / 63 tests                                                                            |
| Compatibility              | 3 files / 33 tests；10 site fixtures + fixture SHA baseline                                   |
| Security                   | 3 tests + 150 source/2 manifest scan passed                                                   |
| Coverage                   | 54 files / 269 tests；85.29 statements / 77.11 branches / 86.71 functions / 88.81 lines       |
| Chrome E2E                 | 3 passed；configured churn 默认 skipped                                                       |
| Firefox E2E                | Firefox 153.0 passed；web-ext lint 0 errors / 2 generated warnings                            |
| Churn smoke                | 5064 ms / 65 cycles / 1 worker restart / listeners 4→4                                        |
| Bundle budget              | background 90813/90814 B、content 192180 B、page-main 93458 B raw；双端 passed                |
| Legacy regression          | SHA-256 `91b5312d7cf150cd852d005b1e5d5f3d8ed2ed7cd8a481dfa1d561d48f7b3f27`；561788 bytes      |
| Architecture/Security/Code | 本次三类复核完成；fixture 范围无 blocker/major，修复项已纳入 registry 与门禁                  |
| `git diff --check`         | Passed                                                                                        |

## 6. 最终结论

`CONDITIONAL GO`

固定 fixture 范围满足 Phase 5 设计目标，可进入 Phase 6。该结论不是 Tier 1 真实站点支持声明，也不是
Beta、Stable 或商店发布批准。
