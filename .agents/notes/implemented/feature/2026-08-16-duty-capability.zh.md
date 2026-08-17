# Agent Note: Duty 能力——持久化职责、主触发 run 与人工收件箱

Status: implemented

[English](2026-08-16-duty-capability.md) | 中文

## Problem

对 dittos loop 产品的调研显示,它相对 DeepSeek Harness 有四个能力缺口:没有冷会话常驻触发、没有独立验证、没有不依赖在线 agent 的持久化人工裁决、没有把三者串起来的运行时。而"loop flow"产品的其余部分——会话日志、agent、工具、子代理、目标、存储域、会话投影——DSH 全部已有可复用能力。一个 loop flow 本质上是一份持久化职责:一份说明要做什么、何时做、用哪些工具、如何汇报结果的合约,外加每次主触发产生一个用户可见的 run,其全过程都落在同一个 Session 里。

## Decision

该能力以第一方 `packages/duty/*` 包组落地(`@deepseek-ai/dsh-duty*`;UI 层仍把产品概念称为"loop flow"):

- **`dsh-duty`** 拥有 `duty` 存储域中的持久化记录层:`specs`、`state`、`runs`、`human_requests`、`trigger_events` 五张以 `DutyId` 为键的表。一次触发通过在域写链内的 claim 恰好接纳一个 `DutyRun`(dittos 的 `claimRun` 是非原子的先读后写)。cursor 只在 run 完成后推进;连续 N 次失败(默认 3)以 `failures` 原因暂停;显式的 `budget` 暂停与失败次数无关、立即生效。`ask`/`answer` 实现持久化人工收件箱,校验选项或自由文本;`answer` 只在持久化落定之后才发出 `duty/human-answered` 事件。未来唤醒与解析它的 Duty spec 版本一同存储;感知版本的 claim 把旧唤醒决定以 `not-due` 拒绝。
- **`dsh-duty-trigger`** 是唤醒源 seam:一个按可配置的亚分钟节奏轮询已注册 provider、并把其观测以 `duty/trigger` 事件发布的注册表。sweep 永不重叠、每次唤醒都重读墙钟,沿用 schedule 包的时钟纪律。
- **`dsh-duty-trigger-timer`** 为 `interval` 与 `cron` 类型的 Duty 注册 `timer` provider。interval 的发生点锚定在创建时间上;cron 是五段数值子集、Vixie OR 日期语义,因仓库没有现成解析库、且所需操作是"此刻之后的最近一次匹配"而手写实现。cron 触发可命名 IANA 时区(省略即 UTC):匹配通过 `Intl.DateTimeFormat` 读取每个候选分钟,因此半小时偏移在精确的本地分钟边界触发,日期字段跟随该时区的本地日历,夏令时切换让唤醒随偏移移动——春季跳过的一小时没有匹配,秋季重复的一小时按 Vixie cron 惯例每个 UTC 经过各触发一次。错过的发生点只前进不重放:一个 Duty 只为最近一次已过去的发生点醒来一次。provider 把首次未来发生点与 Duty 版本一同持久化,使后续 sweep 与重启跳过规则计算,编辑则使旧唤醒失效。注册表 `pollIntervalMs` 上限(≤ 60 秒)保证整分钟 cron 匹配不会落在两次 sweep 之间。
- **`dsh-duty-runner`** 是运行时:收到观测或手动启动后先 claim,再用 `tools.restrict` 把工具收敛到 `toolPolicy.allow`、用 `tools.guard` 拒绝 gated 工具,创建 run 的 Session 与 Agent,然后执行 body。Session 日志是机器状态的唯一权威:`duty/run-bound`、`duty/step`、`duty/human-wait`、`duty/human-answer`、`duty/run-finish` 事件折叠出机器状态,因此停靠的 run 在重启后靠重放持久化日志恢复。agent 步骤只有模型调用 run 作用域内的 `duty_step_done` 才算完成;从未汇报的步骤最多修复 `maxRepairs` 次后判 run 失败。`parallel` 步骤经 `ctx.subagents` 扇出。开场白沿用中文"开始执行你的 loop flow。本次触发原因:${reason}。"。run 成本是该 Session 中 `assistant/message` usage 之和按配置的 `tokenPrices` 映射计价(每百万 token 美元价;映射中缺失的 provider 判 run 失败并大声报错);超过 `limits.budgetUsd` 即判失败并以 `budget` 暂停。
- **`dsh-tool-duty`** 向模型暴露 `duty_list`、`duty_create`、`duty_set_lifecycle`、`duty_start`、`duty_answer`;**`dsh-command-duty`** 注册 `/duty` 与 `/loop`,`/loop` 把当前转录提炼为 Duty 合约草稿的指令交给模型。
- **`dsh-duty-verify`** 是独立完成验证 seam(`ctx.dutyVerifiers`,一个配置的默认 verifier id),**`dsh-duty-verify-evaluator`** 注册 verifier `evaluator`:每次已汇报的步骤完成启动一个一次性子代理,基于运行时渲染的证据窗口返回结构化 `{ pass, reason }` 判定。Duty 通过 `verification` 选择启用(`off`、`on` 用配置默认,或点名某个已注册的 verifier id);runner 把每次判定记录为 `duty/verdict`,失败判定进入修复,选中的检查器缺失时令 run 大声失败。评估者的中文指令由 duty 快照固定。

