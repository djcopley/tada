import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ApiMemory } from '@tada/shared'
import { eq } from 'drizzle-orm'
import type { FastifyInstance, InjectOptions } from 'fastify'
import { beforeEach, describe, expect, test } from 'vitest'
import { buildApp } from '../src/app.js'
import type { Config } from '../src/config.js'
import { loadConfig } from '../src/config.js'
import { openDb } from '../src/db/index.js'
import { activity, memoryNotes } from '../src/db/schema.js'
import { globalMemoryDir } from '../src/paths.js'
import { Scheduler } from '../src/runs/scheduler.js'
import { WorkspaceManager } from '../src/workspaces/manager.js'
import { BroadcastHub } from '../src/ws.js'
import { isolateXdg } from './helpers/gitFixtures.js'

async function setupApp() {
  const db = openDb(join(mkdtempSync(join(tmpdir(), 'tada-memory-')), 'tada.db'))
  const wm = new WorkspaceManager(db)
  const hub = new BroadcastHub(db)
  const scheduler = new Scheduler({
    db,
    wm,
    adapters: new Map(),
    broadcast: hub.broadcast,
    pr: false,
  })
  const config = loadConfig()
  const app = buildApp({ db, config, wm, scheduler, broadcastHub: hub, adapters: new Map() })
  await app.ready()
  return { app, db, wm, config }
}

function authed(config: Config, opts: InjectOptions): InjectOptions {
  return { ...opts, headers: { ...opts.headers, authorization: `Bearer ${config.bearerToken}` } }
}

async function json(app: FastifyInstance, config: Config, opts: InjectOptions) {
  const res = await app.inject(authed(config, opts))
  return { status: res.statusCode, body: res.body.length > 0 ? res.json() : undefined }
}

