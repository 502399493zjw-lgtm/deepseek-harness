import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import DutyService from '../src/index.ts'
import type { CreateDutyRequest, DutyBody, DutyTrigger } from '../src/types.ts'

/** One disposable Duty service over a real JSON storage medium. */
export interface DutyHarness {
  readonly ctx: Context
  readonly duties: DutyService
  readonly root: string
  /** Unload the service, leaving the medium on disk for a restart. */
  stop(): Promise<void>
  /** Unload the service and delete a medium this harness created. */
  dispose(): Promise<void>
}

/** The default retention and failure policy used by tests. */
export const TEST_CONFIG = {
  defaultMaxConsecutiveFailures: 3,
  runHistoryLimit: 50,
  triggerEventLimit: 50,
} as const

/** Overridable Duty policy fields; values are plain numbers, unlike the frozen defaults. */
export type DutyTestConfig = Partial<{
  defaultMaxConsecutiveFailures: number
  runHistoryLimit: number
  triggerEventLimit: number
}>

/** A minimal valid single-step execution body. */
export const SIMPLE_BODY: DutyBody = {
  steps: [{ id: 'collect', kind: 'agent', label: 'Collect', prompt: 'Collect the open tickets.' }],
}

/** A standing hourly trigger. */
export const HOURLY: DutyTrigger = {
  kind: 'interval',
  description: 'every hour',
  everyMs: 3_600_000,
}

/** Build a valid creation request, overridable per test. */
export function createRequest(overrides: Partial<CreateDutyRequest> = {}): CreateDutyRequest {
  return {
    title: 'Triage tickets',
    goal: 'Keep the open ticket queue triaged.',
    trigger: HOURLY,
    body: SIMPLE_BODY,
    toolPolicy: { allow: ['read', 'grep'], gated: [] },
    ...overrides,
  }
}

/** A deterministic Session id for a run under test. */
export function sessionId(name: string): SessionId {
  return SessionId(`session-${name}`)
}

/**
 * Compose the Duty service over a JSON storage root.
 * @param config - Policy overrides for this instance.
 * @param existingRoot - Reattach to an existing medium instead of a fresh one,
 * so a test can prove records survive a service restart.
 * @param ownExisting - When reattaching, whether this harness deletes the
 * medium on dispose; a restarted harness takes over cleanup from its
 * predecessor.
 * @returns the composed harness.
 */
export async function createDutyHarness(
  config: DutyTestConfig = {},
  existingRoot?: string,
  ownExisting = false,
): Promise<DutyHarness> {
  const root = existingRoot ?? await mkdtemp(join(tmpdir(), 'dsh-duty-'))
  const owned = existingRoot === undefined || ownExisting
  const ctx = new Context()
  try {
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    await ctx.plugin(DutyService, { ...TEST_CONFIG, ...config })
  } catch (error) {
    await ctx.fiber.dispose()
    if (owned) await rm(root, { recursive: true, force: true })
    throw error
  }
  return {
    ctx,
    duties: ctx.duties,
    root,
    stop: async () => {
      await ctx.fiber.dispose()
    },
    dispose: async () => {
      await ctx.fiber.dispose()
      if (owned) await rm(root, { recursive: true, force: true })
    },
  }
}

/**
 * Restart one harness: unload its service and reattach a fresh one to the same
 * medium. The new harness owns the medium from then on.
 * @param previous - The running harness to restart.
 * @param config - Policy overrides for the restarted instance.
 * @returns the restarted harness over the same on-disk records.
 */
export async function restartDutyHarness(
  previous: DutyHarness,
  config: DutyTestConfig = {},
): Promise<DutyHarness> {
  await previous.stop()
  return createDutyHarness(config, previous.root, true)
}
