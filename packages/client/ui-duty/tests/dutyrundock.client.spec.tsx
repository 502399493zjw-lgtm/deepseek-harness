// @vitest-environment jsdom
// DutyRunDock behavior: the live run board above the composer — step
// progress, the open-question answer form, and the finished line — driven
// purely through props over the `duty` projection.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DutyRunMachineState } from '@deepseek-ai/dsh-duty-runner/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { DutyRunDock } from '../src/client/DutyRunDock.tsx'
import type { DutyRunDockProps } from '../src/client/DutyRunDock.tsx'
import type { DutyRunDockActions } from '../src/client/slots.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh, commonZh)

afterEach(cleanup)

function makeState(over: Partial<DutyRunMachineState> = {}): DutyRunMachineState {
  return {
    bound: { dutyId: 'd1' as never, runId: 'r1', cause: { kind: 'schedule', reason: 'hourly' } },
    steps: [],
    ...over,
  }
}

function makeActions() {
  return {
    answer: vi.fn<DutyRunDockActions['answer']>(() => Promise.resolve({ ok: true })),
  } satisfies DutyRunDockActions
}

describe('DutyRunDock', () => {
  it('renders nothing when the session is not a run', () => {
    const actions = makeActions()
    const loading = render(<DutyRunDock {...({ useProjection: () => undefined, ...actions, t } as unknown as DutyRunDockProps)} />)
    expect(loading.container.firstChild).toBeNull()
  })

  it('renders nothing when the projection has no run binding', () => {
    const actions = makeActions()
    const unbound = render(<DutyRunDock
      {...({ useProjection: () => makeState({ bound: undefined }), ...actions, t } as unknown as DutyRunDockProps)}
    />)
    expect(unbound.container.firstChild).toBeNull()
  })

  it('renders step progress and the finished line', () => {
    const actions = makeActions()
    render(<DutyRunDock
      {...({
        useProjection: () => makeState({
          steps: [
            { stepId: 'a', label: 'Collect', status: 'completed', attempts: 1, summary: '3 tickets' },
            { stepId: 'b', label: 'Report', status: 'started', attempts: 2 },
          ],
          finished: { status: 'failed', summary: 'budget exceeded' },
        }),
        ...actions,
        t,
      } as unknown as DutyRunDockProps)}
    />)
    expect(screen.getByText('1/2 个步骤')).toBeTruthy()
    expect(screen.getByText('Collect — 3 tickets')).toBeTruthy()
    expect(screen.getByText(/Report/)).toBeTruthy()
    expect(screen.getByText(/已结束: failed/)).toBeTruthy()
  })

  it('submits an answer for the open human decision', async () => {
    const actions = makeActions()
    render(<DutyRunDock
      {...({
        useProjection: () => makeState({ waitingHuman: { requestId: 'h1', question: 'Send it?' } }),
        ...actions,
        t,
      } as unknown as DutyRunDockProps)}
    />)
    fireEvent.change(screen.getByPlaceholderText('答复…'), { target: { value: 'yes' } })
    fireEvent.click(screen.getByRole('button', { name: '答复' }))
    await waitFor(() => {
      expect(actions.answer).toHaveBeenCalledWith('d1', 'h1', 'yes')
    })
  })

  it('shows the remote failure inline', async () => {
    const actions = makeActions()
    actions.answer.mockResolvedValue({ ok: false, error: 'answer-not-offered' })
    render(<DutyRunDock
      {...({
        useProjection: () => makeState({ waitingHuman: { requestId: 'h1', question: 'Send it?' } }),
        ...actions,
        t,
      } as unknown as DutyRunDockProps)}
    />)
    fireEvent.change(screen.getByPlaceholderText('答复…'), { target: { value: 'no' } })
    fireEvent.click(screen.getByRole('button', { name: '答复' }))
    await waitFor(() => {
      expect(screen.getByText('answer-not-offered')).toBeTruthy()
    })
  })
})
