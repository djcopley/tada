import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ApiAdapterInfo, ApiHealth, ApiStatus } from '@tada/shared'
import { eq } from 'drizzle-orm'
import type { FastifyInstance, InjectOptions } from 'fastify'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { CodexAdapter, codexArgs } from '../src/adapters/codex.js'
import {
  CLI_CAPABILITY_NOTE,
  cliLineEvent,
  probeCli,
  withOutcomeFileInstruction,
} from '../src/adapters/exec.js'
import type { FakeScript } from '../src/adapters/fake.js'
import { FakeAdapter } from '../src/adapters/fake.js'
import { GeminiAdapter, geminiArgs } from '../src/adapters/gemini.js'
import type {
  Adapter,
  AdapterEvent,
  AdapterSession,
  AdapterStartCtx,
} from '../src/adapters/types.js'
import { buildApp } from '../src/app.js'
import type { Config } from '../src/config.js'
import { loadConfig } from '../src/config.js'
import { createDefaultColumns, openDb, type TadaDb } from '../src/db/index.js'
import { agentRuns, columns, comments, events, tickets } from '../src/db/schema.js'
import { executeRun } from '../src/runs/runner.js'
import { Scheduler } from '../src/runs/scheduler.js'
import { serverVersion } from '../src/version.js'
import { WorkspaceManager } from '../src/workspaces/manager.js'
import { BroadcastHub } from '../src/ws.js'
import { isolateXdg, makeOrigin } from './helpers/gitFixtures.js'

/** Minimal Adapter stand-in for discovery tests: never runs, just reports metadata. */
class StubAdapter implements Adapter {
  constructor(
    readonly id: string,
    readonly label: string,
    readonly models: string[],
    readonly efforts: string[],
    readonly supportsInjection: boolean,
    private readonly isAvailable: boolean,
  ) {}

  available(): Promise<boolean> {
    return Promise.resolve(this.isAvailable)
  }

  start(_ctx: AdapterStartCtx): AdapterSession {
    return { done: Promise.resolve({ exitCode: 0 }), inject: () => false }
  }
}

async function setupApp(adapters: Map<string, Adapter> = new Map()) {
  const db = openDb(join(mkdtempSync(join(tmpdir(), 'tada-adapters-')), 'tada.db'))
  const wm = new WorkspaceManager(db)
  const hub = new BroadcastHub(db)
  const scheduler = new Scheduler({ db, wm, adapters, broadcast: hub.broadcast, pr: false })
  const config = loadConfig()
  const app = buildApp({ db, config, wm, scheduler, broadcastHub: hub, adapters })
  await app.ready()
  return { app, db, wm, scheduler, config }
}

function authed(config: Config, opts: InjectOptions): InjectOptions {
  return { ...opts, headers: { ...opts.headers, authorization: `Bearer ${config.bearerToken}` } }
}

async function json(app: FastifyInstance, config: Config, opts: InjectOptions) {
  const res = await app.inject(authed(config, opts))
  return { status: res.statusCode, body: res.body.length > 0 ? res.json() : undefined }
}

function testDb(): TadaDb {
  return openDb(join(mkdtempSync(join(tmpdir(), 'tada-db-')), 'test.db'))
}

/** A workspace backed by a real git origin plus a queued ticket, as executeRun needs. */
async function setupRunnable() {
  isolateXdg()
  const db = testDb()
  const wm = new WorkspaceManager(db)
  const wsId = await wm.create('demo')
  const origin = await makeOrigin('proj')
  await wm.addRepoSource(wsId, origin)

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
      title: 'Do the thing',
      description: 'desc',
      position: 1,
      queueState: 'queued',
    })
    .returning()
    .all()
  if (!ticket) throw new Error('ticket insert returned no row')

  return { db, wm, wsId, ticket }
}

