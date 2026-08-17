/**
 * Durable storage-domain declaration for Duty specs, operational state, run
 * records, human decisions, and trigger audit events.
 *
 * These schemas validate at the durable boundary: every row is revalidated on
 * read, so a hand-edited or format-drifted medium fails loud instead of
 * producing a Duty that wakes with a meaningless contract.
 * @module @deepseek-ai/dsh-duty/src/spec
 */

import { z } from 'zod'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type {
  DutyBody,
  DutyId,
  DutyRun,
  DutyRunId,
  DutySpec,
  DutyState,
  DutyStep,
  DutyTriggerEvent,
  HumanRequest,
  HumanRequestId,
} from './types.ts'

/** Longest execution body accepted, counting every nested step. */
export const MAX_BODY_STEPS = 30
/** Deepest execution body nesting accepted. */
export const MAX_BODY_DEPTH = 5
/** Widest `parallel` fan-out accepted. */
export const MAX_PARALLEL_WIDTH = 8
/** Highest per-run USD budget accepted. */
export const MAX_BUDGET_USD = 20

const epochMillis = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const nonEmpty = z.string().refine(value => value.trim().length > 0, {
  message: 'value must contain a non-whitespace character',
})

/** Five numeric cron fields; ranges, lists, and steps over values or `*`. */
const CRON_ATOM = String.raw`(?:\*|\d+(?:-\d+)?)`
const CRON_FIELD = String.raw`${CRON_ATOM}(?:\/\d+)?(?:,${CRON_ATOM}(?:\/\d+)?)*`
const CRON_EXPR_RE = new RegExp(`^${CRON_FIELD}(?: ${CRON_FIELD}){4}$`)

/** Inclusive value bounds per cron field, in expression order. */
const CRON_FIELD_BOUNDS = [
  [0, 59],   // minute
  [0, 23],   // hour
  [1, 31],   // day of month
  [1, 12],   // month
  [0, 7],    // day of week; 0 and 7 both mean Sunday
] as const

/** Whether one IANA timezone name resolves. */
function isValidTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name })
    return true
  } catch (_invalidTimeZone) {
    return false
  }
}

/**
 * Whether every numeric literal in one cron field stays inside its bounds and
 * every range or step is well-formed. Syntax is already pinned by the regex;
 * this rejects semantically dead rules like minute 99 or a descending range.
 * @param field - One cron field's raw text.
 * @param min - Inclusive lower bound of the field.
 * @param max - Inclusive upper bound of the field.
 * @returns `true` when the field can only name in-range values.
 */
function cronFieldInRange(field: string, min: number, max: number): boolean {
  for (const component of field.split(',')) {
    const parts = component.split('/')
    const base = parts[0] ?? ''
    const stepText = parts[1]
    const step = stepText === undefined ? 1 : Number(stepText)
    if (!Number.isSafeInteger(step) || step < 1) return false
    if (base === '*') continue
    const range = base.split('-')
    const start = Number(range[0])
    const end = range[1] === undefined ? start : Number(range[1])
    if (start < min || start > max) return false
    if (end < min || end > max || end < start) return false
  }
  return true
}

/** Runtime schema for the waking rule of one Duty. */
export const dutyTriggerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('manual'), description: nonEmpty }),
  z.object({
    kind: z.literal('interval'),
    description: nonEmpty,
    // A sub-minute period would wake faster than a run can settle.
    everyMs: z.number().int().min(60_000).max(Number.MAX_SAFE_INTEGER),
  }),
  z.object({
    kind: z.literal('cron'),
    description: nonEmpty,
    expr: z.string().regex(CRON_EXPR_RE, 'cron expression must be five numeric fields')
      .refine(expr => expr.split(' ').every((field, index) => {
        const bounds = CRON_FIELD_BOUNDS[index]
        return bounds !== undefined && cronFieldInRange(field, bounds[0], bounds[1])
      }), {
        message: 'cron expression names a value outside its field bounds',
      }),
    timezone: z.string().refine(isValidTimeZone, {
      message: 'cron timezone must be an IANA timezone name',
    }).optional(),
  }),
])

/**
 * Recursive step schema. Depth, total count, and fan-out width are enforced by
 * {@link dutyBodySchema} because they are properties of the whole body.
 */
