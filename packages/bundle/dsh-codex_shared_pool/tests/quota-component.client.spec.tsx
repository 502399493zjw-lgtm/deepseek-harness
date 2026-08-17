// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CodexQuotaFooter,
  type CodexQuotaFooterProps,
  formatCodexResetTime,
} from '../src/client/quota/CodexQuotaFooter.tsx'
import css from '../src/client/quota/CodexQuotaFooter.module.css'
import { zh, type CodexQuotaLocaleKey } from '../src/client/quota/locales.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const SNAPSHOT = {
  currentAccountName: '经纬 钟',
  currentRemainingPercent: 73,
  currentResetsAt: null,
  poolAccountCount: 12,
  poolRemainingPercent: 61,
  refreshedAt: 1,
} as const

const t = ((key: CodexQuotaLocaleKey, params?: Record<string, unknown>): string => {
  let value: string = zh[key]
  for (const [name, replacement] of Object.entries(params ?? {})) {
    value = value.replace(`{${name}}`, String(replacement))
  }
  return value
}) as CodexQuotaFooterProps['t']

function props(overrides: Partial<CodexQuotaFooterProps> = {}): CodexQuotaFooterProps {
  return {
    wide: true,
    read: vi.fn().mockResolvedValue(SNAPSHOT),
    openSettings: vi.fn(),
    t,
    ...overrides,
  } as CodexQuotaFooterProps
}

describe('unified Codex quota footer', () => {
  it('uses the settings account name and reserves blue for the current quota', async () => {
    const view = render(<CodexQuotaFooter {...props()} />)
    expect(await screen.findByText('经纬 钟')).toBeTruthy()

    const rows = view.container.querySelectorAll(`.${css.current}, .${css.pool}`)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toBe('经纬 钟 · 剩余 73% · 重置时间未知')
    expect(rows[1]?.textContent).toBe('账号池 12 个账号 · 总剩余 61%')

    const blue = view.container.querySelectorAll(`.${css.quota}`)
    expect([...blue].map(node => node.textContent)).toEqual(['73%'])
    expect(view.container.querySelectorAll(`.${css.separator}`)).toHaveLength(3)
    const open = screen.getByRole('button', { name: '打开' })
    expect(rows[0]?.parentElement).toBe(open.parentElement)
    expect(rows[1]?.parentElement).toBe(view.container.firstElementChild)
  })

  it('opens the unified Codex settings section from the arrow action', async () => {
    const openSettings = vi.fn()
    render(<CodexQuotaFooter {...props({ openSettings })} />)
    await screen.findByText('经纬 钟')

    const open = screen.getByRole('button', { name: '打开' })
    expect(open.textContent).toBe('')
    expect(open.querySelector('svg')).not.toBeNull()
    fireEvent.click(open)

    expect(openSettings).toHaveBeenCalledOnce()
  })

  it('does not render the two-line block in the collapsed rail', () => {
    const read = vi.fn().mockResolvedValue(SNAPSHOT)
    const view = render(<CodexQuotaFooter {...props({ wide: false, read })} />)
    expect(view.container.childElementCount).toBe(0)
  })

  it('shows a neutral unavailable state without exposing an error message', async () => {
    const read = vi.fn().mockRejectedValue(new Error('private account path'))
    render(<CodexQuotaFooter {...props({ read })} />)
    expect(await screen.findByText(zh.unavailable)).toBeTruthy()
    expect(screen.queryByText('private account path')).toBeNull()
  })

  it.each([
    [null, '账号池 12 个账号'],
    [61, '账号池 12 个账号 · 总剩余 61%'],
  ])('keeps pool context when the current account cannot be summarized', async (
    poolRemainingPercent,
    expectedPool,
  ) => {
    const read = vi.fn().mockResolvedValue({
      ...SNAPSHOT,
      currentAccountName: null,
      currentRemainingPercent: null,
      poolRemainingPercent,
    })
    const view = render(<CodexQuotaFooter {...props({ read })} />)

    await waitFor(() => {
      expect(view.container.querySelector(`.${css.pool}`)?.textContent).toBe(expectedPool)
    })
    expect(screen.getByRole('button', { name: '打开' })).toBeTruthy()
  })

  it('formats a known reset time and renders an unknown pool percentage neutrally', async () => {
    const read = vi.fn().mockResolvedValue({
      ...SNAPSHOT,
      currentResetsAt: 0,
      poolRemainingPercent: null,
    })
    const view = render(<CodexQuotaFooter {...props({ read })} />)

    expect(await screen.findByText(zh.resetAt.replace('{time}', formatCodexResetTime(0))))
      .toBeTruthy()
    expect(view.container.querySelector(`.${css.pool}`)?.textContent)
      .toBe('账号池 12 个账号 · 总剩余 —')
  })
})
