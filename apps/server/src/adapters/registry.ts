import { ClaudeAdapter } from './claude.js'
import { CodexAdapter } from './codex.js'
import { FakeAdapter } from './fake.js'
import { GeminiAdapter } from './gemini.js'
import type { Adapter } from './types.js'

/**
 * Every adapter tada knows about, registered regardless of whether its CLI is installed here:
 * discovery reports `available: false` for the missing ones, and a run scheduled against one
 * fails with a journaled reason instead of vanishing from the UI.
 */
export function buildAdapterRegistry(env: NodeJS.ProcessEnv = process.env): Map<string, Adapter> {
  const adapters = new Map<string, Adapter>()
  for (const adapter of [new ClaudeAdapter(), new CodexAdapter(), new GeminiAdapter()]) {
    adapters.set(adapter.id, adapter)
  }
  if (env.TADA_FAKE_ADAPTER === '1') {
    const fake = new FakeAdapter()
    adapters.set(fake.id, fake)
  }
  return adapters
}
