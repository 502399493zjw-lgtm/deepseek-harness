// @vitest-environment jsdom
// DutyPanel behavior: the sidebar duty entry — trigger open/close, the duty
// list, run history on selection, lifecycle/start/remove verbs, and the
// human-decision inbox — driven purely through the injected Remote verbs.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DutyView } from '@deepseek-ai/dsh-api-remotes/client'
import type { DutyPanelProps } from '../src/client/DutyPanel.tsx'
import type { DutyPanelActions } from '../src/client/slots.ts'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { DutyPanel } from '../src/client/DutyPanel.tsx'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh, commonZh)

afterEach(cleanup)

function makeActions(over: Partial<DutyPanelActions> = {}): DutyPanelActions {
  return {
    listDuties: vi.fn<DutyPanelActions['listDuties']>(() => Promise.resolve([])),
    listRuns: vi.fn<DutyPanelActions['listRuns']>(() => Promise.resolve([])),
    openRequests: vi.fn<DutyPanelActions['openRequests']>(() => Promise.resolve([])),
    answer: vi.fn<DutyPanelActions['answer']>(() => Promise.resolve({ ok: true })),
    setLifecycle: vi.fn<DutyPanelActions['setLifecycle']>(() => Promise.resolve({ ok: true })),
    start: vi.fn<DutyPanelActions['start']>(() => Promise.resolve({ ok: true })),
    remove: vi.fn<DutyPanelActions['remove']>(() => Promise.resolve({ ok: true })),
    ...over,
  }
}

function makeDuty(over: Partial<DutyView> = {}): DutyView {
  const base: DutyView = {
    spec: {
      id: 'd1' as never,
      title: 'Triage tickets',
      mode: 'standing',
      goal: 'Keep the queue triaged.',
      trigger: { kind: 'interval', description: 'every hour', everyMs: 3600000 },
      body: { steps: [] },
      toolPolicy: { allow: [], gated: [] },
      limits: { maxConsecutiveFailures: 3 },
      escalation: [],
      version: 'v1' as never,
      createdAt: 1,
      updatedAt: 1,
    },
    state: {
      dutyId: 'd1' as never,
      lifecycle: 'active',
      runCount: 1,
      running: false,
      consecutiveFailures: 0,
      lastOutcome: 'succeeded',
    },
  }
  return { ...base, ...over }
}

function renderPanel(actions: DutyPanelActions) {
  const props = { wide: true, t, ...actions }
  render(<DutyPanel {...props as unknown as DutyPanelProps} />)
  fireEvent.click(screen.getByRole('button', { name: /Duty/ }))
}

