import { once } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ApiActivity } from '@tada/shared'
import { eq } from 'drizzle-orm'
import type { FastifyInstance, InjectOptions } from 'fastify'
import { beforeEach, describe, expect, test } from 'vitest'
import { WebSocket } from 'ws'
import { buildApp } from '../src/app.js'
import type { Config } from '../src/config.js'
import { loadConfig } from '../src/config.js'
import { createDefaultColumns, openDb, type TadaDb } from '../src/db/index.js'
import { activity, columns, tickets } from '../src/db/schema.js'
import { Scheduler } from '../src/runs/scheduler.js'
import { WorkspaceManager } from '../src/workspaces/manager.js'
import { BroadcastHub } from '../src/ws.js'
import { isolateXdg } from './helpers/gitFixtures.js'

async function setupApp() {
  const db = openDb(join(mkdtempSync(join(tmpdir(), 'tada-activity-')), 'tada.db'))
  const wm = new WorkspaceManager(db)
  const hub = new BroadcastHub(db)
  const scheduler = new Scheduler({
    db,
    wm,
    adapters: new Map(),
    broadcast: hub.broadcast,
    hub,
    pr: false,
  })
  const config = loadConfig()
  const app = buildApp({ db, config, wm, scheduler, broadcastHub: hub, adapters: new Map() })
  await app.ready()
  return { app, db, wm, hub, config }
}

function authed(config: Config, opts: InjectOptions): InjectOptions {
  return { ...opts, headers: { ...opts.headers, authorization: `Bearer ${config.bearerToken}` } }
}

async function json(app: FastifyInstance, config: Config, opts: InjectOptions) {
  const res = await app.inject(authed(config, opts))
  return { status: res.statusCode, body: res.body.length > 0 ? res.json() : undefined }
}

async function seedWorkspace(db: TadaDb, wm: WorkspaceManager, name: string) {
  const wsId = await wm.create(name)
  createDefaultColumns(db, wsId)
  return wsId
}

function backlogColumnId(db: TadaDb, workspaceId: number): number {
  const col = db.drizzle
    .select()
    .from(columns)
    .where(eq(columns.workspaceId, workspaceId))
    .all()
    .find((c) => c.kind === 'backlog')
  if (!col) throw new Error('no backlog column')
  return col.id
}

function seedTicket(db: TadaDb, workspaceId: number, title: string) {
  const [t] = db.drizzle
    .insert(tickets)
    .values({
      workspaceId,
      columnId: backlogColumnId(db, workspaceId),
      title,
      description: '',
      position: 1,
    })
    .returning()
    .all()
  if (!t) throw new Error('ticket insert returned no row')
  return t
}

function seedActivity(
  db: TadaDb,
  workspaceId: number,
  opts: { ticketId?: number; message: string },
) {
  db.drizzle
    .insert(activity)
    .values({
      workspaceId,
      ticketId: opts.ticketId ?? null,
      type: 'ticket_created',
      message: opts.message,
    })
    .run()
}

