import type { ColumnKind } from '@tada/shared'
import { canMoveCard } from '@tada/shared'
import { asc, desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { recordActivity } from '../activity.js'
import { agentRuns, columns, comments, tickets, workspaces } from '../db/schema.js'
import { cleanupRunDirs } from '../runs/runDir.js'
import type { RouteDeps } from './deps.js'
import { cancelRun } from './runs.js'
import { publicRun } from './serialize.js'

const TITLE_MAX = 500
const DESCRIPTION_MAX = 100_000

const createTicketSchema = z.object({
  workspaceId: z.number().int(),
  title: z.string().min(1).max(TITLE_MAX),
  description: z.string().max(DESCRIPTION_MAX).default(''),
})

const patchTicketSchema = z
  .object({
    title: z.string().min(1).max(TITLE_MAX),
    description: z.string().max(DESCRIPTION_MAX),
    position: z.number(),
    adapterOverride: z.string().nullable(),
    modelOverride: z.string().nullable(),
    effortOverride: z.string().nullable(),
  })
  .partial()

const moveTicketSchema = z.object({
  columnId: z.number().int(),
  position: z.number(),
})

const commentSchema = z.object({ body: z.string().min(1) })

const sendBackSchema = z.object({ feedback: z.string().min(1) })

const proposalSchema = z.object({ action: z.enum(['keep', 'dismiss']) })

const CONTENT_FIELDS = [
  'title',
  'description',
  'adapterOverride',
  'modelOverride',
  'effortOverride',
] as const

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

function columnByKind(deps: RouteDeps, workspaceId: number, kind: ColumnKind) {
  return deps.db.drizzle
    .select()
    .from(columns)
    .where(eq(columns.workspaceId, workspaceId))
    .all()
    .find((c) => c.kind === kind)
}

/** Position one past the current last card in `columnId` - the same "append to the end" rule
 * ticket creation uses for the Backlog. */
function endOfColumnPosition(deps: RouteDeps, columnId: number): number {
  const last = deps.db.drizzle
    .select()
    .from(tickets)
    .where(eq(tickets.columnId, columnId))
    .orderBy(desc(tickets.position))
    .limit(1)
    .get()
  return (last?.position ?? 0) + 1
}

type TicketRow = NonNullable<ReturnType<typeof ticketOr404>>
type ColumnRow = NonNullable<ReturnType<typeof columnById>>

/**
 * Applies a card move that's already been authorized by the caller (human-drag permission via
 * `canMoveCard`, the "run in progress" 409, the "must be in_review" 409 for accept/send-back,
 * etc): updates the ticket's column/position, cancels any queued run left behind when leaving
 * Ready, enqueues a new run when landing on Ready, and cleans up the run directory when landing
 * on Done. Shared by POST /tickets/:id/move, /accept, and /send-back so none of them duplicate
 * this bookkeeping. Returns an error message if enqueueing failed (the move is rolled back in
 * that case); otherwise undefined.
 */
async function applyMove(
  deps: RouteDeps,
  ticket: TicketRow,
  fromCol: ColumnRow,
  toCol: ColumnRow,
  position: number,
): Promise<{ error: string } | undefined> {
  const { db, scheduler, wm, hub } = deps
  const id = ticket.id

  const existingRuns = db.drizzle.select().from(agentRuns).where(eq(agentRuns.ticketId, id)).all()

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
      position,
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
      return { error: err instanceof Error ? err.message : 'failed to enqueue run' }
    }
  }

  if (landingDone) {
    await cleanupRunDirs(
      wm,
      ticket.workspaceId,
      existingRuns.map((r) => r.id),
    )
  }

  hub.boardChanged(ticket.workspaceId)
  return undefined
}

