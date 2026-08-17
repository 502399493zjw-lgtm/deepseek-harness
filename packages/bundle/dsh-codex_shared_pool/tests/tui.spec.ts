import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import type { OpenAICodexService } from '../src/service.ts'
import type { ImageToolPreferences, ResponseApiPreferences } from '../src/shared/types.ts'
import { installOpenAICodexTui } from '../src/tui.ts'

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

function fakeService(): {
  service: OpenAICodexService
  responsePatches: Array<Partial<ResponseApiPreferences>>
} {
  let imagePreferences = { modifyReadImage: true, shareImagegenWithOtherModels: true }
  let responsePreferences = { useFastMode: false, useWebSocketContextReuse: false, useNativeCompaction: false }
  const responsePatches: Array<Partial<ResponseApiPreferences>> = []
  const service = {
    authStatus: vi.fn(async () => ({ authenticated: true, expiresAt: new Date('2026-08-17T00:00:00Z') })),
    usage: vi.fn(async () => ({
      rateLimits: [{
        id: 'codex',
        name: 'Codex',
        windows: [{ windowSeconds: 18_000, remainingPercent: 62.5 }],
      }],
    })),
    login: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
    imagePreferences: vi.fn(() => ({ ...imagePreferences })),
    updateImagePreferences: vi.fn(async (patch: Partial<ImageToolPreferences>) => {
      imagePreferences = { ...imagePreferences, ...patch }
      return { ...imagePreferences }
    }),
    responsePreferences: vi.fn(() => ({ ...responsePreferences })),
    updateResponsePreferences: vi.fn(async (patch: Partial<ResponseApiPreferences>) => {
      responsePatches.push(patch)
      responsePreferences = { ...responsePreferences, ...patch }
      return { ...responsePreferences }
    }),
  } as unknown as OpenAICodexService
  return { service, responsePatches }
}

async function command(ctx: Context): Promise<CommandDefinition> {
  const agent = { ctx } as never
  const definition = ctx.commands.find(agent, 'codex')
  if (definition === undefined) throw new Error('/codex was not registered')
  return definition
}

describe('UI-neutral command with optional dsh-tui completion', () => {
  it('registers the command without requiring dsh-tui', async () => {
    const ctx = new Context()
    context = ctx
    ctx.provide('openAICodex', fakeService().service)
    await ctx.plugin(CommandRuntime)
    installOpenAICodexTui(ctx)
    await new Promise(resolve => setTimeout(resolve, 0))

    const commands = ctx.commands.list({ ctx } as never)
    expect(commands).toHaveLength(1)
    expect(commands[0]?.name).toBe('codex')
    expect(commands[0]?.description).toContain('OpenAI Codex')
  })

  it('registers one provider command when dsh-tui is present', async () => {
    const ctx = new Context()
    context = ctx
    const { service, responsePatches } = fakeService()
    ctx.provide('openAICodex', service)
    let commandTree: {
      descriptions?: Readonly<Partial<Record<'zh' | 'en', string>>>
      children(path: readonly string[]): readonly { name: string }[]
    } | undefined
    ctx.provide('tuiCommandTrees', {
      register(provider: typeof commandTree & { root: string }) {
        commandTree = provider
        return () => { commandTree = undefined }
      },
    })
    await ctx.plugin(CommandRuntime)
    installOpenAICodexTui(ctx)
    await new Promise(resolve => setTimeout(resolve, 0))

    const definition = await command(ctx)
    expect(definition.description).toContain('OpenAI Codex')
    if (commandTree === undefined) throw new Error('Codex command tree was not registered')
    expect(commandTree.descriptions?.zh).toBe('管理 OpenAI Codex 账号与提供方设置')
    expect(commandTree.children(['codex']).map(item => item.name)).toEqual([
      'status', 'login', 'logout', 'usage', 'config', 'set',
    ])
    expect(commandTree.children(['codex'])[0]).toMatchObject({
      descriptions: { en: 'Show the ChatGPT sign-in state', zh: '查看 ChatGPT 登录状态' },
    })
    expect(commandTree.children(['codex', 'set']).map(item => item.name)).toEqual([
      'read-image', 'imagegen-other-models', 'fast', 'websocket-context', 'native-compaction',
    ])
    expect(commandTree.children(['codex', 'set', 'native-compaction']).map(item => item.name)).toEqual(['on', 'off'])
    await expect(definition.handler({ rawInput: ' status' } as never)).resolves.toEqual({
      kind: 'success',
      text: 'OpenAI Codex is signed in. Access token expires 2026-08-17T00:00:00.000Z; refresh is automatic.',
    })
    await expect(definition.handler({ rawInput: ' usage' } as never)).resolves.toEqual({
      kind: 'success',
      text: 'Codex (18000s): 62.5% remaining',
    })
    const configResult = await definition.handler({ rawInput: ' config' } as never)
    expect(configResult.kind).toBe('success')
    expect(configResult.text).toContain('read-image: on')
    const compactionResult = await definition.handler({ rawInput: ' set native-compaction on' } as never)
    expect(compactionResult.kind).toBe('success')
    expect(compactionResult.text).toContain('native-compaction: on')
    expect(responsePatches).toContainEqual({ useNativeCompaction: true })
    const fastResult = await definition.handler({ rawInput: ' set fast on' } as never)
    expect(fastResult.kind).toBe('success')
    expect(fastResult.text).toContain('fast: on')
    expect(responsePatches).toContainEqual({ useFastMode: true })
  })
})
