// Web e2e scenarios: the public Codex bundle settles a cancelled ChatGPT
// authorization and confirms one stored account as the global quota priority.
// The real Web composition loads the optional bundle; only the external OAuth
// site and its nondeterministic challenge routes are replaced. No model call
// or developer credential is involved.
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, BrowserContext, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { REPO_ROOT, ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

const OVERLAY = fileURLToPath(new URL('./codex-account-auth.overlay.yml', import.meta.url))
const INSTALL_ANCHOR = join(REPO_ROOT, 'packages/bundle/dsh-codex_shared_pool/package.json')
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/codex-account-auth', import.meta.url))
const CANCELLED_EXPECTED = join(SNAPSHOT_DIR, 'cancelled.expected.md')
const GLOBAL_PRIORITY_EXPECTED = join(SNAPSHOT_DIR, 'global-priority.expected.md')
const MODE = webSnapshotMode()

const personalProfile = {
  id: 'personal',
  label: '个人账号',
  createdAt: 1,
  updatedAt: 1,
  usage: {
    rateLimits: [{
      id: 'codex',
      name: 'Codex',
      windows: [{ remainingPercent: 29, windowSeconds: 604_800 }],
    }],
  },
}

const workProfile = {
  id: 'work',
  label: '工作账号',
  createdAt: 2,
  updatedAt: 2,
  usage: {
    rateLimits: [{
      id: 'codex',
      name: 'Codex',
      windows: [{ remainingPercent: 100, windowSeconds: 604_800 }],
    }],
  },
}

describe('web e2e: Codex authorization cancellation', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let context: BrowserContext
  let page: Page
  let cancelRequests = 0
  let priorityRequests = 0
  let accountFixture = false
  let priorityProfileId = personalProfile.id
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      extraOverlayPath: OVERLAY,
      extraInstallAnchor: INSTALL_ANCHOR,
    })
    browser = await chromium.launch()
    context = await browser.newContext({
      viewport: { width: 1680, height: 1000 },
      locale: ZH_BROWSER_LOCALE,
    })
    await context.route('https://auth.openai.test/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>Authorization</title>',
      })
    })
    await context.route('**/plugins/dsh-openai-codex/profiles**', async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      if (path.endsWith('/profiles/login/cancel') && request.method() === 'POST') {
        cancelRequests += 1
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cancelled: true }) })
        return
      }
      if (path.endsWith('/profiles/login') && request.method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ url: 'https://auth.openai.test/authorize' }),
        })
        return
      }
      if (path.endsWith('/profiles/priority') && request.method() === 'POST') {
        const body: unknown = request.postDataJSON()
        if (
          typeof body !== 'object'
          || body === null
          || !('profileId' in body)
          || body.profileId !== personalProfile.id && body.profileId !== workProfile.id
        ) {
          await route.abort('failed')
          return
        }
        priorityRequests += 1
        priorityProfileId = body.profileId
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
        return
      }
      if (path.endsWith('/profiles') && request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'ready',
            profiles: accountFixture
              ? priorityProfileId === workProfile.id ? [workProfile, personalProfile] : [personalProfile, workProfile]
              : [],
          }),
        })
        return
      }
      await route.abort('failed')
    })
    page = await context.newPage()
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('cancels when the authorization popup closes', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-codex-auth-cancel'))
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.getByRole('button', { name: 'OpenAI Codex', exact: true }).click()
    await dialog.getByRole('heading', { name: 'ChatGPT 账号' }).waitFor({ timeout: 10_000 })

    const popupPromise = page.waitForEvent('popup')
    const addAccount = dialog.getByRole('button', { name: '添加账号' })
    await addAccount.click()
    await dialog.getByText('正在等待浏览器授权…', { exact: true }).waitFor({ timeout: 10_000 })
    const popup = await popupPromise
    await popup.waitForURL('https://auth.openai.test/authorize', { timeout: 10_000 })
    await popup.close()

    await dialog.getByText('授权窗口已关闭，未添加账号。你可以重新尝试。', { exact: true })
      .waitFor({ timeout: 10_000 })
    await expect.poll(() => cancelRequests, { timeout: 5_000 }).toBe(1)
    await expect.poll(() => addAccount.isEnabled(), { timeout: 5_000 }).toBe(true)
    const snapshot = await captureStableAria(page, '.dsh-codex-settings', scaffold.workspaceCwd)
    await compareOrRefreshGolden(CANCELLED_EXPECTED, snapshot, MODE)
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('confirms one account as the global quota allocation priority', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-codex-global-priority'))
    accountFixture = true
    priorityProfileId = personalProfile.id
    priorityRequests = 0
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.getByRole('button', { name: 'OpenAI Codex', exact: true }).click()
    await dialog.getByRole('heading', { name: 'ChatGPT 账号' }).waitFor({ timeout: 10_000 })

    const useFirst = dialog.getByRole('button', { name: '优先使用', exact: true })
    await useFirst.click()
    await expect.poll(() => priorityRequests, { timeout: 5_000 }).toBe(1)
    await dialog.getByRole('button', { name: '优先使用', exact: true }).click()
    await expect.poll(() => priorityRequests, { timeout: 5_000 }).toBe(2)

    await dialog.getByRole('button', { name: '工作账号', exact: true }).click()
    expect(priorityRequests).toBe(2)
    await dialog.getByRole('button', { name: '优先使用', exact: true }).click()

    await expect.poll(() => priorityRequests, { timeout: 5_000 }).toBe(3)
    await dialog.getByRole('button', { name: '优先使用', exact: true }).waitFor({ timeout: 10_000 })
    expect(await dialog.getByText('自动分配额度', { exact: true }).count()).toBe(0)
    const priorityBadge = dialog.getByRole('button', { name: /^工作账号/ }).getByText('优先', { exact: true })
    await priorityBadge.waitFor({ timeout: 10_000 })
    const snapshot = await captureStableAria(page, '.dsh-codex-settings', scaffold.workspaceCwd)
    await compareOrRefreshGolden(GLOBAL_PRIORITY_EXPECTED, snapshot, MODE)
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('keeps the fixture inventory exact', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['cancelled.expected.md', 'global-priority.expected.md'])
  })
})
