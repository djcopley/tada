import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { buildAdapterRegistry } from './adapters/registry.js'
import { createApnsSender } from './apns.js'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { openDb } from './db/index.js'
import { createLiveActivityChannel } from './liveActivity.js'
import { dataDir } from './paths.js'
import { Scheduler } from './runs/scheduler.js'
import { SourceStore } from './sources/store.js'
import { createWebPushSender } from './webPush.js'
import { BroadcastHub } from './ws.js'

async function main(): Promise<void> {
  const config = loadConfig()
  // One sender, shared by both consumers: runs ping through the scheduler's RunnerDeps, and the
  // /web-push/* routes ping through RouteDeps. Miss either and that half of the web channel is
  // silently dead while the other half looks fine.
  const webPush = createWebPushSender(config)

  mkdirSync(dataDir(), { recursive: true })
  const db = openDb(join(dataDir(), 'tada.db'))
  const store = new SourceStore()
  const adapters = buildAdapterRegistry()
  const hub = new BroadcastHub()

  const apns = createApnsSender(config)
  // Dormant without APNs credentials, exactly like the web push sender without VAPID keys.
  const liveActivity = apns ? createLiveActivityChannel({ db, send: apns }) : undefined

  const scheduler = new Scheduler({
    db,
    store,
    adapters,
    broadcast: hub.runEvent,
    hub,
    mcpUrl: `http://127.0.0.1:${config.port}/mcp`,
    webPush,
    liveActivity,
  })
  scheduler.recover()

  const app = buildApp({
    db,
    config,
    store,
    scheduler,
    broadcastHub: hub,
    adapters,
    webPush,
    liveActivity,
  })
  const address = await app.listen({ port: config.port, host: config.host })
  app.log.info(`tada server listening on ${address}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
