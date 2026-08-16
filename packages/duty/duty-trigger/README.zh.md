# @deepseek-ai/dsh-duty-trigger

[English](README.md) | 中文

Duty 唤醒源 seam:`ctx.dutyTriggers` 注册触发 provider 并按固定节奏轮询它们,把其观测发布为 `duty/trigger` 事件。provider 负责对持久化 Duty 状态的到期计算;run 运行时(独立 Consumer)负责 claim、去重与执行。注册表只负责节奏与故障遏制。

公开类型从包根与 `@deepseek-ai/dsh-duty-trigger/types` 导出;[`src/types.ts`](src/types.ts) 是其来源。

## 配置

| 键 | 含义 |
|---|---|
| `pollIntervalMs` | 必填整数毫秒 1000–60000:两次 sweep 启动之间的间隔。 |

```yaml
- id: duty-trigger
  name: '@deepseek-ai/dsh-duty-trigger'
  config:
    pollIntervalMs: 30000
```

上限保证整分钟 cron 匹配不会落在两次 sweep 之间:每次 sweep 最多间隔一分钟,而匹配分钟在其整个时长内保持到期。

## provider 与 sweep

provider 实现 {@link DutyTriggerProvider}:稳定的唯一 `id` 与只返回到期 {@link DutyTriggerObservation} 的 `poll(now)`。重复 id 直接抛错;{@link DutyTriggerService.registerProvider} 返回 disposer,因此 provider 插件经 `ctx.effect()` 注册、在 fiber 卸载时注销。

一次 sweep 按当前墙钟轮询每个 provider 一次,并把每条观测以 `duty/trigger` 事件发布。sweep 永不重叠:下一次计时器只在当前 sweep 落定后启动,每次唤醒重读时钟而不累积漂移。poll 抛错的 provider 被记录并跳过,既不会拖住 sweep,也不会掩盖其他 provider 的到期任务。并发 {@link DutyTriggerService.sweep} 调用共享同一次在途 sweep。

观测是候选而非决定:Consumer 对照 Duty 域校验,然后要么 claim 一个 run,要么记录跳过原因。

## 模型体验

### 本地触发注册表状态

#### 模型看到什么

什么都看不到。`ctx.dutyTriggers` 不注册任何工具、提示词段落、模型上下文或 Session 事件;观测只有在 Consumer 将其变成 run 的 Session 后才到达模型。

#### Token 影响

零。任何观测、provider id 或 sweep 结果都不会进入模型请求。

#### KV Cache 影响

独立。sweep 不触及模型请求前缀。

## 已知限制与待办

- **观测不在此持久化** — 注册表只在一次 emit 期间持有观测;Consumer 决定哪些持久化(`duty` 域中的 run 记录与触发审计)。
- **无按 provider 的节奏** — 所有 provider 共享注册表唯一的 sweep 间隔。
- **单进程 sweep** — 两个 Host 进程都会轮询与上报;run 运行时的单 run claim 把重复转化为跳过记录。
