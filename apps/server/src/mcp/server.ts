import { copyFileSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Broadcaster } from '../activity.js'
import { recordActivity } from '../activity.js'
import type { TadaDb } from '../db/index.js'
import { agentRuns, comments, events, memoryNotes, tickets } from '../db/schema.js'
import { stateDir } from '../paths.js'
import { takeAnswer } from '../runs/answers.js'
import { addWorktree, runDirFor } from '../runs/runDir.js'
import { stampRepoTag } from '../runs/tags.js'
import type { SourceStore } from '../sources/store.js'

export interface RunOutcome {
  status: 'success' | 'failed'
  summary: string
  /** Number of tests the agent saw pass, when it bothered to count. */
  testsPassed?: number
}

interface RunContext {
  db: TadaDb
  store: SourceStore
  hub: Broadcaster
  runId: number
  ticketId: number
}

function addAgentComment(ctx: RunContext, body: string): void {
  ctx.db.drizzle
    .insert(comments)
    .values({ ticketId: ctx.ticketId, runId: ctx.runId, author: 'agent', body })
    .run()
  // An open ticket screen learns about the new comment through the board_changed refetch.
  ctx.hub.boardChanged()
}

function createMcpServer(ctx: RunContext): McpServer {
  const server = new McpServer({ name: 'tada', version: '0.0.0' })

  server.registerTool(
    'use_repo',
    {
      description:
        "Check a connected repo out into your run directory (at ./<name>, on this ticket's branch) before working in it. Returns the path and the memory notes tagged to that repo. Idempotent.",
      inputSchema: { name: z.string() },
    },
    async ({ name }) => {
      const repo = ctx.store.repo(name)
      if (!repo) {
        const known = ctx.store.repos().map((r) => r.name)
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `no repo named "${name}". connected repos: ${known.length ? known.join(', ') : '(none)'}`,
            },
          ],
        }
      }
      const runDir = runDirFor(ctx.store, ctx.runId)
      const fresh = !(name in runDir.repoDirs)
      const path = await addWorktree(ctx.store, runDir, ctx.ticketId, repo)
      // The tag is stamped here and only here: making a worktree is what "touching" a repo means.
      stampRepoTag(ctx.db, ctx.ticketId, name)
      if (fresh) {
        const event = {
          type: 'text' as const,
          payload: { text: `made a worktree for ${name} — off ${repo.defaultBranch}` },
        }
        ctx.db.drizzle
          .insert(events)
          .values({ runId: ctx.runId, ...event })
          .run()
        ctx.hub.runEvent(ctx.runId, event)
        ctx.hub.boardChanged()
      }

      const notes = ctx.db.drizzle
        .select()
        .from(memoryNotes)
        .where(
          and(
            eq(memoryNotes.state, 'kept'),
            sql`exists (select 1 from json_each(${memoryNotes.tags}) where value = ${name})`,
          ),
        )
        .all()
      const noteText = notes.length
        ? `\n\nMemory notes for ${name}:\n${notes.map((n) => `### ${n.title}\n${n.body}`).join('\n\n')}`
        : ''
      return {
        content: [
          {
            type: 'text',
            text: `worktree ready at ${path} on branch ticket/${ctx.ticketId} (off ${repo.defaultBranch}).${noteText}`,
          },
        ],
      }
    },
  )

  server.registerTool(
    'ask_user',
    {
      description:
        'Ask the human a question and wait for their answer. Offer options when there is a natural choice. The run pauses until they reply.',
      inputSchema: {
        question: z.string(),
        options: z.array(z.string()).optional(),
        // Filled in by the gate on the way through; never something the agent supplies itself.
        answer: z.string().optional(),
      },
    },
    async ({ answer }) => {
      const text = answer ?? takeAnswer(ctx.runId)
      if (text === undefined) {
        return { isError: true, content: [{ type: 'text', text: 'no answer was recorded' }] }
      }
      return { content: [{ type: 'text', text: `The human answered: ${text}` }] }
    },
  )

  server.registerTool(
    'update_ticket',
    {
      description: "Post a progress note or finding on the ticket driving this run's work",
      inputSchema: { comment: z.string() },
    },
    async ({ comment }) => {
      addAgentComment(ctx, comment)
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
      addAgentComment(ctx, `[${label}](${url})`)
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
      const dest = join(destDir, basename(path))
      copyFileSync(path, dest)
      addAgentComment(ctx, `Attached file: ${dest}`)
      return { content: [{ type: 'text', text: dest }] }
    },
  )

  server.registerTool(
    'write_memory_note',
    {
      description:
        'Propose a durable memory note (a build quirk, a convention, an API behaviour). Tag it with repo names when it only applies there; untagged notes ride on every run. A human keeps or dismisses it.',
      inputSchema: { title: z.string(), body: z.string(), tags: z.array(z.string()).optional() },
    },
    async ({ title, body, tags }) => {
      const known = new Set(ctx.store.repos().map((r) => r.name))
      const cleanTags = (tags ?? []).filter((t) => known.has(t))
      const [note] = ctx.db.drizzle
        .insert(memoryNotes)
        .values({
          title,
          body,
          tags: cleanTags,
          author: 'agent',
          runId: ctx.runId,
          state: 'pending',
        })
        .returning()
        .all()
      if (!note) throw new Error('failed to insert memory note')
      recordActivity(ctx.db, ctx.hub, {
        ticketId: ctx.ticketId,
        runId: ctx.runId,
        type: 'memory_proposed',
        message: `Agent proposed a memory note — "${title}" — waiting on your keep`,
      })
      return { content: [{ type: 'text', text: `proposed note #${note.id}` }] }
    },
  )

  server.registerTool(
    'propose_ticket',
    {
      description:
        'Propose a follow-up ticket for work discovered but out of scope for this run. Files it in the backlog as a pending proposal for a human to keep or dismiss.',
      inputSchema: { title: z.string(), description: z.string().optional() },
    },
    async ({ title, description }) => {
      const last = ctx.db.drizzle
        .select({ position: tickets.position })
        .from(tickets)
        .where(eq(tickets.column, 'backlog'))
        .orderBy(desc(tickets.position))
        .limit(1)
        .get()
      const [proposal] = ctx.db.drizzle
        .insert(tickets)
        .values({
          column: 'backlog',
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
        ticketId: proposal.id,
        runId: ctx.runId,
        type: 'follow_up_filed',
        message: `Agent filed a follow-up: "${title}"`,
      })
      ctx.hub.boardChanged()
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
  store: SourceStore,
  hub: Broadcaster,
): void {
  app.post('/mcp', async (req, reply) => {
    const token = bearerToken(req.headers.authorization)
    const run = token
      ? db.drizzle.select().from(agentRuns).where(eq(agentRuns.runToken, token)).get()
      : undefined

    if (!run || (run.status !== 'queued' && run.status !== 'running' && run.status !== 'held')) {
      await reply.code(401).send({ error: 'unauthorized' })
      return
    }

    const server = createMcpServer({ db, store, hub, runId: run.id, ticketId: run.ticketId })
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
