import type { ApiRule } from '@tada/shared'
import { and, asc, desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { agentRuns, rules } from '../db/schema.js'
import { intParam, type RouteDeps } from './deps.js'

const ruleBody = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).default(''),
  tool: z.string().min(1).default('Bash'),
  patterns: z.array(z.string().min(1)).default([]),
  decision: z.enum(['allow', 'ask', 'never']),
  publishes: z.boolean().default(false),
  position: z.number().optional(),
})

type RuleRow = typeof rules.$inferSelect

export function registerRuleRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, hub } = deps

  /** Runs held on a rule right now — Settings shows "holding 1 run" beside it. */
  const holdingCounts = (): Map<number, number> => {
    const held = db.drizzle
      .select({ hold: agentRuns.hold })
      .from(agentRuns)
      .where(and(eq(agentRuns.status, 'held'), eq(agentRuns.heldReason, 'permission')))
      .all()
    const counts = new Map<number, number>()
    for (const { hold } of held) {
      const ruleId = (hold as { ruleId?: unknown } | null)?.ruleId
      if (typeof ruleId === 'number') counts.set(ruleId, (counts.get(ruleId) ?? 0) + 1)
    }
    return counts
  }

  const publicRule = (row: RuleRow, holding: Map<number, number>): ApiRule => ({
    id: row.id,
    title: row.title,
    description: row.description,
    tool: row.tool,
    patterns: row.patterns,
    decision: row.decision,
    publishes: row.publishes,
    position: row.position,
    source: row.source,
    sourceRunId: row.sourceRunId,
    updatedAt: row.updatedAt.toISOString(),
    holdingCount: holding.get(row.id) ?? 0,
  })

  const ruleById = (id: number) => db.drizzle.select().from(rules).where(eq(rules.id, id)).get()

  app.get('/rules', async (): Promise<ApiRule[]> => {
    const holding = holdingCounts()
    return db.drizzle
      .select()
      .from(rules)
      .orderBy(asc(rules.position), asc(rules.id))
      .all()
      .map((r) => publicRule(r, holding))
  })

  app.post('/rules', async (req, reply) => {
    const parsed = ruleBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })
    const last = db.drizzle
      .select({ position: rules.position })
      .from(rules)
      .orderBy(desc(rules.position))
      .limit(1)
      .get()
    const [row] = db.drizzle
      .insert(rules)
      .values({
        ...parsed.data,
        position: parsed.data.position ?? (last?.position ?? 0) + 1,
        source: 'human',
      })
      .returning()
      .all()
    if (!row) return reply.code(500).send({ error: 'failed to create rule' })
    hub.rulesChanged()
    return reply.code(201).send(publicRule(row, holdingCounts()))
  })

  app.patch('/rules/:id', async (req, reply) => {
    const id = intParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })
    if (!ruleById(id)) return reply.code(404).send({ error: 'not found' })
    const parsed = ruleBody.partial().safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })
    if (Object.keys(parsed.data).length > 0) {
      // Editing from Settings makes it a human rule again — provenance describes the last writer.
      db.drizzle
        .update(rules)
        .set({ ...parsed.data, source: 'human', sourceRunId: null, updatedAt: new Date() })
        .where(eq(rules.id, id))
        .run()
      hub.rulesChanged()
    }
    const fresh = ruleById(id)
    return fresh ? publicRule(fresh, holdingCounts()) : fresh
  })

  app.delete('/rules/:id', async (req, reply) => {
    const id = intParam((req.params as { id: string }).id)
    if (id === undefined) return reply.code(400).send({ error: 'invalid id' })
    if (!ruleById(id)) return reply.code(404).send({ error: 'not found' })
    db.drizzle.delete(rules).where(eq(rules.id, id)).run()
    hub.rulesChanged()
    return reply.code(204).send()
  })
}
