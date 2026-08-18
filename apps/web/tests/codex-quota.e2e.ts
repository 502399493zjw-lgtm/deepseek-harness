// Keyless assembled-browser coverage for the Codex quota sidebar plugin. The
// real Web bundle talks to a deterministic local app-server subprocess, so the
// test covers Host protocol projection, Remote transport, slot placement, and
// final styling without touching the developer's Codex account.
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { saveFailureShot, ZH_BROWSER_LOCALE } from './support.ts'

const MODE = webSnapshotMode()
const FIXTURE = fileURLToPath(new URL('./fixtures/codex-quota-app-server.mjs', import.meta.url))
const INSTALL_ANCHOR = fileURLToPath(new URL(
  '../../../packages/bundle/dsh-codex_shared_pool/package.json',
  import.meta.url,
))

describe.skipIf(MODE === 'record')('web e2e: Codex quota sidebar plugin', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let overlayRoot: string
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    overlayRoot = await mkdtemp(join(tmpdir(), 'dsh-codex-quota-e2e-'))
    const overlay = join(overlayRoot, 'codex-quota.overlay.yml')
    await chmod(FIXTURE, 0o755)
    await writeFile(overlay, [
      '- insert:',
      '    - id: codex-shared-pool',
      "      name: '@deepseek-ai/dsh-codex_shared_pool'",
      '      config:',
      '        quota:',
      '          accountHomes:',
      '            - ./codex-active',
      '            - ./codex-secondary',
      '          refreshIntervalMs: 60000',
      '          requestTimeoutMs: 5000',
      '          disposeGraceMs: 100',
      `          codexCommand: ${JSON.stringify(FIXTURE)}`,
      '',
    ].join('\n'))
    scaffold = await launchWebScaffold({
      extraOverlayPath: overlay,
      extraInstallAnchor: INSTALL_ANCHOR,
    })
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      locale: ZH_BROWSER_LOCALE,
    })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    await rm(overlayRoot, { recursive: true, force: true })
  })

  it('shows compact quota rows above Settings', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-codex-quota-sidebar'))
    const quota = page.getByRole('region', { name: 'Codex 额度' })
    await quota.waitFor({ timeout: 15_000 })
    const rows = quota.locator(':scope > div')
    await expect.poll(async () => rows.count(), { timeout: 10_000 }).toBe(3)
    await expect.poll(async () => rows.nth(0).textContent(), { timeout: 10_000 })
      .toBe('Codex 账号：codex42@example.com')
    expect(await rows.nth(1).textContent()).toBe('剩余 73% · 重置时间未知')
    expect(await rows.nth(2).textContent()).toBe('账号池 2 个账号 · 总剩余 61%')

    const quotaValues = quota.getByText(/^(73|61)%$/)
    expect(await quotaValues.allTextContents()).toEqual(['73%', '61%'])
    const colors = await quota.evaluate((root) => {
      const [account, current, pool] = [...root.querySelectorAll(':scope > div')]
      const values = [...root.querySelectorAll('span')]
        .filter(node => /^(73|61)%$/.test(node.textContent ?? ''))
      return {
        fontSize: getComputedStyle(root).fontSize,
        rowGap: getComputedStyle(root).rowGap,
        accountFontSize: account === undefined ? '' : getComputedStyle(account).fontSize,
        currentFontSize: current === undefined ? '' : getComputedStyle(current).fontSize,
        leftInset: current === undefined
          ? Number.NaN
          : current.getBoundingClientRect().left - root.getBoundingClientRect().left,
        current: current === undefined ? '' : getComputedStyle(current).color,
        pool: pool === undefined ? '' : getComputedStyle(pool).color,
        separatorMargins: [...root.querySelectorAll('span')]
          .filter(node => node.textContent?.trim() === '·')
          .map(node => [getComputedStyle(node).marginLeft, getComputedStyle(node).marginRight]),
        quotas: values.map(node => getComputedStyle(node).color),
      }
    })
    expect(colors.fontSize).toBe('14px')
    expect(colors.rowGap).toBe('2px')
    expect(colors.accountFontSize).toBe('13px')
    expect(colors.currentFontSize).toBe('13px')
    expect(colors.leftInset).toBe(0)
    expect(colors.separatorMargins).toEqual([
      ['3px', '3px'],
      ['3px', '3px'],
    ])
    expect(colors.pool).not.toBe(colors.current)
    expect(colors.quotas).toHaveLength(2)
    expect(colors.quotas[0]).not.toBe(colors.current)
    expect(colors.quotas[0]).not.toBe(colors.pool)
    expect(colors.quotas[1]).toBe(colors.pool)

    const open = quota.getByRole('button', { name: '打开' })
    expect(await open.textContent()).toBe('')
    expect(await open.locator('svg').count()).toBe(1)
    const [currentBox, openBox] = await Promise.all([
      rows.nth(1).locator(':scope > div').first().boundingBox(),
      open.boundingBox(),
    ])
    expect(currentBox).not.toBeNull()
    expect(openBox).not.toBeNull()
    expect(currentBox!.x + currentBox!.width).toBeLessThanOrEqual(openBox!.x)

    const settings = page.getByRole('button', { name: '设置', exact: true })
    await settings.waitFor({ timeout: 10_000 })
    const [quotaBox, settingsBox] = await Promise.all([quota.boundingBox(), settings.boundingBox()])
    expect(quotaBox).not.toBeNull()
    expect(settingsBox).not.toBeNull()
    expect(quotaBox!.y + quotaBox!.height).toBeLessThanOrEqual(settingsBox!.y)

    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
