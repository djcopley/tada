import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { FakeAdapter } from './adapters/fake.js'
import type { Adapter } from './adapters/types.js'
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

  const adapters = new Map<string, Adapter>()
  // Task 13 registration point: adapters.set('claude', new ClaudeAdapter(...))
  if (process.env.TADA_FAKE_ADAPTER === '1') {
    adapters.set('fake', new FakeAdapter())
  }

  const hub = new BroadcastHub(db)
  const scheduler = new Scheduler({
    db,
    wm,
    adapters,
    broadcast: hub.broadcast,
    mcpUrl: `http://127.0.0.1:${config.port}/mcp`,
  })
  scheduler.recover()

  const app = buildApp({ db, config, wm, scheduler, broadcastHub: hub })
  const address = await app.listen({ port: config.port, host: '127.0.0.1' })
  app.log.info(`tada server listening on ${address}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
