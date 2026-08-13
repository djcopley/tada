import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { describe, expect, test, vi } from 'vitest'
import type { FakeScript } from '../src/adapters/fake.js'
import { FakeAdapter } from '../src/adapters/fake.js'
import type { Adapter } from '../src/adapters/types.js'
import { createDefaultColumns, openDb, type TadaDb } from '../src/db/index.js'
import { agentRuns, columns, tickets, workspaces } from '../src/db/schema.js'
import { Scheduler } from '../src/runs/scheduler.js'
import { WorkspaceManager } from '../src/workspaces/manager.js'
import { isolateXdg, makeOrigin } from './helpers/gitFixtures.js'

function testDb(): TadaDb {
  return openDb(join(mkdtempSync(join(tmpdir(), 'tada-db-')), 'test.db'))
}

async function makeWorkspace(
  db: TadaDb,
  manager: WorkspaceManager,
  name: string,
  opts: { concurrency?: number } = {},
): Promise<{ wsId: number; readyColId: number; inProgressColId: number }> {
  const wsId = await manager.create(name)
  await manager.addRepo(wsId, await makeOrigin(name))
  if (opts.concurrency !== undefined) {
    db.drizzle
      .update(workspaces)
      .set({ concurrency: opts.concurrency })
      .where(eq(workspaces.id, wsId))
      .run()
  }
  createDefaultColumns(db, wsId)
  const cols = db.drizzle.select().from(columns).where(eq(columns.workspaceId, wsId)).all()
  const readyCol = cols.find((c) => c.kind === 'ready')
  const inProgressCol = cols.find((c) => c.kind === 'in_progress')
  if (!readyCol) throw new Error('ready column not seeded')
  if (!inProgressCol) throw new Error('in_progress column not seeded')
  return { wsId, readyColId: readyCol.id, inProgressColId: inProgressCol.id }
}

function makeTicket(
  db: TadaDb,
  wsId: number,
  columnId: number,
  position: number,
  queueState: 'queued' | 'held' | null,
) {
  const [ticket] = db.drizzle
    .insert(tickets)
    .values({ workspaceId: wsId, columnId, title: `t${position}`, position, queueState })
    .returning()
    .all()
  if (!ticket) throw new Error('ticket insert returned no row')
  return ticket
}

function seedQueuedRun(db: TadaDb, ticketId: number, adapter: string, runToken: string) {
  const [run] = db.drizzle
    .insert(agentRuns)
    .values({ ticketId, adapter, model: 'fake-1', status: 'queued', runToken })
    .returning()
    .all()
  if (!run) throw new Error('agentRun insert returned no row')
  return run
}

function runStatus(db: TadaDb, runId: number): string | undefined {
  return db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, runId)).get()?.status
}

