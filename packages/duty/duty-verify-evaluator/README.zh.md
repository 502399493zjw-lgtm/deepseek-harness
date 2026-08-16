# @deepseek-ai/dsh-duty-verify-evaluator

[English](README.md) | 中文

评估者验证器:用一次性子代理在有界证据束上判定已汇报的步骤完成,返回结构化判定(`pass`/`reason`)——绝不嗅探自然语言。

## 配置

| 键 | 含义 |
|---|---|
| `subagentProvider` | 评估子代理所用的 provider;默认 `fork`。 |
| `maxEvidenceChars` | 必填整数 ≥ 1000:渲染证据块的 UTF-16 字符上限。 |

```yaml
- id: duty-verify-evaluator
  name: '@deepseek-ai/dsh-duty-verify-evaluator'
  config:
    subagentProvider: fork
    maxEvidenceChars: 12000
```

插件以 id `evaluator` 注册到 `ctx.dutyVerifiers`,注入 `dutyVerifiers` 与 `subagents`。

## 判定流程

一次验证启动一个一次性子代理,携带中文评估指令(步骤标签、步骤目标、模型自报摘要、证据行)与 `{ pass, reason }` 的输出 schema。没有有效结构化判定就停下的子代理解析为一次带原因的失败验证,run 运行时据此进入修复而不是前进。

## 模型体验

### 评估子代理提示词

#### 模型看到什么

一条子代理指令,点名步骤标签与目标、自报摘要与证据行,结尾要求结构化 `{ pass, reason }` 输出。子代理的判定是 run 运行时的唯一输入;子代理自身的转录留在自己的 Session 中。

#### Token 影响

每次验证一个指令块加证据束,在独立子代理 Session 中——不占 run Agent 的上下文。

#### KV Cache 影响

独立:每个评估子代理有各自的请求前缀。

## 已知限制与待办

- **证据是渲染窗口而非原始日志** — 运行时对证据行做有界渲染;评估者不能索取更多上下文。
- **单次判定** — 失败判定修复步骤,但不触发更深的复查策略。
