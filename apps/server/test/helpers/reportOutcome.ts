import { eq } from 'drizzle-orm'
import type { TadaDb } from '../../src/db/index.js'
import { agentRuns, events } from '../../src/db/schema.js'

/**
 * Mirrors the MCP `report_outcome` tool (src/mcp/server.ts) without spinning up a live MCP
 * endpoint: inserts the outcome event `executeRun` reads via `pendingOutcome`, and stores the
 * summary on the run row the same way the real tool does.
 */
export function reportOutcome(
  db: TadaDb,
  runId: number,
  _ticketId: number,
  status: 'success' | 'failed',
  summary: string,
): void {
  db.drizzle.update(agentRuns).set({ summary }).where(eq(agentRuns.id, runId)).run()
  db.drizzle
    .insert(events)
    .values({ runId, type: 'status', payload: { kind: 'outcome', status, summary } })
    .run()
}
