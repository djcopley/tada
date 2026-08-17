import { eq } from 'drizzle-orm'
import { describe, expect, test, vi } from 'vitest'
import { pushTokens, settings } from '../src/db/schema.js'
import { holdPingText, ping } from '../src/notify.js'
import { testDb } from './helpers/testApp.js'

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
      fetchImpl as unknown as typeof fetch,
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
      fetchImpl as unknown as typeof fetch,
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
      ping(db, { ticketId: 1, runId: 1, title: 'a', body: 'b' }, boom as unknown as typeof fetch),
    ).resolves.toBeUndefined()
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
