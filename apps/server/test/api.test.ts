import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { ApiBoard, ApiWorkspaceListItem } from '@tada/shared'
import { eq } from 'drizzle-orm'
import type { FastifyInstance, InjectOptions } from 'fastify'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { FakeScript } from '../src/adapters/fake.js'
import { FakeAdapter } from '../src/adapters/fake.js'
import type { Adapter } from '../src/adapters/types.js'
import { buildApp } from '../src/app.js'
import type { Config } from '../src/config.js'
import { loadConfig } from '../src/config.js'
import { openDb, type TadaDb } from '../src/db/index.js'
import { agentRuns, comments, tickets, workspaces } from '../src/db/schema.js'
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
      payload: { name: 'acme-web' },
    })

    const taken = await json(app, config, {
      method: 'GET',
      url: '/workspaces/check-name?name=Acme%20Web',
    })
    expect(taken.status).toBe(200)
    expect(taken.body).toEqual({ id: 'acme-web', available: false })
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
