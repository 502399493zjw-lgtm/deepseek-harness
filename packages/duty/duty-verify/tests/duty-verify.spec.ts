import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import DutyVerifierRegistry from '../src/index.ts'
import * as DutyVerifyInvariant from '../src/invariant.ts'
import type { DutyVerificationRequest, DutyVerifier } from '../src/types.ts'

const request = (): DutyVerificationRequest => ({
  dutyId: 'd1' as never,
  runId: 'r1' as never,
  sessionId: 's1' as never,
  step: { id: 'collect', kind: 'agent', label: 'Collect', prompt: 'Collect the list.' },
  summary: 'done',
  evidence: [{ kind: 'tool-result', text: '3 tickets' }],
  parent: {} as never,
})

describe('duty verifier registry', () => {
  let ctx: Context
  let registry: DutyVerifierRegistry

  beforeEach(async () => {
    ctx = new Context()
    await ctx.plugin(DutyVerifierRegistry, { verifier: 'evaluator' })
    registry = ctx.dutyVerifiers
  })

  afterEach(async () => {
    await ctx.fiber.dispose()
  })

  it('registers a verifier under its id and unregisters via the disposer', () => {
    const verifier: DutyVerifier = { id: 'evaluator', verify: async () => ({ pass: true }) }
    const unregister = registry.register(verifier)
    expect(registry.verifierIds()).toEqual(['evaluator'])
    unregister()
    expect(registry.verifierIds()).toEqual([])
  })

  it('refuses a duplicate verifier id', () => {
    const verifier: DutyVerifier = { id: 'evaluator', verify: async () => ({ pass: true }) }
    registry.register(verifier)
    expect(() => registry.register(verifier)).toThrow(/already registered/)
  })

  it('verifies through the configured verifier', async () => {
    const verify = vi.fn(async () => ({ pass: false, reason: 'no evidence' }))
    registry.register({ id: 'evaluator', verify })
    expect(await registry.verify(request())).toEqual({ pass: false, reason: 'no evidence' })
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('fails loud when the configured verifier is missing', async () => {
    await expect(registry.verify(request())).rejects.toThrow(/no verifier 'evaluator' is registered/)
  })
})

describe('duty verify invariant companion', () => {
  it('removes its registry contribution on fiber disposal (HMR safety)', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(InvariantRegistry)
      const fiber = await ctx.plugin(DutyVerifyInvariant)
      expect(() => {
        ctx.invariants.register('@deepseek-ai/dsh-duty-verify', () => {})
      }).toThrow(/already registered/u)
      await fiber.dispose()
      await expect(ctx.plugin(DutyVerifyInvariant).await()).resolves.toBeDefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
