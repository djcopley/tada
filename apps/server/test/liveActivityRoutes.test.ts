import { expect, test } from 'vitest'
import { liveActivitySessions, liveActivityStartTokens } from '../src/db/schema.js'
import { makeTestApp } from './helpers/testApp.js'

test('a push-to-start token is stored once, however many times it is sent', async () => {
  const { db, json } = await makeTestApp()

  const first = await json({
    method: 'POST',
    url: '/live-activity/start-token',
    payload: { token: 'aa11' },
  })
  expect(first.status).toBe(201)
  await json({ method: 'POST', url: '/live-activity/start-token', payload: { token: 'aa11' } })

  expect(db.drizzle.select().from(liveActivityStartTokens).all()).toHaveLength(1)
})

test('a start token is rejected when it is missing', async () => {
  const { json } = await makeTestApp()
  const res = await json({ method: 'POST', url: '/live-activity/start-token', payload: {} })
  expect(res.status).toBe(400)
})

test('an activity token binds to the newest session that has none', async () => {
  const { db, json } = await makeTestApp()
  db.drizzle
    .insert(liveActivitySessions)
    .values([
      { runId: 1, pushToken: 'old', startedAt: new Date(1), endedAt: new Date(2) },
      { runId: 2, pushToken: null, startedAt: new Date(3), endedAt: null },
    ])
    .run()

  const res = await json({
    method: 'POST',
    url: '/live-activity/tokens',
    payload: { token: 'bb22' },
  })
  expect(res.status).toBe(201)

  const rows = db.drizzle.select().from(liveActivitySessions).all()
  expect(rows.find((r) => r.runId === 2)?.pushToken).toBe('bb22')
  expect(rows.find((r) => r.runId === 1)?.pushToken).toBe('old')
})

test('an activity token with nothing to bind to is accepted and dropped', async () => {
  const { json } = await makeTestApp()
  const res = await json({
    method: 'POST',
    url: '/live-activity/tokens',
    payload: { token: 'cc33' },
  })
  expect(res.status).toBe(201)
})
