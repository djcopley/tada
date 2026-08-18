import { describe, expect, test } from 'vitest'
import { webPushSubscriptions } from '../src/db/schema.js'
import { makeTestApp } from './helpers/testApp.js'

const body = {
  endpoint: 'https://web.push.apple.com/abc',
  keys: { p256dh: 'p256key', auth: 'authkey' },
}

describe('web push routes', () => {
  test('serves the VAPID public key the client needs before subscribing', async () => {
    const t = await makeTestApp()
    const res = await t.json({ method: 'GET', url: '/web-push/public-key' })
    expect(res.status).toBe(200)
    expect(res.body.publicKey).toBe(t.config.vapidPublicKey)
  })

  test('stores a subscription and is idempotent on endpoint', async () => {
    const t = await makeTestApp()

    const first = await t.json({ method: 'POST', url: '/web-push/subscriptions', payload: body })
    expect(first.status).toBe(201)

    const again = await t.json({ method: 'POST', url: '/web-push/subscriptions', payload: body })
    expect(again.status).toBe(201)

    const rows = t.db.drizzle.select().from(webPushSubscriptions).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.p256dh).toBe('p256key')
  })

  test('rejects a malformed subscription', async () => {
    const t = await makeTestApp()
    const res = await t.json({
      method: 'POST',
      url: '/web-push/subscriptions',
      payload: { endpoint: 'https://x', keys: { p256dh: 'only-one' } },
    })
    expect(res.status).toBe(400)
  })

  test('deletes a subscription on explicit opt-out', async () => {
    const t = await makeTestApp()
    await t.json({ method: 'POST', url: '/web-push/subscriptions', payload: body })

    const res = await t.json({
      method: 'DELETE',
      url: '/web-push/subscriptions',
      payload: { endpoint: body.endpoint },
    })
    expect(res.status).toBe(200)
    expect(t.db.drizzle.select().from(webPushSubscriptions).all()).toHaveLength(0)
  })

  test('the test-ping route succeeds even with nothing subscribed', async () => {
    const t = await makeTestApp()
    const res = await t.json({ method: 'POST', url: '/web-push/test', payload: {} })
    expect(res.status).toBe(200)
  })
})
