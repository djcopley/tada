import fastify, { type FastifyInstance } from 'fastify'
import type { Config } from './config.js'
import type { TadaDb } from './db/index.js'

declare module 'fastify' {
  interface FastifyInstance {
    db: TadaDb
  }
}

export interface AppDeps {
  db: TadaDb
  config: Config
}

export function buildApp({ db, config }: AppDeps): FastifyInstance {
  const app = fastify()
  app.decorate('db', db)
  app.get('/health', async () => ({ ok: true }))
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?', 1)[0]
    if (path === '/health' || path === '/mcp' || path?.startsWith('/mcp/')) return
    if (req.headers.authorization !== `Bearer ${config.bearerToken}`) {
      await reply.code(401).send({ error: 'unauthorized' })
    }
  })
  return app
}
