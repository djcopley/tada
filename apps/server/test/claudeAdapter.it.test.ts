/**
 * Gated integration test for ClaudeAdapter: drives a real Claude Agent SDK session against a
 * live tada MCP endpoint, through the gate hook.
 *
 * Requires:
 *  - `claude` CLI logged in on this machine (the SDK shells out to it / uses its credentials).
 *  - Consumes the logged-in account's Max/API quota — do NOT run in CI.
 *
 * Run manually with:
 *   TADA_IT=1 pnpm --filter @tada/server exec vitest run test/claudeAdapter.it.test.ts
 */
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, test } from 'vitest'
import { ClaudeAdapter } from '../src/adapters/claude.js'
import type { Adapter } from '../src/adapters/types.js'
import { agentRuns, events, settings, tickets } from '../src/db/schema.js'
import { git } from '../src/git.js'
import { makeOrigin } from './helpers/gitFixtures.js'
import { makeTestApp, seedTicket, type TestApp, waitFor } from './helpers/testApp.js'

describe.skipIf(!process.env.TADA_IT)('ClaudeAdapter (integration)', () => {
  let t: TestApp | undefined

  afterEach(async () => {
    await t?.app.close()
    t = undefined
  })

  test('uses the repo, commits, gets held at a gate, is approved, and files itself', async () => {
    const adapters = new Map<string, Adapter>([['claude', new ClaudeAdapter()]])
    t = await makeTestApp({ adapters })
    const address = await t.app.listen({ port: 0, host: '127.0.0.1' })
    // point the scheduler's runner at the live MCP endpoint
    ;(t.scheduler as unknown as { deps: { mcpUrl: string } }).deps.mcpUrl = `${address}/mcp`
    const origin = await makeOrigin('proj')
    await t.store.addRepo(origin)
    t.db.drizzle
      .update(settings)
      .set({ model: 'haiku', effort: 'low' })
      .where(eq(settings.id, 1))
      .run()
    // make `git status` a gate so the test sees a hold without touching github
    await t.json({
      method: 'POST',
      url: '/rules',
      payload: { title: 'Status', patterns: ['*git status*'], decision: 'ask' },
    })

    const ticket = seedTicket(t.db, {
      column: 'queued',
      title: 'Create hello.txt',
      description:
        'Use the repo "proj". Create a file hello.txt containing "hello" and commit it. Then run `git status` once. Then report success.',
    })
    const runId = t.scheduler.enqueue(ticket.id)
    const tt = t

    await waitFor(
      () =>
        tt.db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, runId)).get()?.status ===
        'held',
      300_000,
    )
    const held = tt.db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, runId)).get()
    expect(held?.heldReason).toBe('permission')
    await tt.json({ method: 'POST', url: `/runs/${runId}/approve`, payload: {} })

    await waitFor(() => {
      const s = tt.db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, runId)).get()?.status
      return s === 'done' || s === 'failed'
    }, 300_000)
    const run = tt.db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, runId)).get()
    expect(run?.status).toBe('done')
    expect(
      tt.db.drizzle.select().from(tickets).where(eq(tickets.id, ticket.id)).get()?.repoTags,
    ).toEqual(['proj'])
    const log = await git(tt.store.cloneDir('proj'), 'log', `ticket/${ticket.id}`, '--oneline')
    expect(log.length).toBeGreaterThan(0)
  }, 600_000)

  test('a turn that ends with no outcome is nudged, and the SDK gives it another turn', async () => {
    const adapters = new Map<string, Adapter>([['claude', new ClaudeAdapter()]])
    t = await makeTestApp({ adapters })
    const address = await t.app.listen({ port: 0, host: '127.0.0.1' })
    ;(t.scheduler as unknown as { deps: { mcpUrl: string } }).deps.mcpUrl = `${address}/mcp`
    t.db.drizzle
      .update(settings)
      .set({ model: 'haiku', effort: 'low' })
      .where(eq(settings.id, 1))
      .run()

    // The point of the exercise: end a turn without reporting. Only a second turn - one the SDK
    // has to accept from stdin *after* it emitted a result - can get this run to done.
    const ticket = seedTicket(t.db, {
      column: 'queued',
      title: 'Stop early, then finish',
      description: [
        'This is a test of the run harness. Do exactly this and nothing else:',
        '1. On your FIRST turn: reply with the single word "waiting" and stop. Do not call any',
        '   tool, and do NOT call report_outcome — ending the turn there is the whole point.',
        '2. If you are given another turn: call report_outcome with status success and the',
        '   summary "second turn reached".',
      ].join('\n'),
    })
    const runId = t.scheduler.enqueue(ticket.id)
    const tt = t

    await waitFor(() => {
      const s = tt.db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, runId)).get()?.status
      return s === 'done' || s === 'failed'
    }, 300_000)

    const run = tt.db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, runId)).get()
    expect(run?.status).toBe('done')
    // Not just "it finished": the journal line only the idle path writes proves the run really
    // did close a turn with no outcome and win a second one out of the live SDK.
    const journalled = tt.db.drizzle
      .select()
      .from(events)
      .where(eq(events.runId, runId))
      .all()
      .map((e) => JSON.stringify(e.payload))
    expect(journalled.some((p) => p.includes('stopped without reporting an outcome'))).toBe(true)
  }, 600_000)
})
