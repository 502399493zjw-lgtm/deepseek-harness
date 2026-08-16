/**
 * Human-facing Duty commands: `/duty` inspects and wakes Duties directly, and
 * `/loop` turns the current transcript into a Duty contract draft.
 * @module @deepseek-ai/dsh-command-duty
 */

import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { DutyError, DutyId } from '@deepseek-ai/dsh-duty'
import type {} from '@deepseek-ai/dsh-session'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'command-duty'

/** The command registry and the Duty domain the commands read and wake. */
export const inject = ['commands', 'duties']

/** This package has no deployment-varying policy. */
export interface Config {}

export const Config: s<Config> = s.object({})

const DUTY_USAGE = '用法: /duty list | /duty start <dutyId> <原因>'

/** Render one Duty for a human in the command surface. */
function renderDutyLine(view: { spec: { id: string; title: string }; state: { lifecycle: string; lastOutcome?: string } }): string {
  return `- ${view.spec.id} ${view.state.lifecycle} ${view.spec.title}`
    + (view.state.lastOutcome === undefined ? '' : ` (last: ${view.state.lastOutcome})`)
}

/** Execute one parsed `/duty` command against the durable domain. */
async function executeDutyCommand(ctx: Context, rawInput: string): Promise<CommandResult> {
  const parts = rawInput.trim().split(/\s+/u).filter(part => part.length > 0)
  const verb = parts[0]
  try {
    if (verb === undefined || verb === 'list') {
      const views = ctx.duties.list()
      if (views.length === 0) return { kind: 'success', text: '没有 Duty。' }
      return { kind: 'success', text: views.map(renderDutyLine).join('\n') }
    }
    if (verb === 'start') {
      const dutyId = parts[1]
      const reason = parts.slice(2).join(' ') || '由 /duty 命令触发'
      if (dutyId === undefined) return { kind: 'error', text: DUTY_USAGE }
      const runner = resolveRunner(ctx)
      if (runner === undefined) {
        return { kind: 'error', text: '未加载 duty run runtime (@deepseek-ai/dsh-duty-runner)。' }
      }
      const run = await runner.startRun(DutyId(dutyId), { kind: 'manual', reason })
      return { kind: 'success', text: `已启动 run ${run.id}。` }
    }
    return { kind: 'error', text: DUTY_USAGE }
  } catch (error: unknown) {
    if (error instanceof DutyError) return { kind: 'error', text: error.message }
    return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
  }
}

/** The one run-runtime method these surfaces reach, kept optional. */
interface DutyRunnerLike {
  startRun(dutyId: string, cause: { kind: 'manual'; reason: string }): Promise<{ id: string }>
}

/** Resolve the optional run runtime without binding this package to it. */
function resolveRunner(ctx: Context): DutyRunnerLike | undefined {
  const value: unknown = ctx.get('dutyRunner')
  return typeof value === 'object' && value !== null && 'startRun' in value
    ? (value as DutyRunnerLike)
    : undefined
}

/** The model instruction that turns the current transcript into a Duty draft. */
const LOOP_DRAFT_PROMPT = [
  '根据本会话的完整上下文,把用户想要的 loop flow 提炼成一份 Duty 合约草案:',
  '1. 概括目标 (goal) 与边界 (scope),给出标题。',
  '2. 确定触发方式:一次性手动、每隔多久 (interval,至少 60 秒)、或五段式 cron。',
  '3. 把工作拆成执行步骤 body:agent 步骤必须带 prompt,可用 parallel/phase 分组。',
  '4. 选择工具策略 tool_policy:allow 只列必需工具,gated 列出需要人工同意的。',
  '5. 需要人工介入的条件写入 escalation。',
  '完成后调用 duty_create 工具创建草稿 (draft),不要激活;把 draft id 告诉用户,',
  '由用户确认后再用 duty_set_lifecycle 激活。',
].join('\n')

/**
 * Register the `/duty` and `/loop` commands.
 * @param ctx - Cordis context carrying the command registry and Duty domain.
 */
export function apply(ctx: Context): void {
  ctx.commands.register({
    name: 'duty',
    description: '查看 Duty 列表或手动启动一个 Duty。',
    input: { hint: 'list | start <dutyId> <原因>' },
    handler: invocation => executeDutyCommand(ctx, invocation.rawInput),
  })

  ctx.commands.register({
    name: 'loop',
    description: '把当前会话提炼成一份 Duty 合约草案。',
    input: { hint: '<触发方式描述>' },
    handler: (invocation) => {
      const reason = invocation.rawInput.trim()
      const message = createUserMessage({
        content: [{ type: 'text', text: LOOP_DRAFT_PROMPT + (reason === '' ? '' : `\n用户描述的触发方式:${reason}`) }],
        source: { kind: 'user' },
      })
      invocation.agent.followup(message)
      return { kind: 'success', text: '已请求模型起草 Duty 合约,完成后会调用 duty_create 并汇报 draft id。' }
    },
  })
}
