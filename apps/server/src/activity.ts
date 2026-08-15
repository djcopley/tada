import type { ActivityType } from '@tada/shared'
import type { TadaDb } from './db/index.js'
import { activity } from './db/schema.js'

export interface RecordActivityInput {
  workspaceId: number
  ticketId?: number
  runId?: number
  type: ActivityType
  message: string
}

/** Structural subset of `BroadcastHub` that `recordActivity` needs - avoids importing ws.ts
 * (and its db/websocket dependencies) into this module just for a type. Any object with an
 * `activityChanged` method satisfies it, including a no-op for call sites/tests with no hub. */
export interface ActivityBroadcaster {
  activityChanged(workspaceId: number): void
}

export const noopActivityBroadcaster: ActivityBroadcaster = { activityChanged: () => {} }

/** Inserts an activity row and broadcasts `{type:'activity', workspaceId}` on the hub, so the
 * control screen's activity feed updates live without a manual refresh. This is the only way to
 * record activity - every call site must supply a hub (a no-op one is fine when there's genuinely
 * no live hub, e.g. some tests). */
export function recordActivity(
  db: TadaDb,
  hub: ActivityBroadcaster,
  input: RecordActivityInput,
): void {
  db.drizzle
    .insert(activity)
    .values({
      workspaceId: input.workspaceId,
      ticketId: input.ticketId ?? null,
      runId: input.runId ?? null,
      type: input.type,
      message: input.message,
    })
    .run()
  hub.activityChanged(input.workspaceId)
}
