import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type {
  ApiBoard,
  ApiRunDetail,
  ApiTicket,
  ApiTicketDetail,
  ApiWorkspaceDetail,
  ApiWorkspaceListItem,
} from '@tada/shared'
import { eq } from 'drizzle-orm'
import type { FastifyInstance, InjectOptions } from 'fastify'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { FakeScript } from '../src/adapters/fake.js'
import { FakeAdapter } from '../src/adapters/fake.js'
import type { Adapter, AdapterSession } from '../src/adapters/types.js'
import { buildApp } from '../src/app.js'
import type { Config } from '../src/config.js'
import { loadConfig } from '../src/config.js'
import { openDb, type TadaDb } from '../src/db/index.js'
import { activity, agentRuns, comments, tickets, workspaces } from '../src/db/schema.js'
import { git } from '../src/git.js'
import { dataDir, stateDir } from '../src/paths.js'
import { Scheduler } from '../src/runs/scheduler.js'
import { WorkspaceManager } from '../src/workspaces/manager.js'
import { BroadcastHub } from '../src/ws.js'
import { isolateXdg, makeOrigin } from './helpers/gitFixtures.js'
import { reportOutcome } from './helpers/reportOutcome.js'

async function setupApp(adapters: Map<string, Adapter> = new Map()) {
  const db = openDb(join(mkdtempSync(join(tmpdir(), 'tada-api-')), 'tada.db'))
  const wm = new WorkspaceManager(db)
  const hub = new BroadcastHub(db)
  const scheduler = new Scheduler({ db, wm, adapters, broadcast: hub.broadcast, pr: false })
  scheduler.recover()
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

/** Metadata-only Adapter stand-in: never runs, just advertises models and efforts for the
 * workspace PATCH validation tests. */
class StubAdapter implements Adapter {
  readonly supportsInjection = false
  constructor(
    readonly id: string,
    readonly label: string,
    readonly models: string[],
    readonly efforts: string[],
  ) {}

  available(): Promise<boolean> {
    return Promise.resolve(true)
  }

  start(): AdapterSession {
    return { done: Promise.resolve({ exitCode: 0 }), inject: () => false }
  }
}

/** The two harnesses a fresh workspace's defaults ('claude'/'sonnet'/'medium') and the
 * harness-switch tests need, with deliberately disjoint effort lists. */
function stubAdapters(): Map<string, Adapter> {
  return new Map<string, Adapter>([
    ['claude', new StubAdapter('claude', 'Claude', ['sonnet', 'opus'], ['low', 'medium', 'high'])],
    ['gemini', new StubAdapter('gemini', 'Gemini', ['gemini-3-pro'], ['default'])],
  ])
}

interface BoardTicket {
  id: number
  columnId: number
  queueState: string | null
}

interface BoardColumn {
  id: number
  kind: string
  tickets: BoardTicket[]
}

interface BoardPayload {
  columns: BoardColumn[]
}

function columnIdFor(board: BoardPayload, kind: string): number {
  const col = board.columns.find((c) => c.kind === kind)
  if (!col) throw new Error(`no ${kind} column in board`)
  return col.id
}

interface TicketDetail {
  id: number
  columnId: number
  comments: Array<{ author: string; body: string }>
  runs: Array<{ id: number; status: string; summary: string | null; branch: string | null }>
}

describe('REST API + WebSocket events', () => {
  beforeEach(() => {
    isolateXdg()
  })

  test('full loop: create workspace -> ready -> needs_review -> in_review -> done, worktree cleaned up', async () => {
    const origin = await makeOrigin('proj')

    // The FakeAdapter's `act` mimics what a real adapter+agent would do over MCP: post a
    // progress comment, commit some work in the repo worktree, and report success. `runId` is
    // recovered from the run directory path (`<stateDir>/runs/<runId>`) since RunContext doesn't
    // carry it directly.
    let db!: TadaDb
    const script: FakeScript = {
      act: async (ctx) => {
        const runId = Number(basename(ctx.runDir))
        const run = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, runId)).get()
        if (!run) throw new Error(`run ${runId} not found`)

        db.drizzle
          .insert(comments)
          .values({ ticketId: run.ticketId, author: 'agent', body: 'Working on it!' })
          .run()

        const repoDir = join(ctx.runDir, 'proj')
        writeFileSync(join(repoDir, 'change.txt'), 'agent work\n')
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

        reportOutcome(db, run.id, run.ticketId, 'success', 'Implemented the thing')
      },
    }
    const adapters = new Map<string, Adapter>([['fake', new FakeAdapter(script)]])

    const started = await setupApp(adapters)
    const { app, config } = started
    db = started.db

    const created = await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'demo' },
    })
    expect(created.status).toBe(201)
    const wsId = (created.body as { id: number }).id

    // DTO drift guard: a typed assignment from a real GET /workspaces response makes the server
    // suite fail to compile if ApiWorkspaceListItem drifts from what this route actually returns.
    const listRes = await json(app, config, { method: 'GET', url: '/workspaces' })
    const list: ApiWorkspaceListItem[] = listRes.body
    const listedWs = list.find((w) => w.id === wsId)
    if (!listedWs) throw new Error('created workspace missing from GET /workspaces')
    if (typeof listedWs.createdAt !== 'string') {
      throw new Error(`expected createdAt to be an ISO string, got ${typeof listedWs.createdAt}`)
    }

    const repoAdded = await json(app, config, {
      method: 'POST',
      url: `/workspaces/${wsId}/sources`,
      payload: { type: 'repo', url: origin },
    })
    expect(repoAdded.status).toBe(201)

    const patched = await json(app, config, {
      method: 'PATCH',
      url: `/workspaces/${wsId}`,
      payload: { defaultAdapter: 'fake', defaultModel: 'fake-1' },
    })
    expect(patched.status).toBe(200)

    const boardBefore = await json(app, config, { method: 'GET', url: `/workspaces/${wsId}/board` })
    // DTO drift guard: typed assignment from a real board response makes the server suite fail
    // to compile if ApiBoard drifts from what this route actually returns.
    const apiBoard: ApiBoard = boardBefore.body
    const firstCol = apiBoard.columns[0]
    if (!firstCol) throw new Error('expected at least one column in board response')
    const board = boardBefore.body as BoardPayload
    const readyColId = columnIdFor(board, 'ready')
    const inReviewColId = columnIdFor(board, 'in_review')
    const doneColId = columnIdFor(board, 'done')

    const ticketCreated = await json(app, config, {
      method: 'POST',
      url: '/tickets',
      payload: { workspaceId: wsId, title: 'Do the thing', description: 'desc' },
    })
    expect(ticketCreated.status).toBe(201)
    const ticketId = (ticketCreated.body as { id: number }).id

    const moved = await json(app, config, {
      method: 'POST',
      url: `/tickets/${ticketId}/move`,
      payload: { columnId: readyColId, position: 1 },
    })
    expect(moved.status).toBe(200)

    let finalTicket: TicketDetail | undefined
    await vi.waitFor(async () => {
      const res = await json(app, config, { method: 'GET', url: `/tickets/${ticketId}` })
      const ticket = res.body as TicketDetail
      const lastRun = ticket.runs.at(-1)
      if (lastRun?.status !== 'needs_review') {
        throw new Error(`run not needs_review yet: ${lastRun?.status}`)
      }
      finalTicket = ticket
    })
    if (!finalTicket) throw new Error('poll loop exited without setting finalTicket')

    expect(finalTicket.columnId).toBe(inReviewColId)
    expect(finalTicket.comments.some((c) => c.author === 'agent')).toBe(true)
    const lastRun = finalTicket.runs.at(-1)
    if (!lastRun) throw new Error('expected at least one run')
    expect(lastRun.summary).toBe('Implemented the thing')
    expect(lastRun.branch).toBe(`ticket/${ticketId}`)

    const branches = await git(origin, 'branch', '--list', `ticket/${ticketId}`)
    expect(branches).toContain(`ticket/${ticketId}`)

    const runDirPath = join(stateDir(), 'runs', String(lastRun.id))
    expect(existsSync(runDirPath)).toBe(true)

    const movedToDone = await json(app, config, {
      method: 'POST',
      url: `/tickets/${ticketId}/move`,
      payload: { columnId: doneColId, position: 1 },
    })
    expect(movedToDone.status).toBe(200)
    expect((movedToDone.body as TicketDetail).columnId).toBe(doneColId)
    expect(existsSync(runDirPath)).toBe(false)
  })

  test('401 without a bearer token', async () => {
    const { app } = await setupApp()
    const res = await app.inject({ method: 'GET', url: '/workspaces' })
    expect(res.statusCode).toBe(401)
  })

  test('400 on a zod-invalid body', async () => {
    const { app, config } = await setupApp()
    const res = await json(app, config, { method: 'POST', url: '/workspaces', payload: {} })
    expect(res.status).toBe(400)
  })

  test('human moving a card into In Progress is rejected with 403', async () => {
    const { app, config } = await setupApp()

    const ws = await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'ws' },
    })
    const wsId = (ws.body as { id: number }).id

    const board = (await json(app, config, { method: 'GET', url: `/workspaces/${wsId}/board` }))
      .body as BoardPayload
    const inProgressColId = columnIdFor(board, 'in_progress')

    const ticket = await json(app, config, {
      method: 'POST',
      url: '/tickets',
      payload: { workspaceId: wsId, title: 't', description: '' },
    })
    const ticketId = (ticket.body as { id: number }).id

    const res = await json(app, config, {
      method: 'POST',
      url: `/tickets/${ticketId}/move`,
      payload: { columnId: inProgressColId, position: 1 },
    })
    expect(res.status).toBe(403)
  })

  test('PATCH a ticket with an active run returns 409', async () => {
    const hang: FakeScript = { act: () => new Promise<void>(() => {}) }
    const adapters = new Map<string, Adapter>([['fake', new FakeAdapter(hang)]])
    const { app, config } = await setupApp(adapters)

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
      .body as BoardPayload
    const readyColId = columnIdFor(board, 'ready')

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

    await vi.waitFor(async () => {
      const res = await json(app, config, { method: 'GET', url: `/tickets/${ticketId}` })
      const t = res.body as TicketDetail
      const lastRun = t.runs.at(-1)
      if (lastRun?.status !== 'running') throw new Error('run not running yet')
    })

    const patchRes = await json(app, config, {
      method: 'PATCH',
      url: `/tickets/${ticketId}`,
      payload: { title: 'renamed' },
    })
    expect(patchRes.status).toBe(409)
  })

  test('memory PUT rejects a path-traversal file name', async () => {
    const { app, config } = await setupApp()
    const ws = await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'ws' },
    })
    const wsId = (ws.body as { id: number }).id

    const res = await json(app, config, {
      method: 'PUT',
      url: `/workspaces/${wsId}/memory/..%2Fevil`,
      payload: { body: 'pwned' },
    })
    expect(res.status).toBe(400)
  })

  /** Sets up a workspace with a hanging fake run, moves a fresh ticket to Ready, and waits for
   * the run to be actually 'running' (worktree built, adapter blocked on the never-resolving
   * promise) before handing back everything a test needs to poke at it further. */
  async function setupRunningTicket() {
    const hang: FakeScript = { act: () => new Promise<void>(() => {}) }
    const adapters = new Map<string, Adapter>([['fake', new FakeAdapter(hang)]])
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
      .body as BoardPayload
    const readyColId = columnIdFor(board, 'ready')
    const inProgressColId = columnIdFor(board, 'in_progress')
    const doneColId = columnIdFor(board, 'done')
    const backlogColId = columnIdFor(board, 'backlog')

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

    let runId!: number
    await vi.waitFor(async () => {
      const res = await json(app, config, { method: 'GET', url: `/tickets/${ticketId}` })
      const t = res.body as TicketDetail
      const lastRun = t.runs.at(-1)
      if (lastRun?.status !== 'running') throw new Error('run not running yet')
      runId = lastRun.id
    })

    // Status flips to 'running' before buildRunDir (git worktrees) finishes - wait for the
    // worktree to actually exist before handing control back, so callers can assert on it.
    const runDirPath = join(stateDir(), 'runs', String(runId))
    await vi.waitFor(() => {
      if (!existsSync(runDirPath)) throw new Error('run dir not built yet')
    })

    return {
      app,
      config,
      db,
      wsId,
      ticketId,
      runId,
      readyColId,
      inProgressColId,
      doneColId,
      backlogColId,
    }
  }

  test('moving a ticket with a running run to Done is rejected with 409, worktree untouched', async () => {
    const { app, config, ticketId, runId, doneColId, inProgressColId } = await setupRunningTicket()

    const runDirPath = join(stateDir(), 'runs', String(runId))
    expect(existsSync(runDirPath)).toBe(true)

    const res = await json(app, config, {
      method: 'POST',
      url: `/tickets/${ticketId}/move`,
      payload: { columnId: doneColId, position: 1 },
    })
    expect(res.status).toBe(409)
    expect((res.body as { error: string }).error).toBe('run in progress')

    // worktree/run dir untouched, and the card wasn't yanked out of In Progress
    expect(existsSync(runDirPath)).toBe(true)
    const ticketRes = await json(app, config, { method: 'GET', url: `/tickets/${ticketId}` })
    expect((ticketRes.body as TicketDetail).columnId).toBe(inProgressColId)
  })

  test('moving a ticket with a running run to Ready is rejected with 409, no second run row', async () => {
    const { app, config, db, ticketId, readyColId } = await setupRunningTicket()

    const res = await json(app, config, {
      method: 'POST',
      url: `/tickets/${ticketId}/move`,
      payload: { columnId: readyColId, position: 1 },
    })
    expect(res.status).toBe(409)
    expect((res.body as { error: string }).error).toBe('run in progress')

    const runs = db.drizzle.select().from(agentRuns).where(eq(agentRuns.ticketId, ticketId)).all()
    expect(runs).toHaveLength(1)
  })

  test('POST /workspaces with a path-traversal name is rejected with 400, nothing created', async () => {
    const { app, config, db } = await setupApp()

    const res = await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: '../evil' },
    })
    expect(res.status).toBe(400)

    expect(db.drizzle.select().from(workspaces).all()).toHaveLength(0)
    expect(existsSync(join(dataDir(), 'workspaces', 'evil'))).toBe(false)
  })

  test('DELETE source with a path-traversal name is rejected with 400, nothing deleted', async () => {
    const { app, config } = await setupApp()
    const origin = await makeOrigin('proj')

    const ws = await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'ws' },
    })
    const wsId = (ws.body as { id: number }).id
    await json(app, config, {
      method: 'POST',
      url: `/workspaces/${wsId}/sources`,
      payload: { type: 'repo', url: origin },
    })

    const res = await json(app, config, {
      method: 'DELETE',
      url: `/workspaces/${wsId}/sources/..%2Fevil`,
    })
    expect(res.status).toBe(400)

    const detail = await json(app, config, { method: 'GET', url: `/workspaces/${wsId}` })
    expect((detail.body as { sources: Array<{ name: string }> }).sources).toEqual([
      { type: 'repo', name: 'proj', url: origin, defaultBranch: 'main' },
    ])
  })

  test('old POST/DELETE /workspaces/:id/repos routes are gone', async () => {
    const { app, config } = await setupApp()
    const ws = await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'ws' },
    })
    const wsId = (ws.body as { id: number }).id

    const postRes = await json(app, config, {
      method: 'POST',
      url: `/workspaces/${wsId}/repos`,
      payload: { url: 'file:///whatever' },
    })
    expect(postRes.status).toBe(404)

    const deleteRes = await json(app, config, {
      method: 'DELETE',
      url: `/workspaces/${wsId}/repos/proj`,
    })
    expect(deleteRes.status).toBe(404)
  })

  test('POST /workspaces/:id/sources with type folder adds a folder source, symlinked by name', async () => {
    const { app, config } = await setupApp()
    const ws = await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'ws' },
    })
    const wsId = (ws.body as { id: number }).id

    const folder = mkdtempSync(join(tmpdir(), 'tada-folder-'))

    const added = await json(app, config, {
      method: 'POST',
      url: `/workspaces/${wsId}/sources`,
      payload: { type: 'folder', path: folder },
    })
    expect(added.status).toBe(201)

    const detail = await json(app, config, { method: 'GET', url: `/workspaces/${wsId}` })
    expect((detail.body as { sources: unknown[] }).sources).toEqual([
      { type: 'folder', name: basename(folder), path: folder },
    ])

    const removed = await json(app, config, {
      method: 'DELETE',
      url: `/workspaces/${wsId}/sources/${basename(folder)}`,
    })
    expect(removed.status).toBe(200)

    const afterRemove = await json(app, config, { method: 'GET', url: `/workspaces/${wsId}` })
    expect((afterRemove.body as { sources: unknown[] }).sources).toEqual([])
  })

  test('POST /workspaces/:id/sources with a relative folder path is rejected with 400', async () => {
    const { app, config } = await setupApp()
    const ws = await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'ws' },
    })
    const wsId = (ws.body as { id: number }).id

    const res = await json(app, config, {
      method: 'POST',
      url: `/workspaces/${wsId}/sources`,
      payload: { type: 'folder', path: 'relative/dir' },
    })
    expect(res.status).toBe(400)
  })

  test('POST /workspaces/:id/sources with a missing folder path is rejected with 400', async () => {
    const { app, config } = await setupApp()
    const ws = await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'ws' },
    })
    const wsId = (ws.body as { id: number }).id

    const res = await json(app, config, {
      method: 'POST',
      url: `/workspaces/${wsId}/sources`,
      payload: { type: 'folder', path: join(tmpdir(), 'tada-does-not-exist-xyz') },
    })
    expect(res.status).toBe(400)
  })

  test('GET /repos/known returns the union of repo sources across workspaces', async () => {
    const { app, config } = await setupApp()
    const origin = await makeOrigin('shared')

    const wsA = await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'ws-a' },
    })
    const wsAId = (wsA.body as { id: number }).id
    await json(app, config, {
      method: 'POST',
      url: `/workspaces/${wsAId}/sources`,
      payload: { type: 'repo', url: origin },
    })

    const wsB = await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'ws-b' },
    })
    const wsBId = (wsB.body as { id: number }).id
    await json(app, config, {
      method: 'POST',
      url: `/workspaces/${wsBId}/sources`,
      payload: { type: 'repo', url: origin },
    })

    const known = await json(app, config, { method: 'GET', url: '/repos/known' })
    expect(known.status).toBe(200)
    expect(known.body).toEqual([{ url: origin, name: 'shared' }])
  })

  test('GET /workspaces/check-name slugifies the name and reports availability', async () => {
    const { app, config } = await setupApp()

    const free = await json(app, config, {
      method: 'GET',
      url: '/workspaces/check-name?name=Acme%20Web',
    })
    expect(free.status).toBe(200)
    expect(free.body).toEqual({ id: 'acme-web', available: true })

    await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'Acme Web' },
    })

    // Availability is by exact (trimmed) name - the same rule POST /workspaces enforces - so a
    // differently-cased or differently-spaced name is still free even if it slugs the same.
    const taken = await json(app, config, {
      method: 'GET',
      url: '/workspaces/check-name?name=Acme%20Web',
    })
    expect(taken.status).toBe(200)
    expect(taken.body).toEqual({ id: 'acme-web', available: false })

    const stillFree = await json(app, config, {
      method: 'GET',
      url: '/workspaces/check-name?name=acme-web',
    })
    expect(stillFree.body).toEqual({ id: 'acme-web', available: true })
  })

  test('POST /workspaces with a duplicate name returns 409 and leaves the original intact', async () => {
    const { app, config, wm } = await setupApp()
    const first = await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'dup' },
    })
    const wsId = (first.body as { id: number }).id
    const folder = mkdtempSync(join(tmpdir(), 'tada-folder-'))
    await json(app, config, {
      method: 'POST',
      url: `/workspaces/${wsId}/sources`,
      payload: { type: 'folder', path: folder },
    })

    const dup = await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'dup' },
    })
    expect(dup.status).toBe(409)
    expect(dup.body).toEqual({ error: 'workspace name already exists' })
    expect(wm.listSources(wsId)).toHaveLength(1)

    const check = await json(app, config, {
      method: 'GET',
      url: '/workspaces/check-name?name=dup',
    })
    expect(check.body).toEqual({ id: 'dup', available: false })
  })

  test('GET /workspaces needsReviewCount follows the in_review column (drops back after accept) and survives a broken manifest', async () => {
    const { app, config, db, wm } = await setupApp()
    const ws = await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'ws' },
    })
    const wsId = (ws.body as { id: number }).id
    const board = await json(app, config, { method: 'GET', url: `/workspaces/${wsId}/board` })
    const inReviewCol = columnIdFor(board.body as BoardPayload, 'in_review')

    const t = await json(app, config, {
      method: 'POST',
      url: '/tickets',
      payload: { workspaceId: wsId, title: 'review me' },
    })
    const ticketId = (t.body as { id: number }).id
    // Park a needs_review run on it and put the card in In review, the way a finished run does.
    db.drizzle
      .insert(agentRuns)
      .values({
        ticketId,
        adapter: 'claude',
        model: 'sonnet',
        effort: 'medium',
        attemptNumber: 1,
        status: 'needs_review',
        runToken: 'tok',
      })
      .run()
    db.drizzle.update(tickets).set({ columnId: inReviewCol }).where(eq(tickets.id, ticketId)).run()

    const before = await json(app, config, { method: 'GET', url: '/workspaces' })
    expect(
      (before.body as ApiWorkspaceListItem[]).find((w) => w.id === wsId)?.needsReviewCount,
    ).toBe(1)

    const accepted = await json(app, config, { method: 'POST', url: `/tickets/${ticketId}/accept` })
    expect(accepted.status).toBe(200)

    const after = await json(app, config, { method: 'GET', url: '/workspaces' })
    expect(
      (after.body as ApiWorkspaceListItem[]).find((w) => w.id === wsId)?.needsReviewCount,
    ).toBe(0)

    // A workspace whose manifest vanished must not 500 the whole list.
    rmSync(join(wm.reposDir(wsId), '..', 'manifest.json'))
    const broken = await json(app, config, { method: 'GET', url: '/workspaces' })
    expect(broken.status).toBe(200)
    expect((broken.body as ApiWorkspaceListItem[]).find((w) => w.id === wsId)?.sourceCount).toBe(0)
  })

  test('GET /workspaces reports sourceCount and queuedCount (ready column + queueState=queued only), scoped per workspace', async () => {
    const { app, config, db } = await setupApp()

    // Workspace A: two sources (sourceCount = 2), three tickets - one ready+queued (counts), one
    // ready+held (doesn't count - held, not queued), one left in backlog (doesn't count - wrong
    // column).
    const wsA = await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'ws-a' },
    })
    const wsAId = (wsA.body as { id: number }).id

    const origin = await makeOrigin('proj')
    await json(app, config, {
      method: 'POST',
      url: `/workspaces/${wsAId}/sources`,
      payload: { type: 'repo', url: origin },
    })
    const folder = mkdtempSync(join(tmpdir(), 'tada-folder-'))
    await json(app, config, {
      method: 'POST',
      url: `/workspaces/${wsAId}/sources`,
      payload: { type: 'folder', path: folder },
    })

    const boardA = await json(app, config, { method: 'GET', url: `/workspaces/${wsAId}/board` })
    const readyColIdA = columnIdFor(boardA.body as BoardPayload, 'ready')

    const queuedTicket = await json(app, config, {
      method: 'POST',
      url: '/tickets',
      payload: { workspaceId: wsAId, title: 'queued', description: '' },
    })
    const heldTicket = await json(app, config, {
      method: 'POST',
      url: '/tickets',
      payload: { workspaceId: wsAId, title: 'held', description: '' },
    })
    await json(app, config, {
      method: 'POST',
      url: '/tickets',
      payload: { workspaceId: wsAId, title: 'still in backlog', description: '' },
    })

    db.drizzle
      .update(tickets)
      .set({ columnId: readyColIdA, queueState: 'queued' })
      .where(eq(tickets.id, (queuedTicket.body as { id: number }).id))
      .run()
    db.drizzle
      .update(tickets)
      .set({ columnId: readyColIdA, queueState: 'held' })
      .where(eq(tickets.id, (heldTicket.body as { id: number }).id))
      .run()

    // Workspace B: no sources, one ready+queued ticket of its own - proves counts don't leak
    // across workspaces (if the query dropped its workspaceId filter, A would read 2 not 1).
    const wsB = await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'ws-b' },
    })
    const wsBId = (wsB.body as { id: number }).id
    const boardB = await json(app, config, { method: 'GET', url: `/workspaces/${wsBId}/board` })
    const readyColIdB = columnIdFor(boardB.body as BoardPayload, 'ready')
    const ticketB = await json(app, config, {
      method: 'POST',
      url: '/tickets',
      payload: { workspaceId: wsBId, title: 'b-queued', description: '' },
    })
    db.drizzle
      .update(tickets)
      .set({ columnId: readyColIdB, queueState: 'queued' })
      .where(eq(tickets.id, (ticketB.body as { id: number }).id))
      .run()

    const list = await json(app, config, { method: 'GET', url: '/workspaces' })
    const items = list.body as ApiWorkspaceListItem[]
    const wsAItem = items.find((w) => w.id === wsAId)
    const wsBItem = items.find((w) => w.id === wsBId)
    if (!wsAItem || !wsBItem) throw new Error('missing workspace in GET /workspaces')

    expect(wsAItem.sourceCount).toBe(2)
    expect(wsAItem.queuedCount).toBe(1)
    expect(wsBItem.sourceCount).toBe(0)
    expect(wsBItem.queuedCount).toBe(1)
  })

  test('PATCH workspace with an unknown adapter name returns 400', async () => {
    const { app, config } = await setupApp()
    const ws = await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'ws' },
    })
    const wsId = (ws.body as { id: number }).id

    const res = await json(app, config, {
      method: 'PATCH',
      url: `/workspaces/${wsId}`,
      payload: { defaultAdapter: 'nope' },
    })
    expect(res.status).toBe(400)
  })

  // defaultEffort used to be missing from the PATCH schema, so zod stripped it: the effort
  // picker's PATCH arrived as `{}` (a 500 from drizzle's empty `set`) and a harness switch
  // silently kept the old harness's effort. These three lock the field in.
  test('PATCH workspace with defaultEffort alone round-trips and leaves the rest untouched', async () => {
    const { app, config } = await setupApp(stubAdapters())
    const ws = await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'ws' },
    })
    const wsId = (ws.body as { id: number }).id

    const res = await json(app, config, {
      method: 'PATCH',
      url: `/workspaces/${wsId}`,
      payload: { defaultEffort: 'high' },
    })
    expect(res.status).toBe(200)
    expect(res.body as ApiWorkspaceDetail).toMatchObject({
      defaultAdapter: 'claude',
      defaultModel: 'sonnet',
      defaultEffort: 'high',
    })

    const fetched = await json(app, config, { method: 'GET', url: `/workspaces/${wsId}` })
    expect((fetched.body as ApiWorkspaceDetail).defaultEffort).toBe('high')
  })

  test('PATCH workspace with an effort the adapter does not offer returns 400 and stores nothing', async () => {
    const { app, config } = await setupApp(stubAdapters())
    const ws = await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'ws' },
    })
    const wsId = (ws.body as { id: number }).id

    const res = await json(app, config, {
      method: 'PATCH',
      url: `/workspaces/${wsId}`,
      payload: { defaultEffort: 'ludicrous' },
    })
    expect(res.status).toBe(400)

    const fetched = await json(app, config, { method: 'GET', url: `/workspaces/${wsId}` })
    expect((fetched.body as ApiWorkspaceDetail).defaultEffort).toBe('medium')
  })

  test('PATCH workspace switching harness applies adapter, model and effort, validated against the new harness', async () => {
    const { app, config } = await setupApp(stubAdapters())
    const ws = await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'ws' },
    })
    const wsId = (ws.body as { id: number }).id

    const switched = await json(app, config, {
      method: 'PATCH',
      url: `/workspaces/${wsId}`,
      payload: { defaultAdapter: 'gemini', defaultModel: 'gemini-3-pro', defaultEffort: 'default' },
    })
    expect(switched.status).toBe(200)
    expect(switched.body as ApiWorkspaceDetail).toMatchObject({
      defaultAdapter: 'gemini',
      defaultModel: 'gemini-3-pro',
      defaultEffort: 'default',
    })

    // 'high' is a Claude effort; the new harness only offers 'default'.
    const rejected = await json(app, config, {
      method: 'PATCH',
      url: `/workspaces/${wsId}`,
      payload: { defaultAdapter: 'gemini', defaultModel: 'gemini-3-pro', defaultEffort: 'high' },
    })
    expect(rejected.status).toBe(400)
  })

  test('PATCH workspace switching only the harness resets a stored model/effort the new harness lacks', async () => {
    const { app, config } = await setupApp(stubAdapters())
    const ws = await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'ws' },
    })
    const wsId = (ws.body as { id: number }).id

    // Fresh workspace: claude/sonnet/medium. Switch harness only; gemini has neither.
    const switched = await json(app, config, {
      method: 'PATCH',
      url: `/workspaces/${wsId}`,
      payload: { defaultAdapter: 'gemini' },
    })
    expect(switched.status).toBe(200)
    expect(switched.body as ApiWorkspaceDetail).toMatchObject({
      defaultAdapter: 'gemini',
      defaultModel: 'gemini-3-pro',
      defaultEffort: 'default',
    })
  })

  test('PATCH ticket validates model/effort overrides against the workspace default adapter when no adapter override is set', async () => {
    const { app, config } = await setupApp(stubAdapters())
    const ws = await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'ws' },
    })
    const wsId = (ws.body as { id: number }).id
    const ticket = await json(app, config, {
      method: 'POST',
      url: '/tickets',
      payload: { workspaceId: wsId, title: 't' },
    })
    const ticketId = (ticket.body as { id: number }).id

    const bogusModel = await json(app, config, {
      method: 'PATCH',
      url: `/tickets/${ticketId}`,
      payload: { modelOverride: 'totally-bogus' },
    })
    expect(bogusModel.status).toBe(400)

    const bogusEffort = await json(app, config, {
      method: 'PATCH',
      url: `/tickets/${ticketId}`,
      payload: { effortOverride: 'zzz' },
    })
    expect(bogusEffort.status).toBe(400)

    const ok = await json(app, config, {
      method: 'PATCH',
      url: `/tickets/${ticketId}`,
      payload: { modelOverride: 'opus', effortOverride: 'high' },
    })
    expect(ok.status).toBe(200)

    // Switching only the adapter override clears overrides the new adapter can't honour.
    const switched = await json(app, config, {
      method: 'PATCH',
      url: `/tickets/${ticketId}`,
      payload: { adapterOverride: 'gemini' },
    })
    expect(switched.status).toBe(200)
    expect(switched.body as ApiTicket).toMatchObject({
      adapterOverride: 'gemini',
      modelOverride: null,
      effortOverride: null,
    })
  })

  test('PATCH ticket with an empty body is a 200 no-op', async () => {
    const { app, config } = await setupApp()
    const ws = await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'ws' },
    })
    const wsId = (ws.body as { id: number }).id
    const ticket = await json(app, config, {
      method: 'POST',
      url: '/tickets',
      payload: { workspaceId: wsId, title: 't' },
    })
    const ticketId = (ticket.body as { id: number }).id

    const res = await json(app, config, {
      method: 'PATCH',
      url: `/tickets/${ticketId}`,
      payload: {},
    })
    expect(res.status).toBe(200)
  })

  test('PATCH ticket with an unknown adapterOverride returns 400', async () => {
    const { app, config } = await setupApp()
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

    const res = await json(app, config, {
      method: 'PATCH',
      url: `/tickets/${ticketId}`,
      payload: { adapterOverride: 'nope' },
    })
    expect(res.status).toBe(400)
  })

  test('move to Ready with a stale bogus adapterOverride is rejected 400, column unchanged', async () => {
    const adapters = new Map<string, Adapter>([['fake', new FakeAdapter()]])
    const { app, config, db } = await setupApp(adapters)

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
      .body as BoardPayload
    const readyColId = columnIdFor(board, 'ready')
    const backlogColId = columnIdFor(board, 'backlog')

    const ticket = await json(app, config, {
      method: 'POST',
      url: '/tickets',
      payload: { workspaceId: wsId, title: 't', description: '' },
    })
    const ticketId = (ticket.body as { id: number }).id

    // Bypass the PATCH-time adapter validation entirely, simulating stale/corrupted data.
    db.drizzle
      .update(tickets)
      .set({ adapterOverride: 'nonexistent-adapter' })
      .where(eq(tickets.id, ticketId))
      .run()

    const res = await json(app, config, {
      method: 'POST',
      url: `/tickets/${ticketId}/move`,
      payload: { columnId: readyColId, position: 1 },
    })
    expect(res.status).toBe(400)

    const ticketRes = await json(app, config, { method: 'GET', url: `/tickets/${ticketId}` })
    expect((ticketRes.body as TicketDetail).columnId).toBe(backlogColId)
  })

  test('GET /runs/:id/transcript returns 404 (not 500) when the transcript file is missing', async () => {
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
        transcriptPath: join(stateDir(), 'transcripts', 'does-not-exist.jsonl'),
      })
      .returning()
      .all()
    if (!run) throw new Error('agentRun insert returned no row')

    const res = await app.inject(
      authed(config, { method: 'GET', url: `/runs/${run.id}/transcript` }),
    )
    expect(res.statusCode).toBe(404)
  })
})

