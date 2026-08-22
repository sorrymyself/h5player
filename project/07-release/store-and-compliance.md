# 商店、权限与合规清单

> 文档 ID：REL-002  
> 状态：Approved / Phase 6 Compliance Baseline<br>
> 负责人：Release Manager / Security Reviewer  
> 最后更新：2026-08-11

## 1. 适用范围

本清单用于 Chrome Web Store、Firefox Add-ons 及未来其他分发渠道。它不替代平台最新政策；发布前必须重新核对平台规则并把差异记录在发布记录中。

## 2. 权限说明包

每个实际权限都要有一行可审计说明：

| 权限/能力      | 使用场景              | 最小替代方案         | 用户可见说明           | 测试/证据                  | 首发决策         |
| -------------- | --------------------- | -------------------- | ---------------------- | -------------------------- | ---------------- |
| `storage`      | 配置/迁移/诊断元数据/可选进度 | 无 | 保存本扩展本地设置 | repository/migration/privacy tests | Required |
| `activeTab`    | 用户主动操作当前 Tab | 可选 host permission | 点击扩展后操作当前页 | popup/permission E2E | Required |
| `scripting`    | 在已授权 origin 注册包内固定脚本 | 静态 content script（权限更宽） | 只启动扩展自带代码 | registration/revoke/security tests | Required |
| optional `<all_urls>` | 当前 origin 或 all-sites opt-in | 只使用 activeTab/单 origin | 只在用户授权站点运行，可撤销 | Chrome/Firefox permission E2E；headed 待补 | Optional |
| clipboard/downloads   | 当前版本不申请 | Blob 本地下载/手工复制 | N/A | manifest/security scan | Rejected for current release |
| webRequest/DNR        | 当前版本无合法最小用途 | 页面/声明式替代 | N/A | threat model/manifest scan | Default reject |

禁止用“未来可能需要”作为权限理由；每项权限都必须有当前版本调用点和移除条件。

## 3. 商店审核材料

- 产品名称、简介、功能截图与实际 UI 一致。
- 支持的浏览器、最低版本、站点范围和限制明确。
- 隐私政策说明存储数据、日志、诊断导出、远程请求和第三方依赖。
- 权限说明使用用户能理解的场景，不隐藏全站访问或实验能力。
- 远程资源、更新机制和开源许可证可追溯；不加载远程可执行代码。
- 截图和宣传不得承诺绕过 DRM、付费限制、访问控制或平台安全策略。
- 对下载/截图/广告相关能力使用中性、合规描述，明确用户对内容拥有合法权限的责任。

## 4. 内容与能力边界

首发产品只承诺增强用户可访问的 HTML5 媒体控制体验；不承诺：

- 解密、绕过 DRM、破解付费/登录/地域限制；
- 抓取或下载用户无权保存的内容；
- 修改网站安全策略或注入任意第三方代码；
- 对所有网站永久兼容。

若某站点适配器可能触及平台规则、版权、反自动化或用户隐私，必须降级为手工/尽力支持或拒绝迁移，并记录理由。

## 5. 签名与供应链

- 生产包由受保护 CI 环境构建/签名；本地开发包不得误发 Stable。
- 发布记录关联提交 SHA、依赖 lockfile hash、构建器版本、SBOM、许可证报告和 zip hash。
- 商店上传账号、API token、签名密钥只存在 CI secret manager，不进入仓库、日志或 issue。
- 构建前后扫描 `eval`、`new Function`、远程 script、Data URI script、意外 host/permission 和 source map。
- 第三方资源必须打包并锁版本；不得从 CDN 加载生产 JS/CSS。

## 6. 隐私设计复核

- 默认无遥测、无远程推荐握手、无完整 URL/媒体源收集。
- 诊断导出为用户主动操作，含脱敏预览和大小上限。
- 设置/进度/日志分别有清除入口和保留策略。
- 任何未来网络功能先更新隐私政策、权限说明、威胁模型和 opt-in UI，再进入 Beta。

## 7. 发布前签字

- [ ] Product Owner 确认功能描述和非目标真实。
- [ ] Security Reviewer 确认权限、远程能力、输入校验和禁止模式。
- [ ] Quality Owner 确认矩阵、E2E、性能和缺陷门禁。
- [ ] Release Manager 确认产物、签名、SBOM、hash 和回滚包。
- [ ] 支持负责人确认安装、诊断、Issue 和事故说明。

Phase 6 已完成仓库内 [Listing 包](./store-listing-package.md)、[隐私与权限披露](./privacy-and-permission-disclosure.md)、
[artifact contract](./release-artifact-and-evidence-contract.md) 和自动 manifest/remote-code inspection。公开隐私 URL、真实截图、
headed 权限确认、商店账号/签名环境与提交回执尚未完成，因此以上签字保持未勾选，Stable 为 `NO-GO`。
