import fastifyCors from '@fastify/cors'
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

  // The web build runs from a different origin than the server (Expo's dev server, or wherever the
  // static bundle is hosted), so every browser request is cross-origin and needs CORS. Reflecting
  // any origin is safe here: the only credential is a bearer token the client attaches explicitly,
  // never an ambient cookie, so a hostile page reflecting past CORS still has nothing to send.
  void app.register(fastifyCors, { origin: true, credentials: false })

  // Registered inside `.after()` so it lands *behind* the CORS hook: `.register()` defers plugin
  // boot to the avvio phase, and hooks run in the order they were added. Added synchronously here
  // the auth hook would run first, so a preflight (which browsers send with no Authorization
  // header) would 401 before CORS could answer it, and a genuine 401 would go back without
  // allow-origin headers - the browser would then report a network error and the client would say
  // "could not reach server" instead of "invalid token".
  app.after(() => {
    app.addHook('onRequest', async (req, reply) => {
      const path = req.url.split('?', 1)[0]
      if (
        path === '/health' ||
        path === '/mcp' ||
        path?.startsWith('/mcp/') ||
        path === '/ws' ||
        path?.startsWith('/ws/')
      )
        return
      if (req.headers.authorization !== `Bearer ${config.bearerToken}`) {
        await reply.code(401).send({ error: 'unauthorized' })
      }
    })
  })

  // registerWsRoute must run only after the websocket plugin has finished loading: `.register()`
  // defers plugin boot to the avvio phase, so calling registerWsRoute synchronously right after
  // would add the /ws route before the plugin's onRoute hook (which wraps the handler for
  // websocket upgrades) is installed - the handler would then run as a plain (request, reply)
  // HTTP handler instead of (socket, request). `.after()` waits for prior registrations first.
  void app.register(fastifyWebsocket)
  app.after(() => {
    registerWsRoute(app, broadcastHub, config)
  })

  const routeDeps = { db, wm, scheduler, hub: broadcastHub, adapters }
  registerWorkspaceRoutes(app, routeDeps)
  registerTicketRoutes(app, routeDeps)
  registerRunRoutes(app, routeDeps)
  registerMemoryRoutes(app, routeDeps)

  return app
}
