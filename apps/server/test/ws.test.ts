import { afterEach, describe, expect, test } from 'vitest'
import WebSocket from 'ws'
import { makeTestApp, type TestApp } from './helpers/testApp.js'

let t: TestApp
afterEach(async () => {
  await t?.app.close()
})

function open(url: string): Promise<{ ws: WebSocket; messages: unknown[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const messages: unknown[] = []
    ws.on('message', (d) => messages.push(JSON.parse(String(d))))
    ws.on('open', () => resolve({ ws, messages }))
    ws.on('error', reject)
  })
}

describe('/ws', () => {
  test('one room: every client gets board, activity, rules and run events; bad token is closed', async () => {
    t = await makeTestApp()
    const address = await t.app.listen({ port: 0, host: '127.0.0.1' })
    const wsBase = address.replace('http', 'ws')

    const bad = new WebSocket(`${wsBase}/ws?token=nope`)
    const closeCode = await new Promise<number>((resolve) => bad.on('close', resolve))
    expect(closeCode).toBe(1008)

    const { ws, messages } = await open(`${wsBase}/ws?token=${t.config.bearerToken}`)
    t.hub.boardChanged()
    t.hub.activityChanged()
    t.hub.rulesChanged()
    t.hub.runEvent(4, { type: 'text', payload: { text: 'hi' } })
    t.hub.runEvent(4, { type: 'status', payload: { kind: 'run_status', status: 'held' } })
    await new Promise((r) => setTimeout(r, 50))
    expect(messages).toEqual([
      { type: 'board_changed' },
      { type: 'activity' },
      { type: 'rules_changed' },
      { type: 'run_event', runId: 4, event: { type: 'text', payload: { text: 'hi' } } },
      {
        type: 'run_event',
        runId: 4,
        event: { type: 'status', payload: { kind: 'run_status', status: 'held' } },
      },
      { type: 'board_changed' },
    ])
    ws.close()
  })
})
