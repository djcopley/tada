import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ColumnKind, RunStatus } from '@tada/shared'
import { canMoveCard, canTransitionRun } from '@tada/shared'
import { asc, eq } from 'drizzle-orm'
import type { ActivityBroadcaster } from '../activity.js'
import { noopActivityBroadcaster, recordActivity } from '../activity.js'
import type { Adapter, AdapterEvent, AdapterSession } from '../adapters/types.js'
import type { TadaDb } from '../db/index.js'
import { agentRuns, columns, comments, tickets, workspaces } from '../db/schema.js'
import { pendingOutcome } from '../mcp/server.js'
import { notifyRunFinished } from '../notify.js'
import { ensureGlobalMemoryDir, stateDir } from '../paths.js'
import type { WorkspaceManager } from '../workspaces/manager.js'
import { completeRun } from './completion.js'
import { Journal } from './journal.js'
import { readOutcomeFile } from './outcome.js'
import { composePrompt } from './prompt.js'
import { branchFor, buildRunDir, cleanupRunDirs } from './runDir.js'

export type BroadcastFn = (runId: number, e: AdapterEvent) => void

export interface RunnerDeps {
  db: TadaDb
  wm: WorkspaceManager
  adapters: Map<string, Adapter>
  broadcast?: BroadcastFn
  /** Broadcasts activity feed updates. Defaults to a no-op (tests that don't care about the
   * activity feed can omit it); production always supplies the real BroadcastHub. */
  hub?: ActivityBroadcaster
  /** Open PRs for pushed branches. Defaults to true; set false in tests (no `gh`/network). */
  pr?: boolean
  /** MCP endpoint the adapter should call back to. Defaults to a placeholder for tests. */
  mcpUrl?: string
  /** fetch implementation used for Expo push notifications. Defaults to global fetch; override in tests. */
  fetchImpl?: typeof fetch
}

/** Plain-English duration for activity messages, e.g. `timed out at 30m`. */
function humanizeMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = seconds / 60
  if (minutes < 60) return `${Math.round(minutes)}m`
  const hours = minutes / 60
  return `${Math.round(hours)}h`
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

/** An adapter that throws while probing is treated as unavailable rather than crashing the run. */
async function isAvailable(adapter: Adapter): Promise<boolean> {
  try {
    return await adapter.available()
  } catch {
    return false
  }
}

/** Executes a single run to a terminal state (needs_review, failed, or cancelled).
 *
 * `onSession` hands the live AdapterSession back to the caller (the Scheduler) as soon as the
 * adapter starts, which is how `POST /runs/:id/nudge` reaches into a running agent. */
