import { eq } from 'drizzle-orm'
import { describe, expect, test, vi } from 'vitest'
import { pushTokens, settings, webPushSubscriptions } from '../src/db/schema.js'
import { holdPingText, ping } from '../src/notify.js'
import { testDb } from './helpers/testApp.js'

const sub = (endpoint: string) => ({ endpoint, p256dh: 'p256', auth: 'auth' })

describe('ping', () => {
  test('sends one Expo message per token, chunked, and respects the off switch', async () => {
    const db = testDb()
    db.drizzle
      .insert(pushTokens)
      .values(Array.from({ length: 101 }, (_, i) => ({ token: `t${i}` })))
      .run()
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
    await ping(
      db,
      { ticketId: 1, runId: 2, title: 'x', body: 'y'.repeat(200) },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    )
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const first = JSON.parse(
      (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    )
    expect(first).toHaveLength(100)
    expect(first[0]).toEqual({
      to: 't0',
      title: 'x',
      body: 'y'.repeat(150),
      data: { ticketId: 1, runId: 2 },
    })

    db.drizzle.update(settings).set({ pingChannel: 'off' }).where(eq(settings.id, 1)).run()
    fetchImpl.mockClear()
    await ping(
      db,
      { ticketId: 1, runId: 2, title: 'x', body: 'y' },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('never throws on a failing push service', async () => {
    const db = testDb()
    db.drizzle.insert(pushTokens).values({ token: 't' }).run()
    const boom = vi.fn(async () => {
      throw new Error('down')
    })
    await expect(
      ping(
        db,
        { ticketId: 1, runId: 1, title: 'a', body: 'b' },
        {
          fetchImpl: boom as unknown as typeof fetch,
        },
      ),
    ).resolves.toBeUndefined()
  })

  test('sends one web push per subscription, with the ticket in the payload', async () => {
    const db = testDb()
    db.drizzle
      .insert(webPushSubscriptions)
      .values([sub('e1'), sub('e2')])
      .run()
    const webPush = vi.fn(async () => {})

    await ping(db, { ticketId: 7, runId: 9, title: 'stopped', body: 'needs you' }, { webPush })

    expect(webPush).toHaveBeenCalledTimes(2)
    const [subscription, payload] = webPush.mock.calls[0] as unknown as [unknown, string]
    expect(subscription).toEqual({ endpoint: 'e1', keys: { p256dh: 'p256', auth: 'auth' } })
    expect(JSON.parse(payload)).toEqual({
      title: 'stopped',
      body: 'needs you',
      ticketId: 7,
      runId: 9,
    })
  })

  test('deletes a subscription the push service reports as gone, and keeps the rest', async () => {
    const db = testDb()
    db.drizzle
      .insert(webPushSubscriptions)
      .values([sub('dead'), sub('alive')])
      .run()
    const webPush = vi.fn(async (s: { endpoint: string }) => {
      if (s.endpoint === 'dead') throw Object.assign(new Error('gone'), { statusCode: 410 })
    })

    await ping(db, { ticketId: 1, runId: 1, title: 't', body: 'b' }, { webPush })

    // Both endpoints must have been attempted: a dead subscription is skipped, not a stop signal.
    expect(webPush).toHaveBeenCalledTimes(2)
    const left = db.drizzle.select().from(webPushSubscriptions).all()
    expect(left.map((r) => r.endpoint)).toEqual(['alive'])
  })

  test('keeps a subscription that failed transiently', async () => {
    const db = testDb()
    db.drizzle.insert(webPushSubscriptions).values(sub('flaky')).run()
    const webPush = vi.fn(async () => {
      throw Object.assign(new Error('server error'), { statusCode: 500 })
    })

    await ping(db, { ticketId: 1, runId: 1, title: 't', body: 'b' }, { webPush })

    expect(db.drizzle.select().from(webPushSubscriptions).all()).toHaveLength(1)
  })

  test('a failing Expo channel does not suppress the web channel', async () => {
    const db = testDb()
    db.drizzle.insert(pushTokens).values({ token: 't' }).run()
    db.drizzle.insert(webPushSubscriptions).values(sub('e1')).run()
    const boom = vi.fn(async () => {
      throw new Error('expo down')
    })
    const webPush = vi.fn(async () => {})

    await ping(
      db,
      { ticketId: 1, runId: 1, title: 't', body: 'b' },
      {
        fetchImpl: boom as unknown as typeof fetch,
        webPush,
      },
    )

    expect(webPush).toHaveBeenCalledTimes(1)
  })

  test('truncates the web payload body like the Expo one', async () => {
    const db = testDb()
    db.drizzle.insert(webPushSubscriptions).values(sub('e1')).run()
    const webPush = vi.fn(async () => {})

    await ping(db, { ticketId: 1, runId: 1, title: 't', body: 'y'.repeat(200) }, { webPush })

    const [, payload] = webPush.mock.calls[0] as unknown as [unknown, string]
    expect(JSON.parse(payload).body).toBe('y'.repeat(150))
  })

  test('the off switch silences the web channel too', async () => {
    const db = testDb()
    db.drizzle.insert(webPushSubscriptions).values(sub('e1')).run()
    db.drizzle.update(settings).set({ pingChannel: 'off' }).where(eq(settings.id, 1)).run()
    const webPush = vi.fn(async () => {})

    await ping(db, { ticketId: 1, runId: 1, title: 't', body: 'b' }, { webPush })

    expect(webPush).not.toHaveBeenCalled()
  })

  test('holdPingText names what stopped the run', () => {
    expect(
      holdPingText({
        reason: 'permission',
        tool: 'Bash',
        summary: 'gh pr create',
        ruleId: 1,
        ruleTitle: 'Open a pull request',
        publishes: true,
      }),
    ).toBe('wants to: Open a pull request — gh pr create')
    expect(holdPingText({ reason: 'question', question: 'which?', options: [] })).toBe('which?')
    expect(holdPingText({ reason: 'time', budgetMs: 1 })).toContain('out of time')
  })
})
