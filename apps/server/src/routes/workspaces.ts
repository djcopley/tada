import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createDefaultColumns } from '../db/index.js'
import { agentRuns, columns, tickets, workspaces } from '../db/schema.js'
import { dataDir } from '../paths.js'
import { SourceExistsError, WorkspaceExistsError } from '../workspaces/manager.js'
import type { RouteDeps } from './deps.js'

// basename-only: any '/' (or a resolved-away '..') in the name is rejected outright, so the
// on-disk path this feeds (WorkspaceManager.create) can never escape dataDir.
const createWorkspaceSchema = z.object({
  name: z
    .string()
    .min(1)
    .refine((name) => name === basename(name) && name !== '.' && name !== '..', {
      message: 'invalid workspace name',
    }),
})

const patchWorkspaceSchema = z
  .object({
    defaultAdapter: z.string().min(1),
    defaultModel: z.string().min(1),
    defaultEffort: z.string().min(1),
    concurrency: z.number().int().min(1).max(16),
    timeoutMs: z
      .number()
      .int()
      .min(1_000)
      .max(24 * 60 * 60 * 1000),
  })
  .partial()

const addSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('repo'), url: z.string().min(1) }),
  z.object({ type: z.literal('folder'), path: z.string().min(1) }),
])

function workspaceIdParam(id: string): number | undefined {
  const n = Number(id)
  return Number.isInteger(n) ? n : undefined
}

/** lowercased, spaces -> '-', stripped to [a-z0-9-] */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
}