export async function executeRun(
  deps: RunnerDeps,
  runId: number,
  externalSignal?: AbortSignal,
  onSession?: (session: AdapterSession) => void,
): Promise<void> {
  const { db, wm } = deps
  const hub = deps.hub ?? noopActivityBroadcaster

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

  recordActivity(db, hub, {
    workspaceId: ticket.workspaceId,
    ticketId: ticket.id,
    runId,
    type: 'run_started',
    message: `Started "${ticket.title}"`,
  })

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
  const markFailed = (reason: string): void => {
    // The reason is journaled as an error event (so the run screen's feed shows *why*, not just
    // running → failed) and kept as the run's summary when the agent left none, so cards and the
    // ticket's attempts list can surface it too.
    journal.write({ type: 'error', payload: { message: reason } })
    journal.write({ type: 'status', payload: { kind: 'run_status', status: 'failed' } })
    assertRunTransition('running', 'failed')
    const before = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, runId)).get()
    db.drizzle
      .update(agentRuns)
      .set({ status: 'failed', finishedAt: new Date(), summary: before?.summary ?? reason })
      .where(eq(agentRuns.id, runId))
      .run()

    assertCardMove('in_progress', 'ready')
    db.drizzle
      .update(tickets)
      .set({ columnId: readyColumn.id, queueState: 'held' })
      .where(eq(tickets.id, ticket.id))
      .run()

    recordActivity(db, hub, {
      workspaceId: ticket.workspaceId,
      ticketId: ticket.id,
      runId,
      type: 'run_failed',
      message: `"${ticket.title}" failed: ${reason}`,
    })

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

    // Parked as `held`, like a failure: it stays visibly "needs you" (Control's triage list, the
    // board's retry meta) instead of looking like an ordinary queued card that never runs.
    assertCardMove('in_progress', 'ready')
    db.drizzle
      .update(tickets)
      .set({ columnId: readyColumn.id, queueState: 'held' })
      .where(eq(tickets.id, ticket.id))
      .run()
  }

  try {
    const priorRuns = db.drizzle
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.ticketId, ticket.id))
      .orderBy(asc(agentRuns.id))
      .all()
      .filter((r) => r.id !== runId)

    // 2. build the run directory (git worktrees per repo) and compose the prompt.
    //
    // Earlier attempts' run dirs are torn down first: a finished attempt leaves its worktree in
    // place (the on-Done cleanup only fires when the ticket is accepted), and that worktree still
    // has `ticket/<id>` checked out, so `git worktree add` for this attempt would fail with
    // "branch already used by worktree" and insta-fail every send-back re-run. Safe to do here
    // rather than at enqueue: runs are per-ticket serial (a ticket has one card, and the
    // scheduler only starts a run for a queued card), so no other run of this ticket is live.
    await cleanupRunDirs(
      wm,
      ticket.workspaceId,
      priorRuns.map((r) => r.id),
    )

    const runDir = await buildRunDir(wm, ticket.workspaceId, ticket.id, runId)

    const ticketComments = db.drizzle
      .select()
      .from(comments)
      .where(eq(comments.ticketId, ticket.id))
      .orderBy(asc(comments.createdAt), asc(comments.id))
      .all()

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
    } else if (!(await isAvailable(adapter))) {
      const message = 'adapter not available on this server'
      markFailed(message)
      return
    } else {
      const manualController = new AbortController()
      const signal = AbortSignal.any(
        [AbortSignal.timeout(workspace.timeoutMs), manualController.signal, externalSignal].filter(
          (s): s is AbortSignal => s !== undefined,
        ),
      )

      const session = adapter.start({
        runDir: runDir.path,
        prompt,
        model: run.model,
        effort: run.effort,
        mcpUrl: deps.mcpUrl ?? 'http://127.0.0.1:0/mcp',
        runToken: run.runToken,
        journal,
        signal,
      })
      onSession?.(session)

      const runPromise = session.done.then(
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
      const message = adapterError instanceof Error ? adapterError.message : String(adapterError)
      markFailed(message)
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
      markFailed(`timed out at ${humanizeMs(workspace.timeoutMs)}`)
      return
    }

    if (exitCode !== undefined && exitCode !== 0) {
      markFailed(`exited with code ${exitCode}`)
      return
    }

    // MCP is the primary outcome channel; the outcome file is the fallback for adapters that
    // can't call tools (codex/gemini), so it is only consulted when nothing arrived over MCP.
    let reported = pendingOutcome(db, runId)
    if (!reported) {
      const fromFile = readOutcomeFile(runDir.path)
      if (fromFile.kind === 'invalid') {
        markFailed(fromFile.reason)
        return
      }
      if (fromFile.kind === 'outcome') reported = fromFile.outcome
    }

    if (!reported) {
      markFailed('agent did not report an outcome')
      return
    }
    if (reported.status === 'failed') {
      markFailed(reported.summary)
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
        diffAdditions: completion.diffAdditions,
        diffDeletions: completion.diffDeletions,
        testsPassed: reported.testsPassed ?? null,
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

    recordActivity(db, hub, {
      workspaceId: ticket.workspaceId,
      ticketId: ticket.id,
      runId,
      type: 'needs_review',
      message: `"${ticket.title}" is ready for review: ${reported.summary}`,
    })

    notifyRunFinished(
      db,
      { id: runId, status: 'needs_review', summary: reported.summary },
      ticket,
      deps.fetchImpl,
    ).catch((err) => console.error('notifyRunFinished failed:', err))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    markFailed(message)
  }
}
