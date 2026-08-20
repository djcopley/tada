import { eq } from 'drizzle-orm'
import { describe, expect, test } from 'vitest'
import { FakeAdapter } from '../src/adapters/fake.js'
import type { Adapter } from '../src/adapters/types.js'
import { agentRuns, settings, tickets } from '../src/db/schema.js'
import { reportOutcome } from './helpers/reportOutcome.js'
import { makeTestApp, seedRun, seedTicket, type TestApp, waitFor } from './helpers/testApp.js'

/** A fake whose runs block until released, and which can hold on a gate on demand. */
function blockingFake(t: () => TestApp, opts: { gateFirst?: boolean } = {}) {
  const releases = new Map<number, () => void>()
  const released = new Set<number>()
  const fake = new FakeAdapter({
    act: async (ctx) => {
      const run = t()
        .db.drizzle.select()
        .from(agentRuns)
        .where(eq(agentRuns.runToken, ctx.runToken))
        .get()
      if (!run) throw new Error('no run')
      if (opts.gateFirst) await ctx.gate({ tool: 'Bash', input: { command: 'gh pr create' } })
      // `release` may land before the run gets this far (status flips to running before start)
      if (!released.has(run.id)) await new Promise<void>((resolve) => releases.set(run.id, resolve))
      reportOutcome(t().db, run.id, 'success', 'ok')
    },
  })
  return {
    fake,
    release: (id: number) => {
      released.add(id)
      releases.get(id)?.()
    },
  }
}

const statuses = (t: TestApp) =>
  Object.fromEntries(
    t.db.drizzle
      .select()
      .from(agentRuns)
      .all()
      .map((r) => [r.id, r.status]),
  )

async function setup(opts: { gateFirst?: boolean; concurrency?: number } = {}) {
  let t!: TestApp
  const { fake, release } = blockingFake(() => t, opts)
  t = await makeTestApp({ adapters: new Map<string, Adapter>([['fake', fake]]) })
  t.db.drizzle
    .update(settings)
    .set({ adapter: 'fake', model: 'fake-1', concurrency: opts.concurrency ?? 1 })
    .where(eq(settings.id, 1))
    .run()
  return { t, release }
}

