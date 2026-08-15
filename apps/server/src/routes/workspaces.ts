import { basename } from 'node:path'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createDefaultColumns } from '../db/index.js'
import { agentRuns, columns, tickets, workspaces } from '../db/schema.js'
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
    concurrency: z.number().int().min(1),
    timeoutMs: z.number().int().min(1),
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
  const { db, wm, adapters } = deps

  app.get('/workspaces', async () => {
    const rows = db.drizzle.select().from(workspaces).all()
    return rows.map((ws) => {
      const counts = db.drizzle
        .select({ status: agentRuns.status })
        .from(agentRuns)
        .innerJoin(tickets, eq(agentRuns.ticketId, tickets.id))
        .where(
          and(
            eq(tickets.workspaceId, ws.id),
            inArray(agentRuns.status, ['running', 'needs_review']),
          ),
        )
        .all()
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
        runningCount: counts.filter((c) => c.status === 'running').length,
        needsReviewCount: counts.filter((c) => c.status === 'needs_review').length,
        queuedCount,
        sourceCount: wm.listSources(ws.id).length,
      }
    })
  })

  app.post('/workspaces', async (req, reply) => {
    const parsed = createWorkspaceSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })

    const id = await wm.create(parsed.data.name)
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

    const id = slugify(name)
    const rows = db.drizzle.select({ name: workspaces.name }).from(workspaces).all()
    const available = !rows.some((row) => slugify(row.name) === id)
    return { id, available }
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

    if (parsed.data.defaultModel !== undefined) {
      const adapterName = parsed.data.defaultAdapter ?? existing.defaultAdapter
      const adapter = adapters.get(adapterName)
      if (!adapter?.models.includes(parsed.data.defaultModel)) {
        return reply.code(400).send({
          error: `unknown model: ${parsed.data.defaultModel} for adapter ${adapterName}. valid models: ${adapter?.models.join(', ') ?? 'none (unknown adapter)'}`,
        })
      }
    }

    db.drizzle.update(workspaces).set(parsed.data).where(eq(workspaces.id, id)).run()
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

    await wm.removeSource(id, name)
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
