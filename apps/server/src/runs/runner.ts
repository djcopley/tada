import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ColumnKind, RunStatus } from '@tada/shared'
import { canMoveCard, canTransitionRun } from '@tada/shared'
import { asc, eq } from 'drizzle-orm'
import type { Adapter, AdapterEvent } from '../adapters/types.js'
import type { TadaDb } from '../db/index.js'
import { agentRuns, columns, comments, tickets, workspaces } from '../db/schema.js'
import { pendingOutcome } from '../mcp/server.js'
import { notifyRunFinished } from '../notify.js'
import { ensureGlobalMemoryDir, stateDir } from '../paths.js'
import type { WorkspaceManager } from '../workspaces/manager.js'
import { completeRun } from './completion.js'
import { Journal } from './journal.js'
import { composePrompt } from './prompt.js'
import { branchFor, buildRunDir } from './runDir.js'

export type BroadcastFn = (runId: number, e: AdapterEvent) => void

export interface RunnerDeps {
  db: TadaDb
  wm: WorkspaceManager
  adapters: Map<string, Adapter>
  broadcast?: BroadcastFn
  /** Open PRs for pushed branches. Defaults to true; set false in tests (no `gh`/network). */
  pr?: boolean
  /** MCP endpoint the adapter should call back to. Defaults to a placeholder for tests. */
  mcpUrl?: string
  /** fetch implementation used for Expo push notifications. Defaults to global fetch; override in tests. */
  fetchImpl?: typeof fetch
}

function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransitionRun(from, to)) {
    throw new Error(`illegal run status transition: ${from} -> ${to}`)
  }
}

function assertCardMove(from: ColumnKind, to: ColumnKind): void {
  if (!canMoveCard('orchestrator', from, to)) {
    throw new Error(`illegal card move: ${from} -> ${to}`)
  }
}

function columnFor(db: TadaDb, workspaceId: number, kind: ColumnKind) {
  const row = db.drizzle
    .select()
    .from(columns)
    .where(eq(columns.workspaceId, workspaceId))
    .all()
    .find((c) => c.kind === kind)
  if (!row) throw new Error(`workspace ${workspaceId} has no ${kind} column`)
  return row
}

