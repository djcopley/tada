/**
 * Static agent/model catalog for v1. The server has no discovery route for
 * this yet, so it's hand-mirrored here from the adapter registry built in
 * apps/server/src/index.ts (`adapters.set('claude', new ClaudeAdapter())`).
 * Keep the two in sync manually; the server is still the authority and
 * rejects unknown adapter/model combinations with a 400.
 */
export const ADAPTERS: Record<string, readonly string[]> = {
  claude: ['sonnet', 'opus', 'haiku'],
}