function seedRun(db: TadaDb, ticketId: number, effort = 'medium') {
  const [run] = db.drizzle
    .insert(agentRuns)
    .values({
      ticketId,
      adapter: 'fake',
      model: 'fake-1',
      effort,
      status: 'queued',
      runToken: 'tok',
    })
    .returning()
    .all()
  if (!run) throw new Error('agentRun insert returned no row')
  return run
}

describe('adapter discovery endpoints', () => {
  beforeEach(() => {
    isolateXdg()
  })

  test('1. GET /adapters returns one ApiAdapterInfo per registered adapter', async () => {
    const adapters = new Map<string, Adapter>([
      ['claude', new StubAdapter('claude', 'Claude', ['sonnet'], ['low'], true, true)],
      ['codex', new StubAdapter('codex', 'Codex', ['gpt-5.2'], ['high'], false, false)],
    ])
    const { app, config } = await setupApp(adapters)

    const res = await json(app, config, { method: 'GET', url: '/adapters' })
    expect(res.status).toBe(200)
    expect(res.body as ApiAdapterInfo[]).toEqual([
      {
        id: 'claude',
        label: 'Claude',
        available: true,
        models: ['sonnet'],
        efforts: ['low'],
        supportsInjection: true,
      },
      {
        id: 'codex',
        label: 'Codex',
        available: false,
        models: ['gpt-5.2'],
        efforts: ['high'],
        supportsInjection: false,
      },
    ])
  })

  test('2. GET /adapters requires auth', async () => {
    const { app } = await setupApp()
    const res = await app.inject({ method: 'GET', url: '/adapters' })
    expect(res.statusCode).toBe(401)
  })

  test('3. GET /status reports version, workspace names, and agent availability', async () => {
    const adapters = new Map<string, Adapter>([
      ['claude', new StubAdapter('claude', 'Claude', ['sonnet'], ['low'], true, true)],
      ['gemini', new StubAdapter('gemini', 'Gemini', ['gemini-3-pro'], ['default'], false, false)],
    ])
    const { app, config } = await setupApp(adapters)
    await json(app, config, { method: 'POST', url: '/workspaces', payload: { name: 'alpha' } })
    await json(app, config, { method: 'POST', url: '/workspaces', payload: { name: 'beta' } })

    const res = await json(app, config, { method: 'GET', url: '/status' })
    expect(res.status).toBe(200)
    const status = res.body as ApiStatus
    expect(status.ok).toBe(true)
    expect(status.version).toBe(serverVersion)
    expect(status.workspaces).toEqual(['alpha', 'beta'])
    expect(status.agents).toEqual([
      { id: 'claude', available: true },
      { id: 'gemini', available: false },
    ])
  })

  test('4. GET /status requires auth', async () => {
    const { app } = await setupApp()
    const res = await app.inject({ method: 'GET', url: '/status' })
    expect(res.statusCode).toBe(401)
  })

  test('5. GET /health is unauthed and carries the server version', async () => {
    const { app } = await setupApp()
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json() as ApiHealth).toEqual({ ok: true, version: serverVersion })

    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')) as {
      version: string
    }
    expect(serverVersion).toBe(pkg.version)
  })
})