/** Executes a single run to a terminal state (needs_review, failed, or cancelled). */
export async function executeRun(
  deps: RunnerDeps,
  runId: number,
  externalSignal?: AbortSignal,
): Promise<void> {
  const { db, wm } = deps

  const run = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, runId)).get()
  if (!run) throw new Error(`run ${runId} not found`)

  const ticket = db.drizzle.select().from(tickets).where(eq(tickets.id, run.ticketId)).get()
  if (!ticket) throw new Error(`ticket ${run.ticketId} not found`)

  const workspace = db.drizzle
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, ticket.workspaceId))
    .get()
  if (!workspace) throw new Error(`workspace ${ticket.workspaceId} not found`)

  const transcriptPath = join(stateDir(), 'transcripts', `${runId}.jsonl`)
  const journal = new Journal(db, runId, transcriptPath, deps.broadcast)

  // 1. mark run running + move card ready -> in_progress
  assertRunTransition(run.status, 'running')
  journal.write({ type: 'status', payload: { kind: 'run_status', status: 'running' } })
  db.drizzle
    .update(agentRuns)
    .set({ status: 'running', transcriptPath, startedAt: new Date() })
    .where(eq(agentRuns.id, runId))
    .run()

  const readyColumn = columnFor(db, ticket.workspaceId, 'ready')
  const inProgressColumn = columnFor(db, ticket.workspaceId, 'in_progress')
  assertCardMove('ready', 'in_progress')
  db.drizzle
    .update(tickets)
    .set({ columnId: inProgressColumn.id, queueState: null })
    .where(eq(tickets.id, ticket.id))
    .run()

  // Every failure between here and a terminal state (including unexpected throws from
  // buildRunDir, prompt composition, memory reads, or completeRun) must route through
  // markFailed rather than propagate — otherwise the run wedges at 'running' with the card
  // stuck at in_progress and no journaled reason.
  const markFailed = (): void => {
    journal.write({ type: 'status', payload: { kind: 'run_status', status: 'failed' } })
    assertRunTransition('running', 'failed')
    db.drizzle
      .update(agentRuns)
      .set({ status: 'failed', finishedAt: new Date() })
      .where(eq(agentRuns.id, runId))
      .run()

    assertCardMove('in_progress', 'ready')
    db.drizzle
      .update(tickets)
      .set({ columnId: readyColumn.id, queueState: 'held' })
      .where(eq(tickets.id, ticket.id))
      .run()

    // report_outcome may have stored a summary before the run went on to fail (e.g. a crash
    // after the agent called it); re-read the row rather than trusting the stale `run` closure.
    const failedRun = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, runId)).get()
    notifyRunFinished(
      db,
      { id: runId, status: 'failed', summary: failedRun?.summary ?? null },
      ticket,
      deps.fetchImpl,
    ).catch((err) => console.error('notifyRunFinished failed:', err))
  }

  // Deliberate cancellation (Scheduler.cancel) is not a failure: the card goes back to Ready with
  // queueState null. It is NOT immediately eligible to be picked up again - the scheduler only
  // starts tickets with queueState 'queued', so a cancelled card sits idle in Ready until a human
  // re-drags it (any move into Ready re-enqueues via the tickets/:id/move route).
  const markCancelled = (): void => {
    journal.write({ type: 'status', payload: { kind: 'run_status', status: 'cancelled' } })
    assertRunTransition('running', 'cancelled')
    db.drizzle
      .update(agentRuns)
      .set({ status: 'cancelled', finishedAt: new Date() })
      .where(eq(agentRuns.id, runId))
      .run()

    assertCardMove('in_progress', 'ready')
    db.drizzle
      .update(tickets)
      .set({ columnId: readyColumn.id, queueState: null })
      .where(eq(tickets.id, ticket.id))
      .run()
  }

  try {
    // 2. build the run directory (git worktrees per repo) and compose the prompt
    const runDir = await buildRunDir(wm, ticket.workspaceId, ticket.id, runId)

    const ticketComments = db.drizzle
      .select()
      .from(comments)
      .where(eq(comments.ticketId, ticket.id))
      .orderBy(asc(comments.createdAt), asc(comments.id))
      .all()

    const priorRuns = db.drizzle
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.ticketId, ticket.id))
      .orderBy(asc(agentRuns.id))
      .all()
      .filter((r) => r.id !== runId)

    const memoryDir = wm.memoryDir(ticket.workspaceId)
    const agentsMd = readFileSync(join(memoryDir, 'AGENTS.md'), 'utf-8')
    const noteFiles = readdirSync(join(memoryDir, 'notes'))

    const globalMemoryDir = ensureGlobalMemoryDir()
    const globalAgentsMd = readFileSync(join(globalMemoryDir, 'AGENTS.md'), 'utf-8')
    const globalNoteFiles = readdirSync(join(globalMemoryDir, 'notes'))

    const prompt = composePrompt({
      ticket: { id: ticket.id, title: ticket.title, description: ticket.description },
      comments: ticketComments.map((c) => ({
        author: c.author,
        kind: c.kind,
        body: c.body,
        createdAt: c.createdAt,
      })),
      agentsMd,
      noteFiles,
      globalAgentsMd,
      globalNoteFiles,
      priorRuns: priorRuns.map((r) => ({
        attemptNumber: r.attemptNumber,
        summary: r.summary,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
      })),
    })

    // 3. run the adapter with a timeout
    const adapter = deps.adapters.get(run.adapter)

    let exitCode: number | undefined
    let adapterError: unknown
    let timedOut = false

    if (!adapter) {
      adapterError = new Error(`unknown adapter: ${run.adapter}`)
    } else {
      const manualController = new AbortController()
      const signal = AbortSignal.any(
        [AbortSignal.timeout(workspace.timeoutMs), manualController.signal, externalSignal].filter(
          (s): s is AbortSignal => s !== undefined,
        ),
      )

      const runPromise = adapter
        .run({
          runDir: runDir.path,
          prompt,
          model: run.model,
          timeoutMs: workspace.timeoutMs,
          mcp: { url: deps.mcpUrl ?? 'http://127.0.0.1:0/mcp', token: run.runToken },
          onEvent: (e) => journal.write(e),
          signal,
        })
        .then(
          (r) => ({ kind: 'exit' as const, exitCode: r.exitCode }),
          (error: unknown) => ({ kind: 'error' as const, error }),
        )

      const timeoutPromise = new Promise<{ kind: 'timeout' }>((resolve) => {
        if (signal.aborted) {
          resolve({ kind: 'timeout' })
          return
        }
        signal.addEventListener('abort', () => resolve({ kind: 'timeout' }), { once: true })
      })

      const result = await Promise.race([runPromise, timeoutPromise])
      manualController.abort()

      if (result.kind === 'exit') {
        exitCode = result.exitCode
      } else if (result.kind === 'error') {
        adapterError = result.error
      } else {
        timedOut = true
      }
    }

    // 4. decide the outcome
    if (adapterError !== undefined) {
      journal.write({
        type: 'error',
        payload: {
          message: adapterError instanceof Error ? adapterError.message : String(adapterError),
        },
      })
      markFailed()
      return
    }

    if (timedOut) {
      if (externalSignal?.aborted) {
        markCancelled()
        return
      }
      journal.write({
        type: 'error',
        payload: { message: `run timed out after ${workspace.timeoutMs}ms` },
      })
      markFailed()
      return
    }

    if (exitCode !== undefined && exitCode !== 0) {
      markFailed()
      return
    }

    const reported = pendingOutcome(db, runId)
    if (!reported || reported.status === 'failed') {
      markFailed()
      return
    }

    // success
    const completion = await completeRun(wm, ticket.workspaceId, ticket.id, {
      pr: deps.pr ?? true,
      title: ticket.title,
      summary: reported.summary,
      onError: (message) => journal.write({ type: 'error', payload: { message } }),
    })

    journal.write({ type: 'status', payload: { kind: 'run_status', status: 'needs_review' } })
    assertRunTransition('running', 'needs_review')
    db.drizzle
      .update(agentRuns)
      .set({
        status: 'needs_review',
        summary: reported.summary,
        branch: branchFor(ticket.id),
        prUrl: completion.prUrls[0] ?? null,
        finishedAt: new Date(),
      })
      .where(eq(agentRuns.id, runId))
      .run()

    const inReviewColumn = columnFor(db, ticket.workspaceId, 'in_review')
    assertCardMove('in_progress', 'in_review')
    db.drizzle
      .update(tickets)
      .set({ columnId: inReviewColumn.id, queueState: null })
      .where(eq(tickets.id, ticket.id))
      .run()

    notifyRunFinished(
      db,
      { id: runId, status: 'needs_review', summary: reported.summary },
      ticket,
      deps.fetchImpl,
    ).catch((err) => console.error('notifyRunFinished failed:', err))
  } catch (err) {
    journal.write({
      type: 'error',
      payload: { message: err instanceof Error ? err.message : String(err) },
    })
    markFailed()
  }
}
