import { basename } from 'node:path'
import type { ApiSettings } from '@tada/shared'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { settings } from '../db/schema.js'
import { SourceExistsError } from '../sources/store.js'
import type { RouteDeps } from './deps.js'

const patchSettingsSchema = z
  .object({
    adapter: z.string().min(1),
    model: z.string().min(1),
    effort: z.string().min(1),
    concurrency: z.number().int().min(1).max(16),
    timeoutMs: z
      .number()
      .int()
      .min(60_000)
      .max(24 * 60 * 60 * 1000),
    pingChannel: z.enum(['push', 'off']),
    repingMs: z
      .number()
      .int()
      .min(0)
      .max(24 * 60 * 60 * 1000),
  })
  .partial()

const addSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('repo'), url: z.string().min(1) }),
  z.object({ type: z.literal('folder'), path: z.string().min(1) }),
])

export function registerSettingsRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, adapters, scheduler, store, hub } = deps

  const current = (): ApiSettings => {
    const row = db.drizzle.select().from(settings).get()
    if (!row) throw new Error('settings row missing')
    const { id: _id, ...rest } = row
    return rest
  }

  app.get('/settings', async () => current())

  app.patch('/settings', async (req, reply) => {
    const parsed = patchSettingsSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })
    const existing = current()

    if (parsed.data.adapter !== undefined && !adapters.has(parsed.data.adapter)) {
      return reply.code(400).send({
        error: `unknown adapter: ${parsed.data.adapter}. valid adapters: ${[...adapters.keys()].join(', ')}`,
      })
    }
    // Model and effort are validated against the adapter this PATCH leaves us on — the one it is
    // switching to when the same body sets `adapter`, otherwise the stored one.
    const adapterName = parsed.data.adapter ?? existing.adapter
    const adapter = adapters.get(adapterName)
    if (parsed.data.model !== undefined && !adapter?.models.includes(parsed.data.model)) {
      return reply.code(400).send({
        error: `unknown model: ${parsed.data.model} for adapter ${adapterName}. valid models: ${adapter?.models.join(', ') ?? 'none'}`,
      })
    }
    if (parsed.data.effort !== undefined && !adapter?.efforts.includes(parsed.data.effort)) {
      return reply.code(400).send({
        error: `unknown effort: ${parsed.data.effort} for adapter ${adapterName}. valid efforts: ${adapter?.efforts.join(', ') ?? 'none'}`,
      })
    }
    // A harness switch that doesn't re-supply model/effort must not leave us on a model/effort
    // the new harness doesn't offer.
    const patch = { ...parsed.data }
    if (adapter && parsed.data.adapter !== undefined && parsed.data.adapter !== existing.adapter) {
      if (patch.model === undefined && !adapter.models.includes(existing.model)) {
        patch.model = adapter.models[0]
      }
      if (patch.effort === undefined && !adapter.efforts.includes(existing.effort)) {
        patch.effort = adapter.efforts.includes('medium') ? 'medium' : adapter.efforts[0]
      }
    }
    if (Object.keys(patch).length > 0) {
      db.drizzle.update(settings).set(patch).where(eq(settings.id, 1)).run()
    }
    // A raised cap should start waiting runs now, not whenever something else next ticks.
    if (patch.concurrency !== undefined && patch.concurrency > existing.concurrency)
      scheduler.tick()
    return current()
  })

  app.get('/sources', async () => store.list())

  app.post('/sources', async (req, reply) => {
    const parsed = addSourceSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })
    try {
      if (parsed.data.type === 'repo') await store.addRepo(parsed.data.url)
      else store.addFolder(parsed.data.path)
    } catch (err) {
      if (err instanceof SourceExistsError) return reply.code(409).send({ error: err.message })
      return reply
        .code(400)
        .send({ error: err instanceof Error ? err.message : 'failed to add source' })
    }
    hub.boardChanged()
    return reply.code(201).send(store.list())
  })

  app.delete('/sources/:name', async (req, reply) => {
    const { name } = req.params as { name: string }
    // basename-only: any '/' (or a resolved-away '..') is rejected outright, so the rmSync path
    // this feeds (SourceStore.remove) can never escape the repos dir.
    if (name !== basename(name) || name === '' || name === '.' || name === '..') {
      return reply.code(400).send({ error: 'invalid source name' })
    }
    if (!store.remove(name)) return reply.code(404).send({ error: 'source not found' })
    hub.boardChanged()
    return store.list()
  })
}
