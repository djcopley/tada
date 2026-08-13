import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
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
import { agentRuns, comments } from '../src/db/schema.js'
import { git } from '../src/git.js'
import { stateDir } from '../src/paths.js'
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
  const app = buildApp({ db, config, wm, scheduler, broadcastHub: hub })
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

    const repoAdded = await json(app, config, {
      method: 'POST',
      url: `/workspaces/${wsId}/repos`,
      payload: { url: origin },
    })
    expect(repoAdded.status).toBe(201)

    const patched = await json(app, config, {
      method: 'PATCH',
      url: `/workspaces/${wsId}`,
      payload: { defaultAdapter: 'fake', defaultModel: 'fake-1' },
    })
    expect(patched.status).toBe(200)

    const boardBefore = await json(app, config, { method: 'GET', url: `/workspaces/${wsId}/board` })
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
})
