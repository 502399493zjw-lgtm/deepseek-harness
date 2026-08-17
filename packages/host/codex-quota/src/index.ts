/** Host gateway for display-safe Codex account-pool quota snapshots. */

import { homedir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { readOpenAICodexAccountName } from './account-name.ts'
import { CodexQuotaAppServerWire } from './wire.ts'
import type { CodexAccountQuota, CodexQuotaSnapshot } from './types.ts'

export type * from './types.ts'
export { CodexQuotaAppServerWire, projectCodexAccountQuota } from './wire.ts'

const DEFAULT_REFRESH_INTERVAL_MS = 60_000
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_DISPOSE_GRACE_MS = 3_000
const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Deployment policy for Codex homes and app-server lifecycle bounds. */
export interface Config {
  /** Ordered Codex homes; the first is the active account. */
  accountHomes?: string[]
  /** Minimum time a successful or unavailable snapshot remains cached. */
  refreshIntervalMs?: number
  /** Deadline for one account's app-server requests. */
  requestTimeoutMs?: number
  /** Grace between managed child-process termination tiers. */
  disposeGraceMs?: number
  /** Codex executable name or absolute path in the subprocess execution world. */
  codexCommand?: string
}

export const Config: z<Config> = z.object({
  accountHomes: z.array(z.string()).default([]),
  refreshIntervalMs: z.number().default(DEFAULT_REFRESH_INTERVAL_MS),
  requestTimeoutMs: z.number().default(DEFAULT_REQUEST_TIMEOUT_MS),
  disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
  codexCommand: z.string().default('codex'),
})

interface ResolvedConfig {
  readonly accountHomes: readonly string[]
  readonly refreshIntervalMs: number
  readonly requestTimeoutMs: number
  readonly disposeGraceMs: number
  readonly codexCommand: string
}

interface CodexAccountReadSpec {
  readonly accountHome: string
  readonly requestTimeoutMs: number
  readonly disposeGraceMs: number
  readonly codexCommand: string
  readonly cwd: string
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
}

function positiveTimer(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_TIMER_DELAY_MS) {
    throw new TypeError(`codex-quota: ${name} must be finite, positive, and no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  return value
}

function absoluteHome(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new TypeError('codex-quota: accountHomes cannot contain an empty path')
  if (trimmed === '~') return homedir()
  if (trimmed.startsWith('~/')) return resolve(homedir(), trimmed.slice(2))
  return resolve(trimmed)
}

/**
 * Resolve explicit config, then DSH pool homes, then the standard current Codex home.
 * @param configured - Ordered account homes supplied by plugin configuration.
 * @returns Deduplicated absolute account-home paths in active-account order.
 */
export function resolveCodexAccountHomes(configured: readonly string[] | undefined): readonly string[] {
  const fromEnv = process.env.DSH_CODEX_ACCOUNT_HOMES
  const selected = configured !== undefined && configured.length > 0
    ? configured
    : fromEnv !== undefined && fromEnv.trim().length > 0
      ? fromEnv.split(delimiter)
      : [process.env.CODEX_HOME ?? join(homedir(), '.codex')]
  return Object.freeze([...new Set(selected.map(absoluteHome))])
}

function codexAppServerArgv(command: string, platform: NodeJS.Platform = process.platform): string[] {
  return platform === 'win32'
    ? ['cmd.exe', '/d', '/s', '/c', command, 'app-server', '--stdio']
    : [command, 'app-server', '--stdio']
}

async function disposeChild(wire: CodexQuotaAppServerWire, child: SubprocessHandle): Promise<void> {
  wire.close()
  try {
    child.stdin?.end()
  } catch {
    // Concurrent app-server exit does not change process-tree ownership.
  }
  child.terminate()
  await child.waitForExit()
  await child.done.catch(() => {})
}

/**
 * Read one Codex home through the official app-server protocol.
 * @param spec - Process, timeout, and account-home inputs for the isolated read.
 * @returns Display-safe account quota fields from the official app-server.
 */
export async function readCodexAccountQuota(spec: CodexAccountReadSpec): Promise<CodexAccountQuota> {
  const accountDisplayName = await readOpenAICodexAccountName(spec.accountHome)
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort(new Error('codex-quota: app-server request timed out'))
  }, spec.requestTimeoutMs)
  const child = spec.spawn({
    argv: codexAppServerArgv(spec.codexCommand),
    cwd: spec.cwd,
    stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 64 * 1024 } },
    graceMs: spec.disposeGraceMs,
    signal: controller.signal,
    env: { CODEX_HOME: spec.accountHome },
  })
  const wire = new CodexQuotaAppServerWire(
    child.stdout as NonNullable<SubprocessHandle['stdout']>,
    child.stdin as NonNullable<SubprocessHandle['stdin']>,
  )
  const processFailure: Promise<never> = child.done.then(outcome => Promise.reject(new Error(
    `codex-quota: app-server exited before quota read settled (code ${String(outcome.exitCode)}, signal ${String(outcome.signal)})`,
  )))
  void processFailure.catch(() => {})
  try {
    wire.start()
    await Promise.race([wire.initialize(controller.signal), processFailure])
    return await Promise.race([wire.read(controller.signal, accountDisplayName), processFailure])
  } finally {
    clearTimeout(timeout)
    await disposeChild(wire, child)
  }
}

/**
 * Aggregate account reads without exposing account-home paths or failures.
 * @param accountHomes - Ordered configured homes; the first identifies the active account.
 * @param readAccount - Isolated reader invoked once for every configured home.
 * @param now - Clock used to stamp the point-in-time snapshot.
 * @returns A display-safe current-account and pool snapshot.
 */
export async function assembleCodexQuotaSnapshot(
  accountHomes: readonly string[],
  readAccount: (accountHome: string) => Promise<CodexAccountQuota>,
  now: () => number = Date.now,
): Promise<CodexQuotaSnapshot> {
  const settled = await Promise.allSettled(accountHomes.map(readAccount))
  const readable = settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
  const current = settled[0]?.status === 'fulfilled' ? settled[0].value : undefined
  const poolRemainingPercent = readable.length === 0
    ? null
    : Math.round(readable.reduce((total, account) => total + account.remainingPercent, 0) / readable.length)
  return Object.freeze({
    currentAccountName: current?.accountName ?? null,
    currentRemainingPercent: current?.remainingPercent ?? null,
    currentResetsAt: current?.resetsAt ?? null,
    poolAccountCount: accountHomes.length,
    poolRemainingPercent,
    refreshedAt: now(),
  })
}

/** Read-only Remote service for the sidebar's Codex quota plugin. */
export class CodexQuotaGateway extends TypertRemoteService {
  static inject = ['subprocess']
  static Config = Config

  private readonly config: ResolvedConfig
  private cached: { readonly expiresAt: number; readonly snapshot: CodexQuotaSnapshot } | undefined
  private inFlight: Promise<CodexQuotaSnapshot> | undefined

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'codexQuota')
    const codexCommand = config.codexCommand?.trim() ?? 'codex'
    if (codexCommand.length === 0) throw new TypeError('codex-quota: codexCommand must not be empty')
    this.config = {
      accountHomes: resolveCodexAccountHomes(config.accountHomes),
      refreshIntervalMs: positiveTimer(
        'refreshIntervalMs',
        config.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS,
      ),
      requestTimeoutMs: positiveTimer(
        'requestTimeoutMs',
        config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      ),
      disposeGraceMs: positiveTimer(
        'disposeGraceMs',
        config.disposeGraceMs ?? DEFAULT_DISPOSE_GRACE_MS,
      ),
      codexCommand,
    }
  }

  /**
   * Return one cached, display-safe account-pool snapshot.
   * @returns The latest account and pool quota projection.
   */
  @Remote('read')
  read(): Promise<CodexQuotaSnapshot> {
    const now = Date.now()
    if (this.cached !== undefined && now < this.cached.expiresAt) {
      return Promise.resolve(this.cached.snapshot)
    }
    if (this.inFlight !== undefined) return this.inFlight
    const readAccount = (accountHome: string): Promise<CodexAccountQuota> => readCodexAccountQuota({
      accountHome,
      requestTimeoutMs: this.config.requestTimeoutMs,
      disposeGraceMs: this.config.disposeGraceMs,
      codexCommand: this.config.codexCommand,
      cwd: process.cwd(),
      spawn: spec => this.ctx.subprocess.spawn(spec),
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      this.ctx.logger.warn(`codex-quota: one configured account could not be read: ${message}`)
      throw error
    })
    const pending = assembleCodexQuotaSnapshot(this.config.accountHomes, readAccount)
      .then((snapshot) => {
        this.cached = { expiresAt: Date.now() + this.config.refreshIntervalMs, snapshot }
        return snapshot
      })
      .finally(() => {
        if (this.inFlight === pending) this.inFlight = undefined
      })
    this.inFlight = pending
    return pending
  }
}

export default CodexQuotaGateway
