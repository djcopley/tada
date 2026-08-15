import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { and, desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ActivityBroadcaster } from '../activity.js'
import { recordActivity } from '../activity.js'
import type { TadaDb } from '../db/index.js'
import { agentRuns, columns, comments, events, memoryNotes, tickets } from '../db/schema.js'
import { stateDir } from '../paths.js'
import type { WorkspaceManager } from '../workspaces/manager.js'

export interface RunOutcome {
  status: 'success' | 'failed'
  summary: string
  /** Number of tests the agent saw pass, when it bothered to count. */
  testsPassed?: number
}

interface RunContext {
  db: TadaDb
  wm: WorkspaceManager
  hub: ActivityBroadcaster
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

/**
 * The note file this run may write for `slug`, without clobbering anyone else's note.
 *
 * `<slug>.md` is taken as soon as a memory_notes row claims it, or a file with that name is
 * already on disk (a hand-placed note that hasn't been indexed yet) — in which case the next free
 * `<slug>-2.md`, `<slug>-3.md`, ... is used. The one name this run may reuse is a note it wrote
 * itself and that is still pending review: rewriting its own draft is an update, not a
 * collision. Without this, an agent picking a title a human already used would overwrite the
 * human's kept note and flip it to pending/agent — and a human then discarding the "agent" note
 * would delete content they wrote.
 */
function freeNoteFile(ctx: RunContext, notesDir: string, slug: string): string {
  for (let n = 1; n <= 1000; n++) {
    const file = n === 1 ? `${slug}.md` : `${slug}-${n}.md`
    const row = ctx.db.drizzle
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

    if (row) {
      if (row.state === 'pending' && row.runId === ctx.runId) return file
      continue
    }
    if (!existsSync(join(notesDir, file))) return file
  }
  throw new Error(`no free memory note filename for slug ${slug}`)
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
      const file = freeNoteFile(ctx, notesDir, slugify(title))
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

      recordActivity(ctx.db, ctx.hub, {
        workspaceId: ctx.workspaceId,
        runId: ctx.runId,
        type: 'memory_written',
        message: `Wrote memory note: ${title}`,
      })

      return { content: [{ type: 'text', text: `saved ${file}` }] }
    },
  )

  server.registerTool(
    'propose_ticket',
    {
      description:
        'Propose a follow-up ticket for work discovered but out of scope for this run. Files it in the Backlog as a pending proposal for a human to keep or dismiss.',
      inputSchema: { title: z.string(), description: z.string().optional() },
    },
    async ({ title, description }) => {
      const backlog = ctx.db.drizzle
        .select()
        .from(columns)
        .where(and(eq(columns.workspaceId, ctx.workspaceId), eq(columns.kind, 'backlog')))
        .get()
      if (!backlog) throw new Error(`workspace ${ctx.workspaceId} has no backlog column`)

      const last = ctx.db.drizzle
        .select()
        .from(tickets)
        .where(eq(tickets.columnId, backlog.id))
        .orderBy(desc(tickets.position))
        .limit(1)
        .get()

      const [proposal] = ctx.db.drizzle
        .insert(tickets)
        .values({
          workspaceId: ctx.workspaceId,
          columnId: backlog.id,
          title,
          description: description ?? '',
          position: (last?.position ?? 0) + 1,
          origin: 'agent',
          proposalState: 'pending',
          followUpOfTicketId: ctx.ticketId,
        })
        .returning()
        .all()
      if (!proposal) throw new Error('failed to insert proposed ticket')

      recordActivity(ctx.db, ctx.hub, {
        workspaceId: ctx.workspaceId,
        ticketId: proposal.id,
        runId: ctx.runId,
        type: 'follow_up_filed',
        message: `Filed a follow-up ticket: "${title}"`,
      })

      return { content: [{ type: 'text', text: String(proposal.id) }] }
    },
  )

  server.registerTool(
    'report_outcome',
    {
      description: 'Report the final outcome of this run',
      inputSchema: {
        status: z.enum(['success', 'failed']),
        summary: z.string(),
        testsPassed: z.number().optional(),
      },
    },
    async ({ status, summary, testsPassed }) => {
      ctx.db.drizzle.update(agentRuns).set({ summary }).where(eq(agentRuns.id, ctx.runId)).run()
      ctx.db.drizzle
        .insert(events)
        .values({
          runId: ctx.runId,
          type: 'status',
          payload: { kind: 'outcome', status, summary, testsPassed },
        })
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
  testsPassed?: number
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
  return {
    status: latest.payload.status,
    summary: latest.payload.summary,
    testsPassed: latest.payload.testsPassed,
  }
}

function bearerToken(header: string | undefined): string | undefined {
  if (!header?.startsWith('Bearer ')) return undefined
  return header.slice('Bearer '.length)
}

/** Registers the stateless MCP endpoint at POST /mcp, authed per-request by run token. */
export function registerMcpRoute(
  app: FastifyInstance,
  db: TadaDb,
  wm: WorkspaceManager,
  hub: ActivityBroadcaster,
): void {
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
      hub,
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
