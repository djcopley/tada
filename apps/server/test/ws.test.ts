import { once } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { WebSocket } from 'ws'
import { buildApp } from '../src/app.js'
import type { Config } from '../src/config.js'
import { loadConfig } from '../src/config.js'
import { openDb, type TadaDb } from '../src/db/index.js'
import { workspaces } from '../src/db/schema.js'
import type { BroadcastHub } from '../src/ws.js'
import { makeAppDeps } from './helpers/appDeps.js'
import { isolateXdg } from './helpers/gitFixtures.js'

function makeDb() {
  return openDb(join(mkdtempSync(join(tmpdir(), 'tada-ws-')), 'tada.db'))
}

async function startApp(
  db: TadaDb,
  config: Config,
): Promise<{ app: FastifyInstance; hub: BroadcastHub; port: number }> {
  const deps = makeAppDeps(db, config)
  const app = buildApp(deps)
  const address = await app.listen({ port: 0, host: '127.0.0.1' })
  const port = Number(new URL(address).port)
  return { app, hub: deps.broadcastHub, port }
}

describe('WebSocket route', () => {
  let db: TadaDb
  let config: Config
  let app: FastifyInstance | undefined

  beforeEach(() => {
    isolateXdg()
    db = makeDb()
    config = loadConfig()
  })

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  test('ws connects with query token and receives board_changed', async () => {
    const [ws] = db.drizzle
      .insert(workspaces)
      .values({ name: 'ws', path: '/tmp/ws' })
      .returning()
      .all()
    if (!ws) throw new Error('workspace insert returned no row')

    const started = await startApp(db, config)
    app = started.app

    const sock = new WebSocket(
      `ws://127.0.0.1:${started.port}/ws?workspaceId=${ws.id}&token=${config.bearerToken}`,
    )
    await once(sock, 'open')

    started.hub.boardChanged(ws.id)
    const [raw] = await once(sock, 'message')
    expect(JSON.parse(String(raw))).toEqual({ type: 'board_changed', workspaceId: ws.id })

    sock.close()
  })

  test('creating a ticket and commenting on it broadcast board_changed to the workspace', async () => {
    const started = await startApp(db, config)
    app = started.app
    const wsRes = await app.inject({
      method: 'POST',
      url: '/workspaces',
      headers: { authorization: `Bearer ${config.bearerToken}` },
      payload: { name: 'live' },
    })
    const wsId = (wsRes.json() as { id: number }).id

    const sock = new WebSocket(
      `ws://127.0.0.1:${started.port}/ws?workspaceId=${wsId}&token=${config.bearerToken}`,
    )
    await once(sock, 'open')
    const received: unknown[] = []
    sock.on('message', (raw) => received.push(JSON.parse(String(raw))))

    const ticketRes = await app.inject({
      method: 'POST',
      url: '/tickets',
      headers: { authorization: `Bearer ${config.bearerToken}` },
      payload: { workspaceId: wsId, title: 'hello' },
    })
    const ticketId = (ticketRes.json() as { id: number }).id
    await app.inject({
      method: 'POST',
      url: `/tickets/${ticketId}/comments`,
      headers: { authorization: `Bearer ${config.bearerToken}` },
      payload: { body: 'a note' },
    })
    await new Promise((r) => setTimeout(r, 50))

    const boardChanges = received.filter((m) => (m as { type: string }).type === 'board_changed')
    // One for the create, one for the comment — other boards/ticket screens refetch on these.
    expect(boardChanges).toHaveLength(2)

    sock.close()
  })

  test('ws with wrong token is closed with 1008', async () => {
    const [ws] = db.drizzle
      .insert(workspaces)
      .values({ name: 'ws', path: '/tmp/ws' })
      .returning()
      .all()
    if (!ws) throw new Error('workspace insert returned no row')

    const started = await startApp(db, config)
    app = started.app

    const sock = new WebSocket(
      `ws://127.0.0.1:${started.port}/ws?workspaceId=${ws.id}&token=wrong-token`,
    )
    const [code] = (await once(sock, 'close')) as [number]
    expect(code).toBe(1008)
  })

  test('ws with bearer header (no query token) still connects', async () => {
    const [ws] = db.drizzle
      .insert(workspaces)
      .values({ name: 'ws', path: '/tmp/ws' })
      .returning()
      .all()
    if (!ws) throw new Error('workspace insert returned no row')

    const started = await startApp(db, config)
    app = started.app

    const sock = new WebSocket(`ws://127.0.0.1:${started.port}/ws?workspaceId=${ws.id}`, {
      headers: { Authorization: `Bearer ${config.bearerToken}` },
    })
    await once(sock, 'open')

    started.hub.boardChanged(ws.id)
    const [raw] = await once(sock, 'message')
    expect(JSON.parse(String(raw))).toEqual({ type: 'board_changed', workspaceId: ws.id })

    sock.close()
  })
})