export function registerTicketRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, hub, adapters } = deps

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
    if (!ticket) return reply.code(500).send({ error: 'failed to create ticket' })

    recordActivity(db, hub, {
      workspaceId,
      ticketId: ticket.id,
      type: 'ticket_created',
      message: `You created "${ticket.title}"`,
    })
    hub.boardChanged(workspaceId)

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
    const followUps = db.drizzle
      .select({ id: tickets.id, title: tickets.title, proposalState: tickets.proposalState })
      .from(tickets)
      .where(eq(tickets.followUpOfTicketId, id))
      .all()

    return { ...ticket, comments: ticketComments, runs: runs.map(publicRun), followUps }
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

    // Overrides are validated against the adapter the run would actually use after this patch:
    // the override being set, else the stored override, else the workspace default. (Skipping
    // validation whenever no adapter override was set let bogus models through to the runner.)
    const workspace = db.drizzle
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, ticket.workspaceId))
      .get()
    const effectiveAdapterName =
      (parsed.data.adapterOverride !== undefined
        ? parsed.data.adapterOverride
        : ticket.adapterOverride) ?? workspace?.defaultAdapter
    const effectiveAdapter =
      effectiveAdapterName != null ? adapters.get(effectiveAdapterName) : undefined

    if (
      parsed.data.modelOverride != null &&
      !effectiveAdapter?.models.includes(parsed.data.modelOverride)
    ) {
      return reply.code(400).send({
        error: `unknown model: ${parsed.data.modelOverride} for adapter ${effectiveAdapterName}. valid models: ${effectiveAdapter?.models.join(', ') ?? 'none (unknown adapter)'}`,
      })
    }

    if (
      parsed.data.effortOverride != null &&
      !effectiveAdapter?.efforts.includes(parsed.data.effortOverride)
    ) {
      return reply.code(400).send({
        error: `unknown effort: ${parsed.data.effortOverride} for adapter ${effectiveAdapterName}. valid efforts: ${effectiveAdapter?.efforts.join(', ') ?? 'none (unknown adapter)'}`,
      })
    }

    // Changing the adapter override without re-supplying model/effort: drop stored overrides the
    // new adapter can't honour rather than carrying an invalid combination into the next run.
    const patch: typeof parsed.data = { ...parsed.data }
    if (
      parsed.data.adapterOverride !== undefined &&
      parsed.data.adapterOverride !== ticket.adapterOverride
    ) {
      if (
        patch.modelOverride === undefined &&
        ticket.modelOverride != null &&
        !effectiveAdapter?.models.includes(ticket.modelOverride)
      ) {
        patch.modelOverride = null
      }
      if (
        patch.effortOverride === undefined &&
        ticket.effortOverride != null &&
        !effectiveAdapter?.efforts.includes(ticket.effortOverride)
      ) {
        patch.effortOverride = null
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

    // An empty patch is a no-op, not an error: drizzle's `set({})` throws ("No values to set").
    if (Object.keys(patch).length > 0) {
      db.drizzle.update(tickets).set(patch).where(eq(tickets.id, id)).run()
      hub.boardChanged(ticket.workspaceId)
    }
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

    // A pending agent proposal hasn't been reviewed (kept/dismissed) yet - it must never start
    // running just because it got dragged onto Ready.
    if (toCol.kind === 'ready' && ticket.proposalState === 'pending') {
      return reply.code(403).send({ error: 'cannot move a pending proposal to ready' })
    }

    const existingRuns = db.drizzle.select().from(agentRuns).where(eq(agentRuns.ticketId, id)).all()

    // A run that's actually executing owns the ticket's worktree and card position right now -
    // any human drag (including to Done, which would rmSync the live worktree out from under it)
    // must be rejected outright, regardless of destination column.
    if (existingRuns.some((r) => r.status === 'running')) {
      return reply.code(409).send({ error: 'run in progress' })
    }

    const moveErr = await applyMove(deps, ticket, fromCol, toCol, parsed.data.position)
    if (moveErr) return reply.code(400).send({ error: moveErr.error })

    // Dragging a reviewed ticket into Done *is* accepting it — record it like the Accept button
    // does, so the activity feed and anything reading it agree.
    if (fromCol.kind === 'in_review' && toCol.kind === 'done') {
      recordActivity(db, hub, {
        workspaceId: ticket.workspaceId,
        ticketId: id,
        type: 'accepted',
        message: `You accepted "${ticket.title}"`,
      })
    }

    return ticketOr404(deps, id)
  })

  app.post('/tickets/:id/accept', async (req, reply) => {
    const id = idParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })

    const ticket = ticketOr404(deps, id)
    if (!ticket) return reply.code(404).send({ error: 'ticket not found' })

    const fromCol = columnById(deps, ticket.columnId)
    if (fromCol?.kind !== 'in_review') {
      return reply.code(409).send({ error: 'ticket is not in review' })
    }

    const doneCol = columnByKind(deps, ticket.workspaceId, 'done')
    if (!doneCol) return reply.code(400).send({ error: 'workspace has no done column' })

    const moveErr = await applyMove(
      deps,
      ticket,
      fromCol,
      doneCol,
      endOfColumnPosition(deps, doneCol.id),
    )
    if (moveErr) return reply.code(400).send({ error: moveErr.error })

    recordActivity(db, hub, {
      workspaceId: ticket.workspaceId,
      ticketId: id,
      type: 'accepted',
      message: `You accepted "${ticket.title}"`,
    })

    return ticketOr404(deps, id)
  })

  app.post('/tickets/:id/send-back', async (req, reply) => {
    const id = idParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })

    const ticket = ticketOr404(deps, id)
    if (!ticket) return reply.code(404).send({ error: 'ticket not found' })

    const fromCol = columnById(deps, ticket.columnId)
    if (fromCol?.kind !== 'in_review') {
      return reply.code(409).send({ error: 'ticket is not in review' })
    }

    const parsed = sendBackSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })

    const readyCol = columnByKind(deps, ticket.workspaceId, 'ready')
    if (!readyCol) return reply.code(400).send({ error: 'workspace has no ready column' })

    db.drizzle
      .insert(comments)
      .values({ ticketId: id, author: 'human', kind: 'feedback', body: parsed.data.feedback })
      .run()

    // Recorded before the move so the feed reads "sent back" → "started attempt N+1", not the
    // other way round (applyMove enqueues the new attempt synchronously).
    recordActivity(db, hub, {
      workspaceId: ticket.workspaceId,
      ticketId: id,
      type: 'sent_back',
      message: `You sent back "${ticket.title}"`,
    })

    const moveErr = await applyMove(
      deps,
      ticket,
      fromCol,
      readyCol,
      endOfColumnPosition(deps, readyCol.id),
    )
    if (moveErr) return reply.code(400).send({ error: moveErr.error })

    return ticketOr404(deps, id)
  })

  app.post('/tickets/:id/proposal', async (req, reply) => {
    const id = idParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })

    const ticket = ticketOr404(deps, id)
    if (ticket?.proposalState !== 'pending') {
      return reply.code(404).send({ error: 'ticket is not a pending proposal' })
    }

    const parsed = proposalSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })

    if (parsed.data.action === 'dismiss') {
      db.drizzle.delete(tickets).where(eq(tickets.id, id)).run()
      hub.boardChanged(ticket.workspaceId)
      return reply.code(204).send()
    }

    // keep: it's no longer a proposal, just a regular backlog ticket.
    db.drizzle.update(tickets).set({ proposalState: null }).where(eq(tickets.id, id)).run()
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
    hub.boardChanged(ticket.workspaceId)

    return reply.code(201).send(comment)
  })
}
