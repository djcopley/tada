import { readFileSync } from 'node:fs'
import type { ApiRunDetail, ApiRunDiff, Hold } from '@tada/shared'
import { and, asc, eq, gt } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { recordActivity } from '../activity.js'
import {
  agentRuns,
  comments,
  events,
  liveActivityStartTokens,
  memoryNotes,
  pushTokens,
  rules,
  tickets,
  webPushSubscriptions,
} from '../db/schema.js'
import { bindActivityToken } from '../liveActivity.js'
import { ping } from '../notify.js'
import { runDiff } from '../runs/diff.js'
import { runDirFor } from '../runs/runDir.js'
import { humanizeMs, type LiveRun } from '../runs/runner.js'
import { intParam, type RouteDeps } from './deps.js'
import { publicRun } from './serialize.js'

const pushTokenSchema = z.object({ token: z.string().min(1) })
const webPushSubscriptionSchema = z.object({
  endpoint: z.string().min(1),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
})
const approveSchema = z.object({ alwaysAllow: z.boolean().default(false) })
const denySchema = z.object({ note: z.string().min(1), saveToMemory: z.boolean().default(false) })
const answerSchema = z.object({
  answer: z.string().min(1),
  saveToMemory: z.boolean().default(false),
})
const continueSchema = z.object({
  extraMs: z
    .number()
    .int()
    .min(60_000)
    .max(24 * 60 * 60 * 1000)
    .default(30 * 60 * 1000),
})

/**
 * Cancels a run. `Scheduler.cancel` silently no-ops for a run that is still 'queued' (never
 * started, so untracked in the scheduler's in-memory map): in that case mark it cancelled directly
 * (queued -> cancelled is legal). For a running/held run the abort signal reaches the in-flight
 * `executeRun`, which handles the terminal state and the card move itself.
 */
export function cancelRun(deps: RouteDeps, runId: number): void {
  const { db, scheduler, hub } = deps
  scheduler.cancel(runId)
  const fresh = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, runId)).get()
  if (fresh?.status === 'queued') {
    db.drizzle
      .update(agentRuns)
      .set({ status: 'cancelled', finishedAt: new Date() })
      .where(eq(agentRuns.id, runId))
      .run()
    hub.boardChanged()
  }
}

/** Saves a human's gate note as a kept memory note, titled by its first line. */
function saveNoteToMemory(deps: RouteDeps, body: string): void {
  const firstLine = body.split('\n')[0]?.trim() ?? ''
  const title = firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine || 'note'
  deps.db.drizzle.insert(memoryNotes).values({ title, body, author: 'human', state: 'kept' }).run()
}

