import type { ActivityType } from '@tada/shared'
import type { AdapterEvent } from './adapters/types.js'
import type { TadaDb } from './db/index.js'
import { activity } from './db/schema.js'

export interface RecordActivityInput {
  ticketId?: number
  runId?: number
  type: ActivityType
  message: string
}

/** Structural subset of `BroadcastHub` the server core needs — avoids importing ws.ts (and its
 * websocket dependencies) everywhere just for a type. */
export interface Broadcaster {
  activityChanged(): void
  /** `{type:'board_changed'}` — clients refetch the board and every open ticket, so this is also
   * the signal for "a ticket's thread/fields/run changed". */
  boardChanged(): void
  rulesChanged(): void
  /** A journaled run event (also what the run journal's broadcast hook calls). */
  runEvent(runId: number, event: AdapterEvent): void
}

export const noopBroadcaster: Broadcaster = {
  activityChanged: () => {},
  boardChanged: () => {},
  rulesChanged: () => {},
  runEvent: () => {},
}

/** Inserts a Today/activity row and broadcasts it, so Control's feed updates live. This is the only
 * way to record activity. */
export function recordActivity(db: TadaDb, hub: Broadcaster, input: RecordActivityInput): void {
  db.drizzle
    .insert(activity)
    .values({
      ticketId: input.ticketId ?? null,
      runId: input.runId ?? null,
      type: input.type,
      message: input.message,
    })
    .run()
  hub.activityChanged()
}
