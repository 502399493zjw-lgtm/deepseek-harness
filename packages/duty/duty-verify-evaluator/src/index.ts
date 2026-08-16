/**
 * The evaluator verifier: judges a reported step completion with a one-shot
 * subagent over the bounded evidence bundle. The verdict is structured
 * (`pass`/`reason`), never prose-sniffed.
 * @module @deepseek-ai/dsh-duty-verify-evaluator
 */

import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-subagent'
import type {
  DutyVerificationEvidence,
  DutyVerificationRequest,
  DutyVerdict,
  DutyVerifier,
} from '@deepseek-ai/dsh-duty-verify'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'duty-verify-evaluator'

/** The verification seam and the subagent seam this provider joins. */
export const inject = ['dutyVerifiers', 'subagents']

/** Deployment policy for the evaluator. */
export interface Config {
  /** Subagent provider used for the evaluation child. */
  readonly subagentProvider: string
  /** Upper bound on the rendered evidence bundle in UTF-16 chars. */
  readonly maxEvidenceChars: number
}

export const Config: s<Config> = s.object({
  subagentProvider: s.string().default('fork'),
  maxEvidenceChars: s.number().step(1).min(1000).required(),
})

/** Provider id registered with the verification registry. */
export const EVALUATOR_VERIFIER_ID = 'evaluator'

/** One completed child run's verdict payload surface. */
interface EvaluatorChildResult {
  readonly stopReason: string
  readonly structured?: unknown
}

/** The subagent run surface this verifier reaches. */
interface EvaluatorChildRun {
  readonly result: Promise<EvaluatorChildResult>
  dispose(): Promise<void>
}

/** The subagent seam surface this verifier reaches. */
interface SubagentSeamLike {
  start(provider: string, request: unknown): Promise<EvaluatorChildRun>
}

/** The structured verdict the evaluation child must return. */
const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['pass'],
  additionalProperties: false,
} as const

/** The Chinese evaluation instruction, kept verbatim for the snapshot. */
const VERIFY_PROMPT = [
  '你是一个独立的步骤验收者。下面是一个 Duty run 中刚汇报完成的步骤。',
  '请只依据给出的证据与步骤目标判断该步骤是否真正完成,不要轻信摘要。',
  '步骤:${label}',
  '步骤目标:${prompt}',
  '模型自报摘要:${summary}',
  '证据(最近的工具结果与输出):',
  '${evidence}',
  '证据不足以支撑完成、或与目标不符时,pass 必须为 false 并说明原因。',
].join('\n')

/** Render the bounded evidence bundle into one instruction block. */
function renderEvidence(evidence: readonly DutyVerificationEvidence[], maxChars: number): string {
  const lines: string[] = []
  let used = 0
  for (const item of evidence) {
    const line = `[${item.kind}] ${item.text}`
    if (used + line.length > maxChars) {
      lines.push('…(evidence truncated)')
      break
    }
    lines.push(line)
    used += line.length
  }
  return lines.join('\n') || '(no evidence recorded)'
}

/** Render the complete evaluation instruction for one step. */
function renderPrompt(request: DutyVerificationRequest, maxChars: number): string {
  const step = request.step
  const prompt = step.kind === 'agent' ? (step.prompt ?? '') : step.label
  return VERIFY_PROMPT
    .replace('${label}', step.label)
    .replace('${prompt}', prompt)
    .replace('${summary}', request.summary)
    .replace('${evidence}', renderEvidence(request.evidence, maxChars))
}

/**
 * The evaluator verifier: one one-shot subagent per verification, returning a
 * structured verdict through the child's output schema.
 */
export class EvaluatorDutyVerifier implements DutyVerifier {
  readonly id = EVALUATOR_VERIFIER_ID

  /**
   * Compose the evaluator over the run's agent (the subagent parent) and the
   * subagent seam.
   * @param subagents - the subagent runtime.
   * @param config - the provider and evidence bound.
   */
  /**
   * @param subagents - the subagent seam that spawns the evaluation child.
   * @param config - the provider and evidence bound.
   */
  constructor(
    private readonly subagents: SubagentSeamLike,
    private readonly config: Config,
  ) {}

  /**
   * Judge one reported step completion.
   * @param request - the step, its summary, and the bounded evidence.
   * @returns the structured verdict; a child that fails or finishes without a
   * valid verdict resolves to a failed verification with a reason.
   */
  async verify(request: DutyVerificationRequest): Promise<DutyVerdict> {
    const run = await this.subagents.start(this.config.subagentProvider, {
      parent: request.parent,
      label: `verify ${request.step.label}`,
      prompt: [{ type: 'text', text: renderPrompt(request, this.config.maxEvidenceChars) }],
      outputSchema: VERDICT_SCHEMA,
    })
    try {
      const result = await run.result
      if (result.stopReason !== 'completed' || result.structured === undefined) {
        return { pass: false, reason: `evaluator did not complete (${result.stopReason})` }
      }
      const verdict = result.structured as { pass?: unknown; reason?: unknown }
      if (typeof verdict.pass !== 'boolean') {
        return { pass: false, reason: 'evaluator returned an invalid verdict' }
      }
      return {
        pass: verdict.pass,
        ...(typeof verdict.reason === 'string' && verdict.reason.length > 0
          ? { reason: verdict.reason }
          : {}),
      }
    } finally {
      await run.dispose()
    }
  }
}

/**
 * Register the evaluator verifier with the verification registry.
 * @param ctx - Cordis context carrying the registry and subagent seam.
 * @param config - the provider and evidence bound.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => ctx.dutyVerifiers.register(
    new EvaluatorDutyVerifier(ctx.subagents, config),
  ))
}
