// Node-half plugin body and invariant companion.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as UiDutyNode from '../src/index.ts'
import * as UiDutyInvariant from '../src/invariant.ts'

describe('ui-duty node half', () => {
  it('applies without host-side behavior', () => {
    expect(() => {
      UiDutyNode.apply()
    }).not.toThrow()
  })

  it('removes its invariant contribution on fiber disposal (HMR safety)', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(InvariantRegistry)
      const fiber = await ctx.plugin(UiDutyInvariant)
      expect(() => {
        ctx.invariants.register('@deepseek-ai/dsh-client-ui-duty', () => {})
      }).toThrow(/already registered/u)
      await fiber.dispose()
      await expect(ctx.plugin(UiDutyInvariant).await()).resolves.toBeDefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
