import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import * as DutyInvariant from '../src/invariant.ts'
import { DutyId } from '../src/index.ts'
import { createDutyHarness } from './helpers.ts'
import type { DutyRun, DutyState, DutyView } from '../src/types.ts'

/** Boot the invariant service plus the companion over a stubbed Duty service. */
async function setup(stub: {
  view?: DutyView
  runs: readonly DutyRun[]
}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  ctx.provide('duties', {
    get: () => stub.view,
    runsOf: () => stub.runs,
  })
  await ctx.plugin(DutyInvariant)
  return ctx
}

type ChangeLocation = Partial<Pick<DomainChanged, 'domain' | 'table' | 'key'>>

const change = (overrides?: ChangeLocation): DomainChanged => ({
  domain: 'duty',
  table: 'state',
  key: 'd1',
  operation: 'put',
  value: {},
  ...overrides,
})

/** A settled run: it no longer counts as unsettled. */
const settled: DutyRun = {
  id: 'r1' as DutyRun['id'],
  dutyId: DutyId('d1'),
  index: 1,
  sessionId: 's1' as DutyRun['sessionId'],
  cause: { kind: 'manual', reason: 'test' },
  status: 'succeeded',
  startedAt: 1,
  completedAt: 2,
  adapted: false,
}

/** An unsettled run: it still holds the Duty's claim. */
const running: DutyRun = {
  id: 'r1' as DutyRun['id'],
  dutyId: DutyId('d1'),
  index: 1,
  sessionId: 's1' as DutyRun['sessionId'],
  cause: { kind: 'manual', reason: 'test' },
  status: 'running',
  startedAt: 1,
  adapted: false,
}

/** State holding the run claim. */
const holding: DutyState = {
  dutyId: DutyId('d1'),
  lifecycle: 'active',
  runCount: 1,
  running: true,
  consecutiveFailures: 0,
}

/** State with the claim released. */
const released: DutyState = { ...holding, running: false }

const view = (state: DutyState): DutyView => ({ spec: {} as DutyView['spec'], state })

describe('duty claim/run-history invariant', () => {
  it('ignores events from other domains and tables', async () => {
    const ctx = await setup({ view: view(holding), runs: [running] })
    expect(() => { ctx.emit('domain/changed', change({ domain: 'other' })) }).not.toThrow()
    expect(() => { ctx.emit('domain/changed', change({ table: 'specs' })) }).not.toThrow()
  })

  it('accepts a held claim with exactly one unsettled run', async () => {
    const ctx = await setup({ view: view(holding), runs: [running] })
    expect(() => { ctx.emit('domain/changed', change()) }).not.toThrow()
  })

  it('accepts a released claim with no unsettled runs', async () => {
    const ctx = await setup({ view: view(released), runs: [settled] })
    expect(() => { ctx.emit('domain/changed', change()) }).not.toThrow()
  })

  it('accepts events for a duty the service does not know', async () => {
    const ctx = await setup({ runs: [] })
    expect(() => { ctx.emit('domain/changed', change()) }).not.toThrow()
  })

  it('fails a held claim with no unsettled run', async () => {
    const ctx = await setup({ view: view(holding), runs: [settled] })
    expect(() => { ctx.emit('domain/changed', change()) })
      .toThrow(/holds its run claim with 0 unsettled runs/)
  })

  it('fails a released claim that left a run unsettled', async () => {
    const ctx = await setup({ view: view(released), runs: [running] })
    expect(() => { ctx.emit('domain/changed', change()) })
      .toThrow(/released its run claim leaving 1 unsettled runs/)
  })
})

describe('duty invariant companion', () => {
  it('removes its registry contribution when its fiber is disposed (HMR safety)', async () => {
    const harness = await createDutyHarness()
    try {
      await harness.ctx.plugin(InvariantRegistry)
      const fiber = await harness.ctx.plugin(DutyInvariant)

      expect(() => {
        harness.ctx.invariants.register('@deepseek-ai/dsh-duty', () => {})
      }).toThrow(/already registered/u)

      await fiber.dispose()
      await expect(harness.ctx.plugin(DutyInvariant).await()).resolves.toBeDefined()
    } finally {
      await harness.dispose()
    }
  })
})
