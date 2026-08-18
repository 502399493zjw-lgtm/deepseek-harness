# `@deepseek-ai/dsh-codex_shared_pool`

[English](README.md) | 中文

DeepSeek Harness Codex 集成唯一的公开插件与安装入口。一条 Loader 配置项会安装 ChatGPT OAuth 模型提供方、Codex 网络搜索、Web 设置页、侧边栏额度摘要、TUI 命令、图片工具和只读额度 Host 能力。内部 Host 与 Remote 包为这个插件提供支持，但不是独立 Codex 产品，也没有各自的 Loader 配置项。

提供方支持多个用户授权的 ChatGPT 账号。Session（会话）启动时会固定所选 profile，因此默认 profile 改变后，现有对话不会切换身份。额度、速率限制、认证和提供方错误都不会触发自动轮换账号。

## 组成

[`cordis.patch.yml`](cordis.patch.yml) 只贡献 `codex-shared-pool`，模块名为 `@deepseek-ai/dsh-codex_shared_pool`。它为新 agent（智能体）选择 `openai-codex` / `gpt-5.6-sol`，并选择 Codex 搜索提供方；已保存的模型选择仍然优先。

- Host 入口持有 OAuth profile、模型与搜索适配器、图片工具策略、浏览器认证路由、TUI 命令和可选额度子能力。
- 浏览器入口持有 `openai-codex` 设置分区、模型偏好、图片工具渲染，以及侧边栏底部操作上方的三行账号与额度块。箭头操作会打开同一个设置分区。
- [`packages/host/codex-quota`](../../host/codex-quota/README.md) 通过 `codex app-server --stdio` 读取官方 Codex home，[`packages/api/remotes`](../../api/remotes/README.md) 传递可安全显示的 `codexQuota/read` 结果。两个包都没有独立 Loader 配置项。

`dsh-openai-codex` 可执行文件为终端或无界面安装提供 `login`、`status` 和 `logout`。TUI 贡献暴露相同提供方及 `/codex status|login|logout|usage|config` 命令族，无需注册第二个 `/tui` 插件。

## 配置

配置唯一的 Loader 配置项：

```yaml
- id: codex-shared-pool
  name: '@deepseek-ai/dsh-codex_shared_pool'
  config:
    searchMode: live
    searchContextSize: medium
    quota:
      accountHomes:
        - ~/.codex
```

| 字段 | 默认值 | 含义 |
|---|---:|---|
| `searchModel` | `gpt-5.6-sol` | 独立 Codex 搜索使用的模型。 |
| `searchMode` | `cached` | `cached`、`indexed` 或 `live` 搜索访问模式。 |
| `searchContextSize` | `medium` | `low`、`medium` 或 `high` 搜索上下文。 |
| `searchMaxOutputTokens` | `10000` | 独立搜索的正数输出预算。 |
| `modifyReadImage` | `true` | 为现有 `read_image` 工具增加受限的 HTTP(S) 输入。 |
| `shareImagegenWithOtherModels` | `true` | 允许其他支持视觉的提供方调用 `imagegen`。 |
| `useFastMode` | `false` | 为支持该能力的 Codex 模型请求 priority 服务层。 |
| `useWebSocketContextReuse` | `false` | 通过 WebSocket 复用严格续接的 Codex 上下文。 |
| `useNativeCompaction` | `false` | 使用 Codex V2 Responses 压缩，并保留 Harness 回退。 |
| `quota` | `{}` | 配置下方只读的官方 app-server 额度投影。 |

| `quota` 字段 | 默认值 | 含义 |
|---|---:|---|
| `accountHomes` | 环境变量回退 | 有序 Codex home；第一个是侧边栏当前账号。 |
| `refreshIntervalMs` | `60000` | 成功或不可用快照的缓存时长。 |
| `requestTimeoutMs` | `15000` | 单个账号 app-server 请求的截止时间。 |
| `disposeGraceMs` | `3000` | 子进程终止宽限时间。 |
| `codexCommand` | `codex` | 可执行文件名或绝对路径。 |

