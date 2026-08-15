import { randomBytes } from 'node:crypto'
import { canTransitionRun } from '@tada/shared'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import type { TadaDb } from '../db/index.js'
import { agentRuns, columns, tickets, workspaces } from '../db/schema.js'
import { executeRun, type RunnerDeps } from './runner.js'

interface ActiveEntry {
  controller: AbortController
  workspaceId: number
}

function readyColumnFor(db: TadaDb, workspaceId: number) {
  return db.drizzle
    .select()
    .from(columns)
    .where(and(eq(columns.workspaceId, workspaceId), eq(columns.kind, 'ready')))
    .get()
}

/**
 * Single-process, in-memory scheduler: bookkeeping of active runs lives in `active`, everything
 * else (queue state, ordering) is read fresh from the db on every tick. No timers — every run
 * completion re-ticks via `.finally`, and `enqueue`/`cancel` re-tick synchronously.
 */
export class Scheduler {
  private readonly active = new Map<number, ActiveEntry>()

  constructor(private readonly deps: RunnerDeps) {}

  /** Called on boot: any run stuck in 'queued'/'running' -> terminal, card back to ready (held). */
  recover(): void {
    const { db } = this.deps
    const stuck = db.drizzle
      .select()
      .from(agentRuns)
      .where(inArray(agentRuns.status, ['queued', 'running']))
      .all()

    for (const run of stuck) {
      // 'queued' has no legal 'failed' transition in the state machine; route it through
      // 'cancelled' instead. 'running' -> 'failed' is legal and matches "the process died".
      const toStatus = run.status === 'queued' ? 'cancelled' : 'failed'
      if (!canTransitionRun(run.status, toStatus)) {
        throw new Error(`illegal recovery transition: ${run.status} -> ${toStatus}`)
      }

      db.drizzle
        .update(agentRuns)
        .set({ status: toStatus, finishedAt: new Date() })
        .where(eq(agentRuns.id, run.id))
        .run()

      const ticket = db.drizzle.select().from(tickets).where(eq(tickets.id, run.ticketId)).get()
      if (!ticket) continue
      const readyCol = readyColumnFor(db, ticket.workspaceId)
      if (!readyCol) continue

      db.drizzle
        .update(tickets)
        .set({ columnId: readyCol.id, queueState: 'held' })
        .where(eq(tickets.id, ticket.id))
        .run()
    }
  }

  /** Create an AgentRun (status 'queued') and mark the ticket queued, then kick the loop. */
  enqueue(ticketId: number, opts?: { adapter?: string; model?: string; effort?: string }): number {
    const { db } = this.deps
    const ticket = db.drizzle.select().from(tickets).where(eq(tickets.id, ticketId)).get()
    if (!ticket) throw new Error(`ticket ${ticketId} not found`)

    const workspace = db.drizzle
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, ticket.workspaceId))
      .get()
    if (!workspace) throw new Error(`workspace ${ticket.workspaceId} not found`)

    const adapter = opts?.adapter ?? ticket.adapterOverride ?? workspace.defaultAdapter
    const model = opts?.model ?? ticket.modelOverride ?? workspace.defaultModel
    const effort = opts?.effort ?? ticket.effortOverride ?? workspace.defaultEffort

    if (!this.deps.adapters.has(adapter)) {
      throw new Error(`unknown adapter: ${adapter}`)
    }

    const priorRunCount = db.drizzle
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.ticketId, ticketId))
      .all().length

    const runToken = randomBytes(24).toString('hex')
    const [run] = db.drizzle
      .insert(agentRuns)
      .values({
        ticketId,
        adapter,
        model,
        effort,
        attemptNumber: priorRunCount + 1,
        status: 'queued',
        runToken,
      })
      .returning()
      .all()
    if (!run) throw new Error('failed to insert agent run')

    db.drizzle.update(tickets).set({ queueState: 'queued' }).where(eq(tickets.id, ticketId)).run()

    this.tick()
    return run.id
  }

  /** For each workspace, while active runs < concurrency, start the lowest-position queued run. */
  tick(): void {
    const { db } = this.deps
    const allWorkspaces = db.drizzle.select().from(workspaces).all()

    for (const ws of allWorkspaces) {
      let capacity =
        ws.concurrency - [...this.active.values()].filter((e) => e.workspaceId === ws.id).length
      if (capacity <= 0) continue

      const readyCol = readyColumnFor(db, ws.id)
      if (!readyCol) continue

      const candidates = db.drizzle
        .select({ run: agentRuns, ticket: tickets })
        .from(agentRuns)
        .innerJoin(tickets, eq(agentRuns.ticketId, tickets.id))
        .where(
          and(
            eq(tickets.workspaceId, ws.id),
            eq(tickets.columnId, readyCol.id),
            eq(tickets.queueState, 'queued'),
            eq(agentRuns.status, 'queued'),
            isNull(tickets.proposalState),
          ),
        )
        .orderBy(asc(tickets.position))
        .all()
        .filter((row) => !this.active.has(row.run.id))

      for (const { run } of candidates) {
        if (capacity <= 0) break
        this.start(run.id, ws.id)
        capacity--
      }
    }
  }

  /** Abort signal -> executeRun marks the run 'cancelled' and unholds the card. */
  cancel(runId: number): void {
    this.active.get(runId)?.controller.abort()
  }

  private start(runId: number, workspaceId: number): void {
    const controller = new AbortController()
    this.active.set(runId, { controller, workspaceId })
    executeRun(this.deps, runId, controller.signal)
      .catch(() => {
        // executeRun routes every failure through markFailed/markCancelled internally; this is
        // just a safety net against an unhandled rejection killing the process.
      })
      .finally(() => {
        this.active.delete(runId)
        this.tick()
      })
  }
}
