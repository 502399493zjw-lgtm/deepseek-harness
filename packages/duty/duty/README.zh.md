# @deepseek-ai/dsh-duty

[English](README.md) | 中文

DeepSeek Harness 的持久化职责合约。该包注册 `ctx.duties`,持久化 `duty` 存储域,并拥有 {@link DutySpec}、{@link DutyState}、{@link DutyRun} 与 {@link HumanRequest} 的封闭词表。它是 Duty 能力的记录层:把主触发变成 run 的运行时、以及渲染实时状态的 UI 都在独立包中。

公开类型从包根与 `@deepseek-ai/dsh-duty/types` 导出;[`src/types.ts`](src/types.ts) 是其来源。持久化 schema 与其整体边界位于 [`src/spec.ts`](src/spec.ts)。

## 配置

| 键 | 含义 |
|---|---|
| `defaultMaxConsecutiveFailures` | 必填整数 1–20:Duty 自行暂停前可容忍的连续失败次数。 |
| `runHistoryLimit` | 必填正整数:每个 Duty 保留的 run 记录数,新记录在前。 |
| `triggerEventLimit` | 必填正整数:每个 Duty 保留的触发审计事件数。 |

```yaml
- id: duty
  name: '@deepseek-ai/dsh-duty'
  config:
    defaultMaxConsecutiveFailures: 3
    runHistoryLimit: 50
    triggerEventLimit: 50
```

服务注入 `storageDomain`。其持久化域为 `duty`,每类关注点一张表:`specs`、`state`、`runs`、`human_requests`、`trigger_events`,均以 `DutyId` 为键。

## 数据、生命周期与持久化

一次主触发恰好产生一个 {@link DutyRun},该 run 终其一生拥有同一个 Session:重试、修复与人工答复都延续该 Session,而不是开启新 run。因此持久化 Duty 数据存放在 `duty` 域,绝不放进 Session 日志,因为它必须比它创建的每个 Session 活得更久。

`create` 依据请求组装合约(手动触发派生 `once`,否则 `standing`,并默认 `verification` 为 `off`),按持久化 schema 校验后以 `draft` 落库。`edit` 在基于不透明 `version` 令牌的比较并交换下替换指定字段,并对合并后的合约重新校验,因此编辑不可能存入重开时会拒绝的合约。`setLifecycle` 在 `draft`、`active`、`paused`、`archived` 之间迁移;进入 `paused` 记录原因,离开时清除原因。

`claim` 在一次域写链变换内占住 Duty 的单 run 名额并分配下一个 run 编号,因此同时到达的两个触发不可能都启动 run 或拿到同一编号。它以 `paused`、`archived`、`running`、`draft` 作为触发的 `skippedReason` 拒绝。`settle` 写入最终 run 记录并执行策略:cursor 只在成功时推进;失败计数在成功时清零,连续失败达 `limits.maxConsecutiveFailures` 次后暂停 Duty;显式 `pause`(如 `budget`)与计数无关立即暂停;`waiting_for_human` 保持名额,因为同一个 run 在答复后继续。

`ask` 开启绑定到 run 的 Session 的持久化 {@link HumanRequest};`answer` 结清它,除非 `allowFreeform` 否则强制限定选项,并拒绝重复结清。`recordTrigger` 保存每次唤醒决策的有界审计,包括未运行的跳过原因。

## 服务错误

`DutyError` 携带稳定 `code`,取值含 `duty-not-found`、`run-not-found`、`human-request-not-found`、`version-conflict`、`duty-running`、`duty-not-runnable`、`request-already-settled`、`answer-not-offered`、`invalid-contract` 与 `domain-not-open`。运行期存储故障按原样抛出,不会误标为业务错误。

## 合约边界

`src/spec.ts` 中的 schema 强制执行 body 限制与触发词表:最多 30 步、深度 5、parallel 扇出 8、单 run 预算 ≤ 20 美元、interval 周期至少一分钟、五段数值 cron、cron 触发可选的 IANA 时区、gated 工具取自 allow、agent 步骤带 prompt 且无子节点、组合步骤必须有子节点。违反任一条的合约在 `create`/`edit` 中以 `DutyError('invalid-contract')` 拒绝。

## 模型体验

### 本地 duty 状态

#### 模型看到什么

什么都看不到。`ctx.duties` 不注册任何工具、提示词段落、模型上下文或 Session 事件。Duty 合约只有通过单独记录的 Consumer(如工具或斜杠命令)才会到达模型。

#### Token 影响

零。任何合约、状态、run 记录或人工决策都不会进入模型请求。

#### KV Cache 影响

独立。列出或修改 duty 记录不触及模型请求前缀。

## 已知限制与待办

- **本包只做记录,不执行** — run 运行时、触发扫描、工具与命令 Consumer、UI 都在兄弟 duty 包中。
- **人工决策无截止时间** — 开启的请求会一直保持开启;时限到期与再询问推迟到触发/运行时层。
- **无跨进程条件写** — claim 通过单进程的域写链串行化;多 Host 进程写同一存储根依赖后端自身的单写者模型。
- **无 Duty 删除级联** — `remove` 删除 Duty 自有记录,但它创建的 run Session 仍保留;Session 历史删除归 Session persistence 所有,尚无删除 API。