describe('GET /activity', () => {
  beforeEach(() => {
    isolateXdg()
  })

  test('returns rows newest-first, joins ticketTitle, respects workspace filter and limit', async () => {
    const { app, db, wm, config } = await setupApp()
    const wsA = await seedWorkspace(db, wm, 'ws-a')
    const wsB = await seedWorkspace(db, wm, 'ws-b')

    const ticket = seedTicket(db, wsA, 'Fix the thing')
    seedActivity(db, wsA, { ticketId: ticket.id, message: 'first' })
    seedActivity(db, wsA, { ticketId: ticket.id, message: 'second' })
    seedActivity(db, wsA, { message: 'third, no ticket' })
    seedActivity(db, wsB, { message: 'other workspace' })

    const res = await json(app, config, { method: 'GET', url: `/activity?workspaceId=${wsA}` })
    expect(res.status).toBe(200)
    const rows = res.body as ApiActivity[]
    expect(rows.map((r) => r.message)).toEqual(['third, no ticket', 'second', 'first'])
    expect(rows.every((r) => r.workspaceId === wsA)).toBe(true)
    expect(rows.find((r) => r.message === 'first')?.ticketTitle).toBe('Fix the thing')
    expect(rows.find((r) => r.message === 'third, no ticket')?.ticketTitle).toBeNull()

    const limited = await json(app, config, {
      method: 'GET',
      url: `/activity?workspaceId=${wsA}&limit=2`,
    })
    expect((limited.body as ApiActivity[]).map((r) => r.message)).toEqual([
      'third, no ticket',
      'second',
    ])
  })

  test('omitting workspaceId returns activity across all workspaces', async () => {
    const { app, db, wm, config } = await setupApp()
    const wsA = await seedWorkspace(db, wm, 'ws-a')
    const wsB = await seedWorkspace(db, wm, 'ws-b')
    seedActivity(db, wsA, { message: 'from a' })
    seedActivity(db, wsB, { message: 'from b' })

    const res = await json(app, config, { method: 'GET', url: '/activity' })
    expect(res.status).toBe(200)
    const messages = (res.body as ApiActivity[]).map((r) => r.message)
    expect(messages).toContain('from a')
    expect(messages).toContain('from b')
  })

  test('ticketTitle is null when the referenced ticket has been deleted', async () => {
    const { app, db, wm, config } = await setupApp()
    const wsA = await seedWorkspace(db, wm, 'ws-a')
    const ticket = seedTicket(db, wsA, 'Ephemeral')
    seedActivity(db, wsA, { ticketId: ticket.id, message: 'about a doomed ticket' })
    db.drizzle.delete(tickets).where(eq(tickets.id, ticket.id)).run()

    const res = await json(app, config, { method: 'GET', url: `/activity?workspaceId=${wsA}` })
    const row = (res.body as ApiActivity[]).find((r) => r.message === 'about a doomed ticket')
    expect(row?.ticketTitle).toBeNull()
    expect(row?.ticketId).toBe(ticket.id)
  })

  test('defaults to a limit of 50', async () => {
    const { app, db, wm, config } = await setupApp()
    const wsA = await seedWorkspace(db, wm, 'ws-a')
    for (let i = 0; i < 60; i++) seedActivity(db, wsA, { message: `row ${i}` })

    const res = await json(app, config, { method: 'GET', url: `/activity?workspaceId=${wsA}` })
    expect((res.body as ApiActivity[]).length).toBe(50)
  })
})

describe('activity feed live broadcast', () => {
  beforeEach(() => {
    isolateXdg()
  })

  test('recordActivity (via POST /tickets) broadcasts an activity WS message', async () => {
    const db = openDb(join(mkdtempSync(join(tmpdir(), 'tada-activity-ws-')), 'tada.db'))
    const wm = new WorkspaceManager(db)
    const hub = new BroadcastHub(db)
    const scheduler = new Scheduler({
      db,
      wm,
      adapters: new Map(),
      broadcast: hub.broadcast,
      hub,
      pr: false,
    })
    const config = loadConfig()
    const app = buildApp({ db, config, wm, scheduler, broadcastHub: hub, adapters: new Map() })
    const wsId = await seedWorkspace(db, wm, 'ws-live')

    const address = await app.listen({ port: 0, host: '127.0.0.1' })
    const port = Number(new URL(address).port)

    const sock = new WebSocket(
      `ws://127.0.0.1:${port}/ws?workspaceId=${wsId}&token=${config.bearerToken}`,
    )
    await once(sock, 'open')

    const res = await app.inject(
      authed(config, {
        method: 'POST',
        url: '/tickets',
        payload: { workspaceId: wsId, title: 'Live update me' },
      }),
    )
    expect(res.statusCode).toBe(201)

    const [raw] = await once(sock, 'message')
    expect(JSON.parse(String(raw))).toEqual({ type: 'activity', workspaceId: wsId })

    sock.close()
    await app.close()
  })
})
