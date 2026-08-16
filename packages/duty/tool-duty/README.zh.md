# @deepseek-ai/dsh-tool-duty

[English](README.md) | 中文

面向模型的 Duty 工具:`duty_list`、`duty_create`、`duty_set_lifecycle`、`duty_start` 与 `duty_answer`。它们是持久化 Duty 域与 run 运行时之上的模型可见层;所有校验与生命周期规则仍在 `@deepseek-ai/dsh-duty` 中。

该包无配置。它注入 `duties`;run 运行时是可选依赖,经 `ctx.get('dutyRunner')` 解析,因此 `duty_start` 在运行时缺失时报告加载错误而不是自行加载。

## 工具

| 工具 | 效果 |
|---|---|
| `duty_list` | 列出每个 Duty 的生命周期、run 数、运行标志与最近结果。 |
| `duty_create` | 依据完整合约创建一个 Draft Duty;Host 负责校验。 |
| `duty_set_lifecycle` | 在 draft、active、paused、archived 之间迁移;暂停需给出原因。 |
| `duty_start` | 经 run 运行时手动唤醒一个 active Duty;返回 run id。 |
| `duty_answer` | 结清一个开启的人工决策,解除其停靠 run 的阻塞。 |

失败返回 `{ ok: false, error }`(`DutyError` 情形附带 `code`)而不是抛错,以便模型读到原因后重试。

## 模型体验

### Duty 工具结果

#### 模型看到什么

工具结果是持久化记录的紧凑 JSON 摘要,绝不是完整合约。`duty_create` 只返回新 id 与 mode;列表结果携带状态,不带 body 步骤。

#### Token 影响

每次调用有界:结果是小型摘要,本包任何工具都不回显 Duty body。

#### KV Cache 影响

独立。Duty 工具调用不触及模型请求前缀。

## 已知限制与待办

- **无编辑或删除工具** — `duty_edit` 与删除尚未暴露给模型;只有创建、生命周期、唤醒与答复。
- **无人工收件箱读取工具** — 模型无法枚举开启的人工请求;答复需要从带外取得 id。
- **`duty_start` 依赖可选 run 运行时** — 缺少 `@deepseek-ai/dsh-duty-runner` 时该工具报告加载错误而不执行。
