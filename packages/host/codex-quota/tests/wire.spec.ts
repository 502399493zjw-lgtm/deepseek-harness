import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import {
  CodexQuotaAppServerWire,
  projectCodexAccountQuota,
} from '../src/wire.ts'

function wirePair() {
  const clientToServer = new PassThrough()
  const serverToClient = new PassThrough()
  const client = new CodexQuotaAppServerWire(serverToClient, clientToServer)
  const server = new JsonRpcLineTransport(clientToServer, serverToClient)
  return { client, server }
}

describe('Codex quota app-server wire', () => {
  it('performs the handshake and reads the official account methods', async () => {
    const { client, server } = wirePair()
    const methods: string[] = []
    server.onRequest((method) => {
      methods.push(method)
      if (method === 'initialize') return Promise.resolve({ userAgent: 'codex-test' })
      if (method === 'account/read') {
        return Promise.resolve({
          account: { type: 'chatgpt', email: 'codex@example.com', planType: 'pro' },
          requiresOpenaiAuth: true,
        })
      }
      if (method === 'account/rateLimits/read') {
        return Promise.resolve({
          rateLimits: { primary: { usedPercent: 37, resetsAt: 2_000 } },
        })
      }
      return Promise.reject(new Error(`unexpected method ${method}`))
    })
    server.start()
    client.start()
    const signal = new AbortController().signal

    await client.initialize(signal)
    await expect(client.read(signal, 'Codex User')).resolves.toEqual({
      accountName: 'Codex User',
      remainingPercent: 63,
      resetsAt: 2_000_000,
    })
    expect(methods).toEqual(['initialize', 'account/read', 'account/rateLimits/read'])

    client.close()
    server.close()
  })

  it('prefers the named Codex bucket, clamps percent, and supports account fallbacks', () => {
    expect(projectCodexAccountQuota(
      { account: { type: 'apiKey' }, requiresOpenaiAuth: true },
      {
        rateLimits: { primary: { usedPercent: 1 } },
        rateLimitsByLimitId: { codex: { primary: { usedPercent: 130, resetsAt: null } } },
      },
    )).toEqual({ accountName: 'API Key', remainingPercent: 0, resetsAt: null })
    expect(projectCodexAccountQuota(
      { account: { type: 'chatgpt', email: 'codex@example.com', planType: 'pro' } },
      { rateLimits: { primary: { usedPercent: 37 } } },
    )).toMatchObject({ accountName: 'codex@example.com' })
  })

  it('rejects malformed primary-window data', () => {
    expect(() => projectCodexAccountQuota(
      { account: { type: 'chatgpt', email: 'x@example.com', planType: 'plus' } },
      { rateLimits: { primary: null } },
    )).toThrow('invalid primary rate-limit window')
  })
})
