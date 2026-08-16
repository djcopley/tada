import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { FakeScript } from '../src/adapters/fake.js'
import { FakeAdapter } from '../src/adapters/fake.js'
import type { Adapter } from '../src/adapters/types.js'
import { createDefaultColumns, openDb, type TadaDb } from '../src/db/index.js'
import {
  activity,
  agentRuns,
  columns,
  events,
  pushTokens,
  tickets,
  workspaces,
} from '../src/db/schema.js'
import { git } from '../src/git.js'
import { branchFor } from '../src/runs/runDir.js'
import { executeRun } from '../src/runs/runner.js'
import { WorkspaceManager } from '../src/workspaces/manager.js'
import { BroadcastHub } from '../src/ws.js'
import { isolateXdg, makeOrigin } from './helpers/gitFixtures.js'
import { reportOutcome } from './helpers/reportOutcome.js'

function activityRows(db: TadaDb, runId: number) {
  return db.drizzle.select().from(activity).where(eq(activity.runId, runId)).all()
}

function testDb() {
  return openDb(join(mkdtempSync(join(tmpdir(), 'tada-db-')), 'test.db'))
}

async function setup(opts: { timeoutMs?: number } = {}) {
  isolateXdg()
  const db = testDb()
  const manager = new WorkspaceManager(db)
  const wsId = await manager.create('demo')
  const origin = await makeOrigin('proj')
  await manager.addRepoSource(wsId, origin)

  if (opts.timeoutMs !== undefined) {
    db.drizzle
      .update(workspaces)
      .set({ timeoutMs: opts.timeoutMs })
      .where(eq(workspaces.id, wsId))
      .run()
  }

  createDefaultColumns(db, wsId)
  const cols = db.drizzle.select().from(columns).where(eq(columns.workspaceId, wsId)).all()
  const readyCol = cols.find((c) => c.kind === 'ready')
  if (!readyCol) throw new Error('ready column not seeded')

  const [ticket] = db.drizzle
    .insert(tickets)
    .values({
      workspaceId: wsId,
      columnId: readyCol.id,
      title: 'Do the thing',
      description: 'desc',
      position: 1,
      queueState: 'queued',
    })
    .returning()
    .all()
  if (!ticket) throw new Error('ticket insert returned no row')

  return { db, manager, wsId, ticket, origin, cols }
}

function seedRun(db: TadaDb, ticketId: number) {
  const [run] = db.drizzle
    .insert(agentRuns)
    .values({ ticketId, adapter: 'fake', model: 'fake-1', status: 'queued', runToken: 'tok' })
    .returning()
    .all()
  if (!run) throw new Error('agentRun insert returned no row')
  return run
}

function adapters(script: FakeScript): Map<string, Adapter> {
  return new Map([['fake', new FakeAdapter(script)]])
}

function columnKind(db: TadaDb, columnId: number): string | undefined {
  return db.drizzle.select().from(columns).where(eq(columns.id, columnId)).get()?.kind
}

