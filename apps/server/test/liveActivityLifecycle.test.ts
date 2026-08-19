import { eq } from 'drizzle-orm'
import { describe, expect, test } from 'vitest'
import { FakeAdapter, type FakeScript } from '../src/adapters/fake.js'
import type { Adapter } from '../src/adapters/types.js'
import { agentRuns } from '../src/db/schema.js'
import type { LiveActivityChannel } from '../src/liveActivity.js'
import { reportOutcome } from './helpers/reportOutcome.js'
import { makeTestApp, seedTicket, type TestApp, waitFor } from './helpers/testApp.js'

const runRow = (t: TestApp, id: number) =>
  t.db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, id)).get()

async function untilRun(t: TestApp, ticketId: number, status: string) {
  let run: ReturnType<typeof runRow> | undefined
  await waitFor(() => {
    run = t.db.drizzle.select().from(agentRuns).where(eq(agentRuns.ticketId, ticketId)).get()
    return run?.status === status
  })
  if (!run) throw new Error('no run')
  return run
}

/** A run that gates once on `gh pr create` (the default `ask` rule) and, once approved, files a
 * success outcome — the same shape `runner.test.ts`'s permission-gate suite drives. */
function gatedScript(t: () => TestApp): FakeScript {
  return {
    act: async (ctx) => {
      await ctx.gate({ tool: 'Bash', input: { command: 'gh pr create --title x' } })
      const run = t()
        .db.drizzle.select()
        .from(agentRuns)
        .where(eq(agentRuns.runToken, ctx.runToken))
        .get()
      if (!run) throw new Error('no run')
      reportOutcome(t().db, run.id, 'success', 'shipped it')
    },
  }
}

describe('live activity lifecycle', () => {
  test('the card syncs when a run starts, when it holds, when it resumes, and when it ends', async () => {
    let syncs = 0
    const liveActivity: LiveActivityChannel = { sync: () => void syncs++ }
    let t!: TestApp
    const fake = new FakeAdapter(gatedScript(() => t))
    t = await makeTestApp({
      adapters: new Map<string, Adapter>([['fake', fake]]),
      runner: { liveActivity },
    })
    await t.json({
      method: 'PATCH',
      url: '/settings',
      payload: { adapter: 'fake', model: 'fake-1' },
    })
    const ticket = seedTicket(t.db, { column: 'queued' })

    const runId = t.scheduler.enqueue(ticket.id)
    await untilRun(t, ticket.id, 'held')

    const res = await t.json({ method: 'POST', url: `/runs/${runId}/approve`, payload: {} })
    expect(res.status).toBe(200)

    await untilRun(t, ticket.id, 'done')

    // running (start), held (gate), running (resume), done — at least four board-changing
    // transitions, each of which must have refreshed the lock screen.
    expect(syncs).toBeGreaterThanOrEqual(4)
  })

  test('a channel that throws cannot fail a run', async () => {
    const liveActivity: LiveActivityChannel = {
      sync: () => {
        throw new Error('apns is down')
      },
    }
    let t!: TestApp
    const fake = new FakeAdapter(gatedScript(() => t))
    t = await makeTestApp({
      adapters: new Map<string, Adapter>([['fake', fake]]),
      runner: { liveActivity },
    })
    await t.json({
      method: 'PATCH',
      url: '/settings',
      payload: { adapter: 'fake', model: 'fake-1' },
    })
    const ticket = seedTicket(t.db, { column: 'queued' })

    const runId = t.scheduler.enqueue(ticket.id)
    await untilRun(t, ticket.id, 'held')

    const res = await t.json({ method: 'POST', url: `/runs/${runId}/approve`, payload: {} })
    expect(res.status).toBe(200)

    // The run must still reach `done` even though every sync() call throws — a notification
    // surface must never be able to fail a run.
    const run = await untilRun(t, ticket.id, 'done')
    expect(run.summary).toBe('shipped it')
  })
})
