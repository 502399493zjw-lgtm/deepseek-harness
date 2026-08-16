# @deepseek-ai/dsh-duty-verify

[English](README.md) | 中文

独立步骤完成验证 seam:`ctx.dutyVerifiers` 注册完成检查器并解析配置的那一个。当 Duty 合约以 `verification: 'on'` 选择启用时,run 运行时在 `duty_step_done` 之后咨询它;失败的判定把步骤送回修复循环,缺失的检查器大声失败而不是默默放行。

公开类型从包根与 `@deepseek-ai/dsh-duty-verify/types` 导出;[`src/types.ts`](src/types.ts) 是其来源。

## 配置

| 键 | 含义 |
|---|---|
| `verifier` | 必填:注册表为验证请求选择的 verifier id。 |

```yaml
- id: duty-verify
  name: '@deepseek-ai/dsh-duty-verify'
  config:
    verifier: evaluator
```

## 判定

{@link DutyVerifier} 收到步骤、模型的一行完成摘要,以及运行时从 run Session 渲染出的有界证据束;检查器从不直接读日志,因此请求就是完整的输入面。基础设施故障会抛出,运行时将其视为一次失败的验证——绝不默默放行。

## 模型体验

### 本地验证注册表状态

#### 模型看到什么

什么都看不到。注册表不注册任何工具、提示词段落、模型上下文或 Session 事件。它的判定只经 run 运行时的修复循环到达模型,每次判定都记录为 `duty/verdict` session 事件。

#### Token 影响

注册表本身为零;检查器自身的模型用量属于检查器。

#### KV Cache 影响

独立。注册表不触及模型请求前缀。

## 已知限制与待办

- **单一选中检查器** — 注册表只解析一个配置 id;按 Duty 选择检查器待做。
- **无判定申诉或复查策略** — 失败判定只把步骤送回修复;还没有人工申诉面。