describe('POST /runs/:id/nudge', () => {
  beforeEach(() => {
    isolateXdg()
  })

  /** Workspace + ticket whose run is parked mid-adapter, so a live session exists to nudge. */
  async function setupRunningTicket(script: FakeScript = {}) {
    const adapter = new FakeAdapter({ act: () => new Promise<void>(() => {}), ...script })
    const adapters = new Map<string, Adapter>([['fake', adapter]])
    const started = await setupApp(adapters)
    const { app, config, db } = started

    const ws = await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'ws' },
    })
    const wsId = (ws.body as { id: number }).id
    await json(app, config, {
      method: 'PATCH',
      url: `/workspaces/${wsId}`,
      payload: { defaultAdapter: 'fake', defaultModel: 'fake-1' },
    })

    const board = (await json(app, config, { method: 'GET', url: `/workspaces/${wsId}/board` }))
      .body as { columns: { id: number; kind: string }[] }
    const readyColId = board.columns.find((c) => c.kind === 'ready')?.id
    if (readyColId === undefined) throw new Error('no ready column')

    const ticket = await json(app, config, {
      method: 'POST',
      url: '/tickets',
      payload: { workspaceId: wsId, title: 't', description: '' },
    })
    const ticketId = (ticket.body as { id: number }).id

    await json(app, config, {
      method: 'POST',
      url: `/tickets/${ticketId}/move`,
      payload: { columnId: readyColId, position: 1 },
    })

    let runId = 0
    await vi.waitFor(() => {
      const run = db.drizzle.select().from(agentRuns).where(eq(agentRuns.ticketId, ticketId)).get()
      if (run?.status !== 'running') throw new Error('run not running yet')
      runId = run.id
    })

    return { ...started, adapter, ticketId, runId }
  }

  test('6. delivers the note to the live session and records a nudge comment', async () => {
    const { app, config, db, adapter, ticketId, runId } = await setupRunningTicket()

    const res = await json(app, config, {
      method: 'POST',
      url: `/runs/${runId}/nudge`,
      payload: { note: 'try the other API' },
    })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ delivered: true })
    expect(adapter.injected).toEqual(['try the other API'])

    const ticketComments = db.drizzle
      .select()
      .from(comments)
      .where(eq(comments.ticketId, ticketId))
      .all()
    expect(ticketComments).toHaveLength(1)
    expect(ticketComments[0]).toMatchObject({
      kind: 'nudge',
      author: 'human',
      body: 'try the other API',
    })

    // The note is journaled so the run's event stream shows the interruption.
    const runEvents = db.drizzle.select().from(events).where(eq(events.runId, runId)).all()
    expect(JSON.stringify(runEvents)).toContain('try the other API')
  })

  test('7. delivered=false for an adapter that cannot be injected, comment still recorded', async () => {
    const { app, config, db, ticketId, runId } = await setupRunningTicket({
      supportsInjection: false,
    })

    const res = await json(app, config, {
      method: 'POST',
      url: `/runs/${runId}/nudge`,
      payload: { note: 'hurry up' },
    })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ delivered: false })

    const ticketComments = db.drizzle
      .select()
      .from(comments)
      .where(eq(comments.ticketId, ticketId))
      .all()
    expect(ticketComments).toHaveLength(1)
    expect(ticketComments[0]).toMatchObject({ kind: 'nudge', body: 'hurry up' })
  })

  test('8. 404 for a run that is not running, and for an unknown run', async () => {
    const { app, config, db } = await setupApp()
    const ws = await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'ws' },
    })
    const wsId = (ws.body as { id: number }).id
    const ticket = await json(app, config, {
      method: 'POST',
      url: '/tickets',
      payload: { workspaceId: wsId, title: 't', description: '' },
    })
    const ticketId = (ticket.body as { id: number }).id

    const [run] = db.drizzle
      .insert(agentRuns)
      .values({
        ticketId,
        adapter: 'fake',
        model: 'fake-1',
        status: 'needs_review',
        runToken: 'tok',
      })
      .returning()
      .all()
    if (!run) throw new Error('agentRun insert returned no row')

    const notRunning = await json(app, config, {
      method: 'POST',
      url: `/runs/${run.id}/nudge`,
      payload: { note: 'hi' },
    })
    expect(notRunning.status).toBe(404)

    const unknown = await json(app, config, {
      method: 'POST',
      url: '/runs/99999/nudge',
      payload: { note: 'hi' },
    })
    expect(unknown.status).toBe(404)

    // No comment is written when the nudge is rejected.
    expect(
      db.drizzle.select().from(comments).where(eq(comments.ticketId, ticketId)).all(),
    ).toHaveLength(0)
  })

  test('9. rejects an empty note with 400', async () => {
    const { app, config } = await setupApp()
    const res = await json(app, config, {
      method: 'POST',
      url: '/runs/1/nudge',
      payload: { note: '' },
    })
    expect(res.status).toBe(400)
  })
})

