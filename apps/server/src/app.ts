import fastifyCors from '@fastify/cors'
import fastifyWebsocket from '@fastify/websocket'
import fastify, { type FastifyInstance } from 'fastify'
import type { Adapter } from './adapters/types.js'
import type { Config } from './config.js'
import type { TadaDb } from './db/index.js'
import { registerMcpRoute } from './mcp/server.js'
import { registerActivityRoutes } from './routes/activity.js'
import { registerMemoryRoutes } from './routes/memory.js'
import { registerRuleRoutes } from './routes/rules.js'
import { registerRunRoutes } from './routes/runs.js'
import { registerSettingsRoutes } from './routes/settings.js'
import { registerSystemRoutes } from './routes/system.js'
import { registerTicketRoutes } from './routes/tickets.js'
import type { Scheduler } from './runs/scheduler.js'
import type { SourceStore } from './sources/store.js'
import type { WebPushSender } from './webPush.js'
import { type BroadcastHub, registerWsRoute } from './ws.js'

declare module 'fastify' {
  interface FastifyInstance {
    db: TadaDb
  }
}

export interface AppDeps {
  db: TadaDb
  config: Config
  store: SourceStore
  scheduler: Scheduler
  broadcastHub: BroadcastHub
  adapters: Map<string, Adapter>
  /** Sender for the web push channel; absent in tests that do not exercise it. */
  webPush?: WebPushSender
}

export function buildApp({
  db,
  config,
  store,
  scheduler,
  broadcastHub,
  adapters,
  webPush,
}: AppDeps): FastifyInstance {
  // Warn-level logging (off under vitest) so 500s and other server-side failures leave a trace
  // in the daemon's journal instead of vanishing.
  const app = fastify({ logger: process.env.VITEST ? false : { level: 'warn' } })
  app.decorate('db', db)
  registerMcpRoute(app, db, store, broadcastHub)

  // The web build runs from a different origin than the server (Expo's dev server, or wherever the
  // static bundle is hosted), so every browser request is cross-origin and needs CORS. Reflecting
  // any origin is safe here: the only credential is a bearer token the client attaches explicitly,
  // never an ambient cookie, so a hostile page reflecting past CORS still has nothing to send.
  // `methods` is explicit because @fastify/cors defaults to GET,HEAD,POST - a browser preflight for
  // the PATCH/PUT/DELETE routes would otherwise be refused.
  void app.register(fastifyCors, {
    origin: true,
    credentials: false,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })

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

  const routeDeps = { db, store, scheduler, hub: broadcastHub, adapters, config, webPush }
  registerSettingsRoutes(app, routeDeps)
  registerTicketRoutes(app, routeDeps)
  registerRunRoutes(app, routeDeps)
  registerRuleRoutes(app, routeDeps)
  registerMemoryRoutes(app, routeDeps)
  registerActivityRoutes(app, routeDeps)
  registerSystemRoutes(app, routeDeps)

  return app
}
