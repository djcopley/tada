import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { workspaces } from '../db/schema.js'
import type { RouteDeps } from './deps.js'

const putMemorySchema = z.object({ body: z.string() })

function workspaceIdParam(id: string): number | undefined {
  const n = Number(id)
  return Number.isInteger(n) ? n : undefined
}

export function registerMemoryRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, wm } = deps

  app.get('/workspaces/:id/memory', async (req, reply) => {
    const id = workspaceIdParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })

    const existing = db.drizzle.select().from(workspaces).where(eq(workspaces.id, id)).get()
    if (!existing) return reply.code(404).send({ error: 'workspace not found' })

    const memoryDir = wm.memoryDir(id)
    const agentsMd = readFileSync(join(memoryDir, 'AGENTS.md'), 'utf-8')
    const notesDir = join(memoryDir, 'notes')
    const notes = readdirSync(notesDir).map((name) => ({
      name,
      body: readFileSync(join(notesDir, name), 'utf-8'),
    }))

    return { agentsMd, notes }
  })

  // basename-only: any '/' (or a resolved-away '..') in the file param is rejected outright, so
  // the write path can never escape memoryDir - no path.resolve/relative dance needed.
  app.put('/workspaces/:id/memory/:file', async (req, reply) => {
    const id = workspaceIdParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })

    const existing = db.drizzle.select().from(workspaces).where(eq(workspaces.id, id)).get()
    if (!existing) return reply.code(404).send({ error: 'workspace not found' })

    const { file } = req.params as { id: string; file: string }
    if (file !== basename(file) || file === '' || file === '.' || file === '..') {
      return reply.code(400).send({ error: 'invalid file name' })
    }

    const parsed = putMemorySchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })

    const memoryDir = wm.memoryDir(id)
    const dest =
      file === 'AGENTS.md' ? join(memoryDir, 'AGENTS.md') : join(memoryDir, 'notes', file)

    if (!existsSync(join(memoryDir, 'notes')))
      mkdirSync(join(memoryDir, 'notes'), { recursive: true })
    writeFileSync(dest, parsed.data.body)

    return reply.code(204).send()
  })
}
