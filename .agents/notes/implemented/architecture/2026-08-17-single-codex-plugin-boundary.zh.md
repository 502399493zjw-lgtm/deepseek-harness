# Agent Note: 单一 Codex 插件边界

Status: implemented

[English](2026-08-17-single-codex-plugin-boundary.md) | 中文

## 问题

Codex 模型访问、账号设置、终端命令、图片工具和侧边栏额度信息共同组成一个面向用户的集成。通过互不相关的公开包或多条 Loader 配置项加载这些功能，会让设置页插件清单把实现组成误报为多个产品，也会使各部分配置与生命周期发生偏移。

凭据与官方 app-server 访问仍然需要仅限 Host 的代码，浏览器展示则需要 Client 构建。单一公开插件不能消除这些运行时和安全分工。

## 决策

`@deepseek-ai/dsh-codex_shared_pool` 是 DSH Codex 集成唯一的公开安装与 Loader 边界。它的组合包补丁只包含一条 `codex-shared-pool` 配置项。包的 Host 入口注册 `openai-codex` 模型与搜索提供方、账号服务、认证路由、图片策略和 TUI 适配器；浏览器入口注册 OpenAI Codex 设置页、模型偏好、工具视图和侧边栏额度贡献。

仅限 Host 的额度访问保留在 `@deepseek-ai/dsh-host-codex-quota`，浏览器传输保留在 `@deepseek-ai/dsh-api-remotes`。它们是内部实现包。subprocess 服务存在时，根插件会把额度网关挂载为可选子插件；组合包的浏览器入口使用类型化 Remote 结果。两个内部包都没有 Loader 配置项，也没有独立安装的 Codex Client 插件。

TUI 注册由根 Host 入口调用安装函数完成，不再使用第二个 `dsh-codex-profiles/tui` 模块。浏览器额度展示位于组合包的浏览器入口，因此箭头与其目标 `settings.section#openai-codex` 由同一个 Client 插件注册。[Codex 额度视图决策](../feature/2026-08-17-codex-quota-sidebar-summary.md)负责展示投影、隐私字段、聚合与视觉层级。

浏览器入口把授权窗口关闭视为取消。它会调用同源 Host 路由；Host 中止并等待正在进行的提供方登录结束，然后重新发布持久化的 profile 状态。取消不会删除已存储的 profile，也不会让设置操作一直处于等待状态。

静态项目测试固定唯一的补丁配置项，并拒绝旧模块名。真实 Loader 组合测试固定提供方注册与 dispose（资源释放）；浏览器组合测试固定额度 slot 注册、跳转到共享设置页以及卸载时撤销。

## 考虑过的替代方案

**为每个实现包保留一条 Loader 配置项。** 这会把 Host、Client、提供方和 TUI 机制暴露为多个可安装插件，并允许出现设置页与额度导航目标不一致的不完整组合。

**保留独立 TUI 插件。** TUI 适配器使用相同账号服务、凭据、偏好与提供方目录。独立模块会增加生命周期与注册状态，却没有独立演化的能力归属。

**把凭据或 app-server 访问移到浏览器包。** 这会越过 Host 凭据边界，并向浏览器代码暴露文件系统或提供方协议访问。内部 Host 与 Remote 包在单一公开入口背后保留这项分工。

**把所有源文件合并进组合包。** Typert Remote 生成器与 subprocess 持有的 app-server 行为存在仓库级 Host 消费方和构建顺序。保留这些内部包可以维持准确归属，同时不创建其他公开安装路径。

## 后果

- 插件清单与 profile 配置只显示一个 Codex 产品名；一次移除或版本选择会控制所有 Codex 用户界面与提供方行为。
- Host 与 Client 代码仍在不同 TypeScript 构建面编译。公开包输出一个 Host 入口和一个浏览器入口；生成的 Remote 产物继续保持 Host 优先的构建顺序。
- 可选服务只能延迟各自的子贡献。缺少 subprocess、Web Server、Settings、工具、附件或 agent 服务时，根提供方激活不会一直处于等待状态。
- 关闭授权窗口时，Client 与 Host 共同使用唯一的结束路径：尚未完成的登录终止，已存储的 profile 状态恢复，并且可以再次发起登录。
- 内部包名仍可能出现在源码图与诊断中，但不支持作为独立 Codex 安装。
- 单一公开边界不会合并 DSH OAuth profile 存储与官方 Codex-home 存储。两者的账号选择保持显式，并使用相同的 `name`、`email` 展示规则。
