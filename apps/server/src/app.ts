import fastifyWebsocket from '@fastify/websocket'
import fastify, { type FastifyInstance } from 'fastify'
import type { Adapter } from './adapters/types.js'
import type { Config } from './config.js'
import type { TadaDb } from './db/index.js'
import { registerMcpRoute } from './mcp/server.js'
import { registerMemoryRoutes } from './routes/memory.js'
import { registerRunRoutes } from './routes/runs.js'
import { registerTicketRoutes } from './routes/tickets.js'
import { registerWorkspaceRoutes } from './routes/workspaces.js'
import type { Scheduler } from './runs/scheduler.js'
import type { WorkspaceManager } from './workspaces/manager.js'
import { type BroadcastHub, registerWsRoute } from './ws.js'

declare module 'fastify' {
  interface FastifyInstance {
    db: TadaDb
  }
}

export interface AppDeps {
  db: TadaDb
  config: Config
  wm: WorkspaceManager
  scheduler: Scheduler
  broadcastHub: BroadcastHub
  adapters: Map<string, Adapter>
}

export function buildApp({
  db,
  config,
  wm,
  scheduler,
  broadcastHub,
  adapters,
}: AppDeps): FastifyInstance {
  const app = fastify()
  app.decorate('db', db)
  app.get('/health', async () => ({ ok: true }))
  registerMcpRoute(app, db)
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?', 1)[0]
    if (path === '/health' || path === '/mcp' || path?.startsWith('/mcp/')) return
    if (req.headers.authorization !== `Bearer ${config.bearerToken}`) {
      await reply.code(401).send({ error: 'unauthorized' })
    }
  })

  void app.register(fastifyWebsocket)
  registerWsRoute(app, broadcastHub)

  const routeDeps = { db, wm, scheduler, hub: broadcastHub, adapters }
  registerWorkspaceRoutes(app, routeDeps)
  registerTicketRoutes(app, routeDeps)
  registerRunRoutes(app, routeDeps)
  registerMemoryRoutes(app, routeDeps)

  return app
}
