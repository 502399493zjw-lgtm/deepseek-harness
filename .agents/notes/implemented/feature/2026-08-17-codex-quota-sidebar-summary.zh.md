# Agent Note: Web 界面 Codex 额度视图

Status: implemented

[English](2026-08-17-codex-quota-sidebar-summary.md) | 中文

## 问题

DeepSeek Harness 可以把工作委派给 Codex，但 Web 外壳没有一眼可见的账号容量信号。用户若不离开 Harness 并逐个检查 Codex home，就无法得知当前使用哪个 Codex 账号、主要额度何时重置，或已配置账号池是否还有可用容量。

Codex 认证文件属于私有凭据存储。浏览器代码不能解析这些文件，也不能通过 Harness Remote 边界接收 token、原始账号记录或提供方协议载荷。

## 决策

`dsh-codex_shared_pool` 插件挂载其内部 `dsh-host-codex-quota` 能力；该能力为每个已配置 Codex home 启动已安装的 `codex app-server --stdio`，并读取官方 `account/read` 与 `account/rateLimits/read` 操作。`accountHomes` 是显式配置；未提供时依次采用 `DSH_CODEX_ACCOUNT_HOMES`、`CODEX_HOME` 和默认 Codex home。第一个 home 是当前账号。

Host 把每份响应投影为仅供显示的数据：账号名、主要窗口剩余额度比例、重置时间戳、已配置账号池数量，以及成功读取主要窗口的 home 所剩比例的等权平均值。对于 ChatGPT 账号，Host 会读取有大小限制的本地 `auth.json`，只解码 OAuth profile 的展示声明，并按照 OpenAI Codex 设置页的相同规则依次采用 `name` 和 `email`；app-server 返回的邮箱仍是兜底值。即使某个读取失败，账号池数量仍保留每个已配置 home，因此两个数字不会假装不可达账号已经消失。各账号失败相互隔离，六十秒缓存用于限制进程开销。token、登录材料、原始账号对象和原始限额桶都不会进入 Remote 契约。

`dsh-codex_shared_pool` 浏览器入口在底部导航操作之前注册一个 `sidebar.footer.action` 贡献，并在折叠侧栏中隐藏。14px/22px 的主要信息行显示当前账号、剩余额度比例和重置时间，纯图标箭头操作也位于该行。12px/18px 的账号池摘要位于其下 2px 处，并使用低调的辅助文字色。只有当前账号的剩余额度比例采用业务主蓝色 token；账号池比例继承摘要行颜色。两行都与侧边栏前缘内容线对齐。

`dsh-client-ui-settings` 底座持有一个以最新请求为准的 `ctx.settingsNavigation` 界面状态服务。箭头操作请求 `settings.section#openai-codex`，设置外壳会立即选中它，或在对应注册出现时选中它。同一个 `dsh-codex_shared_pool` 浏览器入口持有该页面及账号选择、登录、移除和详细额度展示。额度贡献不注册竞争性的设置分区，也不会取得变更操作或凭据访问能力。[单一 Codex 插件边界](../architecture/2026-08-17-single-codex-plugin-boundary.md)负责安装与包拓扑决策。

Remote 读取失败或不可用时，界面以更浅的中性状态替代异常内容，不泄漏错误。刷新只是呈现层轮询：额度状态既不进入 Session 日志，也不进入模型请求。

## 考虑过的替代方案

**把 Codex 认证文件发送给浏览器。** 这会扩大凭据边界，并让浏览器代码依赖私有磁盘数据。Host 只解码一个有大小限制的展示声明，并只发送得到的标签。

**只使用 app-server 返回的邮箱。** 官方账号响应不包含用户姓名，因此 OAuth profile 存在姓名时，侧边栏会与设置页显示不同。

**把完整 app-server 响应发送到浏览器。** UI 只需要五个显示字段；原始账号与限额对象会扩大隐私面，并使浏览器契约依赖它并不使用的提供方新增字段。

**只显示当前账号。** 这能回答即时账号问题，却仍让已配置账号池不可见，而账号轮换时用户关心的正是池子容量。

**注册一套仅展示额度的设置分区。** 这会创建第二个采用不同账号模型的 Codex 目标，并拆分账号页归属。因此摘要改为指向同一个插件现有的 `openai-codex` 分区。

**把两个百分比都显示成蓝色。** 账号池比例只是辅助信息，并非当前操作的主要信号。只让当前账号比例使用蓝色可以建立单一的主要信息行，并让账号池摘要保持次要层级。

## 后果

- 在 Web bundle 之上安装 `dsh-codex_shared_pool` 会增加一个 Host 服务、一个类型化 Remote 读取和一个侧边栏视图；Codex 额度信息不会成为模型可见内容，也不会成为持久 Session 数据。
- 额度可用性依赖已安装且兼容的 Codex 二进制和当前账号状态。缺少二进制、home 未登录或协议失败时，界面降级为不可用，而不会阻塞 Web 启动。
- 账号池比例是可读主要窗口比例的等权平均值，因为官方操作提供比例而非共享 token 分母；它不是按 token 加权的总和。
- 多账号必须通过配置或 `DSH_CODEX_ACCOUNT_HOMES` 指定不同 Codex home；Harness 不会扫描文件系统发现凭据目录。
- 确定性协议与组件测试固定展示名优先级、投影、聚合、失败隔离、两行文案、状态恢复、主要信息行的操作归属、当前额度蓝色强调和 `openai-codex` 导航请求。使用本地 app-server 子进程的本地组装浏览器组合会验证 14px 主要信息行、12px 辅助文字色账号池行、2px 间距和位于“设置”上方的位置。同一个浏览器插件提供目标账号页。