`quota.accountHomes` 为空时，Host 会使用平台路径分隔符读取 `DSH_CODEX_ACCOUNT_HOMES`，再依次采用 `CODEX_HOME` 和 `~/.codex`。账号池数量包含暂时无法读取的已配置 home；账号池百分比是成功读取主要窗口的账号所剩比例的等权平均值。

## 账号与额度行为

打开**设置 → OpenAI Codex**即可添加、选择或移除 DSH 持有的 ChatGPT OAuth profile，并查看每个 profile 的实时 Codex 限额。关闭授权窗口只会取消尚未完成的登录，已存储的 profile 保持不变，**添加账号**操作会恢复可用。账号标签依次使用 OAuth profile 的 `name` 和 `email`。DSH 凭据位于 Harness home，与 Codex CLI/Desktop 凭据相互独立。

侧边栏第一行以 `Codex 账号：<账号标签>` 标识当前官方 Codex-home 账号。第二行显示主要窗口剩余额度比例和重置时刻；重置时刻按浏览器本地时区显示为固定的 `M月D HH:mm` 格式，例如 `8月17 15:54`。月份和日期不补零，小时和分钟使用两位数。颜色更浅的第三行显示已配置账号数和所剩比例平均值。只有当前账号的百分比使用蓝色。额度块在折叠侧栏中隐藏，其箭头会打开 **OpenAI Codex**，并且不会遮挡侧边栏内容。

## 安全与失败行为

- OAuth token 保留在仅限所有者读取的 Host 存储中。浏览器路由只返回不含秘密的 profile、偏好和额度数据；额度 Remote 不会返回账号 home 路径、认证文件、原始 app-server 账号或限额桶。
- 可选额度子能力等待共享 subprocess 服务时不会让根插件激活一直处于等待状态。缺少 Codex 可执行文件、home 未登录、超时和协议失败会呈现中性的不可用状态，不会阻止 Web 应用启动。
- 本地图片路径继续采用当前 Harness 文件系统与沙箱行为。远程图片读取会限制重定向和字节数，并拒绝 URL 中嵌入的凭据。

## 模型体验

### 请求上下文与条件

#### 模型看到的内容

选择 `openai-codex` 后，普通 Harness 对话、工具、思考设置和附件会通过 Codex Responses 适配器发送。为所选模型启用时，`imagegen` 是额外工具，`read_image` 接受受限的 `url` 输入。独立 Codex 搜索返回普通 Harness 文本与 HTTP(S) 引用。额度摘要和账号管理界面不会对模型可见。

#### Token 影响

提供方会发送每轮 Codex 请求所需的 Harness 请求上下文。启用 `imagegen` 或 URL 扩展会加入对应工具 schema 的 Token，工具结果会进入普通对话历史。原生压缩可以用 Codex 加密压缩 item 替代较早历史；原生压缩失败时会回退到 Harness 文本摘要。

#### KV Cache 影响

稳定提示词与工具 schema 保留普通的可复用前缀。WebSocket 上下文复用可以通过 `previous_response_id` 只发送严格续接的增量；历史改写、压缩、Fork、连接中断或进程重启会发送完整上下文。账号选择在 Session 内保持固定，不会在可复用前缀背后静默改变提供方身份。

## 已知限制与延期工作

- **两个凭据存储**：DSH 模型 profile 与官方 Codex home 使用相同的 `name`、`email` 展示规则，但仍是独立凭据存储。选择 DSH profile 不会重排 `quota.accountHomes`；侧边栏与新 Session 默认账号必须一致时，请在两处配置同一个当前账号。
- **只汇总主要额度窗口**：侧边栏汇总官方主要速率限制窗口。每个 profile 的详细限额保留在设置页；次要窗口和余额不会聚合到侧边栏账号池百分比中。
- **只允许手动切换**：组合包刻意不提供按额度或错误自动切换 profile 的能力。请选择另一个 profile 并启动新 Session。
- **服务管理暂缓**：未暴露长驻 Codex 服务的启动、停止、重启和状态。后续成功停止必须同时关闭自动重启。
