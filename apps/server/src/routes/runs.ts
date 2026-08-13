import { readFileSync } from 'node:fs'
import { and, asc, eq, gt } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { TadaDb } from '../db/index.js'
import { agentRuns, events, pushTokens, tickets } from '../db/schema.js'
import type { Scheduler } from '../runs/scheduler.js'
import type { RouteDeps } from './deps.js'

const pushTokenSchema = z.object({ token: z.string().min(1) })

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
export function cancelRun(db: TadaDb, scheduler: Scheduler, runId: number): void {
  scheduler.cancel(runId)
  const fresh = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, runId)).get()
  if (fresh && fresh.status === 'queued') {
    db.drizzle
      .update(agentRuns)
      .set({ status: 'cancelled', finishedAt: new Date() })
      .where(eq(agentRuns.id, runId))
      .run()
    db.drizzle.update(tickets).set({ queueState: null }).where(eq(tickets.id, fresh.ticketId)).run()
  }
}

export function registerRunRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, scheduler } = deps

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

    const raw = readFileSync(run.transcriptPath, 'utf-8')
    return reply.type('application/x-ndjson').send(raw)
  })

  app.post('/runs/:id/cancel', async (req, reply) => {
    const id = runIdParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })

    const run = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, id)).get()
    if (!run) return reply.code(404).send({ error: 'run not found' })

    cancelRun(db, scheduler, id)
    return db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, id)).get()
  })

  app.post('/push-tokens', async (req, reply) => {
    const parsed = pushTokenSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })

    db.drizzle.insert(pushTokens).values({ token: parsed.data.token }).onConflictDoNothing().run()
    return reply.code(201).send({ ok: true })
  })
}