describe('memory routes', () => {
  beforeEach(() => {
    isolateXdg()
  })

  test('GET /memory returns the seeded global AGENTS.md and no notes', async () => {
    const { app, config } = await setupApp()

    const res = await json(app, config, { method: 'GET', url: '/memory' })
    expect(res.status).toBe(200)
    const body = res.body as ApiMemory
    expect(body.agentsMd).toContain('Global memory')
    expect(body.notes).toEqual([])
  })

  test('PUT /memory/AGENTS.md then GET round-trips the charter, with no note created', async () => {
    const { app, config } = await setupApp()

    const put = await json(app, config, {
      method: 'PUT',
      url: '/memory/AGENTS.md',
      payload: { body: '# Global\n\nUpdated charter.\n' },
    })
    expect(put.status).toBe(204)

    const res = await json(app, config, { method: 'GET', url: '/memory' })
    const body = res.body as ApiMemory
    expect(body.agentsMd).toBe('# Global\n\nUpdated charter.\n')
    expect(body.notes).toEqual([])
  })

  test('PUT /memory/:file writes a note file and upserts human/kept metadata; GET round-trips it', async () => {
    const { app, config } = await setupApp()

    const put = await json(app, config, {
      method: 'PUT',
      url: '/memory/build-quirks.md',
      payload: { body: '# Build quirks\n\nUse pnpm.\n' },
    })
    expect(put.status).toBe(204)

    const res = await json(app, config, { method: 'GET', url: '/memory' })
    const body = res.body as ApiMemory
    expect(body.notes).toHaveLength(1)
    const note = body.notes[0]
    expect(note).toBeDefined()
    expect(note?.scope).toBe('global')
    expect(note?.workspaceId).toBeNull()
    expect(note?.file).toBe('build-quirks.md')
    expect(note?.title).toBe('Build quirks')
    expect(note?.author).toBe('human')
    expect(note?.state).toBe('kept')
    expect(note?.body).toBe('# Build quirks\n\nUse pnpm.\n')
  })

  test('PUT /memory rejects a path-traversal file name', async () => {
    const { app, config } = await setupApp()
    const res = await json(app, config, {
      method: 'PUT',
      url: '/memory/..%2Fevil',
      payload: { body: 'pwned' },
    })
    expect(res.status).toBe(400)
  })

  test('a note file placed on disk without a metadata row is treated as kept/human on GET (lazy row)', async () => {
    const { app, config, db } = await setupApp()

    mkdirSync(join(globalMemoryDir(), 'notes'), { recursive: true })
    writeFileSync(join(globalMemoryDir(), 'notes', 'hand-placed.md'), '# Hand placed\n\nBody.\n')

    const res = await json(app, config, { method: 'GET', url: '/memory' })
    const body = res.body as ApiMemory
    expect(body.notes).toHaveLength(1)
    const note = body.notes[0]
    expect(note?.file).toBe('hand-placed.md')
    expect(note?.author).toBe('human')
    expect(note?.state).toBe('kept')
    expect(typeof note?.id).toBe('number')

    // the lazy row is persisted, not recomputed each time
    const rows = db.drizzle
      .select()
      .from(memoryNotes)
      .where(eq(memoryNotes.file, 'hand-placed.md'))
      .all()
    expect(rows).toHaveLength(1)
  })

  test('DELETE /memory/:file removes the file and its row; second delete 404s', async () => {
    const { app, config } = await setupApp()
    await json(app, config, {
      method: 'PUT',
      url: '/memory/scratch.md',
      payload: { body: '# Scratch\n' },
    })

    const del = await json(app, config, { method: 'DELETE', url: '/memory/scratch.md' })
    expect(del.status).toBe(204)

    const res = await json(app, config, { method: 'GET', url: '/memory' })
    const body = res.body as ApiMemory
    expect(body.notes).toEqual([])

    const del2 = await json(app, config, { method: 'DELETE', url: '/memory/scratch.md' })
    expect(del2.status).toBe(404)
  })

  test('DELETE /memory/AGENTS.md is rejected (charter is not a deletable note)', async () => {
    const { app, config } = await setupApp()
    const res = await json(app, config, { method: 'DELETE', url: '/memory/AGENTS.md' })
    expect(res.status).toBe(400)
  })

  test('workspace-scoped GET/PUT/DELETE round-trip mirrors the global routes', async () => {
    const { app, config } = await setupApp()
    const ws = await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'ws1' },
    })
    const wsId = (ws.body as { id: number }).id

    const put = await json(app, config, {
      method: 'PUT',
      url: `/workspaces/${wsId}/memory/note-a.md`,
      payload: { body: '# Note A\n\nHello.\n' },
    })
    expect(put.status).toBe(204)

    const res = await json(app, config, { method: 'GET', url: `/workspaces/${wsId}/memory` })
    const body = res.body as ApiMemory
    expect(body.notes).toHaveLength(1)
    expect(body.notes[0]).toMatchObject({
      scope: 'workspace',
      workspaceId: wsId,
      file: 'note-a.md',
      title: 'Note A',
      author: 'human',
      state: 'kept',
    })

    const del = await json(app, config, {
      method: 'DELETE',
      url: `/workspaces/${wsId}/memory/note-a.md`,
    })
    expect(del.status).toBe(204)

    const res2 = await json(app, config, { method: 'GET', url: `/workspaces/${wsId}/memory` })
    expect((res2.body as ApiMemory).notes).toEqual([])
  })

  test('POST /memory-notes/:id/keep 404s on a non-pending (kept) note', async () => {
    const { app, config } = await setupApp()
    await json(app, config, {
      method: 'PUT',
      url: '/memory/kept-one.md',
      payload: { body: '# Kept one\n' },
    })
    const get = await json(app, config, { method: 'GET', url: '/memory' })
    const noteId = ((get.body as ApiMemory).notes[0] as { id: number }).id

    const res = await json(app, config, { method: 'POST', url: `/memory-notes/${noteId}/keep` })
    expect(res.status).toBe(404)
  })

  test('POST /memory-notes/:id/discard 404s on a non-pending (kept) note', async () => {
    const { app, config } = await setupApp()
    await json(app, config, {
      method: 'PUT',
      url: '/memory/kept-two.md',
      payload: { body: '# Kept two\n' },
    })
    const get = await json(app, config, { method: 'GET', url: '/memory' })
    const noteId = ((get.body as ApiMemory).notes[0] as { id: number }).id

    const res = await json(app, config, { method: 'POST', url: `/memory-notes/${noteId}/discard` })
    expect(res.status).toBe(404)
  })

  test('POST /memory-notes/:id/keep transitions a pending agent note to kept, leaves the file, records activity', async () => {
    const { app, config, db, wm } = await setupApp()
    const ws = await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'ws2' },
    })
    const wsId = (ws.body as { id: number }).id

    writeFileSync(
      join(wm.memoryDir(wsId), 'notes', 'agent-note.md'),
      '# Agent note\n\nLearned something.\n',
    )
    const [row] = db.drizzle
      .insert(memoryNotes)
      .values({
        scope: 'workspace',
        workspaceId: wsId,
        file: 'agent-note.md',
        title: 'Agent note',
        author: 'agent',
        state: 'pending',
      })
      .returning()
      .all()
    if (!row) throw new Error('note insert returned no row')

    const res = await json(app, config, { method: 'POST', url: `/memory-notes/${row.id}/keep` })
    expect(res.status).toBe(204)

    const reloaded = db.drizzle.select().from(memoryNotes).where(eq(memoryNotes.id, row.id)).get()
    expect(reloaded?.state).toBe('kept')
    expect(readFileSync(join(wm.memoryDir(wsId), 'notes', 'agent-note.md'), 'utf-8')).toContain(
      'Learned something.',
    )

    const acts = db.drizzle.select().from(activity).where(eq(activity.workspaceId, wsId)).all()
    expect(acts.some((a) => a.type === 'note_kept')).toBe(true)
  })

  test('POST /memory-notes/:id/discard deletes the file and the row, records activity', async () => {
    const { app, config, db, wm } = await setupApp()
    const ws = await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'ws3' },
    })
    const wsId = (ws.body as { id: number }).id

    const notePath = join(wm.memoryDir(wsId), 'notes', 'discard-me.md')
    writeFileSync(notePath, '# Discard me\n\nNot useful.\n')
    const [row] = db.drizzle
      .insert(memoryNotes)
      .values({
        scope: 'workspace',
        workspaceId: wsId,
        file: 'discard-me.md',
        title: 'Discard me',
        author: 'agent',
        state: 'pending',
      })
      .returning()
      .all()
    if (!row) throw new Error('note insert returned no row')

    const res = await json(app, config, { method: 'POST', url: `/memory-notes/${row.id}/discard` })
    expect(res.status).toBe(204)

    const reloaded = db.drizzle.select().from(memoryNotes).where(eq(memoryNotes.id, row.id)).get()
    expect(reloaded).toBeUndefined()

    const { existsSync } = await import('node:fs')
    expect(existsSync(notePath)).toBe(false)

    const acts = db.drizzle.select().from(activity).where(eq(activity.workspaceId, wsId)).all()
    expect(acts.some((a) => a.type === 'note_discarded')).toBe(true)
  })

  test('POST /memory-notes/:id/keep 404s on unknown id', async () => {
    const { app, config } = await setupApp()
    const res = await json(app, config, { method: 'POST', url: '/memory-notes/999999/keep' })
    expect(res.status).toBe(404)
  })
})
