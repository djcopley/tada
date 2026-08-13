import type { TadaDb } from '../db/index.js'
import type { Scheduler } from '../runs/scheduler.js'
import type { WorkspaceManager } from '../workspaces/manager.js'
import type { BroadcastHub } from '../ws.js'

export interface RouteDeps {
  db: TadaDb
  wm: WorkspaceManager
  scheduler: Scheduler
  hub: BroadcastHub
}
