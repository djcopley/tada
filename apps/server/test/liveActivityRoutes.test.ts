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
      // Ended and tokenless — excluded by the `endedAt is null` leg, not by having a token.
      // startedAt values are seconds apart: the column is stored as integer seconds, and values
      // within the same second would make `orderBy(desc(startedAt))` non-deterministic here.
      { runId: 1, pushToken: null, startedAt: new Date(1_000), endedAt: new Date(2_000) },
      // Open but already carries a token — excluded by the `pushToken is null` leg, not by being
      // closed. If this row were picked instead, it would silently overwrite a live token.
      { runId: 2, pushToken: 'already-bound', startedAt: new Date(5_000), endedAt: null },
      // Two qualifying rows (open, tokenless) at different startedAt — proves the newest, not
      // just any match, wins the `orderBy(desc(startedAt))`.
      { runId: 3, pushToken: null, startedAt: new Date(3_000), endedAt: null },
      { runId: 4, pushToken: null, startedAt: new Date(4_000), endedAt: null },
    ])
    .run()

  const res = await json({
    method: 'POST',
    url: '/live-activity/tokens',
    payload: { token: 'bb22' },
  })
  expect(res.status).toBe(201)

  const rows = db.drizzle.select().from(liveActivitySessions).all()
  expect(rows.find((r) => r.runId === 1)?.pushToken).toBeNull()
  expect(rows.find((r) => r.runId === 2)?.pushToken).toBe('already-bound')
  expect(rows.find((r) => r.runId === 3)?.pushToken).toBeNull()
  expect(rows.find((r) => r.runId === 4)?.pushToken).toBe('bb22')
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