describe('executeRun', () => {
  beforeEach(() => {
    isolateXdg()
  })

  test('1. success: report_outcome success -> needs_review, ticket in_review, events include transitions', async () => {
    const { db, manager, ticket } = await setup()
    const run = seedRun(db, ticket.id)
    const hub = new BroadcastHub(db)

    await executeRun(
      {
        db,
        wm: manager,
        adapters: adapters({
          act: async () => reportOutcome(db, run.id, ticket.id, 'success', 'done it'),
        }),
        pr: false,
        hub,
      },
      run.id,
    )

    const updatedRun = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, run.id)).get()
    expect(updatedRun?.status).toBe('needs_review')
    expect(updatedRun?.summary).toBe('done it')

    const updatedTicket = db.drizzle.select().from(tickets).where(eq(tickets.id, ticket.id)).get()
    expect(columnKind(db, updatedTicket?.columnId ?? -1)).toBe('in_review')
    expect(updatedTicket?.queueState).toBeNull()

    const runEvents = db.drizzle.select().from(events).where(eq(events.runId, run.id)).all()
    const statuses = runEvents
      .filter((e) => e.type === 'status')
      .map((e) => (e.payload as { status?: string }).status)
    expect(statuses).toContain('running')
    expect(statuses).toContain('needs_review')

    const acts = activityRows(db, run.id)
    expect(acts.map((a) => a.type)).toEqual(['run_started', 'needs_review'])
    expect(
      acts.every((a) => a.ticketId === ticket.id && a.workspaceId === ticket.workspaceId),
    ).toBe(true)
    expect(acts.find((a) => a.type === 'needs_review')?.message).toContain('done it')
  })

  test('2. no outcome reported -> failed, ticket back in ready, queueState held', async () => {
    const { db, manager, ticket } = await setup()
    const run = seedRun(db, ticket.id)
    const hub = new BroadcastHub(db)

    await executeRun({ db, wm: manager, adapters: adapters({}), pr: false, hub }, run.id)

    const updatedRun = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, run.id)).get()
    expect(updatedRun?.status).toBe('failed')

    const updatedTicket = db.drizzle.select().from(tickets).where(eq(tickets.id, ticket.id)).get()
    expect(columnKind(db, updatedTicket?.columnId ?? -1)).toBe('ready')
    expect(updatedTicket?.queueState).toBe('held')

    const acts = activityRows(db, run.id)
    expect(acts.map((a) => a.type)).toEqual(['run_started', 'run_failed'])
    expect(acts.find((a) => a.type === 'run_failed')?.message).toContain(
      'agent did not report an outcome',
    )

    // The reason is also on the run itself (summary) and in the journal (one error event), so
    // the run screen / cards can show why rather than just "failed".
    expect(updatedRun?.summary).toBe('agent did not report an outcome')
    const errorEvents = db.drizzle
      .select()
      .from(events)
      .where(eq(events.runId, run.id))
      .all()
      .filter((e) => e.type === 'error')
    expect(errorEvents.map((e) => (e.payload as { message: string }).message)).toEqual([
      'agent did not report an outcome',
    ])
  })

  test('3. exitCode 1 -> failed', async () => {
    const { db, manager, ticket } = await setup()
    const run = seedRun(db, ticket.id)
    const hub = new BroadcastHub(db)

    await executeRun(
      { db, wm: manager, adapters: adapters({ exitCode: 1 }), pr: false, hub },
      run.id,
    )

    const updatedRun = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, run.id)).get()
    expect(updatedRun?.status).toBe('failed')

    const acts = activityRows(db, run.id)
    expect(acts.find((a) => a.type === 'run_failed')?.message).toContain('exited with code 1')
  })

  test('4. timeout -> failed within ~1s, abort signal fired', async () => {
    const { db, manager, ticket } = await setup({ timeoutMs: 50 })
    const run = seedRun(db, ticket.id)
    const hub = new BroadcastHub(db)

    let sawAbort = false
    const script: FakeScript = {
      act: (ctx) =>
        new Promise<void>((resolve) => {
          ctx.signal.addEventListener('abort', () => {
            sawAbort = true
          })
          setTimeout(resolve, 60_000).unref()
        }),
    }

    const start = Date.now()
    await executeRun({ db, wm: manager, adapters: adapters(script), pr: false, hub }, run.id)
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(1000)
    expect(sawAbort).toBe(true)

    const updatedRun = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, run.id)).get()
    expect(updatedRun?.status).toBe('failed')

    const acts = activityRows(db, run.id)
    expect(acts.find((a) => a.type === 'run_failed')?.message).toContain('timed out at 50ms')
  })

  test('5. success with commits: branch pushed to origin, summary stored, diffstat + testsPassed recorded', async () => {
    const { db, manager, ticket, origin } = await setup()
    const run = seedRun(db, ticket.id)

    const script: FakeScript = {
      act: async (ctx) => {
        const repoDir = join(ctx.runDir, 'proj')
        writeFileSync(join(repoDir, 'change.txt'), 'work\nmore\n')
        await git(repoDir, 'add', '.')
        await git(
          repoDir,
          '-c',
          'user.email=t@t',
          '-c',
          'user.name=t',
          'commit',
          '-m',
          'agent work',
        )
        reportOutcome(db, run.id, ticket.id, 'success', 'shipped it', 7)
      },
    }

    await executeRun({ db, wm: manager, adapters: adapters(script), pr: false }, run.id)

    const updatedRun = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, run.id)).get()
    expect(updatedRun?.status).toBe('needs_review')
    expect(updatedRun?.summary).toBe('shipped it')
    expect(updatedRun?.branch).toBe(`ticket/${ticket.id}`)
    expect(updatedRun?.diffAdditions).toBe(2)
    expect(updatedRun?.diffDeletions).toBe(0)
    expect(updatedRun?.testsPassed).toBe(7)

    const branches = await git(origin, 'branch', '--list', `ticket/${ticket.id}`)
    expect(branches).toContain(`ticket/${ticket.id}`)
  })

  test('11. success with no commits: diffAdditions/diffDeletions/testsPassed all null on the run row', async () => {
    const { db, manager, ticket } = await setup()
    const run = seedRun(db, ticket.id)

    await executeRun(
      {
        db,
        wm: manager,
        adapters: adapters({
          act: async () => reportOutcome(db, run.id, ticket.id, 'success', 'nothing to ship'),
        }),
        pr: false,
      },
      run.id,
    )

    const updatedRun = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, run.id)).get()
    expect(updatedRun?.status).toBe('needs_review')
    expect(updatedRun?.diffAdditions).toBeNull()
    expect(updatedRun?.diffDeletions).toBeNull()
    expect(updatedRun?.testsPassed).toBeNull()
  })

  test('6. setup failure (buildRunDir throws) -> failed, ticket ready/held, error journaled', async () => {
    const { db, manager, wsId, ticket } = await setup()
    const run = seedRun(db, ticket.id)

    // Force buildRunDir to fail: pre-create a worktree checked out on the ticket branch
    // elsewhere, so buildRunDir's own `git worktree add` for that same branch conflicts.
    const canonical = join(manager.reposDir(wsId), 'proj')
    const staleWt = join(mkdtempSync(join(tmpdir(), 'tada-stale-')), 'wt')
    await git(canonical, 'worktree', 'add', '-b', branchFor(ticket.id), staleWt, 'main')

    await executeRun({ db, wm: manager, adapters: adapters({}), pr: false }, run.id)

    const updatedRun = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, run.id)).get()
    expect(updatedRun?.status).toBe('failed')

    const updatedTicket = db.drizzle.select().from(tickets).where(eq(tickets.id, ticket.id)).get()
    expect(columnKind(db, updatedTicket?.columnId ?? -1)).toBe('ready')
    expect(updatedTicket?.queueState).toBe('held')

    const runEvents = db.drizzle.select().from(events).where(eq(events.runId, run.id)).all()
    expect(runEvents.some((e) => e.type === 'error')).toBe(true)
    const statuses = runEvents
      .filter((e) => e.type === 'status')
      .map((e) => (e.payload as { status?: string }).status)
    expect(statuses).toContain('failed')
  })

  test('7. completeRun throws outside its push try/catch (corrupt canonical repo) -> failed, ticket ready/held, error journaled', async () => {
    const { db, manager, wsId, ticket } = await setup()
    const run = seedRun(db, ticket.id)
    const canonical = join(manager.reposDir(wsId), 'proj')

    const script: FakeScript = {
      act: async (ctx) => {
        const repoDir = join(ctx.runDir, 'proj')
        writeFileSync(join(repoDir, 'change.txt'), 'work\n')
        await git(repoDir, 'add', '.')
        await git(
          repoDir,
          '-c',
          'user.email=t@t',
          '-c',
          'user.name=t',
          'commit',
          '-m',
          'agent work',
        )
        reportOutcome(db, run.id, ticket.id, 'success', 'shipped it')
        // Simulate the canonical repo disappearing after the agent already committed to its
        // worktree: completeRun's branch --list / rev-list detection (outside the push
        // try/catch) will now throw when it tries to inspect `canonical`.
        rmSync(canonical, { recursive: true, force: true })
      },
    }

    await executeRun({ db, wm: manager, adapters: adapters(script), pr: false }, run.id)

    const updatedRun = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, run.id)).get()
    expect(updatedRun?.status).toBe('failed')

    const updatedTicket = db.drizzle.select().from(tickets).where(eq(tickets.id, ticket.id)).get()
    expect(columnKind(db, updatedTicket?.columnId ?? -1)).toBe('ready')
    expect(updatedTicket?.queueState).toBe('held')

    const runEvents = db.drizzle.select().from(events).where(eq(events.runId, run.id)).all()
    expect(runEvents.some((e) => e.type === 'error')).toBe(true)
    const statuses = runEvents
      .filter((e) => e.type === 'status')
      .map((e) => (e.payload as { status?: string }).status)
    expect(statuses).toContain('failed')
  })

  test('8. needs_review -> notifies push tokens with the run summary', async () => {
    const { db, manager, ticket } = await setup()
    const run = seedRun(db, ticket.id)
    db.drizzle.insert(pushTokens).values({ token: 'ExponentPushToken[xyz]' }).run()
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true })

    await executeRun(
      {
        db,
        wm: manager,
        adapters: adapters({
          act: async () => reportOutcome(db, run.id, ticket.id, 'success', 'done it'),
        }),
        pr: false,
        fetchImpl,
      },
      run.id,
    )

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://exp.host/--/api/v2/push/send')
    const body = JSON.parse(init.body as string)
    expect(body).toEqual([
      {
        to: 'ExponentPushToken[xyz]',
        title: `Ticket "${ticket.title}" ready for review`,
        body: 'done it',
        data: { ticketId: ticket.id },
      },
    ])
  })

  test('9. failed run -> notifies push tokens with a failure title', async () => {
    const { db, manager, ticket } = await setup()
    const run = seedRun(db, ticket.id)
    db.drizzle.insert(pushTokens).values({ token: 'ExponentPushToken[xyz]' }).run()
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true })

    await executeRun(
      { db, wm: manager, adapters: adapters({ exitCode: 1 }), pr: false, fetchImpl },
      run.id,
    )

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const body = JSON.parse((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body).toEqual([
      {
        to: 'ExponentPushToken[xyz]',
        title: `Ticket "${ticket.title}" failed`,
        body: 'exited with code 1',
        data: { ticketId: ticket.id },
      },
    ])
  })

  test('10. cancelled run -> no push notification', async () => {
    const { db, manager, ticket } = await setup()
    const run = seedRun(db, ticket.id)
    db.drizzle.insert(pushTokens).values({ token: 'ExponentPushToken[xyz]' }).run()
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true })

    const controller = new AbortController()
    const script: FakeScript = {
      act: (ctx) =>
        new Promise<void>((resolve) => {
          ctx.signal.addEventListener('abort', () => {})
          // Abort once the adapter is actually acting, mirroring Scheduler.cancel mid-run
          // (aborting before the adapter starts would instead surface as an adapter error).
          controller.abort()
          setTimeout(resolve, 60_000).unref()
        }),
    }

    await executeRun(
      { db, wm: manager, adapters: adapters(script), pr: false, fetchImpl },
      run.id,
      controller.signal,
    )

    const updatedRun = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, run.id)).get()
    expect(updatedRun?.status).toBe('cancelled')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
