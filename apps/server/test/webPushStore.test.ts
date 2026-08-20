import { describe, expect, test } from 'vitest'
import { webPushSubscriptions } from '../src/db/schema.js'
import { testDb } from './helpers/testApp.js'

describe('web_push_subscriptions', () => {
  test('stores a subscription and dedupes on endpoint', () => {
    const db = testDb()
    const row = { endpoint: 'https://web.push.apple.com/abc', p256dh: 'p', auth: 'a' }

    db.drizzle.insert(webPushSubscriptions).values(row).run()
    // Re-subscribing on the same device yields the same endpoint; it must not pile up rows.
    db.drizzle.insert(webPushSubscriptions).values(row).onConflictDoNothing().run()

    const all = db.drizzle.select().from(webPushSubscriptions).all()
    expect(all).toHaveLength(1)
    expect(all[0]?.endpoint).toBe('https://web.push.apple.com/abc')
  })
})