export const dutyStepSchema: z.ZodType<DutyStep> = z.lazy(() => z.object({
  id: nonEmpty,
  kind: z.union([z.literal('agent'), z.literal('parallel'), z.literal('phase')]),
  label: nonEmpty,
  prompt: nonEmpty.optional(),
  children: z.array(dutyStepSchema).optional(),
}).superRefine((step, ctx) => {
  if (step.kind === 'agent') {
    if (step.prompt === undefined) {
      ctx.addIssue({ code: 'custom', path: ['prompt'], message: 'an agent step requires a prompt' })
    }
    if (step.children !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['children'], message: 'an agent step cannot have children' })
    }
    return
  }
  if (step.children === undefined || step.children.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['children'], message: `a ${step.kind} step requires children` })
  }
  if (step.kind === 'parallel' && (step.children?.length ?? 0) > MAX_PARALLEL_WIDTH) {
    ctx.addIssue({
      code: 'custom',
      path: ['children'],
      message: `a parallel step may fan out to at most ${MAX_PARALLEL_WIDTH} children`,
    })
  }
}) as z.ZodType<DutyStep>)

/** Count every step in a body and report its deepest nesting. */
function measure(steps: readonly DutyStep[], depth: number): { count: number; depth: number } {
  let count = 0
  let deepest = depth
  for (const step of steps) {
    count += 1
    if (step.children !== undefined && step.children.length > 0) {
      const child = measure(step.children, depth + 1)
      count += child.count
      if (child.depth > deepest) deepest = child.depth
    }
  }
  return { count, depth: deepest }
}

/** Collect every step id that appears more than once among its own siblings. */
function duplicateSiblingIds(steps: readonly DutyStep[]): string | undefined {
  const seen = new Set<string>()
  for (const step of steps) {
    if (seen.has(step.id)) return step.id
    seen.add(step.id)
    if (step.children !== undefined) {
      const nested = duplicateSiblingIds(step.children)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

/** Runtime schema for a complete execution body and its whole-body bounds. */
export const dutyBodySchema = z.object({
  steps: z.array(dutyStepSchema),
}).superRefine((body, ctx) => {
  const { count, depth } = measure(body.steps, 1)
  if (count > MAX_BODY_STEPS) {
    ctx.addIssue({ code: 'custom', path: ['steps'], message: `a body may contain at most ${MAX_BODY_STEPS} steps, got ${count}` })
  }
  if (depth > MAX_BODY_DEPTH) {
    ctx.addIssue({ code: 'custom', path: ['steps'], message: `a body may nest at most ${MAX_BODY_DEPTH} levels, got ${depth}` })
  }
  const duplicate = duplicateSiblingIds(body.steps)
  if (duplicate !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['steps'], message: `duplicate sibling step id '${duplicate}'` })
  }
}) as unknown as z.ZodType<DutyBody>

/** Runtime schema for the tool allowance of one Duty. */
export const dutyToolPolicySchema = z.object({
  allow: z.array(nonEmpty),
  gated: z.array(nonEmpty),
}).superRefine((policy, ctx) => {
  const allowed = new Set(policy.allow)
  for (const [index, tool] of policy.gated.entries()) {
    if (!allowed.has(tool)) {
      ctx.addIssue({
        code: 'custom',
        path: ['gated', index],
        message: `gated tool '${tool}' must also appear in allow`,
      })
    }
  }
})

/** Runtime schema for failure and budget bounds. */
export const dutyLimitsSchema = z.object({
  maxConsecutiveFailures: z.number().int().min(1).max(20),
  budgetUsd: z.number().positive().max(MAX_BUDGET_USD).optional(),
})

/** Runtime schema for one durable Duty contract. */
export const dutySpecSchema = z.object({
  id: nonEmpty.transform(value => value as DutyId),
  title: nonEmpty,
  mode: z.union([z.literal('once'), z.literal('standing')]),
  goal: nonEmpty,
  scope: nonEmpty.optional(),
  trigger: dutyTriggerSchema,
  verification: z.union([z.literal('off'), z.literal('on'), z.string().min(1)]),
  body: dutyBodySchema,
  toolPolicy: dutyToolPolicySchema,
  limits: dutyLimitsSchema,
  escalation: z.array(nonEmpty),
  reporting: nonEmpty.optional(),
  projectId: nonEmpty.optional(),
  version: z.uuid().transform(value => value as DutySpec['version']),
  createdAt: epochMillis,
  updatedAt: epochMillis,
}).superRefine((spec, ctx) => {
  if (spec.updatedAt < spec.createdAt) {
    ctx.addIssue({ code: 'custom', path: ['updatedAt'], message: 'updatedAt must not precede createdAt' })
  }
  // A standing Duty that can never wake itself would sit inert while claiming
  // to be on duty; a once Duty that wakes repeatedly would contradict its mode.
  if (spec.mode === 'standing' && spec.trigger.kind === 'manual') {
    ctx.addIssue({ code: 'custom', path: ['trigger'], message: 'a standing duty requires a waking trigger' })
  }
  if (spec.mode === 'once' && spec.trigger.kind !== 'manual') {
    ctx.addIssue({ code: 'custom', path: ['trigger'], message: 'a once duty accepts only a manual trigger' })
  }
}) as unknown as z.ZodType<DutySpec>

/** Runtime schema for cross-trigger operational state. */
export const dutyStateSchema = z.object({
  dutyId: nonEmpty.transform(value => value as DutyId),
  lifecycle: z.union([
    z.literal('draft'),
    z.literal('active'),
    z.literal('paused'),
    z.literal('archived'),
  ]),
  pausedReason: z.union([
    z.literal('failures'),
    z.literal('budget'),
    z.literal('escalation'),
    z.literal('human'),
  ]).optional(),
  runCount: z.number().int().nonnegative(),
  running: z.boolean(),
  lastRunId: nonEmpty.transform(value => value as DutyRunId).optional(),
  lastRunAt: epochMillis.optional(),
  lastOutcome: z.union([
    z.literal('running'),
    z.literal('waiting_for_human'),
    z.literal('succeeded'),
    z.literal('failed'),
    z.literal('canceled'),
  ]).optional(),
  nextWakeAt: epochMillis.optional(),
  consecutiveFailures: z.number().int().nonnegative(),
  cursor: z.unknown().optional(),
}).superRefine((state, ctx) => {
  if (state.lifecycle === 'paused' && state.pausedReason === undefined) {
    ctx.addIssue({ code: 'custom', path: ['pausedReason'], message: 'a paused duty must record why' })
  }
  if (state.lifecycle !== 'paused' && state.pausedReason !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['pausedReason'], message: 'only a paused duty records a pause reason' })
  }
}) as unknown as z.ZodType<DutyState>

