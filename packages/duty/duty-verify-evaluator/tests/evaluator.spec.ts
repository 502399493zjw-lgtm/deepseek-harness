import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import DutyVerifierRegistry from '@deepseek-ai/dsh-duty-verify'
import * as EvaluatorModule from '../src/index.ts'
import { EvaluatorDutyVerifier } from '../src/index.ts'
import type { DutyVerificationRequest } from '@deepseek-ai/dsh-duty-verify'

const request = (): DutyVerificationRequest => ({
  dutyId: 'd1' as never,
  runId: 'r1' as never,
  sessionId: 's1' as never,
  step: { id: 'collect', kind: 'agent', label: 'Collect', prompt: 'Collect the list.' },
  summary: 'done',
  evidence: [{ kind: 'tool-result', text: '3 tickets' }],
  parent: {} as never,
})

/** A scripted subagent seam: the test controls the child outcome. */
function subagentsStub(outcome: { stopReason: string; structured?: unknown }): never {
  const start = vi.fn(async () => ({
    result: Promise.resolve(outcome),
    dispose: vi.fn(async () => {}),
  }))
  return { start, ...outcome } as never
}

describe('evaluator duty verifier', () => {
  it('passes a completed structured verdict', async () => {
    const subagents = subagentsStub({ stopReason: 'completed', structured: { pass: true } })
    const verifier = new EvaluatorDutyVerifier(subagents, {
      subagentProvider: 'fork',
      maxEvidenceChars: 4000,
    })
    expect(await verifier.verify(request())).toEqual({ pass: true })
  })

  it('returns a failed verdict with the reason', async () => {
    const subagents = subagentsStub({ stopReason: 'completed', structured: { pass: false, reason: 'no proof' } })
    const verifier = new EvaluatorDutyVerifier(subagents, {
      subagentProvider: 'fork',
      maxEvidenceChars: 4000,
    })
    expect(await verifier.verify(request())).toEqual({ pass: false, reason: 'no proof' })
  })

  it('fails the verdict when the child does not complete', async () => {
    const subagents = subagentsStub({ stopReason: 'error' })
    const verifier = new EvaluatorDutyVerifier(subagents, {
      subagentProvider: 'fork',
      maxEvidenceChars: 4000,
    })
    expect(await verifier.verify(request())).toEqual({
      pass: false,
      reason: 'evaluator did not complete (error)',
    })
  })

  it('fails the verdict when the child returns an invalid payload', async () => {
    const subagents = subagentsStub({ stopReason: 'completed', structured: { pass: 'yes' } })
    const verifier = new EvaluatorDutyVerifier(subagents, {
      subagentProvider: 'fork',
      maxEvidenceChars: 4000,
    })
    expect(await verifier.verify(request())).toEqual({
      pass: false,
      reason: 'evaluator returned an invalid verdict',
    })
  })
})

describe('evaluator plugin registration', () => {
  it('registers on load and unregisters on fiber disposal (HMR safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(DutyVerifierRegistry, { verifier: 'evaluator' })
    ctx.provide('subagents', { start: async () => ({ result: Promise.resolve({}), dispose: async () => {} }) })
    const fiber = await ctx.plugin(EvaluatorModule, {
      subagentProvider: 'fork',
      maxEvidenceChars: 4000,
    })
    try {
      expect(ctx.dutyVerifiers.verifierIds()).toEqual(['evaluator'])
    } finally {
      await fiber.dispose()
      await ctx.fiber.dispose()
    }
  })
})
