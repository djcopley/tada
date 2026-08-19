import type { Adapter } from '../adapters/types.js'
import type { Config } from '../config.js'
import type { TadaDb } from '../db/index.js'
import type { LiveActivityChannel } from '../liveActivity.js'
import type { Scheduler } from '../runs/scheduler.js'
import type { SourceStore } from '../sources/store.js'
import type { WebPushSender } from '../webPush.js'
import type { BroadcastHub } from '../ws.js'

export interface RouteDeps {
  db: TadaDb
  store: SourceStore
  scheduler: Scheduler
  hub: BroadcastHub
  adapters: Map<string, Adapter>
  config: Config
  /** Sender for the web push channel; absent in tests that do not exercise it. */
  webPush?: WebPushSender
  /** Drives the iOS Live Activity; absent in tests and when APNs is not configured. */
  liveActivity?: LiveActivityChannel
}

export function intParam(id: string): number | undefined {
  const n = Number(id)
  return Number.isInteger(n) ? n : undefined
}
