# @deepseek-ai/dsh-duty-trigger-timer

[English](README.md) | 中文

定时唤醒源 provider:以 id `timer` 注册到 `ctx.dutyTriggers`,上报每个到期(interval 或 cron 已到)且活跃、未被占用的 standing Duty。它只读持久化 Duty 状态,因此无论是否有 Session 或 agent 在线,Duty 都能醒来。

## 唤醒规则数学

规则数学位于 [`src/domain.ts`](src/domain.ts),是纯确定性函数;生产读平台墙钟,测试提供显式时刻。

- **interval** 的发生点锚定在创建时间:`createdAt + k·everyMs`,`k ≥ 1`,首次唤醒在创建后一个周期。睡过三个周期的 Duty 只为最近一次已过去的发生点醒来一次——绝不为每个错过的周期各醒一次——且 `nextWakeAt` 始终越过当前时刻。
- **cron** 表达式是五个数值字段(分钟、小时、日、月、星期;0 与 7 都表示周日),支持 `*`、区间、列表与步长。日期匹配采用常见 OR 语义:两个受限日期字段都需认可该日,或只有受限的那个字段生效。匹配分钟在其整个时长内保持到期,因此注册表亚分钟的 sweep 节奏不会跳过它;错过的匹配分钟只前进、不重放。搜索范围为 {@link CRON_SEARCH_HORIZON_DAYS} 天(八年,覆盖非闰世纪处 2096 至 2104 的特殊闰日间隔);无解的规则(如 2 月 30 日)不报告任何发生点。语法非法的规则在合约写入时已被 schema 拒绝,轮询时再次告警跳过,以防御手改过的持久化介质。
- **cron 时区** — cron 触发可携带 IANA 时区名,省略即 UTC。时区匹配通过 `Intl.DateTimeFormat` 读取每个候选分钟,因此半小时、三刻钟偏移会在精确的本地分钟边界触发;夏令时切换让唤醒随偏移移动:春季跳过的那一小时里没有 02:30,秋季重复的一小时按 Vixie cron 的惯例每个 UTC 经过各触发一次。日与星期字段跟随该时区的本地日历,包括在对应 UTC 午夜之前开始的本地星期。

## 轮询

一次轮询读取一次 `ctx.duties.list()`,跳过所有非 standing、无 `interval`/`cron` 触发、非 `active`、`running`,或存储的 `nextWakeAt` 由当前 Duty 版本解析且仍在未来的 Duty。规则首次解析到未来发生点时,provider 在不返回观测之前就把该时刻连同当前版本存下,使后续 sweep 与进程重启直接走持久化快路径,不再重算规则;编辑会更换版本并使旧唤醒失效。每个到期 Duty 产生一条携带触发描述作为原因、Duty 版本与后续 `nextWakeAt` 的观测;run 运行时只 claim 该版本,并在 claim 后保存后续唤醒。

## 模型体验

### 本地定时器状态

#### 模型看到什么

什么都看不到。该 provider 不注册任何工具、提示词段落、模型上下文或 Session 事件;其 `DutyTriggerObservation`s 只有在 run 运行时把它们变成 run 的 Session 后才到达模型。

#### Token 影响

零。任何观测、规则计算或告警都不会进入模型请求。

#### KV Cache 影响

独立。轮询不触及模型请求前缀。

## 已知限制与待办

- **单一共享节奏** — provider 按注册表唯一的 `pollIntervalMs` 被轮询,不自行启动计时器。
- **手写五段 cron** — 因仓库没有现成解析库、且所需操作是"此刻之后的最近一次匹配"而本地实现数值子集;若范围语义需要超出该子集,可换用维护中的库。