describe('runner adapter contract', () => {
  beforeEach(() => {
    isolateXdg()
  })

  test('10. the run effort reaches the adapter start context', async () => {
    const { db, wm, ticket } = await setupRunnable()
    const run = seedRun(db, ticket.id, 'high')

    let seen: AdapterStartCtx | undefined
    const adapter = new FakeAdapter({
      act: async (ctx) => {
        seen = ctx
      },
    })

    await executeRun({ db, wm, adapters: new Map([['fake', adapter]]), pr: false }, run.id)

    expect(seen?.effort).toBe('high')
    expect(seen?.model).toBe('fake-1')
    expect(seen?.runToken).toBe('tok')
    expect(seen?.mcpUrl).toBeTruthy()
  })

  test('11. an unavailable adapter fails the run with a journaled reason', async () => {
    const { db, wm, ticket } = await setupRunnable()
    const run = seedRun(db, ticket.id)

    const adapter = new FakeAdapter({ available: false })
    await executeRun({ db, wm, adapters: new Map([['fake', adapter]]), pr: false }, run.id)

    const updated = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, run.id)).get()
    expect(updated?.status).toBe('failed')

    const runEvents = db.drizzle.select().from(events).where(eq(events.runId, run.id)).all()
    expect(JSON.stringify(runEvents)).toContain('adapter not available on this server')
  })

  test('12. falls back to scratch/outcome.json when no outcome was reported over MCP', async () => {
    const { db, wm, ticket } = await setupRunnable()
    const run = seedRun(db, ticket.id)

    const adapter = new FakeAdapter({
      act: async (ctx) => {
        mkdirSync(join(ctx.runDir, 'scratch'), { recursive: true })
        writeFileSync(
          join(ctx.runDir, 'scratch', 'outcome.json'),
          JSON.stringify({ status: 'success', summary: 'wrote the file', testsPassed: 3 }),
        )
      },
    })

    await executeRun({ db, wm, adapters: new Map([['fake', adapter]]), pr: false }, run.id)

    const updated = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, run.id)).get()
    expect(updated?.status).toBe('needs_review')
    expect(updated?.summary).toBe('wrote the file')
  })

  test('13. outcome file reporting failure marks the run failed with its summary', async () => {
    const { db, wm, ticket } = await setupRunnable()
    const run = seedRun(db, ticket.id)

    const adapter = new FakeAdapter({
      act: async (ctx) => {
        writeFileSync(
          join(ctx.runDir, 'scratch', 'outcome.json'),
          JSON.stringify({ status: 'failed', summary: 'could not build' }),
        )
      },
    })

    await executeRun({ db, wm, adapters: new Map([['fake', adapter]]), pr: false }, run.id)

    const updated = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, run.id)).get()
    expect(updated?.status).toBe('failed')
  })

  test('14. an unparseable outcome file fails the run rather than throwing', async () => {
    const { db, wm, ticket } = await setupRunnable()
    const run = seedRun(db, ticket.id)

    const adapter = new FakeAdapter({
      act: async (ctx) => {
        writeFileSync(join(ctx.runDir, 'scratch', 'outcome.json'), '{not json')
      },
    })

    await executeRun({ db, wm, adapters: new Map([['fake', adapter]]), pr: false }, run.id)

    const updated = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, run.id)).get()
    expect(updated?.status).toBe('failed')
  })

  test('15. an outcome file with the wrong shape fails the run', async () => {
    const { db, wm, ticket } = await setupRunnable()
    const run = seedRun(db, ticket.id)

    const adapter = new FakeAdapter({
      act: async (ctx) => {
        writeFileSync(
          join(ctx.runDir, 'scratch', 'outcome.json'),
          JSON.stringify({ status: 'done', summary: 42 }),
        )
      },
    })

    await executeRun({ db, wm, adapters: new Map([['fake', adapter]]), pr: false }, run.id)

    const updated = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, run.id)).get()
    expect(updated?.status).toBe('failed')
  })

  test('16. an MCP-reported outcome wins over the outcome file', async () => {
    const { db, wm, ticket } = await setupRunnable()
    const run = seedRun(db, ticket.id)

    const adapter = new FakeAdapter({
      act: async (ctx) => {
        writeFileSync(
          join(ctx.runDir, 'scratch', 'outcome.json'),
          JSON.stringify({ status: 'failed', summary: 'from the file' }),
        )
        db.drizzle
          .insert(events)
          .values({
            runId: run.id,
            type: 'status',
            payload: { kind: 'outcome', status: 'success', summary: 'from mcp' },
          })
          .run()
      },
    })

    await executeRun({ db, wm, adapters: new Map([['fake', adapter]]), pr: false }, run.id)

    const updated = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, run.id)).get()
    expect(updated?.status).toBe('needs_review')
    expect(updated?.summary).toBe('from mcp')
  })
})

