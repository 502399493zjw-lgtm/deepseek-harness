# `@deepseek-ai/dsh-codex_shared_pool`

[English](README.md) | 中文

DSH Codex 额度集成唯一的公开项目与安装边界。[`cordis.patch.yml`](cordis.patch.yml) 在通用 Web 组合包之上挂载只读的 Codex 账号池网关和浏览器侧边栏摘要。主要信息行与 OpenAI Codex 设置页采用相同的账号标签优先级，依次使用 `name` 和 `email`；次要的账号池行只保留低调的容量摘要。摘要中的**打开**操作会选择 `settings.section#openai-codex`，也就是 OpenAI Codex 插件持有的完整账号页，而不是另行注册第二套设置页。宿主实现位于 [`packages/host/codex-quota`](../../host/codex-quota/README.md)，浏览器 Remote 接口保留在 [`packages/api/remotes`](../../api/remotes/README.md)，UI 实现位于 [`packages/client/ui-codex-quota`](../../client/ui-codex-quota/README.md)。它们都是本项目的内部组成部分，不作为独立额度产品安装。

## 模型体验

### 请求上下文与条件

#### 模型看到的内容

没有模型可见内容；本组合包只组合只读的 `codexQuota/read` 账号投影与浏览器界面。

#### Token 影响

没有直接 Token 影响。

#### KV Cache 影响

本组合包不会改变模型请求或可复用的提示词前缀。

## 已知限制与延期工作

- **依赖 Web 与 OpenAI Codex 插件**：本补丁贡献 Codex 专属侧边栏摘要，通用 Web 传输、布局、设置外壳与 Remote 桥接仍由下层 Web 组合包挂载；“打开”所选的 `openai-codex` 账号页由完整 OpenAI Codex 插件持有。
- **服务管理暂缓**：启动、停止、重启和状态尚未纳入首阶段项目边界；后续加入时，成功停止必须同时关闭自动重启。
