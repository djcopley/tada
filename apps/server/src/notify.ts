import type { RunStatus } from '@tada/shared'
import type { TadaDb } from './db/index.js'
import { pushTokens } from './db/schema.js'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
/** Expo's push API caps a single request at 100 messages. */
const CHUNK_SIZE = 100
/** Expo push notification bodies are truncated to keep payloads small and glanceable. */
const BODY_MAX_LENGTH = 150

interface RunForNotify {
  id: number
  status: RunStatus
  summary: string | null
}

interface TicketForNotify {
  id: number
  title: string
}

interface ExpoPushMessage {
  to: string
  title: string
  body: string
  data: { ticketId: number }
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

/**
 * Notifies all registered Expo push tokens when a run reaches a terminal state worth surfacing
 * to the user: `needs_review` (ready for review) or `failed`. Never throws — a notification
 * failure must not affect run state, so errors are logged and swallowed.
 */
export async function notifyRunFinished(
  db: TadaDb,
  run: RunForNotify,
  ticket: TicketForNotify,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (run.status !== 'needs_review' && run.status !== 'failed') return

  const tokens = db.drizzle.select().from(pushTokens).all()
  if (tokens.length === 0) return

  const title =
    run.status === 'needs_review'
      ? `Ticket "${ticket.title}" ready for review`
      : `Ticket "${ticket.title}" failed`
  const body = (run.summary ?? '').slice(0, BODY_MAX_LENGTH)

  const messages: ExpoPushMessage[] = tokens.map((t) => ({
    to: t.token,
    title,
    body,
    data: { ticketId: ticket.id },
  }))

  for (const batch of chunk(messages, CHUNK_SIZE)) {
    try {
      const res = await fetchImpl(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      })
      if (!res.ok) {
        console.error(`expo push send failed: HTTP ${res.status}`)
      }
    } catch (err) {
      console.error('expo push send failed:', err)
    }
  }
}
