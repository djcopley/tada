import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { createDefaultColumns, openDb, type TadaDb } from '../src/db/index.js'
import {
  activity,
  agentRuns,
  columns,
  comments,
  memoryNotes,
  tickets,
  workspaces,
} from '../src/db/schema.js'
import { pendingOutcome } from '../src/mcp/server.js'
import { WorkspaceManager } from '../src/workspaces/manager.js'
import { makeAppDeps } from './helpers/appDeps.js'
import { isolateXdg } from './helpers/gitFixtures.js'

function makeDb() {
  return openDb(join(mkdtempSync(join(tmpdir(), 'tada-mcp-')), 'tada.db'))
}

function seedRun(db: TadaDb, status: 'queued' | 'running' | 'needs_review' = 'running') {
  const [ws] = db.drizzle
    .insert(workspaces)
    .values({ name: 'ws', path: '/tmp/ws' })
    .returning()
    .all()
  if (!ws) throw new Error('workspace insert returned no row')

  createDefaultColumns(db, ws.id)
  const cols = db.drizzle.select().from(columns).all()
  const ready = cols.find((c) => c.kind === 'ready')
  if (!ready) throw new Error('ready column not seeded')

  const [ticket] = db.drizzle
    .insert(tickets)
    .values({
      workspaceId: ws.id,
      columnId: ready.id,
      title: 'Test Ticket',
      description: '',
      position: 1,
    })
    .returning()
    .all()
  if (!ticket) throw new Error('ticket insert returned no row')

  const [run] = db.drizzle
    .insert(agentRuns)
    .values({
      ticketId: ticket.id,
      adapter: 'test',
      model: 'test-model',
      status,
      runToken: 'test-run-token',
    })
    .returning()
    .all()
  if (!run) throw new Error('agentRun insert returned no row')

  return { ws, ticket, run }
}

/** Like seedRun, but the workspace is created through WorkspaceManager so its memory dir
 * (AGENTS.md + notes/) actually exists on disk under the isolated test dataDir — needed for
 * tests that exercise write_memory_note. */
async function seedRunInRealWorkspace(db: TadaDb) {
  const wm = new WorkspaceManager(db)
  const wsId = await wm.create('real-ws')

  createDefaultColumns(db, wsId)
  const cols = db.drizzle.select().from(columns).all()
  const ready = cols.find((c) => c.kind === 'ready')
  if (!ready) throw new Error('ready column not seeded')

  const [ticket] = db.drizzle
    .insert(tickets)
    .values({
      workspaceId: wsId,
      columnId: ready.id,
      title: 'Test Ticket',
      description: '',
      position: 1,
    })
    .returning()
    .all()
  if (!ticket) throw new Error('ticket insert returned no row')

  const [run] = db.drizzle
    .insert(agentRuns)
    .values({
      ticketId: ticket.id,
      adapter: 'test',
      model: 'test-model',
      status: 'running',
      runToken: 'real-ws-run-token',
    })
    .returning()
    .all()
  if (!run) throw new Error('agentRun insert returned no row')

  return { wm, wsId, ticket, run }
}

async function startApp(db: TadaDb): Promise<{ app: FastifyInstance; url: string }> {
  const app = buildApp(makeAppDeps(db, loadConfig()))
  const address = await app.listen({ port: 0, host: '127.0.0.1' })
  return { app, url: `${address}/mcp` }
}

async function connectClient(url: string, token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  })
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  await client.connect(transport)
  return client
}

describe('MCP server', () => {
  let db: TadaDb
  let app: FastifyInstance | undefined

  beforeEach(() => {
    isolateXdg()
    db = makeDb()
  })

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  test('1. tools/list with a valid run token returns the five tools', async () => {
    const { run } = seedRun(db)
    const started = await startApp(db)
    app = started.app

    const client = await connectClient(started.url, run.runToken)
    const { tools } = await client.listTools()
    await client.close()

    const names = tools.map((t) => t.name).sort()
    expect(names).toEqual([
      'attach_file',
      'attach_link',
      'report_outcome',
      'update_ticket',
      'write_memory_note',
    ])
  })

  test('2. update_ticket inserts an agent comment on the right ticket', async () => {
    const { run, ticket } = seedRun(db)
    const started = await startApp(db)
    app = started.app

    const client = await connectClient(started.url, run.runToken)
    await client.callTool({ name: 'update_ticket', arguments: { comment: 'hello from agent' } })
    await client.close()

    const rows = db.drizzle.select().from(comments).where(eq(comments.ticketId, ticket.id)).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      ticketId: ticket.id,
      author: 'agent',
      body: 'hello from agent',
    })
  })

  test('3. report_outcome persists {status, summary} retrievable via pendingOutcome', async () => {
    const { run } = seedRun(db)
    const started = await startApp(db)
    app = started.app

    const client = await connectClient(started.url, run.runToken)
    await client.callTool({
      name: 'report_outcome',
      arguments: { status: 'success', summary: 'did the thing' },
    })
    await client.close()

    const outcome = pendingOutcome(db, run.id)
    expect(outcome).toEqual({ status: 'success', summary: 'did the thing' })

    const updatedRun = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, run.id)).get()
    expect(updatedRun?.summary).toBe('did the thing')
  })

  test('4. bad/missing token returns HTTP 401 before any MCP handling', async () => {
    seedRun(db)
    const started = await startApp(db)
    app = started.app

    const missing = await fetch(started.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    expect(missing.status).toBe(401)

    const bad = await fetch(started.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer nope' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    expect(bad.status).toBe(401)
  })

  test('4b. token for a finished run is rejected', async () => {
    seedRun(db, 'needs_review')
    const started = await startApp(db)
    app = started.app

    const res = await fetch(started.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-run-token' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    expect(res.status).toBe(401)
  })

  test('5. write_memory_note slugifies the title, writes notes/<slug>.md, and inserts a pending agent note + memory_written activity', async () => {
    const { wm, wsId, run } = await seedRunInRealWorkspace(db)
    const started = await startApp(db)
    app = started.app

    const client = await connectClient(started.url, run.runToken)
    await client.callTool({
      name: 'write_memory_note',
      arguments: { title: 'API Rate Limits!', body: '# API Rate Limits\n\n100 req/min.\n' },
    })
    await client.close()

    const notePath = join(wm.memoryDir(wsId), 'notes', 'api-rate-limits.md')
    expect(existsSync(notePath)).toBe(true)
    expect(readFileSync(notePath, 'utf-8')).toBe('# API Rate Limits\n\n100 req/min.\n')

    const rows = db.drizzle
      .select()
      .from(memoryNotes)
      .where(eq(memoryNotes.file, 'api-rate-limits.md'))
      .all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      scope: 'workspace',
      workspaceId: wsId,
      title: 'API Rate Limits!',
      author: 'agent',
      runId: run.id,
      state: 'pending',
    })

    const acts = db.drizzle.select().from(activity).where(eq(activity.workspaceId, wsId)).all()
    expect(acts.some((a) => a.type === 'memory_written')).toBe(true)
  })
})