describe('CLI adapters', () => {
  test('17. codex and gemini advertise their models, efforts, and no injection', () => {
    const codex = new CodexAdapter()
    expect(codex.id).toBe('codex')
    expect(codex.label).toBe('Codex')
    expect(codex.models).toEqual(['gpt-5.2-codex', 'gpt-5.2'])
    expect(codex.efforts).toEqual(['low', 'medium', 'high'])
    expect(codex.supportsInjection).toBe(false)

    const gemini = new GeminiAdapter()
    expect(gemini.id).toBe('gemini')
    expect(gemini.label).toBe('Gemini')
    expect(gemini.models).toEqual(['gemini-3-pro', 'gemini-3-flash'])
    expect(gemini.efforts).toEqual(['default'])
    expect(gemini.supportsInjection).toBe(false)
  })

  test('18. probeCli reports false for a missing binary and caches the answer', async () => {
    const missing = `tada-not-a-real-cli-${Date.now()}`
    expect(await probeCli(missing)).toBe(false)
    expect(await probeCli(missing)).toBe(false)
  })

  test('19. the CLI prompt wrapper asks for scratch/outcome.json', () => {
    const wrapped = withOutcomeFileInstruction('do the work')
    expect(wrapped).toContain('do the work')
    expect(wrapped).toContain('scratch/outcome.json')
    expect(wrapped).toContain('summary')
  })

  /** The ctx a runner hands an adapter, with an already-aborted signal so `start` returns without
   * ever spawning the (possibly absent) CLI - argv and the session-start journal line are both
   * produced before the first await. */
  function cliCtx(overrides: Partial<AdapterStartCtx> = {}) {
    const controller = new AbortController()
    controller.abort()
    const events: AdapterEvent[] = []
    const ctx: AdapterStartCtx = {
      prompt: 'do the work',
      runDir: '/tmp/run',
      model: 'gpt-5.2-codex',
      effort: 'high',
      mcpUrl: 'http://127.0.0.1:0/mcp',
      runToken: 'tok',
      signal: controller.signal,
      journal: { write: (e) => events.push(e) },
      ...overrides,
    }
    return { ctx, events }
  }

  test('20. codex argv passes the run model with -m and the effort as a config override', () => {
    const { ctx } = cliCtx()
    const args = codexArgs(ctx)

    expect(args.slice(0, 3)).toEqual([
      'exec',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
    ])
    expect(args).toContain('-m')
    expect(args[args.indexOf('-m') + 1]).toBe('gpt-5.2-codex')
    expect(args).toContain('-c')
    expect(args[args.indexOf('-c') + 1]).toBe('model_reasoning_effort=high')
    // The prompt is last and still carries the outcome-file instruction.
    expect(args.at(-1)).toContain('do the work')
    expect(args.at(-1)).toContain('scratch/outcome.json')
  })

  test("21. codex omits the effort override for codex's own default ('medium')", () => {
    const args = codexArgs(cliCtx({ effort: 'medium' }).ctx)
    expect(args).not.toContain('-c')
    expect(args).toContain('-m')
  })

  test('22. gemini argv passes the run model with -m (it has no effort flag)', () => {
    const args = geminiArgs(cliCtx({ model: 'gemini-3-pro', effort: 'default' }).ctx)
    expect(args[args.indexOf('-m') + 1]).toBe('gemini-3-pro')
    expect(args).toContain('--yolo')
    expect(args[args.indexOf('-p') + 1]).toContain('scratch/outcome.json')
    expect(args).not.toContain('-c')
  })

  test('23. both CLI adapters journal their reduced capabilities at session start', async () => {
    for (const adapter of [new CodexAdapter(), new GeminiAdapter()]) {
      const { ctx, events } = cliCtx()
      const session = adapter.start(ctx)
      await expect(session.done).rejects.toThrow()

      expect(events[0]).toEqual({ type: 'text', payload: { text: CLI_CAPABILITY_NOTE } })
      expect(CLI_CAPABILITY_NOTE).toContain('scratch/outcome.json')
      expect(CLI_CAPABILITY_NOTE).toBe(CLI_CAPABILITY_NOTE.toLowerCase())
    }
  })
})

