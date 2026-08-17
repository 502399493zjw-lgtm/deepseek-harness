/**
 * The settings domain base plugin's own mounting behavior: it stands up
 * `ctx.settingsScope` for every feature that owns a preference row, and the
 * service retires with its fiber.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject, SettingsScopeBinder } from '../src/client/index.ts'

/** Boot the browser half over a bare root context; it injects nothing. */
function bench() {
  const ctx = new Context()
  return { ctx, fiber: ctx.plugin({ inject: [...inject], apply }) }
}

describe('settings domain base plugin', () => {
  it('mounts the scope service under settingsScope', async () => {
    const { ctx, fiber } = bench()
    await fiber.await()
    expect(ctx.get('settingsScope')).toBeInstanceOf(SettingsScopeBinder)
  })

  it('publishes requested settings sections', async () => {
    const { ctx, fiber } = bench()
    await fiber.await()
    const navigation = ctx.settingsNavigation
    const listener = vi.fn()
    const off = navigation.requests.subscribe(listener)

    navigation.openSection('openai-codex')

    expect(navigation.requests.getSnapshot()).toEqual({
      revision: 1,
      sectionId: 'openai-codex',
    })
    expect(listener).toHaveBeenCalledOnce()
    off()
  })

  it('fiber disposal retires the service', async () => {
    const { ctx, fiber } = bench()
    await fiber.await()
    await fiber.dispose()
    expect(ctx.get('settingsScope')).toBeUndefined()
    expect(ctx.get('settingsNavigation')).toBeUndefined()
  })
})
