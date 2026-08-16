/**
 * Duty surface slot contracts: the injected faces of the two entries.
 * @module @deepseek-ai/dsh-client-ui-duty/client/slots
 */

import type {
  DutyId,
  DutyLifecycle,
  DutyRun,
  DutyState,
  DutyView,
  HumanRequest,
} from '@deepseek-ai/dsh-api-remotes/client'

/** Outcome of one Remote mutation, rendered as inline copy on failure. */
export interface DutyActionResult {
  readonly ok: boolean
  readonly error?: string
}

/** Verbs the run dock hands to its renderer. */
export interface DutyRunDockActions {
  /** Settle one open human decision. */
  answer: (dutyId: DutyId, requestId: string, answer: string) => Promise<DutyActionResult>
}

/** Verbs and reads the panel hands to its renderer. */
export interface DutyPanelActions {
  /** Read every Duty with its state. */
  listDuties: () => Promise<readonly DutyView[]>
  /** Read one Duty's run history, newest first. */
  listRuns: (id: DutyId) => Promise<readonly DutyRun[]>
  /** Read every open human decision. */
  openRequests: () => Promise<readonly HumanRequest[]>
  /** Settle one open human decision. */
  answer: (dutyId: DutyId, requestId: string, answer: string) => Promise<DutyActionResult>
  /** Move one Duty's lifecycle; pausing names a reason. */
  setLifecycle: (id: DutyId, lifecycle: DutyLifecycle, reason?: string) => Promise<DutyActionResult>
  /** Wake one active Duty by hand. */
  start: (id: DutyId, reason: string) => Promise<DutyActionResult>
  /** Remove one Duty and every record it owns. */
  remove: (id: DutyId) => Promise<DutyActionResult>
}

/** Current state of one Duty row, flattened for the panel. */
export interface DutyRowView {
  readonly id: DutyId
  readonly title: string
  readonly state: DutyState
}