describe('Ticket flows: accept, send-back, proposals, attempts, run detail', () => {
  beforeEach(() => {
    isolateXdg()
  })

  function succeedingAdapters(): Map<string, Adapter> {
    return new Map<string, Adapter>([['fake', new FakeAdapter()]])
  }

  async function setupInReviewTicket() {
    let db!: TadaDb
    const script: FakeScript = {
      act: async (ctx) => {
        const runId = Number(basename(ctx.runDir))
        const run = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, runId)).get()
        if (!run) throw new Error(`run ${runId} not found`)
        reportOutcome(db, run.id, run.ticketId, 'success', `Attempt ${run.attemptNumber} summary`)
      },
    }
    const adapters = new Map<string, Adapter>([['fake', new FakeAdapter(script)]])
    const started = await setupApp(adapters)
    const { app, config } = started
    db = started.db

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
      .body as BoardPayload
    const readyColId = columnIdFor(board, 'ready')
    const inProgressColId = columnIdFor(board, 'in_progress')
    const inReviewColId = columnIdFor(board, 'in_review')
    const doneColId = columnIdFor(board, 'done')

    const ticket = await json(app, config, {
      method: 'POST',
      url: '/tickets',
      payload: { workspaceId: wsId, title: 'Reviewable ticket', description: 'desc' },
    })
    const ticketId = (ticket.body as { id: number }).id

    await json(app, config, {
      method: 'POST',
      url: `/tickets/${ticketId}/move`,
      payload: { columnId: readyColId, position: 1 },
    })

    await vi.waitFor(async () => {
      const res = await json(app, config, { method: 'GET', url: `/tickets/${ticketId}` })
      const t = res.body as ApiTicketDetail
      if (t.columnId !== inReviewColId) throw new Error('not in review yet')
    })

    return {
      app,
      config,
      db,
      wsId,
      ticketId,
      readyColId,
      inProgressColId,
      inReviewColId,
      doneColId,
    }
  }

  test('POST /tickets/:id/accept when not in review returns 409', async () => {
    const { app, config } = await setupApp()
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

    const res = await json(app, config, { method: 'POST', url: `/tickets/${ticketId}/accept` })
    expect(res.status).toBe(409)
  })

  test('POST /tickets/:id/accept moves the ticket to Done, writes an accepted activity', async () => {
    const { app, config, db, ticketId, doneColId, wsId } = await setupInReviewTicket()

    const res = await json(app, config, { method: 'POST', url: `/tickets/${ticketId}/accept` })
    expect(res.status).toBe(200)
    expect((res.body as ApiTicketDetail).columnId).toBe(doneColId)

    const acts = db.drizzle.select().from(activity).where(eq(activity.workspaceId, wsId)).all()
    expect(acts.some((a) => a.type === 'accepted' && a.ticketId === ticketId)).toBe(true)
  })

  test('POST /tickets/:id/send-back when not in review returns 409', async () => {
    const { app, config } = await setupApp()
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

    const res = await json(app, config, {
      method: 'POST',
      url: `/tickets/${ticketId}/send-back`,
      payload: { feedback: 'nope' },
    })
    expect(res.status).toBe(409)
  })

  test('POST /tickets/:id/send-back inserts a feedback comment, re-enqueues, moves to ready, writes a sent_back activity', async () => {
    const { app, config, db, ticketId, readyColId, inProgressColId, wsId } =
      await setupInReviewTicket()

    const res = await json(app, config, {
      method: 'POST',
      url: `/tickets/${ticketId}/send-back`,
      payload: { feedback: 'Please handle the edge case' },
    })
    expect(res.status).toBe(200)
    // Card lands in Ready; with scheduler capacity available it may synchronously advance to
    // in_progress within the same call (the re-enqueue starts a run immediately) - either is the
    // correct outcome, unlike still sitting in in_review.
    expect([readyColId, inProgressColId]).toContain((res.body as ApiTicketDetail).columnId)

    const ticketComments = db.drizzle
      .select()
      .from(comments)
      .where(eq(comments.ticketId, ticketId))
      .all()
    const feedbackComment = ticketComments.find((c) => c.kind === 'feedback')
    expect(feedbackComment).toMatchObject({
      author: 'human',
      kind: 'feedback',
      body: 'Please handle the edge case',
    })

    const acts = db.drizzle.select().from(activity).where(eq(activity.workspaceId, wsId)).all()
    expect(acts.some((a) => a.type === 'sent_back' && a.ticketId === ticketId)).toBe(true)

    // re-enqueued: a second run row now exists for the ticket
    await vi.waitFor(() => {
      const runs = db.drizzle.select().from(agentRuns).where(eq(agentRuns.ticketId, ticketId)).all()
      if (runs.length < 2) throw new Error('second run not created yet')
    })
  })

  test('attempt numbering increments across three runs on the same ticket (send-back twice)', async () => {
    const { app, config, ticketId } = await setupInReviewTicket()

    await json(app, config, {
      method: 'POST',
      url: `/tickets/${ticketId}/send-back`,
      payload: { feedback: 'round 1 feedback' },
    })
    await vi.waitFor(async () => {
      const t = (await json(app, config, { method: 'GET', url: `/tickets/${ticketId}` }))
        .body as ApiTicketDetail
      if (t.runs.length < 2 || t.runs[1]?.status !== 'needs_review') {
        throw new Error('second run not needs_review yet')
      }
    })

    await json(app, config, {
      method: 'POST',
      url: `/tickets/${ticketId}/send-back`,
      payload: { feedback: 'round 2 feedback' },
    })
    await vi.waitFor(async () => {
      const t = (await json(app, config, { method: 'GET', url: `/tickets/${ticketId}` }))
        .body as ApiTicketDetail
      if (t.runs.length < 3 || t.runs[2]?.status !== 'needs_review') {
        throw new Error('third run not needs_review yet')
      }
    })

    const final = (await json(app, config, { method: 'GET', url: `/tickets/${ticketId}` }))
      .body as ApiTicketDetail
    expect(final.runs.map((r) => r.attemptNumber)).toEqual([1, 2, 3])
  })

  // Regression guard for the send-back path on a workspace that actually has a repo source (the
  // other attempt tests use a source-less workspace, so buildRunDir never touches git). Attempt
  // 1's run dir keeps `ticket/<id>` checked out after it finishes - the on-Done cleanup only
  // fires when the card is accepted - so without cleaning prior attempts' run dirs first,
  // attempt 2's `git worktree add` fails with "branch already used by worktree", the run
  // insta-fails and the card lands back in Ready/held having never reached the adapter.
  test('send-back on a repo-backed workspace: attempt 2 builds its run dir, reaches the adapter, and records a diffstat', async () => {
    const origin = await makeOrigin('proj')
    const runDirsSeen: string[] = []
    let db!: TadaDb

    const script: FakeScript = {
      act: async (ctx) => {
        runDirsSeen.push(ctx.runDir)
        const runId = Number(basename(ctx.runDir))
        const run = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, runId)).get()
        if (!run) throw new Error(`run ${runId} not found`)

        // Commit inside the worktree the run dir handed us: proof it exists and is on the
        // ticket branch, and it gives completeRun a real diff to measure.
        const repoDir = join(ctx.runDir, 'proj')
        writeFileSync(join(repoDir, `attempt-${run.attemptNumber}.txt`), 'agent work\n')
        await git(repoDir, 'add', '.')
        await git(
          repoDir,
          '-c',
          'user.email=t@t',
          '-c',
          'user.name=t',
          'commit',
          '-m',
          `attempt ${run.attemptNumber}`,
        )

        reportOutcome(db, run.id, run.ticketId, 'success', `attempt ${run.attemptNumber} done`)
      },
    }

    const started = await setupApp(new Map<string, Adapter>([['fake', new FakeAdapter(script)]]))
    const { app, config } = started
    db = started.db

    const ws = await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'ws' },
    })
    const wsId = (ws.body as { id: number }).id
    expect(
      (
        await json(app, config, {
          method: 'POST',
          url: `/workspaces/${wsId}/sources`,
          payload: { type: 'repo', url: origin },
        })
      ).status,
    ).toBe(201)
    await json(app, config, {
      method: 'PATCH',
      url: `/workspaces/${wsId}`,
      payload: { defaultAdapter: 'fake', defaultModel: 'fake-1' },
    })

    const board = (await json(app, config, { method: 'GET', url: `/workspaces/${wsId}/board` }))
      .body as BoardPayload
    const ticket = await json(app, config, {
      method: 'POST',
      url: '/tickets',
      payload: { workspaceId: wsId, title: 'Repo-backed ticket', description: 'desc' },
    })
    const ticketId = (ticket.body as { id: number }).id

    await json(app, config, {
      method: 'POST',
      url: `/tickets/${ticketId}/move`,
      payload: { columnId: columnIdFor(board, 'ready'), position: 1 },
    })
    await vi.waitFor(async () => {
      const t = (await json(app, config, { method: 'GET', url: `/tickets/${ticketId}` }))
        .body as ApiTicketDetail
      if (t.runs[0]?.status !== 'needs_review') throw new Error('first run not needs_review yet')
    })

    const sentBack = await json(app, config, {
      method: 'POST',
      url: `/tickets/${ticketId}/send-back`,
      payload: { feedback: 'one more pass please' },
    })
    expect(sentBack.status).toBe(200)

    await vi.waitFor(async () => {
      const t = (await json(app, config, { method: 'GET', url: `/tickets/${ticketId}` }))
        .body as ApiTicketDetail
      if (t.runs.length < 2 || t.runs[1]?.status === 'running' || t.runs[1]?.status === 'queued') {
        throw new Error('second run not finished yet')
      }
    })

    // The adapter ran twice, in two different run dirs.
    expect(runDirsSeen).toHaveLength(2)
    expect(new Set(runDirsSeen).size).toBe(2)

    const runs = db.drizzle.select().from(agentRuns).where(eq(agentRuns.ticketId, ticketId)).all()
    expect(runs.map((r) => r.status)).toEqual(['needs_review', 'needs_review'])
    expect(runs[1]?.summary).toBe('attempt 2 done')
    // Diffstat is computed against the repo's default branch, so attempt 2 sees both commits.
    expect(runs[1]?.diffAdditions).toBe(2)
    expect(runs[1]?.diffDeletions).toBe(0)

    // Attempt 1's run dir is gone (reclaimed before attempt 2 built its own), attempt 2's is live.
    const firstRunId = runs[0]?.id
    const secondRunId = runs[1]?.id
    if (firstRunId === undefined || secondRunId === undefined) throw new Error('missing run rows')
    expect(existsSync(join(stateDir(), 'runs', String(firstRunId)))).toBe(false)
    expect(existsSync(join(stateDir(), 'runs', String(secondRunId), 'proj'))).toBe(true)
  })

  test('GET /runs/:id returns ApiRunDetail shape (ticketTitle, workspaceId), 404 for missing run', async () => {
    const { app, config, ticketId, wsId } = await setupInReviewTicket()

    const ticketRes = await json(app, config, { method: 'GET', url: `/tickets/${ticketId}` })
    const runId = (ticketRes.body as ApiTicketDetail).runs[0]?.id
    if (runId === undefined) throw new Error('expected at least one run')

    const res = await json(app, config, { method: 'GET', url: `/runs/${runId}` })
    expect(res.status).toBe(200)
    const run = res.body as ApiRunDetail
    expect(run.id).toBe(runId)
    expect(run.ticketId).toBe(ticketId)
    expect(run.ticketTitle).toBe('Reviewable ticket')
    expect(run.workspaceId).toBe(wsId)

    const missing = await json(app, config, { method: 'GET', url: '/runs/999999' })
    expect(missing.status).toBe(404)
  })

  test('POST /tickets writes a ticket_created activity', async () => {
    const { app, config, db } = await setupApp()
    const ws = await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'ws' },
    })
    const wsId = (ws.body as { id: number }).id

    const created = await json(app, config, {
      method: 'POST',
      url: '/tickets',
      payload: { workspaceId: wsId, title: 'A new ticket', description: '' },
    })
    const ticketId = (created.body as { id: number }).id

    const acts = db.drizzle.select().from(activity).where(eq(activity.workspaceId, wsId)).all()
    expect(acts.some((a) => a.type === 'ticket_created' && a.ticketId === ticketId)).toBe(true)
  })

  test('PATCH ticket accepts a valid effortOverride, rejects an unknown one', async () => {
    const adapters = succeedingAdapters()
    const { app, config } = await setupApp(adapters)
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
    const ticket = await json(app, config, {
      method: 'POST',
      url: '/tickets',
      payload: { workspaceId: wsId, title: 't', description: '' },
    })
    const ticketId = (ticket.body as { id: number }).id

    const good = await json(app, config, {
      method: 'PATCH',
      url: `/tickets/${ticketId}`,
      payload: { adapterOverride: 'fake', effortOverride: 'high' },
    })
    expect(good.status).toBe(200)
    expect((good.body as { effortOverride: string | null }).effortOverride).toBe('high')

    const bad = await json(app, config, {
      method: 'PATCH',
      url: `/tickets/${ticketId}`,
      payload: { adapterOverride: 'fake', effortOverride: 'ludicrous' },
    })
    expect(bad.status).toBe(400)
  })

  test('proposal keep: clears proposalState and returns the ticket; dismiss: deletes it (204); both 404 unless pending', async () => {
    const { app, config, db } = await setupApp()
    const ws = await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'ws' },
    })
    const wsId = (ws.body as { id: number }).id
    const parent = await json(app, config, {
      method: 'POST',
      url: '/tickets',
      payload: { workspaceId: wsId, title: 'parent', description: '' },
    })
    const parentId = (parent.body as { id: number }).id

    const board = (await json(app, config, { method: 'GET', url: `/workspaces/${wsId}/board` }))
      .body as BoardPayload
    const backlogColId = columnIdFor(board, 'backlog')

    function makeProposal(title: string) {
      const [t] = db.drizzle
        .insert(tickets)
        .values({
          workspaceId: wsId,
          columnId: backlogColId,
          title,
          position: 100,
          origin: 'agent',
          proposalState: 'pending',
          followUpOfTicketId: parentId,
        })
        .returning()
        .all()
      if (!t) throw new Error('proposal insert returned no row')
      return t
    }

    // 404 on a non-proposal ticket
    const notPending = await json(app, config, {
      method: 'POST',
      url: `/tickets/${parentId}/proposal`,
      payload: { action: 'keep' },
    })
    expect(notPending.status).toBe(404)

    // keep
    const keepTicket = makeProposal('proposal to keep')
    const kept = await json(app, config, {
      method: 'POST',
      url: `/tickets/${keepTicket.id}/proposal`,
      payload: { action: 'keep' },
    })
    expect(kept.status).toBe(200)
    expect((kept.body as { proposalState: string | null }).proposalState).toBeNull()

    // dismiss
    const dismissTicket = makeProposal('proposal to dismiss')
    const dismissRes = await app.inject(
      authed(config, {
        method: 'POST',
        url: `/tickets/${dismissTicket.id}/proposal`,
        payload: { action: 'dismiss' },
      }),
    )
    expect(dismissRes.statusCode).toBe(204)
    expect(
      db.drizzle.select().from(tickets).where(eq(tickets.id, dismissTicket.id)).get(),
    ).toBeUndefined()

    // dismissing again (already gone) is a 404, not a crash
    const dismissAgain = await json(app, config, {
      method: 'POST',
      url: `/tickets/${dismissTicket.id}/proposal`,
      payload: { action: 'dismiss' },
    })
    expect(dismissAgain.status).toBe(404)
  })

  test('a pending proposal cannot be moved to Ready: 403, and GET /tickets/:id lists followUps', async () => {
    const { app, config, db } = await setupApp()
    const ws = await json(app, config, {
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'ws' },
    })
    const wsId = (ws.body as { id: number }).id
    const parent = await json(app, config, {
      method: 'POST',
      url: '/tickets',
      payload: { workspaceId: wsId, title: 'parent', description: '' },
    })
    const parentId = (parent.body as { id: number }).id

    const board = (await json(app, config, { method: 'GET', url: `/workspaces/${wsId}/board` }))
      .body as BoardPayload
    const backlogColId = columnIdFor(board, 'backlog')
    const readyColId = columnIdFor(board, 'ready')

    const [proposal] = db.drizzle
      .insert(tickets)
      .values({
        workspaceId: wsId,
        columnId: backlogColId,
        title: 'a follow-up',
        position: 100,
        origin: 'agent',
        proposalState: 'pending',
        followUpOfTicketId: parentId,
      })
      .returning()
      .all()
    if (!proposal) throw new Error('proposal insert returned no row')

    const moveRes = await json(app, config, {
      method: 'POST',
      url: `/tickets/${proposal.id}/move`,
      payload: { columnId: readyColId, position: 1 },
    })
    expect(moveRes.status).toBe(403)

    const parentDetail = (await json(app, config, { method: 'GET', url: `/tickets/${parentId}` }))
      .body as ApiTicketDetail
    expect(parentDetail.followUps).toEqual([
      { id: proposal.id, title: 'a follow-up', proposalState: 'pending' },
    ])
  })
})
