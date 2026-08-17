import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { DutyId } from '@deepseek-ai/dsh-duty'
import type { DutyVersion } from '@deepseek-ai/dsh-duty'
import DutyTriggerService from '../src/index.ts'
import * as DutyTriggerInvariant from '../src/invariant.ts'
import type { DutyTriggerObservation, DutyTriggerProvider } from '../src/types.ts'

/** A provider whose polls, returns, and failures the test scripts. */
class ScriptedProvider implements DutyTriggerProvider {
  readonly id: string
  calls: number[] = []
  observations: readonly DutyTriggerObservation[] = []
  failure: Error | undefined

  constructor(id: string) {
    this.id = id
  }

  async poll(now: number): Promise<readonly DutyTriggerObservation[]> {
    this.calls.push(now)
    if (this.failure !== undefined) throw this.failure
    return this.observations
  }
}

const observation = (providerId: string): DutyTriggerObservation => ({
  dutyId: DutyId('d1'),
  providerId,
  dutyVersion: 'v1' as DutyVersion,
  cause: { kind: 'schedule', reason: 'the hourly trigger fired' },
  occurredAt: 5,
})

describe('duty trigger registry', () => {
  let ctx: Context
  let triggers: DutyTriggerService

  beforeEach(async () => {
    ctx = new Context()
    await ctx.plugin(DutyTriggerService, { pollIntervalMs: 5000 })
    triggers = ctx.dutyTriggers
  })

  afterEach(async () => {
    await ctx.fiber.dispose()
  })

  it('registers a provider under its id and unregisters via the disposer', () => {
    const provider = new ScriptedProvider('timer')
    const unregister = triggers.registerProvider(provider)
    expect(triggers.providerIds()).toEqual(['timer'])
    unregister()
    expect(triggers.providerIds()).toEqual([])
  })

  it('refuses a duplicate provider id', () => {
    triggers.registerProvider(new ScriptedProvider('timer'))
    expect(() => triggers.registerProvider(new ScriptedProvider('timer')))
      .toThrow(/already registered/)
  })

  it('polls every provider at the current wall clock and emits each observation', async () => {
    const timer = new ScriptedProvider('timer')
    const calendar = new ScriptedProvider('calendar')
    timer.observations = [observation('timer')]
    calendar.observations = [observation('calendar')]
    triggers.registerProvider(timer)
    triggers.registerProvider(calendar)

    const received: DutyTriggerObservation[] = []
    ctx.on('duty/trigger', received.push.bind(received))
    await triggers.sweep()

    expect(timer.calls).toHaveLength(1)
    expect(calendar.calls).toHaveLength(1)
    expect(received.map(item => item.providerId)).toEqual(['timer', 'calendar'])
  })

  it('contains one failing provider and still polls the rest', async () => {
    const broken = new ScriptedProvider('broken')
    broken.failure = new Error('no clock')
    const healthy = new ScriptedProvider('healthy')
    healthy.observations = [observation('healthy')]
    triggers.registerProvider(broken)
    triggers.registerProvider(healthy)

    const received: DutyTriggerObservation[] = []
    ctx.on('duty/trigger', received.push.bind(received))
    await expect(triggers.sweep()).resolves.toBeUndefined()

    expect(received.map(item => item.providerId)).toEqual(['healthy'])
  })

  it('shares one in-flight sweep across concurrent callers', async () => {
    const provider = new ScriptedProvider('timer')
    triggers.registerProvider(provider)
    await Promise.all([triggers.sweep(), triggers.sweep(), triggers.sweep()])
    expect(provider.calls).toHaveLength(1)
  })

  it('arms the next sweep after the previous one settles', async () => {
    vi.useFakeTimers()
    try {
      // The service must arm its first timer under fake time.
      const timed = new Context()
      await timed.plugin(DutyTriggerService, { pollIntervalMs: 5000 })
      const provider = new ScriptedProvider('timer')
      timed.dutyTriggers.registerProvider(provider)
      await vi.advanceTimersByTimeAsync(5000)
      expect(provider.calls).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(5000)
      expect(provider.calls).toHaveLength(2)
      await timed.fiber.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops sweeping when the service fiber unloads', async () => {
    vi.useFakeTimers()
    try {
      const timed = new Context()
      await timed.plugin(DutyTriggerService, { pollIntervalMs: 5000 })
      const provider = new ScriptedProvider('timer')
      timed.dutyTriggers.registerProvider(provider)
      await vi.advanceTimersByTimeAsync(5000)
      expect(provider.calls).toHaveLength(1)
      await timed.fiber.dispose()
      await vi.advanceTimersByTimeAsync(20000)
      expect(provider.calls).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('duty trigger invariant companion', () => {
  it('removes its registry contribution when its fiber is disposed (HMR safety)', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(InvariantRegistry)
      const fiber = await ctx.plugin(DutyTriggerInvariant)

      expect(() => {
        ctx.invariants.register('@deepseek-ai/dsh-duty-trigger', () => {})
      }).toThrow(/already registered/u)

      await fiber.dispose()
      await expect(ctx.plugin(DutyTriggerInvariant).await()).resolves.toBeDefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
