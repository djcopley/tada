import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { describe, expect, test } from 'vitest'
import { createDefaultColumns, openDb, type TadaDb } from '../src/db/index.js'
import { activity, columns, memoryNotes, tickets, workspaces } from '../src/db/schema.js'

function freshDb(): TadaDb {
  return openDb(join(mkdtempSync(join(tmpdir(), 'tada-')), 'tada.db'))
}

describe('db', () => {
  test('migrates, seeds default columns, round-trips a ticket', () => {
    const db = freshDb()
    const [ws] = db.drizzle
      .insert(workspaces)
      .values({ name: 'demo', path: '/tmp/x' })
      .returning()
      .all()
    if (!ws) throw new Error('workspace insert returned no row')
    expect(ws.defaultEffort).toBe('medium')
    createDefaultColumns(db, ws.id)
    const cols = db.drizzle.select().from(columns).all()
    expect(cols.map((c) => c.kind)).toEqual([
      'backlog',
      'ready',
      'in_progress',
      'in_review',
      'done',
    ])
    expect(cols.map((c) => c.title)).toEqual(['Backlog', 'Queued', 'Running', 'In review', 'Done'])
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
    expect(t.origin).toBe('human')
    expect(t.proposalState).toBeNull()
    expect(t.followUpOfTicketId).toBeNull()
    expect(t.effortOverride).toBeNull()
  })

  test('ticket can reference a follow-up parent ticket, cleared on delete', () => {
    const db = freshDb()
    const [ws] = db.drizzle
      .insert(workspaces)
      .values({ name: 'demo2', path: '/tmp/y' })
      .returning()
      .all()
    if (!ws) throw new Error('workspace insert returned no row')
    createDefaultColumns(db, ws.id)
    const [col] = db.drizzle.select().from(columns).all()
    if (!col) throw new Error('no column seeded')
    const [parent] = db.drizzle
      .insert(tickets)
      .values({ workspaceId: ws.id, columnId: col.id, title: 'Parent', position: 1 })
      .returning()
      .all()
    if (!parent) throw new Error('parent ticket insert returned no row')
    const [child] = db.drizzle
      .insert(tickets)
      .values({
        workspaceId: ws.id,
        columnId: col.id,
        title: 'Follow-up',
        position: 2,
        origin: 'agent',
        proposalState: 'pending',
        followUpOfTicketId: parent.id,
      })
      .returning()
      .all()
    if (!child) throw new Error('child ticket insert returned no row')
    expect(child.origin).toBe('agent')
    expect(child.proposalState).toBe('pending')
    expect(child.followUpOfTicketId).toBe(parent.id)

    db.drizzle.delete(tickets).where(eq(tickets.id, parent.id)).run()
    const reloaded = db.drizzle
      .select()
      .from(tickets)
      .all()
      .find((t) => t.id === child.id)
    if (!reloaded) throw new Error('child ticket missing after parent delete')
    expect(reloaded.followUpOfTicketId).toBeNull()
  })

  test('activity and memory_notes tables are queryable', () => {
    const db = freshDb()
    const [ws] = db.drizzle
      .insert(workspaces)
      .values({ name: 'demo3', path: '/tmp/z' })
      .returning()
      .all()
    if (!ws) throw new Error('workspace insert returned no row')

    const [act] = db.drizzle
      .insert(activity)
      .values({ workspaceId: ws.id, type: 'ticket_created', message: 'Ticket created' })
      .returning()
      .all()
    if (!act) throw new Error('activity insert returned no row')
    expect(act.ticketId).toBeNull()
    expect(act.runId).toBeNull()

    const [note] = db.drizzle
      .insert(memoryNotes)
      .values({ scope: 'global', file: 'AGENTS.md', title: 'Global note' })
      .returning()
      .all()
    if (!note) throw new Error('memory note insert returned no row')
    expect(note.author).toBe('human')
    expect(note.state).toBe('kept')
    expect(note.workspaceId).toBeNull()
  })
})
