// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAICodexSettings } from '../src/client/OpenAICodexSettings.tsx'
import { en, type OpenAICodexSettingsKey } from '../src/client/locales.ts'
import { resetResponsePreferencesForTests } from '../src/client/response-preferences.ts'

afterEach(() => {
  cleanup()
  resetResponsePreferencesForTests()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function response(value: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(value),
  } as Response
}

function errorResponse(error: string): Response {
  return {
    ok: false,
    status: 503,
    json: () => Promise.resolve({ error }),
  } as Response
}

const t = (key: OpenAICodexSettingsKey, params?: Record<string, unknown>): string => {
  let value: string = en[key]
  for (const [name, replacement] of Object.entries(params ?? {})) {
    value = value.replace(`{${name}}`, String(replacement))
  }
  return value
}

const personalProfile = {
  id: 'profile-personal',
  label: 'Personal',
  createdAt: 1,
  updatedAt: 1,
  usage: { rateLimits: [] },
}

const workProfile = {
  id: 'profile-work',
  label: 'Work',
  createdAt: 2,
  updatedAt: 2,
  usage: { rateLimits: [] },
}

function readyProfiles(priorityProfileId: string) {
  return {
    status: 'ready',
    profiles: priorityProfileId === workProfile.id
      ? [workProfile, personalProfile]
      : [personalProfile, workProfile],
  }
}

function settingsResponse(path: string): Response | undefined {
  if (path.endsWith('/image-tools')) {
    return response({ modifyReadImage: false, shareImagegenWithOtherModels: false })
  }
  if (path.endsWith('/response-api')) {
    return response({ useFastMode: false, useWebSocketContextReuse: false, useNativeCompaction: false })
  }
  if (path.endsWith('/network')) {
    return response({ enabled: false, httpProxy: false, httpsProxy: false, noProxy: false })
  }
  return undefined
}

describe('OpenAI Codex global account priority', () => {
  it('reasserts the current priority and changes it only after explicit confirmation and refresh', async () => {
    let priorityProfileId = personalProfile.id
    const priorityBodies: Array<BodyInit | null | undefined> = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const preferenceResponse = settingsResponse(path)
      if (preferenceResponse !== undefined) return preferenceResponse
      if (path.endsWith('/profiles/priority')) {
        priorityBodies.push(init?.body)
        const body = JSON.parse(String(init?.body)) as { profileId: string }
        priorityProfileId = body.profileId
        return response({ ok: true })
      }
      if (path.endsWith('/profiles')) return response(readyProfiles(priorityProfileId))
      throw new Error(`unexpected request: ${init?.method ?? 'GET'} ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<OpenAICodexSettings t={t} />)
    const useFirst = await screen.findByRole('button', { name: 'Use first' })
    expect(within(screen.getByRole('button', { name: /^Personal/ })).getByText('Priority')).toBeTruthy()
    expect(screen.queryByText('Automatic quota allocation')).toBeNull()
    expect(screen.queryByText(/^Before each Codex model request/)).toBeNull()

    fireEvent.click(useFirst)
    await waitFor(() => {
      expect(priorityBodies).toEqual([JSON.stringify({ profileId: 'profile-personal' })])
    })
    fireEvent.click(screen.getByRole('button', { name: 'Use first' }))
    await waitFor(() => {
      expect(priorityBodies).toEqual([
        JSON.stringify({ profileId: 'profile-personal' }),
        JSON.stringify({ profileId: 'profile-personal' }),
      ])
    })

    fireEvent.click(screen.getByRole('button', { name: 'Work' }))

    expect(priorityBodies).toHaveLength(2)
    const confirm = screen.getByRole('button', { name: 'Use first' })
    expect(within(screen.getByRole('button', { name: /^Personal/ })).getByText(en.priorityProfile)).toBeTruthy()

    fireEvent.click(confirm)

    await waitFor(() => {
      expect(priorityBodies).toEqual([
        JSON.stringify({ profileId: 'profile-personal' }),
        JSON.stringify({ profileId: 'profile-personal' }),
        JSON.stringify({ profileId: 'profile-work' }),
      ])
      expect(within(screen.getByRole('button', { name: /^Work/ })).getByText(en.priorityProfile)).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: 'Use first' })).toBeTruthy()
  }, 10_000)

  it('keeps the previous priority and permits retry after an update fails', async () => {
    let workHasPriority = false
    let priorityAttempts = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const preferenceResponse = settingsResponse(path)
      if (preferenceResponse !== undefined) return preferenceResponse
      if (path.endsWith('/profiles/priority')) {
        priorityAttempts += 1
        if (priorityAttempts === 1) return errorResponse('temporary failure')
        workHasPriority = true
        return response({ ok: true })
      }
      if (path.endsWith('/profiles')) return response(readyProfiles(workHasPriority ? workProfile.id : personalProfile.id))
      throw new Error(`unexpected request: ${init?.method ?? 'GET'} ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<OpenAICodexSettings t={t} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Work' }))

    fireEvent.click(screen.getByRole('button', { name: 'Use first' }))

    expect((await screen.findByRole('alert')).textContent).toBe(en.profilePriorityFailed)
    expect(within(screen.getByRole('button', { name: /^Personal/ })).getByText(en.priorityProfile)).toBeTruthy()
    expect(within(screen.getByRole('button', { name: /^Work/ })).queryByText(en.priorityProfile)).toBeNull()
    const retry = screen.getByRole('button', { name: 'Use first' })
    expect(retry).toHaveProperty('disabled', false)

    fireEvent.click(retry)

    await waitFor(() => {
      expect(priorityAttempts).toBe(2)
      expect(within(screen.getByRole('button', { name: /^Work/ })).getByText(en.priorityProfile)).toBeTruthy()
      expect(screen.queryByRole('alert')).toBeNull()
    })
  }, 10_000)
})
