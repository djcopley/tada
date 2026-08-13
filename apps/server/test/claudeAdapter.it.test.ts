/**
 * Gated integration test for ClaudeAdapter: drives a real Claude Agent SDK session against a
 * live tada MCP endpoint.
 *
 * Requires:
 *  - `claude` CLI logged in on this machine (the SDK shells out to it / uses its credentials).
 *  - Consumes the logged-in account's Max/API quota — do NOT run in CI.
 *
 * Run manually with:
 *   TADA_IT=1 pnpm --filter @tada/server exec vitest run test/claudeAdapter.it.test.ts
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { ClaudeAdapter } from '../src/adapters/claude.js'
import type { Adapter } from '../src/adapters/types.js'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { createDefaultColumns, openDb, type TadaDb } from '../src/db/index.js'
import { agentRuns, columns, tickets } from '../src/db/schema.js'
import { git } from '../src/git.js'
import { executeRun } from '../src/runs/runner.js'
import { WorkspaceManager } from '../src/workspaces/manager.js'
import { makeAppDeps } from './helpers/appDeps.js'
import { isolateXdg, makeOrigin } from './helpers/gitFixtures.js'

function testDb() {
  return openDb(join(mkdtempSync(join(tmpdir(), 'tada-it-db-')), 'test.db'))
}

describe.skipIf(!process.env.TADA_IT)('ClaudeAdapter (integration)', () => {
  let app: FastifyInstance | undefined

  beforeEach(() => {
    isolateXdg()
  })

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  test('creates hello.txt, commits it, and reports success', async () => {
    const db: TadaDb = testDb()
    const wm = new WorkspaceManager(db)
    const wsId = await wm.create('demo')
    const origin = await makeOrigin('proj')
    await wm.addRepo(wsId, origin)

    createDefaultColumns(db, wsId)
    const readyCol = db.drizzle
      .select()
      .from(columns)
      .where(eq(columns.workspaceId, wsId))
      .all()
      .find((c) => c.kind === 'ready')
    if (!readyCol) throw new Error('ready column not seeded')

    const [ticket] = db.drizzle
      .insert(tickets)
      .values({
        workspaceId: wsId,
        columnId: readyCol.id,
        title: 'Add hello.txt',
        description:
          "Create a file named hello.txt containing 'hello tada', commit it, then report success via report_outcome.",
        position: 1,
        queueState: 'queued',
      })
      .returning()
      .all()
    if (!ticket) throw new Error('ticket insert returned no row')

    const [run] = db.drizzle
      .insert(agentRuns)
      .values({
        ticketId: ticket.id,
        adapter: 'claude',
        model: 'haiku',
        status: 'queued',
        runToken: 'it-tok',
      })
      .returning()
      .all()
    if (!run) throw new Error('agentRun insert returned no row')

    // Real MCP endpoint: the ClaudeAdapter's SDK session calls back into report_outcome over
    // HTTP, so `pendingOutcome` needs an actual listening server, not the runner test's default
    // placeholder mcpUrl.
    const adapters = new Map<string, Adapter>([['claude', new ClaudeAdapter()]])
    app = buildApp(makeAppDeps(db, loadConfig(), { adapters }))
    const address = await app.listen({ port: 0, host: '127.0.0.1' })

    await executeRun({ db, wm, adapters, pr: false, mcpUrl: `${address}/mcp` }, run.id)

    const updatedRun = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, run.id)).get()
    expect(updatedRun?.status).toBe('needs_review')
    expect(updatedRun?.summary).toBeTruthy()

    const log = await git(origin, 'log', `ticket/${ticket.id}`, '--oneline')
    expect(log.length).toBeGreaterThan(0)
  })
})
