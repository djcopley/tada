import { readFileSync } from 'node:fs'
import { and, asc, eq, gt } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { TadaDb } from '../db/index.js'
import { agentRuns, comments, events, pushTokens, tickets } from '../db/schema.js'
import type { Scheduler } from '../runs/scheduler.js'
import type { RouteDeps } from './deps.js'

const pushTokenSchema = z.object({ token: z.string().min(1) })
const nudgeSchema = z.object({ note: z.string().min(1) })

function runIdParam(id: string): number | undefined {
  const n = Number(id)
  return Number.isInteger(n) ? n : undefined
}

/**
 * Cancels a run, handling the gap where `Scheduler.cancel` silently no-ops for a run that's
 * still 'queued' (never started, so untracked in the scheduler's in-memory `active` map): in
 * that case mark it cancelled directly (queued -> cancelled is a legal transition) and clear the
 * ticket's queue state. For a 'running' run, `scheduler.cancel` aborts the signal and the
 * in-flight `executeRun` handles the terminal state + card move itself.
 */
export function cancelRun(
  db: TadaDb,
  scheduler: Scheduler,
  runId: number,
  hub?: { boardChanged(workspaceId: number): void },
): void {
  scheduler.cancel(runId)
  const fresh = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, runId)).get()
  if (fresh && fresh.status === 'queued') {
    db.drizzle
      .update(agentRuns)
      .set({ status: 'cancelled', finishedAt: new Date() })
      .where(eq(agentRuns.id, runId))
      .run()
    db.drizzle.update(tickets).set({ queueState: null }).where(eq(tickets.id, fresh.ticketId)).run()
    // Nothing else broadcasts here (the run never reached the runner), so tell boards the card
    // is no longer queued.
    const ticket = db.drizzle.select().from(tickets).where(eq(tickets.id, fresh.ticketId)).get()
    if (ticket) hub?.boardChanged(ticket.workspaceId)
  }
}

export function registerRunRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, scheduler, hub } = deps

  app.get('/runs/:id', async (req, reply) => {
    const id = runIdParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })

    const row = db.drizzle
      .select({ run: agentRuns, ticketTitle: tickets.title, workspaceId: tickets.workspaceId })
      .from(agentRuns)
      .innerJoin(tickets, eq(agentRuns.ticketId, tickets.id))
      .where(eq(agentRuns.id, id))
      .get()
    if (!row) return reply.code(404).send({ error: 'run not found' })

    return { ...row.run, ticketTitle: row.ticketTitle, workspaceId: row.workspaceId }
  })

  app.get('/runs/:id/events', async (req, reply) => {
    const id = runIdParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })

    const run = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, id)).get()
    if (!run) return reply.code(404).send({ error: 'run not found' })

    const query = req.query as { after?: string }
    const after = query.after !== undefined ? Number(query.after) : undefined
    if (after !== undefined && !Number.isInteger(after)) {
      return reply.code(400).send({ error: 'invalid after' })
    }

    const conditions = [eq(events.runId, id)]
    if (after !== undefined) conditions.push(gt(events.id, after))

    return db.drizzle
      .select()
      .from(events)
      .where(and(...conditions))
      .orderBy(asc(events.id))
      .all()
  })

  app.get('/runs/:id/transcript', async (req, reply) => {
    const id = runIdParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })

    const run = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, id)).get()
    if (!run) return reply.code(404).send({ error: 'run not found' })
    if (!run.transcriptPath) return reply.code(404).send({ error: 'no transcript yet' })

    let raw: string
    try {
      raw = readFileSync(run.transcriptPath, 'utf-8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return reply.code(404).send({ error: 'no transcript yet' })
      }
      throw err
    }
    return reply.type('application/x-ndjson').send(raw)
  })

  app.post('/runs/:id/cancel', async (req, reply) => {
    const id = runIdParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })

    const run = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, id)).get()
    if (!run) return reply.code(404).send({ error: 'run not found' })

    cancelRun(db, scheduler, id, hub)
    return db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, id)).get()
  })

  // Mid-run steer: the note is always recorded on the ticket (so it shows up in the discussion
  // and in the next attempt's prompt), while `delivered` says whether the running agent got it
  // right now - false when the adapter can't be interrupted or the session already wrapped up.
  app.post('/runs/:id/nudge', async (req, reply) => {
    const id = runIdParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })

    const parsed = nudgeSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })

    const run = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, id)).get()
    if (run?.status !== 'running') return reply.code(404).send({ error: 'run not running' })

    db.drizzle
      .insert(comments)
      .values({ ticketId: run.ticketId, author: 'human', kind: 'nudge', body: parsed.data.note })
      .run()
    const ticket = db.drizzle.select().from(tickets).where(eq(tickets.id, run.ticketId)).get()
    if (ticket) hub.boardChanged(ticket.workspaceId)

    const delivered = scheduler.sessionFor(id)?.inject(parsed.data.note) ?? false
    return { delivered }
  })

  app.post('/push-tokens', async (req, reply) => {
    const parsed = pushTokenSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })

    db.drizzle.insert(pushTokens).values({ token: parsed.data.token }).onConflictDoNothing().run()
    return reply.code(201).send({ ok: true })
  })
}
