import type { ApiBoard, ApiTicketDetail, ColumnKind } from '@tada/shared'
import { canMoveCard } from '@tada/shared'
import { asc, desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { recordActivity } from '../activity.js'
import { agentRuns, comments, tickets } from '../db/schema.js'
import { cleanupRunDirs } from '../runs/runDir.js'
import { liveRunFor } from '../runs/runner.js'
import { normalizeRepoTags, unknownRepos } from '../runs/tags.js'
import { intParam, type RouteDeps } from './deps.js'
import { cancelRun } from './runs.js'
import { publicRun, publicTicket } from './serialize.js'

const TITLE_MAX = 500
const DESCRIPTION_MAX = 100_000

const createTicketSchema = z.object({
  title: z.string().min(1).max(TITLE_MAX),
  description: z.string().max(DESCRIPTION_MAX).default(''),
  /** New tickets land in backlog by default; `queued` starts when a slot frees. */
  column: z.enum(['backlog', 'queued']).default('backlog'),
  /**
   * Repos this ticket is for — a plan, not evidence. Creating a card while a repo filter is
   * selected tags it so it shows up on that board straight away; a run stamps its own tags on top
   * as it touches repos. Names must be connected repos.
   */
  repoTags: z.array(z.string()).default([]),
})

const patchTicketSchema = z
  .object({
    title: z.string().min(1).max(TITLE_MAX),
    description: z.string().max(DESCRIPTION_MAX),
  })
  .partial()

const moveTicketSchema = z.object({
  column: z.enum(['backlog', 'queued', 'done']),
  position: z.number().optional(),
})

const noteSchema = z.object({ body: z.string().min(1) })
const proposalSchema = z.object({ action: z.enum(['keep', 'dismiss']) })

type TicketRow = typeof tickets.$inferSelect

function ticketById(deps: RouteDeps, id: number): TicketRow | undefined {
  return deps.db.drizzle.select().from(tickets).where(eq(tickets.id, id)).get()
}

/** Position one past the current last card in `column` — "append to the end". */
export function endOfColumnPosition(deps: RouteDeps, column: ColumnKind): number {
  const last = deps.db.drizzle
    .select({ position: tickets.position })
    .from(tickets)
    .where(eq(tickets.column, column))
    .orderBy(desc(tickets.position))
    .limit(1)
    .get()
  return (last?.position ?? 0) + 1
}

/**
 * Applies a human card move. Landing on `queued` starts a run (unless one is already queued);
 * leaving `queued` cancels the queued run; landing on `backlog` while a run is live stops it;
 * landing on `done` files the ticket. Returns an HTTP error to send, or undefined on success.
 */
export async function moveTicket(
  deps: RouteDeps,
  ticket: TicketRow,
  to: 'backlog' | 'queued' | 'done',
  position: number | undefined,
): Promise<{ code: number; error: string } | undefined> {
  const { db, scheduler, store, hub } = deps
  const from = ticket.column
  if (!canMoveCard('human', from, to)) return { code: 403, error: 'illegal move' }
  if (to === 'queued' && ticket.proposalState === 'pending') {
    return { code: 403, error: 'keep the proposal before queuing it' }
  }

  const live = liveRunFor(db, ticket.id)
  const pos = position ?? (from === to ? ticket.position : endOfColumnPosition(deps, to))

  if (live && live.status !== 'queued') {
    // A running or held run owns the card. The only human move is "stop it": to backlog.
    if (to !== 'backlog') return { code: 409, error: 'stop the run first' }
    db.drizzle.update(tickets).set({ position: pos }).where(eq(tickets.id, ticket.id)).run()
    // The runner moves the card to backlog itself when the cancellation lands.
    cancelRun(deps, live.id)
    return undefined
  }

  db.drizzle
    .update(tickets)
    .set({
      column: to,
      position: pos,
      doneAt: to === 'done' ? new Date() : null,
    })
    .where(eq(tickets.id, ticket.id))
    .run()

  if (live && to !== 'queued') cancelRun(deps, live.id)

  if (to === 'queued' && !live) {
    try {
      scheduler.enqueue(ticket.id)
    } catch (err) {
      db.drizzle
        .update(tickets)
        .set({ column: from, position: ticket.position })
        .where(eq(tickets.id, ticket.id))
        .run()
      return { code: 400, error: err instanceof Error ? err.message : 'failed to enqueue run' }
    }
  }

  if (to === 'done') {
    const runs = db.drizzle
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(eq(agentRuns.ticketId, ticket.id))
      .all()
    await cleanupRunDirs(
      store,
      runs.map((r) => r.id),
    )
  }
  if (from === 'done' && to !== 'done') {
    recordActivity(db, hub, {
      ticketId: ticket.id,
      type: 'undone',
      message: `You moved "${ticket.title}" back out of done`,
    })
  }

  hub.boardChanged()
  return undefined
}

export function registerTicketRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, hub, scheduler } = deps

  app.get('/board', async (): Promise<ApiBoard> => {
    const rows = db.drizzle.select().from(tickets).orderBy(asc(tickets.position)).all()
    const board: ApiBoard = { backlog: [], queued: [], running: [], stopped: [], done: [] }
    for (const row of rows) board[row.column].push(publicTicket(db, row))
    return board
  })

  app.post('/tickets', async (req, reply) => {
    const parsed = createTicketSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })
    const { title, description, column } = parsed.data
    const repoTags = normalizeRepoTags(parsed.data.repoTags)
    const unknown = unknownRepos(deps.store, repoTags)
    if (unknown.length > 0) {
      return reply.code(400).send({ error: `unknown repo: ${unknown.join(', ')}` })
    }

    const [ticket] = db.drizzle
      .insert(tickets)
      .values({ column, title, description, repoTags, position: endOfColumnPosition(deps, column) })
      .returning()
      .all()
    if (!ticket) return reply.code(500).send({ error: 'failed to create ticket' })

    recordActivity(db, hub, {
      ticketId: ticket.id,
      type: 'ticket_created',
      message: `You created "${ticket.title}"`,
    })
    if (column === 'queued') {
      try {
        scheduler.enqueue(ticket.id)
      } catch (err) {
        db.drizzle.update(tickets).set({ column: 'backlog' }).where(eq(tickets.id, ticket.id)).run()
        hub.boardChanged()
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : 'failed to enqueue run' })
      }
    }
    hub.boardChanged()
    const fresh = ticketById(deps, ticket.id)
    return reply.code(201).send(fresh ? publicTicket(db, fresh) : ticket)
  })

  app.get('/tickets/:id', async (req, reply) => {
    const id = intParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })
    const ticket = ticketById(deps, id)
    if (!ticket) return reply.code(404).send({ error: 'ticket not found' })

    const thread = db.drizzle
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
    const followUps = db.drizzle
      .select({ id: tickets.id, title: tickets.title, proposalState: tickets.proposalState })
      .from(tickets)
      .where(eq(tickets.followUpOfTicketId, id))
      .all()
    const parent =
      ticket.followUpOfTicketId != null
        ? db.drizzle
            .select({ id: tickets.id, title: tickets.title })
            .from(tickets)
            .where(eq(tickets.id, ticket.followUpOfTicketId))
            .get()
        : undefined

    const detail: ApiTicketDetail = {
      ...publicTicket(db, ticket),
      comments: thread.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
      runs: runs.map(publicRun),
      followUps,
      followUpOf: parent ?? null,
    }
    return detail
  })

  app.patch('/tickets/:id', async (req, reply) => {
    const id = intParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })
    const ticket = ticketById(deps, id)
    if (!ticket) return reply.code(404).send({ error: 'ticket not found' })

    const parsed = patchTicketSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })

    // An empty patch is a no-op, not an error: drizzle's `set({})` throws ("No values to set").
    if (Object.keys(parsed.data).length > 0) {
      db.drizzle.update(tickets).set(parsed.data).where(eq(tickets.id, id)).run()
      hub.boardChanged()
    }
    const fresh = ticketById(deps, id)
    return fresh ? publicTicket(db, fresh) : fresh
  })

  app.post('/tickets/:id/move', async (req, reply) => {
    const id = intParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })
    const ticket = ticketById(deps, id)
    if (!ticket) return reply.code(404).send({ error: 'ticket not found' })

    const parsed = moveTicketSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })

    const err = await moveTicket(deps, ticket, parsed.data.column, parsed.data.position)
    if (err) return reply.code(err.code).send({ error: err.error })
    const fresh = ticketById(deps, id)
    return fresh ? publicTicket(db, fresh) : fresh
  })

  // Re-run after failure: a fresh attempt — new worktrees, memory re-read; the failed transcript
  // stays on the ticket. It is the same thing as putting the card back in queued.
  app.post('/tickets/:id/rerun', async (req, reply) => {
    const id = intParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })
    const ticket = ticketById(deps, id)
    if (!ticket) return reply.code(404).send({ error: 'ticket not found' })
    const err = await moveTicket(deps, ticket, 'queued', undefined)
    if (err) return reply.code(err.code).send({ error: err.error })
    const fresh = ticketById(deps, id)
    return fresh ? publicTicket(db, fresh) : fresh
  })

  app.post('/tickets/:id/duplicate', async (req, reply) => {
    const id = intParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })
    const ticket = ticketById(deps, id)
    if (!ticket) return reply.code(404).send({ error: 'ticket not found' })
    const [copy] = db.drizzle
      .insert(tickets)
      .values({
        column: 'backlog',
        title: ticket.title,
        description: ticket.description,
        position: endOfColumnPosition(deps, 'backlog'),
      })
      .returning()
      .all()
    if (!copy) return reply.code(500).send({ error: 'failed to duplicate' })
    recordActivity(db, hub, {
      ticketId: copy.id,
      type: 'ticket_created',
      message: `You duplicated "${ticket.title}"`,
    })
    hub.boardChanged()
    return reply.code(201).send(publicTicket(db, copy))
  })

  app.delete('/tickets/:id', async (req, reply) => {
    const id = intParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })
    const ticket = ticketById(deps, id)
    if (!ticket) return reply.code(404).send({ error: 'ticket not found' })

    const live = liveRunFor(db, id)
    if (live && live.status !== 'queued')
      return reply.code(409).send({ error: 'stop the run first' })
    if (live) cancelRun(deps, live.id)

    const runs = db.drizzle
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(eq(agentRuns.ticketId, id))
      .all()
    await cleanupRunDirs(
      deps.store,
      runs.map((r) => r.id),
    )
    db.drizzle.delete(tickets).where(eq(tickets.id, id)).run()
    hub.boardChanged()
    return reply.code(204).send()
  })

  app.post('/tickets/:id/proposal', async (req, reply) => {
    const id = intParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })
    const ticket = ticketById(deps, id)
    if (ticket?.proposalState !== 'pending') {
      return reply.code(404).send({ error: 'ticket is not a pending proposal' })
    }
    const parsed = proposalSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })

    if (parsed.data.action === 'dismiss') {
      db.drizzle.delete(tickets).where(eq(tickets.id, id)).run()
      hub.boardChanged()
      return reply.code(204).send()
    }
    db.drizzle.update(tickets).set({ proposalState: null }).where(eq(tickets.id, id)).run()
    hub.boardChanged()
    const fresh = ticketById(deps, id)
    return fresh ? publicTicket(db, fresh) : fresh
  })

  // A note is the one kind of free text you send the agent. On a live run it is injected into
  // the session right away (`delivered`); otherwise the next run reads it from the thread.
  app.post('/tickets/:id/notes', async (req, reply) => {
    const id = intParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })
    const ticket = ticketById(deps, id)
    if (!ticket) return reply.code(404).send({ error: 'ticket not found' })

    const parsed = noteSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })

    const live = liveRunFor(db, id)
    const [comment] = db.drizzle
      .insert(comments)
      .values({ ticketId: id, runId: live?.id ?? null, author: 'human', body: parsed.data.body })
      .returning()
      .all()
    hub.boardChanged()

    const delivered = live ? (scheduler.liveRun(live.id)?.inject(parsed.data.body) ?? false) : false
    return reply.code(201).send({ comment, delivered })
  })
}
