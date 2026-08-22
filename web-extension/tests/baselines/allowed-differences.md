# Legacy 行为允许差异基线

Phase 0 只冻结可观察行为，不把 Legacy 的高风险实现视为新扩展必须复制的契约。

允许且要求存在的差异：

- 新扩展不提供页面全局 GM API 模拟、同步 localStorage 双写或函数型菜单项。
- 新扩展不修改站点 CSP，不使用 `eval`、`Function` 构造器、Data URI 脚本或远程可执行代码。
- `ctrl+j ctrl+s` 任意函数快捷键和 `ctrl+shift+alt+d` 调试快捷键不进入正式命令注册表。
- 下载、MediaSource 捕获和音频增益属于 Phase 7 实验能力，默认关闭。
- 站点适配器只迁移可验证行为；Legacy 站点副作用和远程 helper 不视为兼容要求。

必须保持的差分 Oracle：

- play/pause、seek、rate、volume/mute 的用户可观察语义。
- 默认核心快捷键的按键、步长和命令意图。
- active player 选择、SPA/iframe/Shadow DOM 生命周期的最终用户效果。
