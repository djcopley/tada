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
import { agentRuns, settings, tickets } from '../src/db/schema.js'
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
})