export function registerWorkspaceRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, wm, adapters, scheduler } = deps

  // One workspace with a missing/corrupt manifest.json must not take the whole list (and the
  // client with it) down; it just reports no sources.
  const safeSourceCount = (wsId: number): number => {
    try {
      return wm.listSources(wsId).length
    } catch (err) {
      app.log.warn({ err, workspaceId: wsId }, 'could not read workspace manifest')
      return 0
    }
  }

  app.get('/workspaces', async () => {
    const rows = db.drizzle.select().from(workspaces).all()
    return rows.map((ws) => {
      const runningCount = db.drizzle
        .select({ status: agentRuns.status })
        .from(agentRuns)
        .innerJoin(tickets, eq(agentRuns.ticketId, tickets.id))
        .where(and(eq(tickets.workspaceId, ws.id), eq(agentRuns.status, 'running')))
        .all().length
      // Counted from the board, not from run rows: accepting a ticket (or a later attempt
      // superseding an earlier one) never transitions the old run out of needs_review, so a
      // run-status count only ever grew.
      const needsReviewCount = db.drizzle
        .select({ id: tickets.id })
        .from(tickets)
        .innerJoin(columns, eq(tickets.columnId, columns.id))
        .where(and(eq(tickets.workspaceId, ws.id), eq(columns.kind, 'in_review')))
        .all().length
      const queuedCount = db.drizzle
        .select({ id: tickets.id })
        .from(tickets)
        .innerJoin(columns, eq(tickets.columnId, columns.id))
        .where(
          and(
            eq(tickets.workspaceId, ws.id),
            eq(columns.kind, 'ready'),
            eq(tickets.queueState, 'queued'),
          ),
        )
        .all().length
      return {
        ...ws,
        runningCount,
        needsReviewCount,
        queuedCount,
        sourceCount: safeSourceCount(ws.id),
      }
    })
  })

  app.post('/workspaces', async (req, reply) => {
    const parsed = createWorkspaceSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })

    let id: number
    try {
      id = await wm.create(parsed.data.name)
    } catch (err) {
      if (err instanceof WorkspaceExistsError) {
        return reply.code(409).send({ error: 'workspace name already exists' })
      }
      throw err
    }
    createDefaultColumns(db, id)
    const row = db.drizzle.select().from(workspaces).where(eq(workspaces.id, id)).get()
    return reply.code(201).send(row)
  })

  app.get('/workspaces/:id', async (req, reply) => {
    const id = workspaceIdParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })

    const row = db.drizzle.select().from(workspaces).where(eq(workspaces.id, id)).get()
    if (!row) return reply.code(404).send({ error: 'workspace not found' })

    return { ...row, sources: wm.listSources(id) }
  })

  app.get('/workspaces/check-name', async (req, reply) => {
    const { name } = req.query as { name?: string }
    if (!name) return reply.code(400).send({ error: 'name is required' })

    // `id` is the display slug. Availability applies exactly the rules POST /workspaces will:
    // the name must validate, and it collides case-insensitively (the on-disk workspace dir
    // lives on a possibly case-insensitive filesystem, so `wn-CASE` cannot coexist with
    // `WN-case` — WorkspaceManager.create refuses it) — so the live check never disagrees
    // with the create.
    const id = slugify(name)
    const valid = createWorkspaceSchema.safeParse({ name })
    if (!valid.success) return { id, available: false, reason: 'invalid workspace name' }
    const taken = db.drizzle
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(sql`lower(${workspaces.name}) = lower(${name.trim()})`)
      .get()
    const onDisk = existsSync(join(dataDir(), 'workspaces', name.trim()))
    return taken || onDisk ? { id, available: false, reason: 'taken' } : { id, available: true }
  })

  app.get('/repos/known', async () => {
    return wm.knownRepos()
  })

  app.patch('/workspaces/:id', async (req, reply) => {
    const id = workspaceIdParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })

    const parsed = patchWorkspaceSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })

    const existing = db.drizzle.select().from(workspaces).where(eq(workspaces.id, id)).get()
    if (!existing) return reply.code(404).send({ error: 'workspace not found' })

    if (parsed.data.defaultAdapter !== undefined && !adapters.has(parsed.data.defaultAdapter)) {
      return reply.code(400).send({
        error: `unknown adapter: ${parsed.data.defaultAdapter}. valid adapters: ${[...adapters.keys()].join(', ')}`,
      })
    }

    // Both model and effort are validated against the adapter this PATCH leaves the workspace
    // on - the one it is switching to when the same body sets defaultAdapter, otherwise the
    // stored one - so a harness switch that carries a new model/effort is checked against the
    // new harness rather than the outgoing one.
    const adapterName = parsed.data.defaultAdapter ?? existing.defaultAdapter
    const adapter = adapters.get(adapterName)

    if (parsed.data.defaultModel !== undefined) {
      if (!adapter?.models.includes(parsed.data.defaultModel)) {
        return reply.code(400).send({
          error: `unknown model: ${parsed.data.defaultModel} for adapter ${adapterName}. valid models: ${adapter?.models.join(', ') ?? 'none (unknown adapter)'}`,
        })
      }
    }

    if (parsed.data.defaultEffort !== undefined) {
      if (!adapter?.efforts.includes(parsed.data.defaultEffort)) {
        return reply.code(400).send({
          error: `unknown effort: ${parsed.data.defaultEffort} for adapter ${adapterName}. valid efforts: ${adapter?.efforts.join(', ') ?? 'none (unknown adapter)'}`,
        })
      }
    }

    // A harness switch that doesn't re-supply model/effort must not leave the workspace on a
    // model/effort the new harness doesn't offer: fall back to the adapter's first model and to
    // 'medium' (else its first effort).
    const patch: typeof parsed.data = { ...parsed.data }
    if (
      adapter &&
      parsed.data.defaultAdapter !== undefined &&
      parsed.data.defaultAdapter !== existing.defaultAdapter
    ) {
      if (patch.defaultModel === undefined && !adapter.models.includes(existing.defaultModel)) {
        patch.defaultModel = adapter.models[0]
      }
      if (patch.defaultEffort === undefined && !adapter.efforts.includes(existing.defaultEffort)) {
        patch.defaultEffort = adapter.efforts.includes('medium') ? 'medium' : adapter.efforts[0]
      }
    }

    // An empty patch is a no-op, not an error: drizzle's `set({})` throws ("No values to set"),
    // which would surface as a 500 for a request that asked for nothing.
    if (Object.keys(patch).length > 0) {
      db.drizzle.update(workspaces).set(patch).where(eq(workspaces.id, id)).run()
    }
    // A raised cap should start waiting runs now, not whenever something else next ticks.
    if (patch.concurrency !== undefined && patch.concurrency > existing.concurrency)
      scheduler.tick()
    return db.drizzle.select().from(workspaces).where(eq(workspaces.id, id)).get()
  })

  app.post('/workspaces/:id/sources', async (req, reply) => {
    const id = workspaceIdParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })

    const parsed = addSourceSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })

    const existing = db.drizzle.select().from(workspaces).where(eq(workspaces.id, id)).get()
    if (!existing) return reply.code(404).send({ error: 'workspace not found' })

    try {
      if (parsed.data.type === 'repo') {
        await wm.addRepoSource(id, parsed.data.url)
      } else {
        await wm.addFolderSource(id, parsed.data.path)
      }
    } catch (err) {
      if (err instanceof SourceExistsError) return reply.code(409).send({ error: err.message })
      return reply.code(400).send({
        error: err instanceof Error ? err.message : 'failed to add source',
      })
    }

    return reply.code(201).send(wm.listSources(id))
  })

  app.delete('/workspaces/:id/sources/:name', async (req, reply) => {
    const id = workspaceIdParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })

    const existing = db.drizzle.select().from(workspaces).where(eq(workspaces.id, id)).get()
    if (!existing) return reply.code(404).send({ error: 'workspace not found' })

    const { name } = req.params as { id: string; name: string }
    // basename-only: any '/' (or a resolved-away '..') in the source name is rejected outright,
    // so the rmSync path this feeds (WorkspaceManager.removeSource) can never escape the repos
    // dir.
    if (name !== basename(name) || name === '' || name === '.' || name === '..') {
      return reply.code(400).send({ error: 'invalid source name' })
    }

    const removed = await wm.removeSource(id, name)
    if (!removed) return reply.code(404).send({ error: 'source not found' })
    return wm.listSources(id)
  })

  app.get('/workspaces/:id/board', async (req, reply) => {
    const id = workspaceIdParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })

    const existing = db.drizzle.select().from(workspaces).where(eq(workspaces.id, id)).get()
    if (!existing) return reply.code(404).send({ error: 'workspace not found' })

    const cols = db.drizzle
      .select()
      .from(columns)
      .where(eq(columns.workspaceId, id))
      .orderBy(asc(columns.position))
      .all()

    return {
      columns: cols.map((col) => ({
        ...col,
        tickets: db.drizzle
          .select()
          .from(tickets)
          .where(eq(tickets.columnId, col.id))
          .orderBy(asc(tickets.position))
          .all(),
      })),
    }
  })
}
