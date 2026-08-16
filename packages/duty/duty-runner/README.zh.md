# @deepseek-ai/dsh-duty-runner

[English](README.md) | 中文

Duty run 运行时:把 `duty/trigger` 观测或手动启动变成一次主触发 run,以 agent 回合与子代理扇出的方式驱动存储的执行 body,在持久化人工决策上停靠,并按 Duty 的失败、预算与 cursor 策略结清 run。

run 的 Session 日志是机器状态的唯一权威。每次状态变化都是一个 session 事件(`duty/run-bound`、`duty/step`、`duty/human-wait`、`duty/human-answer`、`duty/run-finish`),机器状态在每个空闲边界与每次冷恢复时从日志重新折叠——没有进程内游标。

## 配置

| 键 | 含义 |
|---|---|
| `subagentProvider` | `parallel` 扇出所用 subagent provider;默认 `fork`。 |
| `tokenPriceUsdPerMillion` | 必填:每百万 token 的综合美元价格,用于 run 成本归属;`0` 关闭成本核算。 |
| `maxRepairs` | 0–5:agent 步骤在首次尝试之后的修复次数;默认 2。 |

```yaml
- id: duty-runner
  name: '@deepseek-ai/dsh-duty-runner'
  config:
    subagentProvider: fork
    tokenPriceUsdPerMillion: 2.0
    maxRepairs: 2
```

服务注入 `duties`、`agents`、`sessions`、`subagents` 与 `sessionPersistence`。

## run 生命周期

1. **Claim。** 触发观测或 {@link DutyRunnerService.startRun} 以新铸的 Session id claim Duty 的单 run 名额。被跳过的 claim 记入触发审计;对不可运行 Duty 的手动启动以 `duty-not-runnable` 拒绝。
2. **世界。** run 的 Agent 以作用域世界创建:`tools.restrict` 把工具收敛到 `toolPolicy.allow`,`tools.guard` 拒绝 gated 工具,并注册三个 run 作用域工具:`duty_adapt_body`(结构调整)、`duty_step_done`(完成标记)、`duty_request_human`(持久化人工问题)。
3. **开场。** 第一条模型可见消息是点名触发原因的中文开场白,随后是第一步指令。步骤只有模型调用 `duty_step_done` 才算完成;从未汇报的步骤最多修复 `maxRepairs` 次,随后判 run 失败。
4. **Body。** `agent` 步骤作为 run Agent 上的回合执行;`phase` 步骤按序递归;`parallel` 步骤经 subagent seam 扇出子步骤,只有全部子代理以 `completed` 停止才算完成。
5. **验证。** `verification: 'on'` 时,已汇报的步骤完成经过配置的 `ctx.dutyVerifiers` 检查器,基于该步骤的证据窗口判定;每次判定记录为 `duty/verdict`,失败判定把步骤送回修复,缺失检查器令 run 大声失败。
6. **停靠与恢复。** `duty_request_human` 创建持久化 {@link HumanRequest},追加 `duty/human-wait`,并以 `waiting_for_human` 结清 run、保持名额。答复落库后,`dsh-duty` 发出 `duty/human-answered`;runner 恢复同一 Session,追加 `duty/human-answer`,从折叠状态继续。停靠的 run 跨进程重启存活:启动对账重新武装它,并通过重放持久化日志冷恢复被打断的 run。
6. **结清。** cursor 只在成功时推进。run 成本是该 Session 的 `assistant/message` usage 之和乘以 `tokenPriceUsdPerMillion`;超过 `limits.budgetUsd` 判失败并以 `budget` 暂停,与失败计数无关。连续失败按 `limits.maxConsecutiveFailures` 以 `failures` 暂停。

## 模型体验

### run 作用域工具与提示词

#### 模型看到什么

每步一条宿主注入的用户消息,点名步骤标签与 prompt,并要求 `duty_step_done` 汇报。三个 run 作用域工具(`duty_adapt_body`、`duty_step_done`、`duty_request_human`)只存在于该 run 的 Agent 上。开场白、指令、工具结果与恢复的人工答复全部是 session 事件,因此模型可见即已记录。

#### Token 影响

每步尝试一个指令块,加上模型自身的工作。parallel 子步骤跑在独立子代理 Session 中,消耗自己的 token,不进 run Agent 的上下文。

#### KV Cache 影响

run Session 内只追加:每次尝试在可复用前缀之后延续对话。子代理有独立的请求前缀。

## 已知限制与待办

- **验证是可选开启的** — 默认 `verification: 'off'` 接受模型自报的 `duty_step_done`;`'on'` 咨询 `ctx.dutyVerifiers` seam,其 evaluator provider 判定证据窗口,失败判定把步骤送回修复。
- **无跨进程单 run 保证** — claim 经单 Host 进程的域写链串行化;两个 Host 进程同时运行 runner 都会轮询,输掉 claim 竞争的一方得到一条跳过记录。
- **结构调整由模型撰写** — `duty_adapt_body` 按持久化 schema 校验调整后的 body,但执行前不强制与存储 body 的 diff 审查。
- **预算定价是单一综合费率** — 按 provider 或模型的定价待做;run 以配置的每百万 token 美元价归集成本。
- **卸载即停靠而非结清** — 卸载 runner 会释放存活的 run Agent 而不结清;下次启动的对账冷恢复或判失败。
