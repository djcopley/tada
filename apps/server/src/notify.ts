import type { Hold } from '@tada/shared'
import type { TadaDb } from './db/index.js'
import { pushTokens, settings } from './db/schema.js'

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

/**
 * One ping when a run stops on you — permission, question, out of time, failure. Finished runs
 * are quiet: they moved themselves to done. Never throws — a notification failure must not affect
 * run state. Respects the `pingChannel` setting (`off` sends nothing).
 */
export async function ping(
  db: TadaDb,
  input: { ticketId: number; runId: number; title: string; body: string },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const prefs = db.drizzle.select().from(settings).get()
  if (prefs?.pingChannel === 'off') return

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