硬度分层按方案执行:能力层是唯一的硬层(工具收敛与 gating 由 Agent 作用域世界强制执行,而不是靠提示词),行动指引保持软性,Phase 1 不设学习记忆层。执行 body 是结构化数据,在合约边界校验(`MAX_BODY_STEPS` 30、深度 5、`MAX_PARALLEL_WIDTH` 8、预算 ≤ 20 美元、gated ⊆ allow、agent 步骤必须有 prompt);不存在会与实际执行计划漂移的渲染版 `flow.js`,`duty_adapt_body` 把结构调整以结构化方式记录进 run 日志。

## Alternatives considered

- **dittos 的 `flow.js` 与 `claude -p` 执行器**:拒绝——只给人看、从不执行的源码是认知陷阱,子进程执行器也重复了 DSH 的 agent loop。
- **用 `dsh-goal-round-driver` 实现 attempt ≈ goal round**:拒绝——该 driver 跑的是均匀轮次循环,而 Duty body 是带 `parallel` 扇出与人工停靠的结构化步骤机;runner 自行实现空闲检查点(`whenIdle`)、落盘屏障(`sessions.flush`)与修复循环,并在文档中说明这一取舍。
- **做成外部插件包**:拒绝——触发 seam、人工收件箱与 run 运行时必须触及会话、域、工具、agent 层,这些属于第一方包。
- **dittos 的 `.data/*.json` 裸存储与手写 HTTP 路由**:拒绝——存储域与现有 web/Remote 栈负责这些职责。
- **dittos 的字符串子串升级匹配**:拒绝——升级条件是合约上的结构化数据,不做文本嗅探。

## Consequences

- runner 在人工答复上停靠,并从持久化日志冷恢复被打断的 run;启动对账重新武装停靠中的 run、把无法恢复的判为失败。
- 触发注册表与 timer provider 是进程内投影;第二个 Host 进程会重复 sweep,单 run claim 会把重复转化为一条 skip 记录。
- 首个提交之后交付:Typert Host Remote 上的 `DutyService` 合约、`duty` session 投影、`ui-duty`、带无密钥快照的可运行示例、验证 seam 与 evaluator provider、按 Duty 选择检查器、失败判定的人工申诉流程、按 provider 的定价,以及 cron 时区。
- 留待后续迭代:按模型的定价(当前定价图按 provider 计)。
- `duty/step` 等会话事件在 `SessionEventMap` 上不带 `ignorable` 声明,因此含这些事件的会话需要 duty-runner 包(或其类型)才能被读取;duty profile 总是加载它。
