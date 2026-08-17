import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const directory = fileURLToPath(new URL('..', import.meta.url))

describe('dsh-codex_shared_pool project boundary', () => {
  it('exposes every Codex product surface through one public Loader row', () => {
    const manifest = JSON.parse(readFileSync(`${directory}/package.json`, 'utf8')) as {
      name: string
      dependencies: Record<string, string>
    }
    const patch = readFileSync(`${directory}/cordis.patch.yml`, 'utf8')
    const rows = [...patch.matchAll(/- id: ([^\n]+)\n\s+name: '([^']+)'/g)]
      .map(([, id, name]) => [id, name])

    expect(manifest.name).toBe('@deepseek-ai/dsh-codex_shared_pool')
    expect(manifest.dependencies).toMatchObject({
      '@deepseek-ai/dsh-host-codex-quota': 'workspace:^',
    })
    expect(manifest.dependencies).not.toHaveProperty('@deepseek-ai/dsh-client-ui-codex-quota')
    expect(rows).toEqual([
      ['codex-shared-pool', '@deepseek-ai/dsh-codex_shared_pool'],
    ])
    expect(patch).not.toMatch(/name: (?:'dsh-codex-profiles(?:\/tui)?'|'@deepseek-ai\/dsh-(?:host|client-ui)-codex-quota')/)
  })
})
