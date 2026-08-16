import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import type { ApiMemory, ApiMemoryNote, MemoryScope } from '@tada/shared'
import { and, eq, isNull, type SQL } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { recordActivity } from '../activity.js'
import type { TadaDb } from '../db/index.js'
import { memoryNotes, workspaces } from '../db/schema.js'
import { ensureGlobalMemoryDir, globalMemoryDir } from '../paths.js'
import type { RouteDeps } from './deps.js'

const putMemorySchema = z.object({ body: z.string() })

function positiveIntParam(id: string): number | undefined {
  const n = Number(id)
  return Number.isInteger(n) ? n : undefined
}

// basename-only: any '/' (or a resolved-away '..') in the file param is rejected outright, so
// the write/delete path can never escape the memory dir - no path.resolve/relative dance needed.
// Notes must be `*.md` (readMemory only lists .md files, so anything else would be written and
// then invisible), and only the exact `AGENTS.md` is the charter - a case-variant would otherwise
// become a note that shadows it in the agent's eyes.
function isSafeFile(file: string): boolean {
  if (file !== basename(file) || file === '' || file === '.' || file === '..') return false
  if (!file.endsWith('.md')) return false
  if (file.toLowerCase() === 'agents.md' && file !== 'AGENTS.md') return false
  return true
}

/** Note title: first `# ` heading in the body, else the filename with `.md` stripped. */
function titleFor(body: string, file: string): string {
  const heading = /^#\s+(.+)$/m.exec(body)
  const heading1 = heading?.[1]
  if (heading1) return heading1.trim()
  return file.endsWith('.md') ? file.slice(0, -'.md'.length) : file
}

function scopeFilter(scope: MemoryScope, workspaceId: number | null): SQL | undefined {
  return workspaceId === null
    ? and(eq(memoryNotes.scope, scope), isNull(memoryNotes.workspaceId))
    : and(eq(memoryNotes.scope, scope), eq(memoryNotes.workspaceId, workspaceId))
}

/** Reads AGENTS.md + notes/*.md from `dir`, joining each note file with its `memory_notes`
 * metadata row. A note file with no row on disk (e.g. hand-placed) gets one lazily created here
 * with author 'human' / state 'kept' - every note file always ends up with stable provenance and
 * a real id, and this only ever happens once per file. */
function readMemory(
  db: TadaDb,
  scope: MemoryScope,
  workspaceId: number | null,
  dir: string,
): ApiMemory {
  const agentsMd = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
  const notesDir = join(dir, 'notes')
  mkdirSync(notesDir, { recursive: true })

  const rows = db.drizzle.select().from(memoryNotes).where(scopeFilter(scope, workspaceId)).all()
  const byFile = new Map(rows.map((r) => [r.file, r]))

  const files = readdirSync(notesDir).filter((f) => f.endsWith('.md'))
  const notes: ApiMemoryNote[] = files.map((file) => {
    const body = readFileSync(join(notesDir, file), 'utf-8')
    let row = byFile.get(file)
    if (!row) {
      const [inserted] = db.drizzle
        .insert(memoryNotes)
        .values({
          scope,
          workspaceId,
          file,
          title: titleFor(body, file),
          author: 'human',
          state: 'kept',
        })
        .returning()
        .all()
      if (!inserted) throw new Error('memory note insert returned no row')
      row = inserted
    }

    return {
      id: row.id,
      scope: row.scope,
      workspaceId: row.workspaceId,
      file: row.file,
      title: row.title,
      author: row.author,
      runId: row.runId,
      state: row.state,
      body,
      updatedAt: row.updatedAt,
    }
  })

  return { agentsMd, notes }
}

/** Human PUT: writes the file to disk, then (for note files, not AGENTS.md) upserts memory_notes
 * metadata to author 'human' / state 'kept'. AGENTS.md is the charter, not a note - it has no
 * metadata row. */
function writeMemory(
  db: TadaDb,
  scope: MemoryScope,
  workspaceId: number | null,
  dir: string,
  file: string,
  body: string,
): void {
  const notesDir = join(dir, 'notes')
  mkdirSync(notesDir, { recursive: true })
  const dest = file === 'AGENTS.md' ? join(dir, 'AGENTS.md') : join(notesDir, file)
  writeFileSync(dest, body)

  if (file === 'AGENTS.md') return

  const title = titleFor(body, file)
  const existing = db.drizzle
    .select()
    .from(memoryNotes)
    .where(and(scopeFilter(scope, workspaceId), eq(memoryNotes.file, file)))
    .get()

  if (existing) {
    db.drizzle
      .update(memoryNotes)
      .set({ title, author: 'human', state: 'kept', updatedAt: new Date().toISOString() })
      .where(eq(memoryNotes.id, existing.id))
      .run()
  } else {
    db.drizzle
      .insert(memoryNotes)
      .values({ scope, workspaceId, file, title, author: 'human', state: 'kept' })
      .run()
  }
}

