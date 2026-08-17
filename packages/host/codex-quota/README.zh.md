# @deepseek-ai/dsh-host-codex-quota

[English](README.md) | 中文

这是一个只读 Host 网关，为侧边栏提供安全的 Codex 额度数据。它会针对每个已配置的 Codex home 启动官方 `codex app-server --stdio`，调用 `account/read` 和 `account/rateLimits/read`，并通过 `codexQuota/read` 仅返回账号标签、主窗口剩余额度比例、重置时间、账号池数量与账号池平均剩余比例。对于 ChatGPT 账号，Host 按照设置页使用的相同优先级，从本地 OAuth 展示声明中依次采用 `name` 和 `email`；若均不可用，则回退到 app-server 返回的邮箱。认证 token 和 Codex home 路径不会跨越 Remote 边界。

`accountHomes` 按顺序解释，第一项是当前账号。未配置时依次读取平台路径分隔格式的 `DSH_CODEX_ACCOUNT_HOMES`、`CODEX_HOME`，最后使用 `~/.codex`。`refreshIntervalMs` 默认为 60000，`requestTimeoutMs` 默认为 15000，`disposeGraceMs` 默认为 3000，`codexCommand` 默认为 `codex`。账号池数量包含暂时不可读取的配置项；账号池剩余比例仅对成功读取的主窗口取平均值。

## Model Experience

### Request context and condition

#### What the model sees

不包含模型可见内容；该包只提供 `codexQuota/read` 用户界面投影，不增加模型上下文。

#### Token effect

没有直接 token 影响。

#### KV Cache effect

该包不会改变模型请求或可复用的提示词前缀。

## Known Limitations and Deferred Work

- **只展示主窗口** — 侧边栏只汇总官方 Codex 主限额窗口，不展示次级窗口和 credits 余额。
- **账号来源保持显式** — 与设置页相同的 `name`、`email` 展示优先级应用于每个 `accountHomes` 凭据。单独配置的设置页 profile 可能代表另一个账号，因此可以显示不同标签。
