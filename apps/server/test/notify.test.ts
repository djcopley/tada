import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { openDb, type TadaDb } from '../src/db/index.js'
import { pushTokens } from '../src/db/schema.js'
import { notifyRunFinished } from '../src/notify.js'

function testDb(): TadaDb {
  return openDb(join(mkdtempSync(join(tmpdir(), 'tada-db-')), 'test.db'))
}

function seedToken(db: TadaDb, token: string): void {
  db.drizzle.insert(pushTokens).values({ token }).run()
}

const ticket = { id: 42, title: 'Fix the bug' }

describe('notifyRunFinished', () => {
  let db: TadaDb

  beforeEach(() => {
    db = testDb()
  })

  test('needs_review: POSTs correct payload per token', async () => {
    seedToken(db, 'ExponentPushToken[aaa]')
    seedToken(db, 'ExponentPushToken[bbb]')
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true })

    await notifyRunFinished(
      db,
      { id: 1, status: 'needs_review', summary: 'a'.repeat(200) },
      ticket,
      fetchImpl,
    )

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://exp.host/--/api/v2/push/send')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    const body = JSON.parse(init.body as string)
    expect(body).toEqual([
      {
        to: 'ExponentPushToken[aaa]',
        title: 'Ticket "Fix the bug" ready for review',
        body: 'a'.repeat(150),
        data: { ticketId: 42 },
      },
      {
        to: 'ExponentPushToken[bbb]',
        title: 'Ticket "Fix the bug" ready for review',
        body: 'a'.repeat(150),
        data: { ticketId: 42 },
      },
    ])
  })

  test('failed: title reflects failure, body empty when no summary', async () => {
    seedToken(db, 'ExponentPushToken[aaa]')
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true })

    await notifyRunFinished(db, { id: 1, status: 'failed', summary: null }, ticket, fetchImpl)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body).toEqual([
      {
        to: 'ExponentPushToken[aaa]',
        title: 'Ticket "Fix the bug" failed',
        body: '',
        data: { ticketId: 42 },
      },
    ])
  })

  test('no tokens registered -> no fetch call', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true })

    await notifyRunFinished(db, { id: 1, status: 'needs_review', summary: 'x' }, ticket, fetchImpl)

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('cancelled status -> no fetch call', async () => {
    seedToken(db, 'ExponentPushToken[aaa]')
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true })

    await notifyRunFinished(db, { id: 1, status: 'cancelled', summary: null }, ticket, fetchImpl)

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('fetch rejection is swallowed, not thrown', async () => {
    seedToken(db, 'ExponentPushToken[aaa]')
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      notifyRunFinished(db, { id: 1, status: 'failed', summary: 's' }, ticket, fetchImpl),
    ).resolves.toBeUndefined()

    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  test('non-ok response is logged and swallowed', async () => {
    seedToken(db, 'ExponentPushToken[aaa]')
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      notifyRunFinished(db, { id: 1, status: 'failed', summary: 's' }, ticket, fetchImpl),
    ).resolves.toBeUndefined()

    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  test('chunks tokens into groups of 100 per Expo push API limit', async () => {
    for (let i = 0; i < 150; i++) {
      seedToken(db, `ExponentPushToken[${i}]`)
    }
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true })

    await notifyRunFinished(
      db,
      { id: 1, status: 'needs_review', summary: 'ready' },
      ticket,
      fetchImpl,
    )

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const firstBody = JSON.parse(
      (fetchImpl.mock.calls[0] as [string, RequestInit])[1].body as string,
    )
    const secondBody = JSON.parse(
      (fetchImpl.mock.calls[1] as [string, RequestInit])[1].body as string,
    )
    expect(firstBody).toHaveLength(100)
    expect(secondBody).toHaveLength(50)
  })
})
