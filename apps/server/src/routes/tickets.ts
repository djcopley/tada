import { join } from 'node:path'
import type { ColumnKind } from '@tada/shared'
import { canMoveCard } from '@tada/shared'
import { asc, desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { agentRuns, columns, comments, tickets, workspaces } from '../db/schema.js'
import { stateDir } from '../paths.js'
import { cleanupRunDir } from '../runs/runDir.js'
import type { RouteDeps } from './deps.js'
import { cancelRun } from './runs.js'

const createTicketSchema = z.object({
  workspaceId: z.number().int(),
  title: z.string().min(1),
  description: z.string().default(''),
})

const patchTicketSchema = z
  .object({
    title: z.string().min(1),
    description: z.string(),
    position: z.number(),
    adapterOverride: z.string().nullable(),
    modelOverride: z.string().nullable(),
  })
  .partial()

const moveTicketSchema = z.object({
  columnId: z.number().int(),
  position: z.number(),
})

const commentSchema = z.object({ body: z.string().min(1) })

const CONTENT_FIELDS = ['title', 'description', 'adapterOverride', 'modelOverride'] as const

function idParam(id: string): number | undefined {
  const n = Number(id)
  return Number.isInteger(n) ? n : undefined
}

function ticketOr404(deps: RouteDeps, id: number) {
  return deps.db.drizzle.select().from(tickets).where(eq(tickets.id, id)).get()
}

function columnById(deps: RouteDeps, id: number) {
  return deps.db.drizzle.select().from(columns).where(eq(columns.id, id)).get()
}

export function registerTicketRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, scheduler, wm, hub, adapters } = deps

  app.post('/tickets', async (req, reply) => {
    const parsed = createTicketSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })

    const { workspaceId, title, description } = parsed.data
    const ws = db.drizzle.select().from(workspaces).where(eq(workspaces.id, workspaceId)).get()
    if (!ws) return reply.code(400).send({ error: 'workspace not found' })

    const backlog = db.drizzle
      .select()
      .from(columns)
      .where(eq(columns.workspaceId, workspaceId))
      .all()
      .find((c) => c.kind === 'backlog')
    if (!backlog) return reply.code(400).send({ error: 'workspace has no backlog column' })

    const last = db.drizzle
      .select()
      .from(tickets)
      .where(eq(tickets.columnId, backlog.id))
      .orderBy(desc(tickets.position))
      .limit(1)
      .get()

    const [ticket] = db.drizzle
      .insert(tickets)
      .values({
        workspaceId,
        columnId: backlog.id,
        title,
        description,
        position: (last?.position ?? 0) + 1,
      })
      .returning()
      .all()

    return reply.code(201).send(ticket)
  })

  app.get('/tickets/:id', async (req, reply) => {
    const id = idParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })

    const ticket = ticketOr404(deps, id)
    if (!ticket) return reply.code(404).send({ error: 'ticket not found' })

    const ticketComments = db.drizzle
      .select()
      .from(comments)
      .where(eq(comments.ticketId, id))
      .orderBy(asc(comments.createdAt), asc(comments.id))
      .all()
    const runs = db.drizzle
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.ticketId, id))
      .orderBy(asc(agentRuns.id))
      .all()

    return { ...ticket, comments: ticketComments, runs }
  })

  app.patch('/tickets/:id', async (req, reply) => {
    const id = idParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })

    const ticket = ticketOr404(deps, id)
    if (!ticket) return reply.code(404).send({ error: 'ticket not found' })

    const parsed = patchTicketSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })

    if (parsed.data.adapterOverride != null && !adapters.has(parsed.data.adapterOverride)) {
      return reply.code(400).send({
        error: `unknown adapter: ${parsed.data.adapterOverride}. valid adapters: ${[...adapters.keys()].join(', ')}`,
      })
    }

    if (parsed.data.modelOverride != null) {
      const adapterName =
        parsed.data.adapterOverride !== undefined
          ? parsed.data.adapterOverride
          : ticket.adapterOverride
      const adapter = adapterName != null ? adapters.get(adapterName) : undefined
      if (adapterName != null && !adapter?.models.includes(parsed.data.modelOverride)) {
        return reply.code(400).send({
          error: `unknown model: ${parsed.data.modelOverride} for adapter ${adapterName}. valid models: ${adapter?.models.join(', ') ?? 'none (unknown adapter)'}`,
        })
      }
    }

    const editsContent = Object.keys(parsed.data).some((k) =>
      (CONTENT_FIELDS as readonly string[]).includes(k),
    )
    if (editsContent) {
      const activeRun = db.drizzle
        .select()
        .from(agentRuns)
        .where(eq(agentRuns.ticketId, id))
        .all()
        .find((r) => r.status === 'queued' || r.status === 'running')
      if (activeRun) return reply.code(409).send({ error: 'ticket has an active run' })
    }

    db.drizzle.update(tickets).set(parsed.data).where(eq(tickets.id, id)).run()
    hub.boardChanged(ticket.workspaceId)
    return ticketOr404(deps, id)
  })

  app.post('/tickets/:id/move', async (req, reply) => {
    const id = idParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })

    const ticket = ticketOr404(deps, id)
    if (!ticket) return reply.code(404).send({ error: 'ticket not found' })

    const parsed = moveTicketSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })

    const fromCol = columnById(deps, ticket.columnId)
    const toCol = columnById(deps, parsed.data.columnId)
    if (!fromCol || !toCol || toCol.workspaceId !== ticket.workspaceId) {
      return reply.code(400).send({ error: 'invalid column' })
    }

    if (!canMoveCard('human', fromCol.kind as ColumnKind, toCol.kind as ColumnKind)) {
      return reply.code(403).send({ error: 'illegal move' })
    }

    const existingRuns = db.drizzle.select().from(agentRuns).where(eq(agentRuns.ticketId, id)).all()

    // A run that's actually executing owns the ticket's worktree and card position right now -
    // any human drag (including to Done, which would rmSync the live worktree out from under it)
    // must be rejected outright, regardless of destination column.
    if (existingRuns.some((r) => r.status === 'running')) {
      return reply.code(409).send({ error: 'run in progress' })
    }

    const leavingReady = fromCol.kind === 'ready' && toCol.kind !== 'ready'
    const hasQueuedRun = existingRuns.some((r) => r.status === 'queued')
    const landingReady = toCol.kind === 'ready' && ticket.queueState !== 'queued' && !hasQueuedRun
    const landingDone = toCol.kind === 'done'

    const original = {
      columnId: ticket.columnId,
      position: ticket.position,
      queueState: ticket.queueState,
    }

    db.drizzle
      .update(tickets)
      .set({
        columnId: toCol.id,
        position: parsed.data.position,
        ...(toCol.kind === 'ready' ? {} : { queueState: null }),
      })
      .where(eq(tickets.id, id))
      .run()

    if (leavingReady) {
      const queuedRuns = existingRuns.filter((r) => r.status === 'queued')
      for (const run of queuedRuns) cancelRun(db, scheduler, run.id)
    }

    if (landingReady) {
      try {
        scheduler.enqueue(id)
      } catch (err) {
        // e.g. a stale/invalid adapterOverride slipped past PATCH validation (direct db write,
        // adapter removed after the fact, etc). Don't strand the ticket in the new column with no
        // run behind it - roll back to where it was and surface the failure.
        db.drizzle.update(tickets).set(original).where(eq(tickets.id, id)).run()
        return reply.code(400).send({
          error: err instanceof Error ? err.message : 'failed to enqueue run',
        })
      }
    }

    if (landingDone) {
      for (const run of existingRuns) {
        const path = join(stateDir(), 'runs', String(run.id))
        const repoDirs = Object.fromEntries(
          wm
            .manifest(ticket.workspaceId)
            .sources.filter((s) => s.type === 'repo')
            .map((r) => [r.name, join(path, r.name)]),
        )
        try {
          await cleanupRunDir(wm, ticket.workspaceId, { path, repoDirs })
        } catch {
          // already cleaned up (or never built) - ignore
        }
      }
    }

    hub.boardChanged(ticket.workspaceId)
    return ticketOr404(deps, id)
  })

  app.post('/tickets/:id/comments', async (req, reply) => {
    const id = idParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })

    const ticket = ticketOr404(deps, id)
    if (!ticket) return reply.code(404).send({ error: 'ticket not found' })

    const parsed = commentSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })

    const [comment] = db.drizzle
      .insert(comments)
      .values({ ticketId: id, author: 'human', body: parsed.data.body })
      .returning()
      .all()

    return reply.code(201).send(comment)
  })
}
