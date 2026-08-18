#!/usr/bin/env node

// Deterministic newline-delimited JSON-RPC stand-in for the official Codex
// app-server. The assembled browser test exercises the real Host subprocess
// and protocol boundary without reading a developer's Codex account.
import { basename } from 'node:path'
import { createInterface } from 'node:readline'

const accountHome = basename(process.env.CODEX_HOME ?? '')
const active = accountHome === 'codex-active'

function result(method) {
  if (method === 'initialize') return { userAgent: 'codex-quota-e2e' }
  if (method === 'account/read') {
    return {
      account: {
        type: 'chatgpt',
        email: active ? 'codex42@example.com' : 'pool@example.com',
        planType: 'plus',
      },
      requiresOpenaiAuth: true,
    }
  }
  if (method === 'account/rateLimits/read') {
    return {
      rateLimits: {
        primary: { usedPercent: active ? 27 : 51, resetsAt: null },
      },
      rateLimitsByLimitId: null,
    }
  }
  throw new Error(`unexpected method ${String(method)}`)
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
for await (const line of lines) {
  const message = JSON.parse(line)
  if (message.id === undefined) continue
  try {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: result(message.method),
    })}\n`)
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32601, message: error instanceof Error ? error.message : String(error) },
    })}\n`)
  }
}
