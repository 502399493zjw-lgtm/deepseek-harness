# @deepseek-ai/dsh-command-duty

[English](README.md) | 中文

面向人类的 Duty 命令。`/duty` 列出 Duty 并手动唤醒一个;`/loop` 请模型从当前转录提炼 Duty 合约草稿并用 `duty_create` 创建。

该包无配置。它注入 `commands` 与 `duties`;run 运行时是可选依赖,经 `ctx.get('dutyRunner')` 解析,因此 `/duty start` 在运行时缺失时报告加载错误而不是自行加载。

## 命令

| 命令 | 效果 |
|---|---|
| `/duty` 或 `/duty list` | 列出每个 Duty 的 id、生命周期、标题与最近结果。 |
| `/duty start <dutyId> <原因>` | 手动唤醒一个 active Duty 并报告 run id。 |
| `/loop <触发方式描述>` | 排队一条模型指令:从转录提炼 Duty 合约,经 `duty_create` 创建 Draft;需要 `@deepseek-ai/dsh-tool-duty`。 |

## 模型体验

### loop 起草指令

#### 模型看到什么

一条用户消息,指示模型从当前转录提炼目标、边界、触发、body、工具策略与升级条件,并用 `duty_create` 创建 Draft——绝不激活。该消息是 session 事件,因此起草的合约已记录。

#### Token 影响

每次 `/loop` 调用一个固定指令块,加上模型自身的起草工作。

#### KV Cache 影响

只追加:指令在可复用前缀之后延续现有对话。

## 已知限制与待办

- **`/loop` 依赖 `@deepseek-ai/dsh-tool-duty`** — 缺少它时模型无法创建草稿,只能报告缺失工具。
- **无删除或历史命令** — 命令面只覆盖列表与启动;编辑、暂停、归档与 run 历史仍是工具或 UI 的职责。