function ticketState(db: TadaDb, ticketId: number) {
  const t = db.drizzle.select().from(tickets).where(eq(tickets.id, ticketId)).get()
  if (!t) throw new Error(`ticket ${ticketId} not found`)
  const col = db.drizzle.select().from(columns).where(eq(columns.id, t.columnId)).get()
  return { columnKind: col?.kind, queueState: t.queueState }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function adaptersWith(entries: Record<string, FakeScript>): Map<string, Adapter> {
  return new Map(Object.entries(entries).map(([name, script]) => [name, new FakeAdapter(script)]))
}

describe('Scheduler', () => {
  test('1. order follows position, not insertion order; second run starts only after first resolves', async () => {
    isolateXdg()
    const db = testDb()
    const manager = new WorkspaceManager(db)
    const { wsId, readyColId } = await makeWorkspace(db, manager, 'ws', { concurrency: 1 })

    // A is inserted first but has the higher position; B should start first.
    const ticketA = makeTicket(db, wsId, readyColId, 2, 'queued')
    const ticketB = makeTicket(db, wsId, readyColId, 1, 'queued')

    const a = deferred()
    const b = deferred()
    const adapters = adaptersWith({
      fakeA: { act: () => a.promise },
      fakeB: { act: () => b.promise },
    })
    const runA = seedQueuedRun(db, ticketA.id, 'fakeA', 'tokA')
    const runB = seedQueuedRun(db, ticketB.id, 'fakeB', 'tokB')

    const scheduler = new Scheduler({ db, wm: manager, adapters, pr: false })
    scheduler.tick()

    expect(runStatus(db, runB.id)).toBe('running')
    expect(runStatus(db, runA.id)).toBe('queued')

    b.resolve()
    await vi.waitFor(() => {
      expect(runStatus(db, runA.id)).toBe('running')
    })

    a.resolve()
    await vi.waitFor(() => {
      expect(runStatus(db, runA.id)).not.toBe('running')
    })
  })

  test('2. concurrency 2 runs both tickets simultaneously', async () => {
    isolateXdg()
    const db = testDb()
    const manager = new WorkspaceManager(db)
    const { wsId, readyColId } = await makeWorkspace(db, manager, 'ws', { concurrency: 2 })

    const ticketA = makeTicket(db, wsId, readyColId, 1, 'queued')
    const ticketB = makeTicket(db, wsId, readyColId, 2, 'queued')

    const a = deferred()
    const b = deferred()
    const adapters = adaptersWith({
      fakeA: { act: () => a.promise },
      fakeB: { act: () => b.promise },
    })
    const runA = seedQueuedRun(db, ticketA.id, 'fakeA', 'tokA')
    const runB = seedQueuedRun(db, ticketB.id, 'fakeB', 'tokB')

    const scheduler = new Scheduler({ db, wm: manager, adapters, pr: false })
    scheduler.tick()

    expect(runStatus(db, runA.id)).toBe('running')
    expect(runStatus(db, runB.id)).toBe('running')

    a.resolve()
    b.resolve()
    await vi.waitFor(() => {
      expect(runStatus(db, runA.id)).not.toBe('running')
      expect(runStatus(db, runB.id)).not.toBe('running')
    })
  })

  test('3. two workspaces, one busy: the other still starts its own run', async () => {
    isolateXdg()
    const db = testDb()
    const manager = new WorkspaceManager(db)
    const ws1 = await makeWorkspace(db, manager, 'ws1', { concurrency: 1 })
    const ws2 = await makeWorkspace(db, manager, 'ws2', { concurrency: 1 })

    const ticket1 = makeTicket(db, ws1.wsId, ws1.readyColId, 1, 'queued')
    const ticket2 = makeTicket(db, ws2.wsId, ws2.readyColId, 1, 'queued')

    const p1 = deferred()
    const p2 = deferred()
    const adapters = adaptersWith({
      fake1: { act: () => p1.promise },
      fake2: { act: () => p2.promise },
    })
    const run1 = seedQueuedRun(db, ticket1.id, 'fake1', 'tok1')
    const run2 = seedQueuedRun(db, ticket2.id, 'fake2', 'tok2')

    const scheduler = new Scheduler({ db, wm: manager, adapters, pr: false })
    scheduler.tick()

    expect(runStatus(db, run1.id)).toBe('running')
    expect(runStatus(db, run2.id)).toBe('running')

    p1.resolve()
    p2.resolve()
    await vi.waitFor(() => {
      expect(runStatus(db, run1.id)).not.toBe('running')
      expect(runStatus(db, run2.id)).not.toBe('running')
    })
  })

  test('4. held tickets are never picked', async () => {
    isolateXdg()
    const db = testDb()
    const manager = new WorkspaceManager(db)
    const { wsId, readyColId } = await makeWorkspace(db, manager, 'ws', { concurrency: 1 })

    // Lower position but held: must be skipped in favor of the queued one.
    const heldTicket = makeTicket(db, wsId, readyColId, 1, 'held')
    const queuedTicket = makeTicket(db, wsId, readyColId, 2, 'queued')

    let heldStarted = false
    const queuedRunDeferred = deferred()
    const adapters = adaptersWith({
      heldAdapter: {
        act: () => {
          heldStarted = true
          return Promise.resolve()
        },
      },
      queuedAdapter: { act: () => queuedRunDeferred.promise },
    })
    const heldRun = seedQueuedRun(db, heldTicket.id, 'heldAdapter', 'tokHeld')
    const queuedRun = seedQueuedRun(db, queuedTicket.id, 'queuedAdapter', 'tokQueued')

    const scheduler = new Scheduler({ db, wm: manager, adapters, pr: false })
    scheduler.tick()

    expect(runStatus(db, queuedRun.id)).toBe('running')
    expect(runStatus(db, heldRun.id)).toBe('queued')
    expect(heldStarted).toBe(false)

    queuedRunDeferred.resolve()
    await vi.waitFor(() => {
      expect(runStatus(db, queuedRun.id)).not.toBe('running')
    })
  })

  test('5. recover() fails orphaned running runs and unwedges the ticket, held', async () => {
    isolateXdg()
    const db = testDb()
    const manager = new WorkspaceManager(db)
    const { wsId, inProgressColId } = await makeWorkspace(db, manager, 'ws', { concurrency: 1 })

    const ticket = makeTicket(db, wsId, inProgressColId, 1, null)
    const run = seedQueuedRun(db, ticket.id, 'fake', 'tokOrphan')
    db.drizzle.update(agentRuns).set({ status: 'running' }).where(eq(agentRuns.id, run.id)).run()

    const scheduler = new Scheduler({
      db,
      wm: manager,
      adapters: adaptersWith({}),
      pr: false,
    })
    scheduler.recover()

    expect(runStatus(db, run.id)).toBe('failed')
    expect(ticketState(db, ticket.id)).toEqual({ columnKind: 'ready', queueState: 'held' })
  })

  test('5b. recover() cancels orphaned queued runs and unwedges the ticket, held', async () => {
    isolateXdg()
    const db = testDb()
    const manager = new WorkspaceManager(db)
    const { wsId, readyColId } = await makeWorkspace(db, manager, 'ws', { concurrency: 1 })

    const ticket = makeTicket(db, wsId, readyColId, 1, 'queued')
    const run = seedQueuedRun(db, ticket.id, 'fake', 'tokOrphan')

    const scheduler = new Scheduler({
      db,
      wm: manager,
      adapters: adaptersWith({}),
      pr: false,
    })
    scheduler.recover()

    expect(runStatus(db, run.id)).toBe('cancelled')
    expect(ticketState(db, ticket.id)).toEqual({ columnKind: 'ready', queueState: 'held' })
  })

  test('6. cancel mid-run aborts the adapter signal and marks the run cancelled', async () => {
    isolateXdg()
    const db = testDb()
    const manager = new WorkspaceManager(db)
    const { wsId, readyColId } = await makeWorkspace(db, manager, 'ws', { concurrency: 1 })

    const ticket = makeTicket(db, wsId, readyColId, 1, null)

    let started = false
    let sawAbort = false
    const script: FakeScript = {
      act: (ctx) =>
        new Promise<void>((resolve) => {
          started = true
          ctx.signal.addEventListener('abort', () => {
            sawAbort = true
          })
          setTimeout(resolve, 60_000).unref()
        }),
    }
    const adapters = adaptersWith({ fake: script })

    const scheduler = new Scheduler({ db, wm: manager, adapters, pr: false })
    const runId = scheduler.enqueue(ticket.id, { adapter: 'fake', model: 'fake-1' })

    expect(runStatus(db, runId)).toBe('running')

    // The adapter starts only after the (real, async) run-directory build completes; cancel
    // once it's actually acting so the abort listener is attached before we abort.
    await vi.waitFor(() => {
      expect(started).toBe(true)
    })

    scheduler.cancel(runId)

    await vi.waitFor(() => {
      expect(runStatus(db, runId)).toBe('cancelled')
    })
    expect(sawAbort).toBe(true)
    expect(ticketState(db, ticket.id)).toEqual({ columnKind: 'ready', queueState: null })
  })

  test('enqueue: throws on unknown adapter name', async () => {
    isolateXdg()
    const db = testDb()
    const manager = new WorkspaceManager(db)
    const { wsId, readyColId } = await makeWorkspace(db, manager, 'ws', { concurrency: 1 })
    const ticket = makeTicket(db, wsId, readyColId, 1, null)

    const scheduler = new Scheduler({ db, wm: manager, adapters: adaptersWith({}), pr: false })

    expect(() => scheduler.enqueue(ticket.id, { adapter: 'nope' })).toThrow(/unknown adapter/)
  })

  test('enqueue: resolves adapter/model from ticket override, falling back to workspace default', async () => {
    isolateXdg()
    const db = testDb()
    const manager = new WorkspaceManager(db)
    const { wsId, readyColId } = await makeWorkspace(db, manager, 'ws', { concurrency: 1 })
    db.drizzle
      .update(workspaces)
      .set({ defaultAdapter: 'fake', defaultModel: 'fake-1' })
      .where(eq(workspaces.id, wsId))
      .run()

    const never = deferred()
    const adapters = adaptersWith({ fake: { act: () => never.promise } })
    const ticket = makeTicket(db, wsId, readyColId, 1, null)

    const scheduler = new Scheduler({ db, wm: manager, adapters, pr: false })
    const runId = scheduler.enqueue(ticket.id)

    const run = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, runId)).get()
    expect(run?.adapter).toBe('fake')
    expect(run?.model).toBe('fake-1')

    never.resolve()
    await vi.waitFor(() => {
      expect(runStatus(db, runId)).not.toBe('running')
    })
  })
})
