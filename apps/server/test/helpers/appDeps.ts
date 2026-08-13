import type { Adapter } from '../../src/adapters/types.js'
import type { AppDeps } from '../../src/app.js'
import type { Config } from '../../src/config.js'
import type { TadaDb } from '../../src/db/index.js'
import { Scheduler } from '../../src/runs/scheduler.js'
import { WorkspaceManager } from '../../src/workspaces/manager.js'
import { BroadcastHub } from '../../src/ws.js'

/** Builds the full AppDeps for tests that only care about a couple of fields (db/config). */
export function makeAppDeps(
  db: TadaDb,
  config: Config,
  opts: { adapters?: Map<string, Adapter> } = {},
): AppDeps {
  const wm = new WorkspaceManager(db)
  const hub = new BroadcastHub(db)
  const scheduler = new Scheduler({
    db,
    wm,
    adapters: opts.adapters ?? new Map(),
    broadcast: hub.broadcast,
    pr: false,
  })
  return { db, config, wm, scheduler, broadcastHub: hub, adapters: opts.adapters ?? new Map() }
}
