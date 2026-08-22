# Chrome Web Store / Firefox AMO Listing 包

> 文档 ID：REL-004<br>
> 状态：In Review / External Store Sign-off Pending<br>
> 负责人：Product Owner / Release Manager / Security Reviewer<br>
> 最后更新：2026-08-11<br>
> 关联需求/任务：EXT-123、EXT-126

## 1. 使用规则

本页是可审查的商店文案源，不代表账号已创建、材料已提交或审核通过。提交前必须把方括号占位项替换为真实证据，附目标
artifact SHA-256、候选记录、隐私声明版本和人工签字。Chrome 与 Firefox 可独立提交，但能力、权限和隐私描述必须一致。

## 2. 产品身份

- 名称：`H5Player Web Extension`（Beta/Alpha 候选必须保留渠道后缀）。
- 类别建议：Productivity / Accessibility（以商店当期分类为准）。
- 默认语言：简体中文；补充英语 listing 后再开放非中文市场。
- 官方代码仓库：`https://github.com/xxxily/h5player`。
- 支持入口：仓库 Issue；提交前填写 `[支持页面 URL]` 与 `[隐私政策公开 URL]`。

## 3. 短描述

中文：

> 为用户已获授权访问的 HTML5 音视频提供播放、进度、音量、画面和站点级控制。

English:

> Playback, progress, volume, visual, and per-site controls for HTML5 media you are authorized to access.

## 4. 详细描述

H5Player Web Extension 是独立的 Manifest V3 扩展，为网页中的 HTML5 音视频提供一致的键盘与扩展界面控制。用户可以在
Popup 和 Options 中管理当前站点授权、快捷键、播放参数、画面调整、可选进度恢复和本地诊断。

核心设计边界：

- 默认不在所有站点运行；用户针对当前站点或明确选择所有站点后，扩展才请求可选站点访问。
- 设置和可选进度记录保存在浏览器扩展本地存储，不提供账号、云同步、遥测或远程规则服务。
- 生产包不加载远程可执行代码，不修改网站 CSP，不使用网络拦截权限。
- 扩展不解密或绕过 DRM、付费、登录、地域限制或网站访问控制，也不保证所有网站永久兼容。

首发功能清单必须以候选追踪矩阵为准；未通过真实浏览器/站点证据的 adapter 只能描述为 Preview 或 best-effort，不得写
“完整支持”。

## 5. 权限说明文案

| 权限 | 商店说明 |
| ---- | -------- |
| `storage` | 在本机浏览器中保存扩展设置、站点偏好、版本化迁移数据，以及用户明确启用的有限进度记录。 |
| `activeTab` | 用户点击扩展或触发明确操作时，与当前标签页中的媒体交互；不会因此获得长期全站访问。 |
| `scripting` | 在用户已授权的站点注册和启动扩展自带的固定内容脚本；不下载或执行远程代码。 |
| optional `<all_urls>` | 仅在用户选择当前站点或“所有站点”时请求相应可选访问；可在 Options 或浏览器权限界面撤销。 |

不申请 `tabs`、`downloads`、`clipboardWrite`、`webRequest`、DNR 或 required host permissions。未来若发生变化，必须重新审查
listing、隐私、威胁模型和权限 E2E。

## 6. 浏览器与站点声明

- Chrome：只可声明 `[已验证的 Stable 版本、previous stable、OS、日期]`。
- Firefox：manifest 当前声明最低 `142.0`，但该数字在 Firefox ESR/最低版本真实验证完成前不能用于公开兼容承诺；提交时填写
  `[Firefox Stable/ESR 实测矩阵]`。
- Edge：在真实 Edge smoke 完成前不得写为支持浏览器。
- Tier 1 当前 fixture 范围为 YouTube、Bilibili、Tencent Video、iQIYI、Youku；真实站点 smoke 未完成时统一标记 Preview，且
  不承诺登录态、DRM、AB 实验或实时 DOM 漂移。
- Safari 与移动浏览器不在首发承诺范围。

## 7. 截图计划与真实性要求

建议 5 张，不得使用合成的不存在状态：

1. Popup：未授权状态与“授权当前站点”动作。
2. Popup：已连接媒体及常用播放控制。
3. Options：站点访问与撤销入口。
4. Options：快捷键编辑和冲突提示。
5. Options：隐私、进度清除与诊断导出说明。

每张截图记录浏览器、版本、OS、语言、候选 hash、测试账号是否使用、是否含第三方内容。裁切或打码不能制造扩展具备的功能；
不得展示用户账号、cookie、媒体 URL、付费内容或未授权版权素材。

## 8. 审核员备注

- 扩展通过可选 host permission + runtime content-script registration 工作；production manifest 没有静态 matches。
- MAIN world 入口是随包发布的固定脚本，只处理媒体状态，不拥有扩展权限；特权操作仍由 isolated/background sender policy 控制。
- 所有 JS/CSS 随包提供；无 CDN、远程模块、`eval`、Function constructor 或自定义远程 update URL。
- 提供 `[release-manifest.json]`、`[SBOM]`、`[许可证清单]`、`[privacy URL]` 和 `[权限演示视频/步骤]`。

## 9. 提交前签字

- [ ] Product Owner：功能、非目标、站点和截图真实。
- [ ] Security Reviewer：manifest、权限、CSP、远程能力与隐私文案一致。
- [ ] Quality Owner：目标浏览器、headed 权限 UX、真实站点 smoke 和候选矩阵有证据。
- [ ] Release Manager：候选 SHA/hash、bundle、商店账号、签名和回滚材料齐全。
- [ ] Legal/Compliance Owner（如适用）：第三方许可证、商标、截图和内容权利已复核。
- [ ] Chrome Web Store / Firefox AMO 实际提交回执已分别归档。

当前以上外部签字和提交回执均未完成，因此本 listing 包不能用于宣告 Store Ready 或 Stable GO。