describe('DutyPanel', () => {
  it('opens and closes over the trigger row', () => {
    const actions = makeActions()
    renderPanel(actions)
    expect(screen.getByText('Duties')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(screen.queryByText('Duties')).toBeNull()
  })

  it('renders the empty states when nothing exists', async () => {
    const actions = makeActions()
    renderPanel(actions)
    await waitFor(() => { expect(screen.getByText('没有待答复的人工决策。')).toBeTruthy() })
    expect(screen.getByText('还没有 Duty。可用 duty_create 工具或 /loop 命令创建。')).toBeTruthy()
  })

  it('lists duties and shows runs on selection', async () => {
    const actions = makeActions({
      listDuties: vi.fn(() => Promise.resolve([makeDuty()])),
      listRuns: vi.fn(() => Promise.resolve([{
        id: 'r1' as never,
        dutyId: 'd1' as never,
        index: 1,
        sessionId: 's1' as never,
        cause: { kind: 'schedule' as const, reason: 'hourly' },
        status: 'succeeded' as const,
        startedAt: 1,
        adapted: false,
        summary: 'done',
      }])),
    })
    renderPanel(actions)
    await waitFor(() => { expect(screen.getByText('Triage tickets')).toBeTruthy() })
    fireEvent.click(screen.getByText('Triage tickets'))
    await waitFor(() => { expect(screen.getByText(/done/)).toBeTruthy() })
    expect(actions.listRuns).toHaveBeenCalledWith('d1')
  })

  it('answers an open human decision', async () => {
    const actions = makeActions({
      openRequests: vi.fn(() => Promise.resolve([{
        id: 'h1' as never,
        dutyId: 'd1' as never,
        runId: 'r1' as never,
        sessionId: 's1' as never,
        status: 'open' as const,
        reason: 'authorization' as const,
        question: 'Send the reply?',
        options: ['send', 'hold'],
        allowFreeform: false,
        createdAt: 1,
      }])),
    })
    renderPanel(actions)
    await waitFor(() => { expect(screen.getByText('Send the reply?')).toBeTruthy() })
    fireEvent.change(screen.getByPlaceholderText('答复…'), { target: { value: 'send' } })
    fireEvent.click(screen.getByRole('button', { name: '答复' }))
    await waitFor(() => {
      expect(actions.answer).toHaveBeenCalledWith('d1' as never, 'h1', 'send')
    })
  })

  it('drives lifecycle, start, and remove verbs', async () => {
    const actions = makeActions({ listDuties: vi.fn(() => Promise.resolve([makeDuty()])) })
    renderPanel(actions)
    await waitFor(() => { expect(screen.getByText('Triage tickets')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    await waitFor(() => {
      expect(actions.setLifecycle).toHaveBeenCalledWith('d1' as never, 'paused', 'human')
    })
    fireEvent.click(screen.getByRole('button', { name: '立即运行' }))
    await waitFor(() => {
      expect(actions.start).toHaveBeenCalledWith('d1' as never, 'started from the duty panel')
    })
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => {
      expect(actions.remove).toHaveBeenCalledWith('d1' as never)
    })
  })

  it('shows a paused duty with its activate row and no outcome suffix', async () => {
    const actions = makeActions({ listDuties: vi.fn(() => Promise.resolve([makeDuty({
      state: {
        dutyId: 'd1' as never,
        lifecycle: 'paused',
        pausedReason: 'human',
        runCount: 0,
        running: false,
        consecutiveFailures: 0,
      },
    })])) })
    renderPanel(actions)
    await waitFor(() => {
      expect(screen.getByText('Triage tickets')).toBeTruthy()
    })
    expect(screen.getByText(/状态: paused$/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '激活' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '激活' }))
    await waitFor(() => {
      expect(actions.setLifecycle).toHaveBeenCalledWith('d1' as never, 'active')
    })
  })

  it('hides the activate row for an archived duty and renders a run without summary', async () => {
    const actions = makeActions({
      listDuties: vi.fn(() => Promise.resolve([makeDuty({
        state: {
          dutyId: 'd1' as never,
          lifecycle: 'archived',
          runCount: 1,
          running: false,
          consecutiveFailures: 0,
        },
      })])),
      listRuns: vi.fn(() => Promise.resolve([{
        id: 'r1' as never,
        dutyId: 'd1' as never,
        index: 1,
        sessionId: 's1' as never,
        cause: { kind: 'schedule' as const, reason: 'hourly' },
        status: 'failed' as const,
        startedAt: 1,
        adapted: false,
      }])),
    })
    renderPanel(actions)
    await waitFor(() => {
      expect(screen.getByText('Triage tickets')).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: '激活' })).toBeNull()
    fireEvent.click(screen.getByText('Triage tickets'))
    await waitFor(() => {
      expect(screen.getByText('#1 failed')).toBeTruthy()
    })
    expect(screen.getByText('hourly')).toBeTruthy()
  })

  it('falls back to the generic copy when a verb fails without a message', async () => {
    const actions = makeActions({
      listDuties: vi.fn(() => Promise.resolve([makeDuty()])),
      setLifecycle: vi.fn(() => Promise.resolve({ ok: false })),
    })
    renderPanel(actions)
    await waitFor(() => {
      expect(screen.getByText('Triage tickets')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    await waitFor(() => {
      expect(screen.getByText('远端调用失败')).toBeTruthy()
    })
  })

  it('shows an inline failure from a rejected verb', async () => {
    const actions = makeActions({
      listDuties: vi.fn(() => Promise.resolve([makeDuty()])),
      setLifecycle: vi.fn(() => Promise.resolve({ ok: false, error: 'duty-running' })),
    })
    renderPanel(actions)
    await waitFor(() => { expect(screen.getByText('Triage tickets')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    await waitFor(() => { expect(screen.getByText('duty-running')).toBeTruthy() })
  })
})