/** Runtime schema for one major-trigger run record. */
export const dutyRunSchema = z.object({
  id: nonEmpty.transform(value => value as DutyRunId),
  dutyId: nonEmpty.transform(value => value as DutyId),
  index: z.number().int().positive(),
  sessionId: nonEmpty.transform(value => value as SessionId),
  cause: z.object({
    kind: z.union([z.literal('manual'), z.literal('schedule')]),
    reason: nonEmpty,
  }),
  status: z.union([
    z.literal('running'),
    z.literal('waiting_for_human'),
    z.literal('succeeded'),
    z.literal('failed'),
    z.literal('canceled'),
  ]),
  startedAt: epochMillis,
  completedAt: epochMillis.optional(),
  summary: nonEmpty.optional(),
  adapted: z.boolean(),
  costUsd: z.number().nonnegative().optional(),
}).superRefine((run, ctx) => {
  const settled = run.status === 'succeeded' || run.status === 'failed' || run.status === 'canceled'
  if (settled && run.completedAt === undefined) {
    ctx.addIssue({ code: 'custom', path: ['completedAt'], message: 'a settled run records when it settled' })
  }
  if (!settled && run.completedAt !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['completedAt'], message: 'an unsettled run has no settle time' })
  }
  if (run.completedAt !== undefined && run.completedAt < run.startedAt) {
    ctx.addIssue({ code: 'custom', path: ['completedAt'], message: 'completedAt must not precede startedAt' })
  }
}) as unknown as z.ZodType<DutyRun>

/** Newest-first run history of one Duty. */
export const dutyRunsRowSchema = z.object({
  runs: z.array(dutyRunSchema),
}).superRefine((row, ctx) => {
  const ids = new Set<string>()
  for (const [index, run] of row.runs.entries()) {
    if (ids.has(run.id)) {
      ctx.addIssue({ code: 'custom', path: ['runs', index, 'id'], message: `duplicate run id '${run.id}'` })
    }
    ids.add(run.id)
  }
})

/** Durable run-history row inferred from {@link dutyRunsRowSchema}. */
export type DutyRunsRow = z.infer<typeof dutyRunsRowSchema>

