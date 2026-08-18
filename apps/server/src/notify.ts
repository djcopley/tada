import type { Hold } from '@tada/shared'
import { eq } from 'drizzle-orm'
import type { TadaDb } from './db/index.js'
import { pushTokens, settings, webPushSubscriptions } from './db/schema.js'
import { isGoneStatus, type WebPushSender } from './webPush.js'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
/** Expo's push API caps a single request at 100 messages. */
const CHUNK_SIZE = 100
/** Expo push notification bodies are truncated to keep payloads small and glanceable. */
const BODY_MAX_LENGTH = 150

interface ExpoPushMessage {
  to: string
  title: string
  body: string
  data: { ticketId: number; runId: number }
}

export interface PingInput {
  ticketId: number
  runId: number
  title: string
  body: string
}

export interface NotifyDeps {
  /** fetch used by the Expo channel. Defaults to global fetch; override in tests. */
  fetchImpl?: typeof fetch
  /** Sender for the web/PWA channel. Absent means the channel is not configured. */
  webPush?: WebPushSender
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

export function holdPingText(hold: Hold): string {
  switch (hold.reason) {
    case 'permission':
      return `wants to: ${hold.ruleTitle} — ${hold.summary}`
    case 'question':
      return hold.question
    case 'time':
      return 'out of time — continue, or stop it'
  }
}

/** Expo channel: the native app's transport. Dormant until a device registers a token. */
async function sendExpo(db: TadaDb, input: PingInput, fetchImpl: typeof fetch): Promise<void> {
  const tokens = db.drizzle.select().from(pushTokens).all()
  if (tokens.length === 0) return

  const messages: ExpoPushMessage[] = tokens.map((t) => ({
    to: t.token,
    title: input.title,
    body: input.body.slice(0, BODY_MAX_LENGTH),
    data: { ticketId: input.ticketId, runId: input.runId },
  }))

  for (const batch of chunk(messages, CHUNK_SIZE)) {
    try {
      const res = await fetchImpl(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      })
      if (!res.ok) console.error(`expo push send failed: HTTP ${res.status}`)
    } catch (err) {
      console.error('expo push send failed:', err)
    }
  }
}

/**
 * Web channel: the browser/PWA transport. Each subscription is sent to independently — one dead
 * endpoint must not stop the others — and a 404/410 deletes the row, which is the only garbage
 * collection a push subscription ever gets.
 */
async function sendWeb(db: TadaDb, input: PingInput, send: WebPushSender): Promise<void> {
  const subs = db.drizzle.select().from(webPushSubscriptions).all()
  if (subs.length === 0) return

  const payload = JSON.stringify({
    title: input.title,
    body: input.body.slice(0, BODY_MAX_LENGTH),
    ticketId: input.ticketId,
    runId: input.runId,
  })

  for (const row of subs) {
    try {
      await send({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload)
    } catch (err) {
      if (isGoneStatus(err)) {
        db.drizzle.delete(webPushSubscriptions).where(eq(webPushSubscriptions.id, row.id)).run()
      } else {
        console.error('web push send failed:', err)
      }
    }
  }
}

/**
 * One ping when a run stops on you — permission, question, out of time, failure. Finished runs
 * are quiet: they moved themselves to done. Never throws — a notification failure must not affect
 * run state — and one channel failing must never suppress the other, which is why the two are
 * awaited with allSettled rather than in sequence. Respects `pingChannel` (`off` sends nothing).
 */
export async function ping(db: TadaDb, input: PingInput, deps: NotifyDeps = {}): Promise<void> {
  const prefs = db.drizzle.select().from(settings).get()
  if (prefs?.pingChannel === 'off') return

  await Promise.allSettled([
    sendExpo(db, input, deps.fetchImpl ?? fetch),
    deps.webPush ? sendWeb(db, input, deps.webPush) : Promise.resolve(),
  ])
}
