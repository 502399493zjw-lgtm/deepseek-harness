import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-codex_shared_pool',
  ['lib/types/index.js', 'lib/types/invariant.js', 'lib/types/bin.js'],
  { hostPhase: true },
)
