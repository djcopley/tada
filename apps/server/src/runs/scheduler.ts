import { randomBytes } from 'node:crypto'
import { canTransitionRun } from '@tada/shared'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { agentRuns, settings, tickets } from '../db/schema.js'
import { executeRun, type LiveRun, type RunnerDeps } from './runner.js'

interface ActiveEntry {
  controller: AbortController
  /** Set once the adapter actually starts; absent while the run dir is still being built. */
  live?: LiveRun
}

/**
 * Single-process, in-memory scheduler: bookkeeping of active runs lives in `active`, everything
 * else (queue state, ordering) is read fresh from the db on every tick. No timers — every run
 * completion re-ticks via `.finally`, and `enqueue`/`cancel`/hold changes re-tick synchronously.
 *
 * Concurrency counts only runs whose status is `running`. A held run keeps its entry here (its
 * process is alive, waiting) but does not occupy a slot — that is what lets the overnight queue
 * keep moving past a gate. Resuming a held run never waits for a slot: it may briefly push the
 * running count over the cap, and new starts simply wait until it is back under. That is the
 * whole of "an approved run resumes at the front".
 */
export class Scheduler {
  private readonly active = new Map<number, ActiveEntry>()

  constructor(private readonly deps: RunnerDeps) {}

  /** Called on boot. Runs that were `running` or `held` belong to a process that no longer
   * exists — they fail (the card lands in stopped, with re-run on offer). Runs still `queued`
   * are left alone: the queue survives a restart. */
  recover(): void {
    const { db } = this.deps
    const orphaned = db.drizzle
      .select()
      .from(agentRuns)
      .where(inArray(agentRuns.status, ['running', 'held']))
      .all()

    for (const run of orphaned) {
      if (!canTransitionRun(run.status, 'failed')) {
        throw new Error(`illegal recovery transition: ${run.status} -> failed`)
      }
      db.drizzle
        .update(agentRuns)
        .set({
          status: 'failed',
          finishedAt: new Date(),
          hold: null,
          heldReason: null,
          summary: run.summary ?? 'the server restarted while this run was live',
        })
        .where(eq(agentRuns.id, run.id))
        .run()
      db.drizzle
        .update(tickets)
        .set({ column: 'stopped' })
        .where(eq(tickets.id, run.ticketId))
        .run()
    }
    this.tick()
  }

  /** Create an AgentRun (status 'queued') for the ticket — resolving adapter/model/effort and the
   * time budget from settings, with the ticket's own adapter/model overriding the global ones
   * when set — then kick the loop. The caller has already put the card in the queued column. */
  enqueue(ticketId: number): number {
    const { db } = this.deps
    const ticket = db.drizzle.select().from(tickets).where(eq(tickets.id, ticketId)).get()
    if (!ticket) throw new Error(`ticket ${ticketId} not found`)

    const prefs = db.drizzle.select().from(settings).get()
    if (!prefs) throw new Error('settings row missing')

    const adapter = ticket.adapter ?? prefs.adapter
    const model = ticket.model ?? prefs.model
    if (!this.deps.adapters.has(adapter)) throw new Error(`unknown adapter: ${adapter}`)

    const priorRunCount = db.drizzle
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(eq(agentRuns.ticketId, ticketId))
      .all().length

    const [run] = db.drizzle
      .insert(agentRuns)
      .values({
        ticketId,
        adapter,
        model,
        effort: prefs.effort,
        attemptNumber: priorRunCount + 1,
        status: 'queued',
        budgetMs: prefs.timeoutMs,
        runToken: randomBytes(24).toString('hex'),
      })
      .returning()
      .all()
    if (!run) throw new Error('failed to insert agent run')

    this.tick()
    return run.id
  }

  /** How many runs are actually working right now (held runs don't count). */
  runningCount(): number {
    if (this.active.size === 0) return 0
    return this.deps.db.drizzle
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(and(inArray(agentRuns.id, [...this.active.keys()]), eq(agentRuns.status, 'running')))
      .all().length
  }

  /** While running runs < concurrency, start the lowest-position queued run. */
  tick(): void {
    const { db } = this.deps
    const prefs = db.drizzle.select().from(settings).get()
    if (!prefs) return

    let capacity = prefs.concurrency - this.runningCount()
    if (capacity <= 0) return

    const candidates = db.drizzle
      .select({ run: agentRuns, ticket: tickets })
      .from(agentRuns)
      .innerJoin(tickets, eq(agentRuns.ticketId, tickets.id))
      .where(
        and(
          eq(tickets.column, 'queued'),
          eq(agentRuns.status, 'queued'),
          isNull(tickets.proposalState),
        ),
      )
      .orderBy(asc(tickets.position), asc(agentRuns.id))
      .all()
      .filter((row) => !this.active.has(row.run.id))

    for (const { run } of candidates) {
      if (capacity <= 0) break
      this.start(run.id)
      capacity--
    }
  }

  /** Abort signal -> executeRun marks the run 'cancelled' and parks the card in backlog. */
  cancel(runId: number): void {
    this.active.get(runId)?.controller.abort()
  }

  /** The control surface for a run in flight here. Undefined for runs that are queued, finished,
   * or (after a restart) were started by a previous process. */
  liveRun(runId: number): LiveRun | undefined {
    return this.active.get(runId)?.live
  }

  private start(runId: number): void {
    const controller = new AbortController()
    const entry: ActiveEntry = { controller }
    this.active.set(runId, entry)
    executeRun({ ...this.deps, onHeld: () => this.tick() }, runId, controller.signal, (live) => {
      entry.live = live
    })
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