/** Deletes a note file from disk plus its metadata row, if any. Returns false if the file didn't
 * exist (caller should 404). */
function deleteMemory(
  db: TadaDb,
  scope: MemoryScope,
  workspaceId: number | null,
  dir: string,
  file: string,
): boolean {
  const dest = join(dir, 'notes', file)
  if (!existsSync(dest)) return false
  unlinkSync(dest)
  db.drizzle
    .delete(memoryNotes)
    .where(and(scopeFilter(scope, workspaceId), eq(memoryNotes.file, file)))
    .run()
  return true
}

export function registerMemoryRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, wm, hub } = deps

  app.get('/memory', async () => readMemory(db, 'global', null, ensureGlobalMemoryDir()))

  app.put('/memory/:file', async (req, reply) => {
    const { file } = req.params as { file: string }
    if (!isSafeFile(file)) return reply.code(400).send({ error: 'invalid file name' })

    const parsed = putMemorySchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })

    writeMemory(db, 'global', null, ensureGlobalMemoryDir(), file, parsed.data.body)
    return reply.code(204).send()
  })

  app.delete('/memory/:file', async (req, reply) => {
    const { file } = req.params as { file: string }
    if (!isSafeFile(file) || file === 'AGENTS.md')
      return reply.code(400).send({ error: 'invalid file name' })

    const deleted = deleteMemory(db, 'global', null, ensureGlobalMemoryDir(), file)
    if (!deleted) return reply.code(404).send({ error: 'not found' })
    return reply.code(204).send()
  })

  app.get('/workspaces/:id/memory', async (req, reply) => {
    const id = positiveIntParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })

    const existing = db.drizzle.select().from(workspaces).where(eq(workspaces.id, id)).get()
    if (!existing) return reply.code(404).send({ error: 'workspace not found' })

    return readMemory(db, 'workspace', id, wm.memoryDir(id))
  })

  app.put('/workspaces/:id/memory/:file', async (req, reply) => {
    const id = positiveIntParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })

    const existing = db.drizzle.select().from(workspaces).where(eq(workspaces.id, id)).get()
    if (!existing) return reply.code(404).send({ error: 'workspace not found' })

    const { file } = req.params as { id: string; file: string }
    if (!isSafeFile(file)) return reply.code(400).send({ error: 'invalid file name' })

    const parsed = putMemorySchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })

    writeMemory(db, 'workspace', id, wm.memoryDir(id), file, parsed.data.body)
    return reply.code(204).send()
  })

  app.delete('/workspaces/:id/memory/:file', async (req, reply) => {
    const id = positiveIntParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })

    const existing = db.drizzle.select().from(workspaces).where(eq(workspaces.id, id)).get()
    if (!existing) return reply.code(404).send({ error: 'workspace not found' })

    const { file } = req.params as { id: string; file: string }
    if (!isSafeFile(file) || file === 'AGENTS.md')
      return reply.code(400).send({ error: 'invalid file name' })

    const deleted = deleteMemory(db, 'workspace', id, wm.memoryDir(id), file)
    if (!deleted) return reply.code(404).send({ error: 'not found' })
    return reply.code(204).send()
  })

  app.post('/memory-notes/:id/keep', async (req, reply) => {
    const id = positiveIntParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })

    const row = db.drizzle.select().from(memoryNotes).where(eq(memoryNotes.id, id)).get()
    if (row?.state !== 'pending') return reply.code(404).send({ error: 'not found' })

    db.drizzle
      .update(memoryNotes)
      .set({ state: 'kept', updatedAt: new Date().toISOString() })
      .where(eq(memoryNotes.id, id))
      .run()

    // Pending notes only ever come from write_memory_note, which targets workspace scope - so a
    // pending row always carries a workspaceId. Guard anyway rather than assume.
    if (row.workspaceId != null) {
      recordActivity(db, hub, {
        workspaceId: row.workspaceId,
        runId: row.runId ?? undefined,
        type: 'note_kept',
        message: `Kept memory note: ${row.title}`,
      })
    }

    return reply.code(204).send()
  })

  app.post('/memory-notes/:id/discard', async (req, reply) => {
    const id = positiveIntParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })

    const row = db.drizzle.select().from(memoryNotes).where(eq(memoryNotes.id, id)).get()
    if (row?.state !== 'pending') return reply.code(404).send({ error: 'not found' })

    const dir = row.scope === 'global' ? globalMemoryDir() : wm.memoryDir(row.workspaceId as number)
    const filePath = join(dir, 'notes', row.file)
    if (existsSync(filePath)) unlinkSync(filePath)
    db.drizzle.delete(memoryNotes).where(eq(memoryNotes.id, id)).run()

    if (row.workspaceId != null) {
      recordActivity(db, hub, {
        workspaceId: row.workspaceId,
        runId: row.runId ?? undefined,
        type: 'note_discarded',
        message: `Discarded memory note: ${row.title}`,
      })
    }

    return reply.code(204).send()
  })
}
