import type { ApiRun, ApiTicket, Hold } from '@tada/shared'
import { desc, eq } from 'drizzle-orm'
import type { TadaDb } from '../db/index.js'
import { agentRuns, type tickets } from '../db/schema.js'

type RunRow = typeof agentRuns.$inferSelect
type TicketRow = typeof tickets.$inferSelect

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null)

/**
 * The run as the API shows it: without the per-run MCP bearer (`runToken`, which lets whoever
 * holds it act as that run's agent) and the server-local transcript path. Every route that
 * returns a run row goes through here.
 */
export function publicRun(row: RunRow): ApiRun {
  return {
    id: row.id,
    ticketId: row.ticketId,
    adapter: row.adapter,
    model: row.model,
    effort: row.effort,
    attemptNumber: row.attemptNumber,
    status: row.status,
    heldReason: row.heldReason,
    hold: (row.hold as Hold | null) ?? null,
    heldAt: iso(row.heldAt),
    budgetMs: row.budgetMs,
    summary: row.summary,
    diffAdditions: row.diffAdditions,
    diffDeletions: row.diffDeletions,
    testsPassed: row.testsPassed,
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
    createdAt: row.createdAt.toISOString(),
  }
}

export function latestRun(db: TadaDb, ticketId: number): RunRow | undefined {
  return db.drizzle
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.ticketId, ticketId))
    .orderBy(desc(agentRuns.id))
    .limit(1)
    .get()
}

export function publicTicket(db: TadaDb, row: TicketRow): ApiTicket {
  const run = latestRun(db, row.id)
  return {
    id: row.id,
    column: row.column,
    title: row.title,
    description: row.description,
    position: row.position,
    repoTags: row.repoTags,
    origin: row.origin,
    adapter: row.adapter,
    model: row.model,
    proposalState: row.proposalState,
    followUpOfTicketId: row.followUpOfTicketId,
    createdAt: row.createdAt.toISOString(),
    doneAt: iso(row.doneAt),
    run: run ? publicRun(run) : null,
  }
}
