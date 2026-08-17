# @deepseek-ai/dsh-client-ui-codex-quota

[English](README.md) | 中文

浏览器额度摘要会轮询 `codexQuota/read`，但不会接收 Codex 凭据或原始 app-server 载荷。展开的侧边栏把当前账号行作为主要的 14px/22px 行，并把纯图标箭头操作放在同一行。账号池摘要位于其下 2px 处，采用 12px/18px 字体与更低调的辅助文字色。只有当前账号的剩余额度比例使用业务蓝色；账号池比例继承摘要行颜色。Host 提供的账号标签与设置页采用相同的展示优先级，依次使用 `name` 和 `email`。箭头操作会请求设置外壳选择 `settings.section#openai-codex`，即 OpenAI Codex 插件持有的完整账号页。本包不会再注册一套竞争性的仅额度设置页。侧边栏折叠为 56px 窄栏时隐藏这段信息。

## Model Experience

### Request context and condition

#### What the model sees

不包含模型可见内容；该浏览器端包只轮询 `codexQuota/read` 并贡献侧边栏界面元素。

#### Token effect

没有直接 token 影响。

#### KV Cache effect

该包不会改变模型请求或可复用的提示词前缀。

## Known Limitations and Deferred Work

- **窄栏不显示徽标** — 两行账号摘要无法放入折叠后的窄栏，因此折叠时整块隐藏。
- **完整账号页有独立归属** — 箭头操作会打开 OpenAI Codex 插件在 `settings.section#openai-codex` 注册的页面；本额度包刻意不复制账号管理能力。
