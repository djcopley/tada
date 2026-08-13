import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { createDefaultColumns, openDb } from '../src/db/index.js'
import { columns, tickets, workspaces } from '../src/db/schema.js'

describe('db', () => {
  test('migrates, seeds default columns, round-trips a ticket', () => {
    const db = openDb(join(mkdtempSync(join(tmpdir(), 'tada-')), 'tada.db'))
    const [ws] = db.drizzle
      .insert(workspaces)
      .values({ name: 'demo', path: '/tmp/x' })
      .returning()
      .all()
    if (!ws) throw new Error('workspace insert returned no row')
    createDefaultColumns(db, ws.id)
    const cols = db.drizzle.select().from(columns).all()
    expect(cols.map((c) => c.kind)).toEqual([
      'backlog',
      'ready',
      'in_progress',
      'in_review',
      'done',
    ])
    const ready = cols.find((c) => c.kind === 'ready')
    if (!ready) throw new Error('ready column not seeded')
    const [t] = db.drizzle
      .insert(tickets)
      .values({
        workspaceId: ws.id,
        columnId: ready.id,
        title: 'Fix crash',
        description: 'Repro: …',
        position: 1,
      })
      .returning()
      .all()
    if (!t) throw new Error('ticket insert returned no row')
    expect(t.queueState).toBeNull()
  })
})
