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

/** Plain insert helper into the `activity` table. Broadcasting and the GET endpoint land in a
 * later task - this just records the row. */
export function recordActivity(db: TadaDb, input: RecordActivityInput): void {
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
}
