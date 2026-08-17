/**
 * Model-facing Duty tools: read, create, edit, and wake Duties from an agent
 * turn. The durable domain and the run runtime own the behavior; these tools
 * are the model-visible surface over them.
 * @module @deepseek-ai/dsh-tool-duty
 */

import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { DutyError, DutyId, HumanRequestId } from '@deepseek-ai/dsh-duty'
import type { DutyLifecycle, DutyPauseReason } from '@deepseek-ai/dsh-duty'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-duty'

/** The Duty domain the tools read and mutate. */
export const inject = ['tools', 'duties']

/** This package has no deployment-varying policy. */
export interface Config {}

export const Config: s<Config> = s.object({})

/** Render a Zod-style contract failure for the model. */
function renderError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Register the Duty tools with the host tool registry. */
/** The one run-runtime method these surfaces reach, kept optional. */
interface DutyRunnerLike {
  startRun(dutyId: string, cause: { kind: 'manual'; reason: string }, options?: { wait?: boolean }): Promise<{ id: string }>
}

/** Resolve the optional run runtime without binding this package to it. */
function resolveRunner(ctx: Context): DutyRunnerLike | undefined {
  const value: unknown = ctx.get('dutyRunner')
  return typeof value === 'object' && value !== null && 'startRun' in value
    ? (value as DutyRunnerLike)
    : undefined
}

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'duty_list',
    description:
      'List every Duty with its current lifecycle, run count, and most recent outcome. '
      + 'Use it to see what responsibilities exist before creating or editing one.',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: (): Promise<JsonValue> => {
      return Promise.resolve(ctx.duties.list().map(view => ({
        id: view.spec.id,
        title: view.spec.title,
        mode: view.spec.mode,
        lifecycle: view.state.lifecycle,
        pausedReason: view.state.pausedReason ?? null,
        runCount: view.state.runCount,
        running: view.state.running,
        lastOutcome: view.state.lastOutcome ?? null,
        consecutiveFailures: view.state.consecutiveFailures,
      })))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'duty_create',
    description:
      'Create one Duty in draft from a complete contract: title, goal, trigger, execution '
      + 'body, tool policy, and optional limits. The Host validates the contract; a draft '
      + 'never wakes until duty_set_lifecycle activates it.',
    parameters: {
      id: { type: 'string', description: 'Optional caller-chosen UUID for idempotent creation.' },
      title: { type: 'string', required: true, description: 'Short human-facing name.' },
      goal: { type: 'string', required: true, description: 'Intended outcome in the user\'s own terms.' },
      scope: { type: 'string', description: 'What the Duty must not do.' },
      trigger: {
        type: 'json',
        required: true,
        description: 'kind manual | interval (everyMs >= 60000) | cron (five numeric fields, optional timezone as an IANA name, UTC when omitted), plus a description.',
      },
      verification: {
        type: 'string',
        description: 'off (default) | on (the configured default verifier) | a registered verifier id.',
      },
      body: {
        type: 'json',
        required: true,
        description: 'Execution body: steps of kind agent (prompt required), parallel, or phase with children.',
      },
      tool_policy: {
        type: 'json',
        required: true,
        description: '{ allow: [tool names], gated: [subset of allow] }.',
      },
      limits: {
        type: 'json',
        description: '{ maxConsecutiveFailures?: 1-20, budgetUsd?: <= 20 }.',
      },
      escalation: {
        type: 'array',
        items: { type: 'string' },
        description: 'Conditions under which the Duty asks a human.',
      },
      reporting: { type: 'string', description: 'Where and how results are reported.' },
      project_id: { type: 'string', description: 'Optional owning project grouping.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: async (args: unknown): Promise<JsonValue> => {
      const input = args as {
        id?: string
        title: string
        goal: string
        scope?: string
        trigger: unknown
        verification?: string
        body: unknown
        tool_policy: { allow: string[]; gated: string[] }
        limits?: { maxConsecutiveFailures?: number; budgetUsd?: number }
        escalation?: string[]
        reporting?: string
        project_id?: string
      }
      try {
        const view = await ctx.duties.create({
          ...(input.id === undefined ? {} : { id: input.id }),
          title: input.title,
          goal: input.goal,
          ...(input.scope === undefined ? {} : { scope: input.scope }),
          trigger: input.trigger as Parameters<typeof ctx.duties.create>[0]['trigger'],
          ...(input.verification === undefined ? {} : { verification: input.verification }),
          body: input.body as Parameters<typeof ctx.duties.create>[0]['body'],
          toolPolicy: input.tool_policy,
          ...(input.limits === undefined ? {} : { limits: input.limits }),
          ...(input.escalation === undefined ? {} : { escalation: input.escalation }),
          ...(input.reporting === undefined ? {} : { reporting: input.reporting }),
          ...(input.project_id === undefined ? {} : { projectId: input.project_id }),
        })
        return { ok: true, dutyId: view.spec.id, mode: view.spec.mode }
      } catch (error: unknown) {
        return { ok: false, error: renderError(error) }
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'duty_set_lifecycle',
    description:
      'Move one Duty between draft, active, paused, and archived. Pausing requires a reason '
      + '(failures, budget, escalation, or human). Only an active Duty can wake.',
    parameters: {
      duty_id: { type: 'string', required: true, description: 'The Duty id.' },
      lifecycle: {
        type: 'string',
        required: true,
        description: 'draft | active | paused | archived.',
      },
      paused_reason: {
        type: 'string',
        description: 'Required when lifecycle is paused: failures, budget, escalation, or human.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: async (args: unknown): Promise<JsonValue> => {
      const { duty_id: dutyId, lifecycle, paused_reason: pausedReason } =
        args as { duty_id: string; lifecycle: string; paused_reason?: string }
      const valid = ['draft', 'active', 'paused', 'archived']
      if (!valid.includes(lifecycle)) {
        return { ok: false, error: `lifecycle must be one of ${valid.join(', ')}` }
      }
      try {
        const state = await ctx.duties.setLifecycle(
          DutyId(dutyId),
          lifecycle as DutyLifecycle,
          pausedReason as DutyPauseReason | undefined,
        )
        return { ok: true, lifecycle: state.lifecycle, pausedReason: state.pausedReason ?? null }
      } catch (error: unknown) {
        return { ok: false, error: renderError(error) }
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'duty_start',
    description:
      'Wake one active Duty now by hand. The run executes the stored body in its own Session; '
      + 'this returns the run record once the run is admitted.',
    parameters: {
      duty_id: { type: 'string', required: true, description: 'The Duty id.' },
      reason: { type: 'string', required: true, description: 'Why this wake is requested.' },
      wait: { type: 'boolean', description: 'Resolve only after the run settles, reporting its outcome.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: async (args: unknown): Promise<JsonValue> => {
      const { duty_id: dutyId, reason, wait } = args as { duty_id: string; reason: string; wait?: boolean }
      const runner = resolveRunner(ctx)
      if (runner === undefined) {
        return { ok: false, error: 'the duty run runtime is not loaded; add @deepseek-ai/dsh-duty-runner' }
      }
      try {
        const run = await runner.startRun(DutyId(dutyId), { kind: 'manual', reason }, { wait: wait === true })
        return { ok: true, runId: run.id }
      } catch (error: unknown) {
        return error instanceof DutyError ? { ok: false, code: error.code, error: error.message }
          : { ok: false, error: renderError(error) }
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'duty_answer',
    description:
      'Answer one open human decision, unblocking its parked run. The answer must be one of '
      + 'the offered options unless the request allows free-form input.',
    parameters: {
      duty_id: { type: 'string', required: true, description: 'The Duty id.' },
      request_id: { type: 'string', required: true, description: 'The open request id.' },
      answer: { type: 'string', required: true, description: 'The human\'s verbatim answer.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: async (args: unknown): Promise<JsonValue> => {
      const { duty_id: dutyId, request_id: requestId, answer } =
        args as { duty_id: string; request_id: string; answer: string }
      try {
        const settled = await ctx.duties.answer(DutyId(dutyId), HumanRequestId(requestId), answer)
        return { ok: true, status: settled.status }
      } catch (error: unknown) {
        return error instanceof DutyError ? { ok: false, code: error.code, error: error.message }
          : { ok: false, error: renderError(error) }
      }
    },
  }))
}
