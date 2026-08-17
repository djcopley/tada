import type { ApiMemoryNote } from '@tada/shared'
import { asc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { recordActivity } from '../activity.js'
import { memoryNotes } from '../db/schema.js'
import { intParam, type RouteDeps } from './deps.js'

const noteBody = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(100_000),
  tags: z.array(z.string().min(1)).default([]),
})

type NoteRow = typeof memoryNotes.$inferSelect

export function publicNote(row: NoteRow): ApiMemoryNote {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    tags: row.tags,
    author: row.author,
    runId: row.runId,
    state: row.state,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function registerMemoryRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, hub, store } = deps

  const noteById = (id: number) =>
    db.drizzle.select().from(memoryNotes).where(eq(memoryNotes.id, id)).get()

  /** Tags are repo names — a note tagged to a repo nobody has connected would never be read. */
  const validTags = (tags: string[]): string | undefined => {
    const known = new Set(store.repos().map((r) => r.name))
    const bad = tags.filter((t) => !known.has(t))
    return bad.length ? `unknown repo tag: ${bad.join(', ')}` : undefined
  }

  app.get(
    '/memory',
    async (): Promise<ApiMemoryNote[]> =>
      db.drizzle.select().from(memoryNotes).orderBy(asc(memoryNotes.id)).all().map(publicNote),
  )

  app.post('/memory', async (req, reply) => {
    const parsed = noteBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })
    const tagErr = validTags(parsed.data.tags)
    if (tagErr) return reply.code(400).send({ error: tagErr })
    const [row] = db.drizzle
      .insert(memoryNotes)
      .values({ ...parsed.data, author: 'human', state: 'kept' })
      .returning()
      .all()
    if (!row) return reply.code(500).send({ error: 'failed to create note' })
    hub.boardChanged()
    return reply.code(201).send(publicNote(row))
  })

  app.patch('/memory/:id', async (req, reply) => {
    const id = intParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })
    if (!noteById(id)) return reply.code(404).send({ error: 'not found' })
    const parsed = noteBody.partial().safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })
    if (parsed.data.tags) {
      const tagErr = validTags(parsed.data.tags)
      if (tagErr) return reply.code(400).send({ error: tagErr })
    }
    // A human edit takes ownership: the note is theirs and kept, whatever it was before.
    db.drizzle
      .update(memoryNotes)
      .set({ ...parsed.data, author: 'human', state: 'kept', updatedAt: new Date() })
      .where(eq(memoryNotes.id, id))
      .run()
    hub.boardChanged()
    const fresh = noteById(id)
    return fresh ? publicNote(fresh) : fresh
  })

  app.delete('/memory/:id', async (req, reply) => {
    const id = intParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })
    if (!noteById(id)) return reply.code(404).send({ error: 'not found' })
    db.drizzle.delete(memoryNotes).where(eq(memoryNotes.id, id)).run()
    hub.boardChanged()
    return reply.code(204).send()
  })

  app.post('/memory/:id/keep', async (req, reply) => {
    const id = intParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })
    const row = noteById(id)
    if (row?.state !== 'pending') return reply.code(404).send({ error: 'not found' })
    db.drizzle
      .update(memoryNotes)
      .set({ state: 'kept', updatedAt: new Date() })
      .where(eq(memoryNotes.id, id))
      .run()
    recordActivity(db, hub, {
      runId: row.runId ?? undefined,
      type: 'note_kept',
      message: `You kept the memory note "${row.title}"`,
    })
    hub.boardChanged()
    return reply.code(204).send()
  })

  app.post('/memory/:id/dismiss', async (req, reply) => {
    const id = intParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })
    const row = noteById(id)
    if (row?.state !== 'pending') return reply.code(404).send({ error: 'not found' })
    db.drizzle.delete(memoryNotes).where(eq(memoryNotes.id, id)).run()
    recordActivity(db, hub, {
      runId: row.runId ?? undefined,
      type: 'note_discarded',
      message: `You dismissed the memory note "${row.title}"`,
    })
    hub.boardChanged()
    return reply.code(204).send()
  })
}
