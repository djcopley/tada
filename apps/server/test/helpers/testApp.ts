import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ColumnKind, RunStatus } from '@tada/shared'
import type { FastifyInstance, InjectOptions } from 'fastify'
import type { Adapter } from '../../src/adapters/types.js'
import { buildApp } from '../../src/app.js'
import type { Config } from '../../src/config.js'
import { loadConfig } from '../../src/config.js'
import { openDb, type TadaDb } from '../../src/db/index.js'
import { agentRuns, tickets } from '../../src/db/schema.js'
import type { LiveActivityChannel } from '../../src/liveActivity.js'
import type { RunnerDeps } from '../../src/runs/runner.js'
import { Scheduler } from '../../src/runs/scheduler.js'
import { SourceStore } from '../../src/sources/store.js'
import { BroadcastHub } from '../../src/ws.js'
import { isolateXdg } from './gitFixtures.js'

export function testDb(): TadaDb {
  return openDb(join(mkdtempSync(join(tmpdir(), 'tada-db-')), 'test.db'))
}

export interface TestApp {
  app: FastifyInstance
  db: TadaDb
  store: SourceStore
  scheduler: Scheduler
  hub: BroadcastHub
  config: Config
  // biome-ignore lint/suspicious/noExplicitAny: test convenience — bodies are asserted ad hoc
  json: (opts: InjectOptions) => Promise<{ status: number; body: any }>
}

/** A real app against a temp SQLite file and an isolated XDG tree. Call in each test (it calls
 * `isolateXdg()` itself). */
export async function makeTestApp(
  opts: {
    adapters?: Map<string, Adapter>
    runner?: Partial<RunnerDeps>
    liveActivity?: LiveActivityChannel
  } = {},
): Promise<TestApp> {
  isolateXdg()
  const db = testDb()
  const store = new SourceStore()
  const adapters = opts.adapters ?? new Map<string, Adapter>()
  const hub = new BroadcastHub()
  const scheduler = new Scheduler({
    db,
    store,
    adapters,
    broadcast: hub.runEvent,
    hub,
    repingMs: 0,
    liveActivity: opts.liveActivity,
    ...opts.runner,
  })
  scheduler.recover()
  const config = loadConfig()
  const app = buildApp({
    db,
    config,
    store,
    scheduler,
    broadcastHub: hub,
    adapters,
    liveActivity: opts.liveActivity,
  })
  await app.ready()

  const json = async (o: InjectOptions) => {
    const res = await app.inject({
      ...o,
      headers: { ...o.headers, authorization: `Bearer ${config.bearerToken}` },
    })
    return { status: res.statusCode, body: res.body.length > 0 ? res.json() : undefined }
  }
  return { app, db, store, scheduler, hub, config, json }
}

export function seedTicket(
  db: TadaDb,
  overrides: Partial<typeof tickets.$inferInsert> & { column?: ColumnKind } = {},
) {
  const [row] = db.drizzle
    .insert(tickets)
    .values({ title: 'Test ticket', description: 'do the thing', position: 1, ...overrides })
    .returning()
    .all()
  if (!row) throw new Error('ticket insert returned no row')
  return row
}

export function seedRun(
  db: TadaDb,
  ticketId: number,
  overrides: Partial<typeof agentRuns.$inferInsert> & { status?: RunStatus } = {},
) {
  const [row] = db.drizzle
    .insert(agentRuns)
    .values({
      ticketId,
      adapter: 'fake',
      model: 'fake-1',
      effort: 'medium',
      status: 'queued',
      budgetMs: 30 * 60 * 1000,
      runToken: `tok-${ticketId}-${Math.random().toString(36).slice(2)}`,
      ...overrides,
    })
    .returning()
    .all()
  if (!row) throw new Error('run insert returned no row')
  return row
}

/** Polls until `pred()` is true (default 5s). */
export async function waitFor(pred: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}
