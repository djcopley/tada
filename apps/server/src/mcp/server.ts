import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { and, desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { recordActivity } from '../activity.js'
import type { TadaDb } from '../db/index.js'
import { agentRuns, comments, events, memoryNotes, tickets } from '../db/schema.js'
import { stateDir } from '../paths.js'
import type { WorkspaceManager } from '../workspaces/manager.js'

export interface RunOutcome {
  status: 'success' | 'failed'
  summary: string
}

interface RunContext {
  db: TadaDb
  wm: WorkspaceManager
  runId: number
  ticketId: number
  workspaceId: number
}

// lowercase, spaces -> '-', strip to [a-z0-9-]; falls back to 'note' if nothing valid remains.
function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
  return slug === '' ? 'note' : slug
}

function addAgentComment(db: TadaDb, ticketId: number, body: string): void {
  db.drizzle.insert(comments).values({ ticketId, author: 'agent', body }).run()
}

function createMcpServer(ctx: RunContext): McpServer {
  const server = new McpServer({ name: 'tada', version: '0.0.0' })

  server.registerTool(
    'update_ticket',
    {
      description: "Add a comment to the ticket driving this run's work",
      inputSchema: { comment: z.string() },
    },
    async ({ comment }) => {
      addAgentComment(ctx.db, ctx.ticketId, comment)
      return { content: [{ type: 'text', text: 'comment added' }] }
    },
  )

  server.registerTool(
    'attach_link',
    {
      description: 'Attach a link to the ticket as a comment',
      inputSchema: { url: z.string(), label: z.string() },
    },
    async ({ url, label }) => {
      addAgentComment(ctx.db, ctx.ticketId, `[${label}](${url})`)
      return { content: [{ type: 'text', text: 'link attached' }] }
    },
  )

  server.registerTool(
    'attach_file',
    {
      description: "Copy a file into the run's attachment directory and link it on the ticket",
      inputSchema: { path: z.string() },
    },
    async ({ path }) => {
      const destDir = join(stateDir(), 'attachments', String(ctx.runId))
      mkdirSync(destDir, { recursive: true })
      const name = basename(path)
      const dest = join(destDir, name)
      copyFileSync(path, dest)
      addAgentComment(ctx.db, ctx.ticketId, `Attached file: ${dest}`)
      return { content: [{ type: 'text', text: dest }] }
    },
  )

  server.registerTool(
    'write_memory_note',
    {
      description:
        'Save a durable learning about this workspace (a build quirk, credential location, API behavior) as a new memory note, pending human review',
      inputSchema: { title: z.string(), body: z.string() },
    },
    async ({ title, body }) => {
      const notesDir = join(ctx.wm.memoryDir(ctx.workspaceId), 'notes')
      mkdirSync(notesDir, { recursive: true })
      const file = `${slugify(title)}.md`
      writeFileSync(join(notesDir, file), body)

      const existing = ctx.db.drizzle
        .select()
        .from(memoryNotes)
        .where(
          and(
            eq(memoryNotes.scope, 'workspace'),
            eq(memoryNotes.workspaceId, ctx.workspaceId),
            eq(memoryNotes.file, file),
          ),
        )
        .get()

      if (existing) {
        ctx.db.drizzle
          .update(memoryNotes)
          .set({
            title,
            author: 'agent',
            runId: ctx.runId,
            state: 'pending',
            updatedAt: new Date().toISOString(),
          })
          .where(eq(memoryNotes.id, existing.id))
          .run()
      } else {
        ctx.db.drizzle
          .insert(memoryNotes)
          .values({
            scope: 'workspace',
            workspaceId: ctx.workspaceId,
            file,
            title,
            author: 'agent',
            runId: ctx.runId,
            state: 'pending',
          })
          .run()
      }

      recordActivity(ctx.db, {
        workspaceId: ctx.workspaceId,
        runId: ctx.runId,
        type: 'memory_written',
        message: `Wrote memory note: ${title}`,
      })

      return { content: [{ type: 'text', text: `saved ${file}` }] }
    },
  )

  server.registerTool(
    'report_outcome',
    {
      description: 'Report the final outcome of this run',
      inputSchema: { status: z.enum(['success', 'failed']), summary: z.string() },
    },
    async ({ status, summary }) => {
      ctx.db.drizzle.update(agentRuns).set({ summary }).where(eq(agentRuns.id, ctx.runId)).run()
      ctx.db.drizzle
        .insert(events)
        .values({ runId: ctx.runId, type: 'status', payload: { kind: 'outcome', status, summary } })
        .run()
      return { content: [{ type: 'text', text: 'outcome recorded' }] }
    },
  )

  return server
}

interface OutcomeEventPayload {
  kind: 'outcome'
  status: 'success' | 'failed'
  summary: string
}

function isOutcomePayload(payload: unknown): payload is OutcomeEventPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as { kind?: unknown }).kind === 'outcome'
  )
}

/** Reads the most recently reported outcome for a run, or null if none was reported. */
export function pendingOutcome(db: TadaDb, runId: number): RunOutcome | null {
  const rows = db.drizzle
    .select()
    .from(events)
    .where(eq(events.runId, runId))
    .orderBy(desc(events.id))
    .all()

  const latest = rows.find((row) => row.type === 'status' && isOutcomePayload(row.payload))
  if (!latest || !isOutcomePayload(latest.payload)) return null
  return { status: latest.payload.status, summary: latest.payload.summary }
}

function bearerToken(header: string | undefined): string | undefined {
  if (!header?.startsWith('Bearer ')) return undefined
  return header.slice('Bearer '.length)
}

/** Registers the stateless MCP endpoint at POST /mcp, authed per-request by run token. */
export function registerMcpRoute(app: FastifyInstance, db: TadaDb, wm: WorkspaceManager): void {
  app.post('/mcp', async (req, reply) => {
    const token = bearerToken(req.headers.authorization)
    const run = token
      ? db.drizzle.select().from(agentRuns).where(eq(agentRuns.runToken, token)).get()
      : undefined

    if (!run || (run.status !== 'queued' && run.status !== 'running')) {
      await reply.code(401).send({ error: 'unauthorized' })
      return
    }

    const ticket = db.drizzle.select().from(tickets).where(eq(tickets.id, run.ticketId)).get()
    if (!ticket) {
      await reply.code(401).send({ error: 'unauthorized' })
      return
    }

    const server = createMcpServer({
      db,
      wm,
      runId: run.id,
      ticketId: run.ticketId,
      workspaceId: ticket.workspaceId,
    })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })

    reply.raw.on('close', () => {
      transport.close()
      server.close()
    })

    await server.connect(transport)
    reply.hijack()
    await transport.handleRequest(req.raw, reply.raw, req.body)
  })
}
