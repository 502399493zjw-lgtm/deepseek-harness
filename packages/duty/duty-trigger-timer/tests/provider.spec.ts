import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DutyId } from '@deepseek-ai/dsh-duty'
import type { DutySpec, DutyState, DutyView } from '@deepseek-ai/dsh-duty'
import DutyTriggerService from '@deepseek-ai/dsh-duty-trigger'
import * as TimerModule from '../src/index.ts'
import { TimerDutyTriggerProvider } from '../src/index.ts'

const T0 = Date.UTC(2026, 0, 1, 0, 0) // 2026-01-01 00:00 UTC

/** Build one minimal Duty view whose trigger and state the test controls. */
function view(spec: Partial<DutySpec>, state: Partial<DutyState>): DutyView {
  return {
    spec: {
      id: DutyId('d1'),
      title: 'Triage tickets',
      mode: 'standing',
      goal: 'Keep the queue triaged.',
      trigger: { kind: 'interval', description: 'every hour', everyMs: 3_600_000 },
      body: { steps: [{ id: 's', kind: 'agent', label: 'Work', prompt: 'work' }] },
      toolPolicy: { allow: [], gated: [] },
      limits: { maxConsecutiveFailures: 3 },
      escalation: [],
      version: 'v1' as DutySpec['version'],
      createdAt: T0,
      updatedAt: T0,
      ...spec,
    },
    state: {
      dutyId: DutyId('d1'),
      lifecycle: 'active',
      runCount: 0,
      running: false,
      consecutiveFailures: 0,
      ...state,
    },
  }
}

const NOW = T0 + 3_600_000 // exactly one interval period after creation

/** A context stub carrying only what the provider reaches. */
const ctxStub = (warn: ReturnType<typeof vi.fn> = vi.fn()): Context =>
  ({ logger: { warn } }) as unknown as Context

const dutiesStub = (views: readonly DutyView[]): never => ({
  list: () => views,
}) as never

describe('timer duty trigger provider', () => {
  it('reports a due interval duty with its next wake', async () => {
    const provider = new TimerDutyTriggerProvider(
      ctxStub(),
      dutiesStub([view({}, {})]),
    )
    const observations = await provider.poll(NOW)
    expect(observations).toHaveLength(1)
    expect(observations[0]).toMatchObject({
      dutyId: DutyId('d1'),
      providerId: 'timer',
      cause: { kind: 'schedule', reason: 'every hour' },
      nextWakeAt: NOW + 3_600_000,
    })
  })

  it('reports a due cron duty', async () => {
    const provider = new TimerDutyTriggerProvider(
      ctxStub(),
      dutiesStub([view({
        trigger: { kind: 'cron', description: 'at minute 45', expr: '45 * * * *' },
        createdAt: T0 - 86_400_000,
      }, {})]),
    )
    const atMinute45 = T0 + 45 * 60_000
    const observations = await provider.poll(atMinute45)
    expect(observations).toHaveLength(1)
    expect(observations[0]?.cause.reason).toBe('at minute 45')
  })

  it('skips a duty not yet due', async () => {
    const provider = new TimerDutyTriggerProvider(
      ctxStub(),
      dutiesStub([view({}, {})]),
    )
    expect(await provider.poll(T0 + 1_800_000)).toHaveLength(0)
  })

  it('skips a duty whose next wake is still in the future', async () => {
    const provider = new TimerDutyTriggerProvider(
      ctxStub(),
      dutiesStub([view({}, { nextWakeAt: NOW + 60_000 })]),
    )
    expect(await provider.poll(NOW)).toHaveLength(0)
  })

  it('evaluates a duty whose next wake has passed', async () => {
    const provider = new TimerDutyTriggerProvider(
      ctxStub(),
      dutiesStub([view({}, { nextWakeAt: NOW - 60_000 })]),
    )
    expect(await provider.poll(NOW)).toHaveLength(1)
  })

  it('skips duties that are not active standing ones', async () => {
    const provider = new TimerDutyTriggerProvider(
      ctxStub(),
      dutiesStub([
        view({ mode: 'once', trigger: { kind: 'manual', description: 'asked' } }, {}),
        view({}, { lifecycle: 'paused', pausedReason: 'human' }),
        view({}, { lifecycle: 'archived' }),
        view({}, { lifecycle: 'draft' }),
        view({}, { running: true }),
      ]),
    )
    expect(await provider.poll(NOW)).toHaveLength(0)
  })

  it('reports no observation for an unsatisfiable cron rule', async () => {
    // February 30 never occurs; the provider must not misreport it as due.
    const provider = new TimerDutyTriggerProvider(
      ctxStub(),
      dutiesStub([view({
        trigger: { kind: 'cron', description: 'never', expr: '0 0 30 2 *' },
        createdAt: T0 - 86_400_000,
      }, {})]),
    )
    expect(await provider.poll(NOW)).toHaveLength(0)
  })

  it('warns and skips a duty with a syntactically invalid cron rule', async () => {
    // The contract schema rejects minute 60 at write time; this defense
    // covers a hand-edited durable medium.
    const warn = vi.fn()
    const provider = new TimerDutyTriggerProvider(
      ctxStub(warn),
      dutiesStub([view({
        trigger: { kind: 'cron', description: 'broken', expr: '60 * * * *' },
        createdAt: T0 - 86_400_000,
      }, {})]),
    )
    expect(await provider.poll(NOW)).toHaveLength(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('invalid cron rule'))
  })
})

describe('timer trigger plugin registration', () => {
  it('registers on load and unregisters on fiber disposal (HMR safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(DutyTriggerService, { pollIntervalMs: 5000 })
    ctx.provide('duties', dutiesStub([]))
    const fiber = await ctx.plugin(TimerModule)
    try {
      expect(ctx.dutyTriggers.providerIds()).toEqual(['timer'])
    } finally {
      await fiber.dispose()
      await ctx.fiber.dispose()
    }
  })
})
