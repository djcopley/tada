import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, test } from 'vitest'
import type { FakeScript } from '../src/adapters/fake.js'
import { FakeAdapter } from '../src/adapters/fake.js'
import type { Adapter } from '../src/adapters/types.js'
import { createDefaultColumns, openDb, type TadaDb } from '../src/db/index.js'
import { agentRuns, columns, events, tickets, workspaces } from '../src/db/schema.js'
import { git } from '../src/git.js'
import { executeRun } from '../src/runs/runner.js'
import { WorkspaceManager } from '../src/workspaces/manager.js'
import { isolateXdg, makeOrigin } from './helpers/gitFixtures.js'
import { reportOutcome } from './helpers/reportOutcome.js'

function testDb() {
  return openDb(join(mkdtempSync(join(tmpdir(), 'tada-db-')), 'test.db'))
}

async function setup(opts: { timeoutMs?: number } = {}) {
  isolateXdg()
  const db = testDb()
  const manager = new WorkspaceManager(db)
  const wsId = await manager.create('demo')
  const origin = await makeOrigin('proj')
  await manager.addRepo(wsId, origin)

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

    await executeRun(
      {
        db,
        wm: manager,
        adapters: adapters({
          act: async () => reportOutcome(db, run.id, ticket.id, 'success', 'done it'),
        }),
        pr: false,
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
  })

  test('2. no outcome reported -> failed, ticket back in ready, queueState held', async () => {
    const { db, manager, ticket } = await setup()
    const run = seedRun(db, ticket.id)

    await executeRun({ db, wm: manager, adapters: adapters({}), pr: false }, run.id)

    const updatedRun = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, run.id)).get()
    expect(updatedRun?.status).toBe('failed')

    const updatedTicket = db.drizzle.select().from(tickets).where(eq(tickets.id, ticket.id)).get()
    expect(columnKind(db, updatedTicket?.columnId ?? -1)).toBe('ready')
    expect(updatedTicket?.queueState).toBe('held')
  })

  test('3. exitCode 1 -> failed', async () => {
    const { db, manager, ticket } = await setup()
    const run = seedRun(db, ticket.id)

    await executeRun({ db, wm: manager, adapters: adapters({ exitCode: 1 }), pr: false }, run.id)

    const updatedRun = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, run.id)).get()
    expect(updatedRun?.status).toBe('failed')
  })

  test('4. timeout -> failed within ~1s, abort signal fired', async () => {
    const { db, manager, ticket } = await setup({ timeoutMs: 50 })
    const run = seedRun(db, ticket.id)

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
    await executeRun({ db, wm: manager, adapters: adapters(script), pr: false }, run.id)
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(1000)
    expect(sawAbort).toBe(true)

    const updatedRun = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, run.id)).get()
    expect(updatedRun?.status).toBe('failed')
  })

  test('5. success with commits: branch pushed to origin, summary stored', async () => {
    const { db, manager, ticket, origin } = await setup()
    const run = seedRun(db, ticket.id)

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
      },
    }

    await executeRun({ db, wm: manager, adapters: adapters(script), pr: false }, run.id)

    const updatedRun = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, run.id)).get()
    expect(updatedRun?.status).toBe('needs_review')
    expect(updatedRun?.summary).toBe('shipped it')
    expect(updatedRun?.branch).toBe(`ticket/${ticket.id}`)

    const branches = await git(origin, 'branch', '--list', `ticket/${ticket.id}`)
    expect(branches).toContain(`ticket/${ticket.id}`)
  })
})
