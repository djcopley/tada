import type { ActivityType, ApiActivity } from '@tada/shared'
import { and, desc, eq, type SQL } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { activity, tickets } from '../db/schema.js'
import type { RouteDeps } from './deps.js'

const DEFAULT_LIMIT = 50

export function registerActivityRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db } = deps

  app.get('/activity', async (req, reply) => {
    const query = req.query as { workspaceId?: string; limit?: string }

    let limit = DEFAULT_LIMIT
    if (query.limit !== undefined) {
      const n = Number(query.limit)
      if (!Number.isInteger(n) || n <= 0) return reply.code(400).send({ error: 'invalid limit' })
      limit = n
    }

    let workspaceId: number | undefined
    if (query.workspaceId !== undefined) {
      const n = Number(query.workspaceId)
      if (!Number.isInteger(n)) return reply.code(400).send({ error: 'invalid workspaceId' })
      workspaceId = n
    }

    const conditions: SQL[] = []
    if (workspaceId !== undefined) conditions.push(eq(activity.workspaceId, workspaceId))

    const rows = db.drizzle
      .select({
        id: activity.id,
        workspaceId: activity.workspaceId,
        ticketId: activity.ticketId,
        runId: activity.runId,
        type: activity.type,
        message: activity.message,
        createdAt: activity.createdAt,
        ticketTitle: tickets.title,
      })
      .from(activity)
      // left join: a row's ticket may have since been deleted (or the activity may have no
      // ticket at all, e.g. memory notes) - ticketTitle is null in either case, never a reason
      // to drop the row.
      .leftJoin(tickets, eq(activity.ticketId, tickets.id))
      .where(and(...conditions))
      .orderBy(desc(activity.id))
      .limit(limit)
      .all()

    const result: ApiActivity[] = rows.map((r) => ({
      ...r,
      type: r.type as ActivityType,
      ticketTitle: r.ticketTitle ?? null,
    }))
    return result
  })
}
