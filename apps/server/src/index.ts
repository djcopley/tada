import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { buildAdapterRegistry } from './adapters/registry.js'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { openDb } from './db/index.js'
import { dataDir } from './paths.js'
import { Scheduler } from './runs/scheduler.js'
import { WorkspaceManager } from './workspaces/manager.js'
import { BroadcastHub } from './ws.js'

async function main(): Promise<void> {
  const config = loadConfig()

  mkdirSync(dataDir(), { recursive: true })
  const db = openDb(join(dataDir(), 'tada.db'))
  const wm = new WorkspaceManager(db)

  const adapters = buildAdapterRegistry()

  const hub = new BroadcastHub(db)
  const scheduler = new Scheduler({
    db,
    wm,
    adapters,
    broadcast: hub.broadcast,
    hub,
    mcpUrl: `http://127.0.0.1:${config.port}/mcp`,
  })
  scheduler.recover()

  const app = buildApp({ db, config, wm, scheduler, broadcastHub: hub, adapters })
  const address = await app.listen({ port: config.port, host: config.host })
  app.log.info(`tada server listening on ${address}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
