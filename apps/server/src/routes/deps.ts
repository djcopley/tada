import type { Adapter } from '../adapters/types.js'
import type { TadaDb } from '../db/index.js'
import type { Scheduler } from '../runs/scheduler.js'
import type { SourceStore } from '../sources/store.js'
import type { BroadcastHub } from '../ws.js'

export interface RouteDeps {
  db: TadaDb
  store: SourceStore
  scheduler: Scheduler
  hub: BroadcastHub
  adapters: Map<string, Adapter>
}

export function intParam(id: string): number | undefined {
  const n = Number(id)
  return Number.isInteger(n) ? n : undefined
}
