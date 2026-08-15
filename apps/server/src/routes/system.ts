import type { ApiAdapterInfo, ApiHealth, ApiStatus } from '@tada/shared'
import { asc } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Adapter } from '../adapters/types.js'
import { workspaces } from '../db/schema.js'
import { serverVersion } from '../version.js'
import type { RouteDeps } from './deps.js'

/** Availability is probed per request (each adapter memoizes its own expensive probe) so a CLI
 * installed after boot shows up without a restart. */
async function describe(adapter: Adapter): Promise<ApiAdapterInfo> {
  let available = false
  try {
    available = await adapter.available()
  } catch {
    available = false
  }
  return {
    id: adapter.id,
    label: adapter.label,
    available,
    models: [...adapter.models],
    efforts: [...adapter.efforts],
    supportsInjection: adapter.supportsInjection,
  }
}

export function registerSystemRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, adapters } = deps

  // Unauthed on purpose (see the auth hook's allowlist in app.ts): this is the "can I reach the
  // server, and which build is it?" probe a client runs before it has a token.
  app.get('/health', async (): Promise<ApiHealth> => ({ ok: true, version: serverVersion }))

  app.get(
    '/adapters',
    async (): Promise<ApiAdapterInfo[]> => Promise.all([...adapters.values()].map(describe)),
  )

  app.get('/status', async (): Promise<ApiStatus> => {
    const names = db.drizzle
      .select({ name: workspaces.name })
      .from(workspaces)
      .orderBy(asc(workspaces.id))
      .all()
      .map((row) => row.name)

    const infos = await Promise.all([...adapters.values()].map(describe))
    return {
      ok: true,
      version: serverVersion,
      workspaces: names,
      agents: infos.map((info) => ({ id: info.id, available: info.available })),
    }
  })
}