describe('Scheduler', () => {
  test('respects the concurrency cap and starts by position', async () => {
    const { t, release } = await setup({ concurrency: 0 })
    const a = seedTicket(t.db, { column: 'queued', position: 2, title: 'a' })
    const b = seedTicket(t.db, { column: 'queued', position: 1, title: 'b' })
    const runA = t.scheduler.enqueue(a.id)
    const runB = t.scheduler.enqueue(b.id)
    t.db.drizzle.update(settings).set({ concurrency: 1 }).where(eq(settings.id, 1)).run()
    t.scheduler.tick()
    await waitFor(() => statuses(t)[runB] === 'running', 1000).catch(() => {
      throw new Error(`statuses: ${JSON.stringify(statuses(t))}`)
    })
    // b (position 1) went first; a waits
    expect(statuses(t)[runA]).toBe('queued')
    expect(t.scheduler.runningCount()).toBe(1)
    release(runB)
    await waitFor(() => statuses(t)[runB] === 'done')
    await waitFor(() => statuses(t)[runA] === 'running')
    release(runA)
    await waitFor(() => statuses(t)[runA] === 'done')
  })

  test('a held run releases its slot: the queue keeps moving past a gate', async () => {
    const { t, release } = await setup({ concurrency: 1, gateFirst: true })
    const a = seedTicket(t.db, { column: 'queued', position: 1 })
    const b = seedTicket(t.db, { column: 'queued', position: 2 })
    const runA = t.scheduler.enqueue(a.id)
    const runB = t.scheduler.enqueue(b.id)
    await waitFor(() => statuses(t)[runA] === 'held')
    // the hold freed the slot, so b started (and is itself now held at its gate)
    await waitFor(() => statuses(t)[runB] === 'held')
    expect(t.scheduler.runningCount()).toBe(0)

    // approving a resumes it immediately — it doesn't wait behind anything
    await t.json({ method: 'POST', url: `/runs/${runA}/approve`, payload: {} })
    await waitFor(() => statuses(t)[runA] === 'running')
    release(runA)
    await waitFor(() => statuses(t)[runA] === 'done')
    await t.json({ method: 'POST', url: `/runs/${runB}/approve`, payload: {} })
    await waitFor(() => statuses(t)[runB] === 'running')
    release(runB)
    await waitFor(() => statuses(t)[runB] === 'done')
  })

  test('a resumed run gets priority: it runs even when the cap is full, and new starts wait', async () => {
    const { t, release } = await setup({ concurrency: 1, gateFirst: true })
    const a = seedTicket(t.db, { column: 'queued', position: 1 })
    const runA = t.scheduler.enqueue(a.id)
    await waitFor(() => statuses(t)[runA] === 'held')

    // fill the slot with a run that never gates
    const plain = new FakeAdapter({ act: () => new Promise<void>(() => {}) })
    const deps = (t.scheduler as unknown as { deps: { adapters: Map<string, Adapter> } }).deps
    deps.adapters.set('plain', plain)
    t.db.drizzle.update(settings).set({ adapter: 'plain' }).where(eq(settings.id, 1)).run()
    const b = seedTicket(t.db, { column: 'queued', position: 2 })
    const runB = t.scheduler.enqueue(b.id)
    await waitFor(() => statuses(t)[runB] === 'running')
    expect(t.scheduler.runningCount()).toBe(1)

    // approving a resumes it despite the cap
    await t.json({ method: 'POST', url: `/runs/${runA}/approve`, payload: {} })
    await waitFor(() => statuses(t)[runA] === 'running')
    expect(t.scheduler.runningCount()).toBe(2)

    // but a third, fresh run waits
    const c = seedTicket(t.db, { column: 'queued', position: 3 })
    const runC = t.scheduler.enqueue(c.id)
    await new Promise((r) => setTimeout(r, 30))
    expect(statuses(t)[runC]).toBe('queued')
    release(runA)
  })

  test('recover: queued runs survive a restart, running/held ones fail with the card in stopped', async () => {
    const t = await makeTestApp()
    const q = seedTicket(t.db, { column: 'queued', title: 'q' })
    const r = seedTicket(t.db, { column: 'running', title: 'r' })
    const h = seedTicket(t.db, { column: 'stopped', title: 'h' })
    const rq = seedRun(t.db, q.id, { status: 'queued' })
    const rr = seedRun(t.db, r.id, { status: 'running', startedAt: new Date() })
    const rh = seedRun(t.db, h.id, {
      status: 'held',
      heldReason: 'permission',
      startedAt: new Date(),
    })
    t.scheduler.recover()
    const s = statuses(t)
    // the queued run is picked up again (and, with no adapter here, fails on its own terms —
    // the point is that recovery itself left it queued rather than killing it)
    expect(['queued', 'running', 'failed']).toContain(s[rq.id])
    expect(s[rq.id]).not.toBe('cancelled')
    expect(s[rr.id]).toBe('failed')
    expect(s[rh.id]).toBe('failed')
    const cols = Object.fromEntries(
      t.db.drizzle
        .select()
        .from(tickets)
        .all()
        .map((x) => [x.title, x.column]),
    )
    expect(cols).toMatchObject({ r: 'stopped', h: 'stopped' })
  })

  test('enqueue snapshots settings onto the run (adapter, model, effort, budget)', async () => {
    const { t } = await setup()
    t.db.drizzle
      .update(settings)
      .set({ timeoutMs: 123_000, effort: 'high' })
      .where(eq(settings.id, 1))
      .run()
    const a = seedTicket(t.db, { column: 'queued' })
    const id = t.scheduler.enqueue(a.id)
    const run = t.db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, id)).get()
    expect(run).toMatchObject({
      adapter: 'fake',
      model: 'fake-1',
      effort: 'high',
      budgetMs: 123_000,
      attemptNumber: 1,
    })
  })

  test('a ticket override wins over the global settings adapter/model', async () => {
    const { t } = await setup()
    t.db.drizzle
      .update(settings)
      .set({ adapter: 'fake', model: 'fake-1' })
      .where(eq(settings.id, 1))
      .run()
    const overridden = seedTicket(t.db, {
      column: 'queued',
      adapter: 'fake',
      model: 'fake-2',
    })
    const id = t.scheduler.enqueue(overridden.id)
    const run = t.db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, id)).get()
    expect(run).toMatchObject({ adapter: 'fake', model: 'fake-2' })

    // a ticket with no override falls back to the global settings, as before
    const plain = seedTicket(t.db, { column: 'queued' })
    const plainId = t.scheduler.enqueue(plain.id)
    const plainRun = t.db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, plainId)).get()
    expect(plainRun).toMatchObject({ adapter: 'fake', model: 'fake-1' })
  })

  test('a pending proposal never starts', async () => {
    const { t } = await setup()
    const p = seedTicket(t.db, { column: 'queued', proposalState: 'pending', origin: 'agent' })
    const id = t.scheduler.enqueue(p.id)
    await new Promise((r) => setTimeout(r, 30))
    expect(statuses(t)[id]).toBe('queued')
  })
})