/** Runtime schema for one durable human-decision record. */
export const humanRequestSchema = z.object({
  id: nonEmpty.transform(value => value as HumanRequestId),
  dutyId: nonEmpty.transform(value => value as DutyId),
  runId: nonEmpty.transform(value => value as DutyRunId),
  sessionId: nonEmpty.transform(value => value as SessionId),
  status: z.union([z.literal('open'), z.literal('answered'), z.literal('canceled')]),
  reason: z.union([
    z.literal('missing_info'),
    z.literal('authorization'),
    z.literal('choice'),
    z.literal('blocked'),
  ]),
  question: nonEmpty,
  options: z.array(nonEmpty),
  allowFreeform: z.boolean(),
  createdAt: epochMillis,
  answeredAt: epochMillis.optional(),
  answer: nonEmpty.optional(),
}).superRefine((request, ctx) => {
  if (request.status === 'answered') {
    if (request.answeredAt === undefined) {
      ctx.addIssue({ code: 'custom', path: ['answeredAt'], message: 'an answered request records when' })
    }
    if (request.answer === undefined) {
      ctx.addIssue({ code: 'custom', path: ['answer'], message: 'an answered request records the answer' })
    }
  }
  if (request.status === 'open' && request.answer !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['answer'], message: 'an open request holds no answer' })
  }
  // A request offering neither a choice nor free text could never be answered.
  if (request.options.length === 0 && !request.allowFreeform) {
    ctx.addIssue({ code: 'custom', path: ['options'], message: 'a request needs options or freeform' })
  }
}) as unknown as z.ZodType<HumanRequest>

/** Open and settled human decisions of one Duty, newest first. */
export const humanRequestsRowSchema = z.object({
  requests: z.array(humanRequestSchema),
}).superRefine((row, ctx) => {
  const ids = new Set<string>()
  for (const [index, request] of row.requests.entries()) {
    if (ids.has(request.id)) {
      ctx.addIssue({ code: 'custom', path: ['requests', index, 'id'], message: `duplicate request id '${request.id}'` })
    }
    ids.add(request.id)
  }
})

/** Durable human-decision row inferred from {@link humanRequestsRowSchema}. */
export type HumanRequestsRow = z.infer<typeof humanRequestsRowSchema>

/** Runtime schema for one recorded waking decision. */
export const dutyTriggerEventSchema = z.object({
  id: nonEmpty,
  dutyId: nonEmpty.transform(value => value as DutyId),
  cause: z.object({
    kind: z.union([z.literal('manual'), z.literal('schedule')]),
    reason: nonEmpty,
  }),
  matched: z.boolean(),
  skippedReason: z.union([
    z.literal('paused'),
    z.literal('archived'),
    z.literal('running'),
    z.literal('not-due'),
    z.literal('draft'),
  ]).optional(),
  runId: nonEmpty.transform(value => value as DutyRunId).optional(),
  createdAt: epochMillis,
}).superRefine((event, ctx) => {
  if (event.matched && event.runId === undefined) {
    ctx.addIssue({ code: 'custom', path: ['runId'], message: 'a matched trigger records its run' })
  }
  if (!event.matched && event.skippedReason === undefined) {
    ctx.addIssue({ code: 'custom', path: ['skippedReason'], message: 'a skipped trigger records why' })
  }
}) as unknown as z.ZodType<DutyTriggerEvent>

/** Bounded newest-first trigger audit history of one Duty. */
export const dutyTriggerEventsRowSchema = z.object({
  events: z.array(dutyTriggerEventSchema),
})

/** Durable trigger-audit row inferred from {@link dutyTriggerEventsRowSchema}. */
export type DutyTriggerEventsRow = z.infer<typeof dutyTriggerEventsRowSchema>

/**
 * The Duty domain. Specs, state, run history, human decisions, and trigger
 * audit each get their own table so a hot write path (trigger events) never
 * rewrites a cold row (the contract).
 */
export const dutyDomainSpec = defineDomain({
  name: 'duty',
  version: 0,
  tables: {
    specs: domainTable<DutyId, DutySpec>(dutySpecSchema),
    state: domainTable<DutyId, DutyState>(dutyStateSchema),
    runs: domainTable<DutyId, DutyRunsRow>(dutyRunsRowSchema),
    human_requests: domainTable<DutyId, HumanRequestsRow>(humanRequestsRowSchema),
    trigger_events: domainTable<DutyId, DutyTriggerEventsRow>(dutyTriggerEventsRowSchema),
  },
})