describe('CLI stdout line rendering', () => {
  /** The `text` a journaled event would carry for one stdout line. */
  function textOf(line: string): unknown {
    return (cliLineEvent(line).payload as { text: string }).text
  }

  test('24. codex item events render as prose, not JSON blobs', () => {
    expect(
      textOf(
        JSON.stringify({
          type: 'item.completed',
          item: { id: 'item_1', type: 'agent_message', text: 'Fixed the flaky test.' },
        }),
      ),
    ).toBe('Fixed the flaky test.')

    expect(
      textOf(
        JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'item_2',
            type: 'command_execution',
            command: 'pnpm test',
            aggregated_output: '...',
            exit_code: 0,
            status: 'completed',
          },
        }),
      ),
    ).toBe('$ pnpm test (exit 0)')

    expect(
      textOf(
        JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'item_3',
            type: 'file_change',
            changes: [
              { path: 'src/a.ts', kind: 'update' },
              { path: 'src/b.ts', kind: 'add' },
            ],
            status: 'completed',
          },
        }),
      ),
    ).toBe('edited src/a.ts, src/b.ts')

    expect(
      textOf(
        JSON.stringify({
          type: 'item.started',
          item: { id: 'i', type: 'reasoning', text: 'Planning.' },
        }),
      ),
    ).toBe('Planning.')
  })

  test('25. lifecycle and error events fall back to a compact label or their message', () => {
    expect(textOf(JSON.stringify({ type: 'thread.started', thread_id: 'th_1' }))).toBe(
      'thread.started',
    )
    expect(
      textOf(
        JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 2 } }),
      ),
    ).toBe('turn.completed')
    expect(textOf(JSON.stringify({ type: 'error', message: 'stream disconnected' }))).toBe(
      'stream disconnected',
    )
    expect(
      textOf(JSON.stringify({ type: 'turn.failed', error: { message: 'model overloaded' } })),
    ).toBe('model overloaded')
    // Unknown item shapes degrade to the item type rather than raw JSON.
    expect(
      textOf(
        JSON.stringify({
          type: 'item.completed',
          item: { id: 'i', type: 'web_search', query: 'zod' },
        }),
      ),
    ).toBe('search zod')
  })

  test('26. non-JSON lines pass through verbatim, and the parsed object rides along for JSON lines', () => {
    const plain = cliLineEvent('just some gemini output')
    expect(plain).toEqual({ type: 'text', payload: { text: 'just some gemini output' } })

    const json = cliLineEvent(JSON.stringify({ type: 'thread.started', thread_id: 'th_1' }))
    expect((json.payload as { json: unknown }).json).toEqual({
      type: 'thread.started',
      thread_id: 'th_1',
    })
  })
})