export function registerRunRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, scheduler, hub, store } = deps

  const runAndTicket = (id: number) =>
    db.drizzle
      .select({ run: agentRuns, ticket: tickets })
      .from(agentRuns)
      .innerJoin(tickets, eq(agentRuns.ticketId, tickets.id))
      .where(eq(agentRuns.id, id))
      .get()

  app.get('/runs/:id', async (req, reply) => {
    const id = intParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })
    const row = runAndTicket(id)
    if (!row) return reply.code(404).send({ error: 'run not found' })
    const detail: ApiRunDetail = {
      ...publicRun(row.run),
      ticketTitle: row.ticket.title,
      repoTags: row.ticket.repoTags,
    }
    return detail
  })

  app.get('/runs/:id/events', async (req, reply) => {
    const id = intParam((req.params as { id: string }).id)
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
    const id = intParam((req.params as { id: string }).id)
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

  // The diff exists only at publish gates — pr create, push, merge — because that is when code
  // leaves your box. Anywhere else this answers 409: the transcript is the view of work in
  // progress. It is the run's own worktree branch vs the default branch, not a github PR.
  app.get('/runs/:id/diff', async (req, reply) => {
    const id = intParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })
    const row = runAndTicket(id)
    if (!row) return reply.code(404).send({ error: 'run not found' })
    const hold = publicRun(row.run).hold
    if (row.run.status !== 'held' || hold?.reason !== 'permission' || !hold.publishes) {
      return reply.code(409).send({ error: 'the diff is only viewable at a publish gate' })
    }
    const repos = await runDiff(store, runDirFor(store, id), row.ticket.id, { patch: true })
    const diff: ApiRunDiff = { runId: id, repos }
    return diff
  })

  app.post('/runs/:id/cancel', async (req, reply) => {
    const id = intParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })
    const run = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, id)).get()
    if (!run) return reply.code(404).send({ error: 'run not found' })
    cancelRun(deps, id)
    const after = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, id)).get()
    return after ? publicRun(after) : after
  })

  /** Shared preamble for the four hold resolutions: the run must be held *here*, in this
   * process, with a live control surface. */
  type HeldRun =
    | { error: { code: number; error: string } }
    | {
        error?: undefined
        row: NonNullable<ReturnType<typeof runAndTicket>>
        live: LiveRun
        hold: Hold
      }
  const heldRun = (id: number): HeldRun => {
    const row = runAndTicket(id)
    if (!row) return { error: { code: 404, error: 'run not found' } }
    const live = scheduler.liveRun(id)
    const hold = live?.currentHold()
    if (row.run.status !== 'held' || !live || !hold) {
      return { error: { code: 409, error: 'run is not held' } }
    }
    return { row, live, hold }
  }

  app.post('/runs/:id/approve', async (req, reply) => {
    const id = intParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })
    const parsed = approveSchema.safeParse(req.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })
    const h = heldRun(id)
    if (h.error) return reply.code(h.error.code).send({ error: h.error.error })
    if (h.hold.reason !== 'permission')
      return reply.code(409).send({ error: 'run is not held for permission' })

    // "Always allow" is not a per-run flag: it edits the rule table Settings renders, records
    // where the rule came from, and leaves a receipt in Today — all before the run resumes, in
    // one synchronous block, so the three can never disagree.
    if (parsed.data.alwaysAllow) {
      db.drizzle
        .update(rules)
        .set({ decision: 'allow', source: 'gate', sourceRunId: id, updatedAt: new Date() })
        .where(eq(rules.id, h.hold.ruleId))
        .run()
      recordActivity(db, hub, {
        ticketId: h.row.ticket.id,
        runId: id,
        type: 'always_allowed',
        message: `You approved ${h.hold.summary.split('\n')[0]?.slice(0, 80)} and made it always allow — rule "${h.hold.ruleTitle}" updated`,
      })
      hub.rulesChanged()
    } else {
      recordActivity(db, hub, {
        ticketId: h.row.ticket.id,
        runId: id,
        type: 'approved',
        message: `You approved ${h.hold.summary.split('\n')[0]?.slice(0, 80)} on "${h.row.ticket.title}"`,
      })
    }
    if (!h.live.resolve({ kind: 'approve' }))
      return reply.code(409).send({ error: 'run is not held' })
    return { ok: true }
  })

  app.post('/runs/:id/deny', async (req, reply) => {
    const id = intParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })
    const parsed = denySchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })
    const h = heldRun(id)
    if (h.error) return reply.code(h.error.code).send({ error: h.error.error })
    if (h.hold.reason !== 'permission')
      return reply.code(409).send({ error: 'run is not held for permission' })

    db.drizzle
      .insert(comments)
      .values({ ticketId: h.row.ticket.id, runId: id, author: 'human', body: parsed.data.note })
      .run()
    if (parsed.data.saveToMemory) saveNoteToMemory(deps, parsed.data.note)
    recordActivity(db, hub, {
      ticketId: h.row.ticket.id,
      runId: id,
      type: 'denied',
      message: `You denied ${h.hold.summary.split('\n')[0]?.slice(0, 80)} on "${h.row.ticket.title}" with a note`,
    })
    if (!h.live.resolve({ kind: 'deny', note: parsed.data.note })) {
      return reply.code(409).send({ error: 'run is not held' })
    }
    hub.boardChanged()
    return { ok: true }
  })

  app.post('/runs/:id/answer', async (req, reply) => {
    const id = intParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })
    const parsed = answerSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })
    const h = heldRun(id)
    if (h.error) return reply.code(h.error.code).send({ error: h.error.error })
    if (h.hold.reason !== 'question')
      return reply.code(409).send({ error: 'run is not held on a question' })

    db.drizzle
      .insert(comments)
      .values({ ticketId: h.row.ticket.id, runId: id, author: 'human', body: parsed.data.answer })
      .run()
    if (parsed.data.saveToMemory)
      saveNoteToMemory(deps, `${h.hold.question}\n\n${parsed.data.answer}`)
    recordActivity(db, hub, {
      ticketId: h.row.ticket.id,
      runId: id,
      type: 'answered',
      message: `You answered "${h.row.ticket.title}": ${parsed.data.answer.slice(0, 80)}`,
    })
    if (!h.live.resolve({ kind: 'answer', answer: parsed.data.answer })) {
      return reply.code(409).send({ error: 'run is not held' })
    }
    hub.boardChanged()
    return { ok: true }
  })

  app.post('/runs/:id/continue', async (req, reply) => {
    const id = intParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })
    const parsed = continueSchema.safeParse(req.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })
    const h = heldRun(id)
    if (h.error) return reply.code(h.error.code).send({ error: h.error.error })
    if (h.hold.reason !== 'time') return reply.code(409).send({ error: 'run is not out of time' })

    recordActivity(db, hub, {
      ticketId: h.row.ticket.id,
      runId: id,
      type: 'continued',
      message: `You gave "${h.row.ticket.title}" another ${humanizeMs(parsed.data.extraMs)}`,
    })
    if (!h.live.resolve({ kind: 'continue', extraMs: parsed.data.extraMs })) {
      return reply.code(409).send({ error: 'run is not held' })
    }
    return { ok: true }
  })

  app.post('/push-tokens', async (req, reply) => {
    const parsed = pushTokenSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })
    db.drizzle.insert(pushTokens).values({ token: parsed.data.token }).onConflictDoNothing().run()
    return reply.code(201).send({ ok: true })
  })

  // The device's push-to-start token. Idempotent: the app re-registers on every launch.
  app.post('/live-activity/start-token', async (req, reply) => {
    const parsed = z.object({ token: z.string().min(1) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })
    db.drizzle
      .insert(liveActivityStartTokens)
      .values({ token: parsed.data.token })
      .onConflictDoNothing()
      .run()
    return reply.code(201).send({ ok: true })
  })

  // A specific activity's update token, read by the app from ActivityKit. It carries no run id —
  // iOS does not provide one — so it binds to the newest session still waiting for a token.
  app.post('/live-activity/tokens', async (req, reply) => {
    const parsed = z.object({ token: z.string().min(1) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })
    bindActivityToken(db, parsed.data.token)
    // Task 5 wires the live activity sync here.
    return reply.code(201).send({ ok: true })
  })

  // The client needs the application server key before it can call pushManager.subscribe(). It
  // is public by definition; the bearer auth in front of it is incidental.
  app.get('/web-push/public-key', async () => ({ publicKey: deps.config.vapidPublicKey }))

  app.post('/web-push/subscriptions', async (req, reply) => {
    const parsed = webPushSubscriptionSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })
    // Idempotent: a browser hands back the same endpoint every time it re-subscribes.
    db.drizzle
      .insert(webPushSubscriptions)
      .values({
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
      })
      .onConflictDoNothing()
      .run()
    return reply.code(201).send({ ok: true })
  })

  app.delete('/web-push/subscriptions', async (req, reply) => {
    const parsed = z.object({ endpoint: z.string().min(1) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })
    db.drizzle
      .delete(webPushSubscriptions)
      .where(eq(webPushSubscriptions.endpoint, parsed.data.endpoint))
      .run()
    return { ok: true }
  })

  // Lets the Settings screen prove delivery end to end with one tap, instead of queueing a real
  // ticket to find out whether notifications work.
  app.post('/web-push/test', async () => {
    await ping(
      db,
      { ticketId: 0, runId: 0, title: 'tada', body: 'Notifications are working.' },
      { webPush: deps.webPush },
    )
    return { ok: true }
  })
}
