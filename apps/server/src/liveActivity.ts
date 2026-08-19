import { and, desc, eq, isNull } from 'drizzle-orm'
import type { TadaDb } from './db/index.js'
import { liveActivitySessions } from './db/schema.js'

/**
 * Binds a token the app just read off ActivityKit to the session it must belong to: the newest
 * one still open and still tokenless. This is the whole reason only one activity exists at a
 * time — iOS returns a token with no way to say which activity, and therefore which run, it is
 * for. A token with nothing to bind to is dropped: the activity it belongs to is already over.
 */
export function bindActivityToken(db: TadaDb, token: string): void {
  const target = db.drizzle
    .select()
    .from(liveActivitySessions)
    .where(and(isNull(liveActivitySessions.endedAt), isNull(liveActivitySessions.pushToken)))
    .orderBy(desc(liveActivitySessions.startedAt))
    .get()
  if (!target) return
  db.drizzle
    .update(liveActivitySessions)
    .set({ pushToken: token })
    .where(eq(liveActivitySessions.id, target.id))
    .run()
}
