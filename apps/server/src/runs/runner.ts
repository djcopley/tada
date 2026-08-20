import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ColumnKind, Hold, RunStatus } from '@tada/shared'
import { canMoveCard, canTransitionRun, holdPingText } from '@tada/shared'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { Broadcaster } from '../activity.js'
import { noopBroadcaster, recordActivity } from '../activity.js'
import type {
  Adapter,
  AdapterEvent,
  AdapterSession,
  GateDecision,
  GateRequest,
} from '../adapters/types.js'
import type { TadaDb } from '../db/index.js'
import { agentRuns, comments, memoryNotes, settings, tickets } from '../db/schema.js'
import { pendingOutcome } from '../mcp/server.js'
import { ping } from '../notify.js'
import { stateDir } from '../paths.js'
import { callSummary, matchRule } from '../rules.js'
import type { SourceStore } from '../sources/store.js'
import type { WebPushSender } from '../webPush.js'
import { storeAnswer } from './answers.js'
import { reposAhead, runDiff } from './diff.js'
import { Journal } from './journal.js'
import { readOutcomeFile } from './outcome.js'
import { composePrompt } from './prompt.js'
import { addWorktree, buildRunDir, cleanupRunDirs, type RunDir, runDirFor } from './runDir.js'
import { stampRepoTag } from './tags.js'

export type BroadcastFn = (runId: number, e: AdapterEvent) => void

/** The tool name the Claude SDK gives tada's `ask_user` MCP tool. */
export const ASK_USER_TOOL = 'mcp__tada__ask_user'

/** How many times a run will ask an agent that stopped without reporting to carry on. */
export const MAX_IDLE_NUDGES = 2

const FIRST_IDLE_NUDGE =
  'You ended your turn without calling `report_outcome`, and your turn ending is what ends this ' +
  'run — nothing will wake you up afterwards, and a background task you started cannot reach ' +
  'you once the session is closed. If work is still outstanding, wait for it here (poll it, or ' +
  're-run the command in the foreground) and finish it. Then call `report_outcome` with success ' +
  'or failed and a concise summary, in this turn.'

const FINAL_IDLE_NUDGE =
  'You stopped again without calling `report_outcome`. This is the last turn you get: the run ' +
  'ends when it does, and with no outcome it is recorded as a failure. Call `report_outcome` ' +
  'now — status `failed` with an honest summary of where you got to is a far better result than ' +
  'nothing. Do not start new work.'

export interface RunnerDeps {
  db: TadaDb
  store: SourceStore
  adapters: Map<string, Adapter>
  broadcast?: BroadcastFn
  /** Broadcasts board/activity/rules changes. Defaults to a no-op for tests that don't care. */
  hub?: Broadcaster
  /** MCP endpoint the adapter should call back to. Defaults to a placeholder for tests. */
  mcpUrl?: string
  /** fetch implementation used for Expo push notifications. Defaults to global fetch; override in tests. */
  fetchImpl?: typeof fetch
  /** Sender for the web push channel. Absent in tests and when no keys are configured. */
  webPush?: WebPushSender
  /** Re-ping delay while held; read from settings when absent. Tests pass 0 (never). */
  repingMs?: number
  /** Called the moment a run enters a hold — its slot is free, so the scheduler should tick. */
  onHeld?: () => void
}

/** How a human resolves a hold. Each kind only applies to the matching hold reason. */
export type HoldResolution =
  | { kind: 'approve' }
  | { kind: 'deny'; note: string }
  | { kind: 'answer'; answer: string }
  | { kind: 'continue'; extraMs: number }

/** The control surface the Scheduler keeps for a run that is in flight in this process. */
export interface LiveRun {
  /** Resolves the current hold. Returns false when the run isn't held, or the resolution doesn't
   * fit the hold (an `answer` for a permission gate, say). */
  resolve(res: HoldResolution): boolean
  inject(note: string): boolean
  /** The hold this run is waiting on right now, if any. */
  currentHold(): Hold | undefined
}

/** Plain-English duration for activity messages, e.g. `30m`. */
export function humanizeMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = seconds / 60
  if (minutes < 60) return `${Math.round(minutes)}m`
  return `${Math.round((minutes / 60) * 10) / 10}h`
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

/** An adapter that throws while probing is treated as unavailable rather than crashing the run. */
async function isAvailable(adapter: Adapter): Promise<boolean> {
  try {
    return await adapter.available()
  } catch {
    return false
  }
}

/**
 * Executes a single run to a terminal state (done, failed, or cancelled), holding along the way
 * whenever a gate, a question, or the time budget stops it.
 *
 * `onLive` hands the run's control surface back to the caller (the Scheduler) as soon as the
 * adapter starts, which is how the approve/deny/answer/continue/note routes reach into a run.
 */
export async function executeRun(
  deps: RunnerDeps,
  runId: number,
  externalSignal: AbortSignal,
  onLive?: (live: LiveRun) => void,
): Promise<void> {
  const { db, store } = deps
  const hub = deps.hub ?? noopBroadcaster

  const run = db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, runId)).get()
  if (!run) throw new Error(`run ${runId} not found`)
  const ticket = db.drizzle.select().from(tickets).where(eq(tickets.id, run.ticketId)).get()
  if (!ticket) throw new Error(`ticket ${run.ticketId} not found`)

  const transcriptPath = join(stateDir(), 'transcripts', `${runId}.jsonl`)
  const journal = new Journal(db, runId, transcriptPath, deps.broadcast)

  const currentRun = () => db.drizzle.select().from(agentRuns).where(eq(agentRuns.id, runId)).get()
  const currentColumn = (): ColumnKind =>
    db.drizzle
      .select({ column: tickets.column })
      .from(tickets)
      .where(eq(tickets.id, ticket.id))
      .get()?.column ?? 'backlog'

  const setRunStatus = (to: RunStatus, extra: Partial<typeof agentRuns.$inferInsert> = {}) => {
    const from = currentRun()?.status ?? run.status
    assertRunTransition(from, to)
    journal.write({ type: 'status', payload: { kind: 'run_status', status: to } })
    db.drizzle
      .update(agentRuns)
      .set({ status: to, ...extra })
      .where(eq(agentRuns.id, runId))
      .run()
  }

  const moveCard = (to: ColumnKind, extra: Partial<typeof tickets.$inferInsert> = {}) => {
    const from = currentColumn()
    if (from === to) return
    assertCardMove(from, to)
    db.drizzle
      .update(tickets)
      .set({ column: to, ...extra })
      .where(eq(tickets.id, ticket.id))
      .run()
  }

  // 1. mark run running + move card queued -> running
  setRunStatus('running', { transcriptPath, startedAt: new Date() })
  moveCard('running')
  recordActivity(db, hub, {
    ticketId: ticket.id,
    runId,
    type: 'run_started',
    message: `Agent started "${ticket.title}"`,
  })

  // Every failure between here and a terminal state must route through markFailed rather than
  // propagate — otherwise the run wedges at running/held with the card stuck in its lane and no
  // journaled reason.
  const markFailed = (reason: string): void => {
    journal.write({ type: 'error', payload: { message: reason } })
    const before = currentRun()
    setRunStatus('failed', {
      finishedAt: new Date(),
      summary: before?.summary ?? reason,
      hold: null,
      heldReason: null,
    })
    // Failure sits in the same stopped-on-you lane as a hold — the only red in the product.
    moveCard('stopped')
    recordActivity(db, hub, {
      ticketId: ticket.id,
      runId,
      type: 'run_failed',
      message: `"${ticket.title}" failed — ${reason}`,
    })
    hub.boardChanged()
    void ping(
      db,
      { ticketId: ticket.id, runId, title: `"${ticket.title}" failed`, body: reason },
      { fetchImpl: deps.fetchImpl, webPush: deps.webPush },
    )
  }

  // Deliberate cancellation (Stop run) is not a failure: the card goes to backlog and nothing
  // restarts it until a human queues it again.
  const markCancelled = (): void => {
    setRunStatus('cancelled', { finishedAt: new Date(), hold: null, heldReason: null })
    moveCard('backlog')
    recordActivity(db, hub, {
      ticketId: ticket.id,
      runId,
      type: 'run_cancelled',
      message: `You stopped "${ticket.title}"`,
    })
    hub.boardChanged()
  }

  let session: AdapterSession | undefined

  // ---- holds -----------------------------------------------------------------------------------
  // A hold is a pending promise the gate (or the time budget) is waiting on. The run's status is
  // `held` for exactly as long as one is pending, and the scheduler stops counting it against
  // the concurrency cap for that time.
  let pending: { hold: Hold; resolve: (r: HoldResolution | { kind: 'abort' }) => void } | undefined
  let timeExhausted = false
  let deadline: ReturnType<typeof setTimeout> | undefined
  // The budget counts the agent's working time, not the human's thinking time, so the deadline is
  // suspended for the length of every hold. `armedAt`/`armedMs` are what's needed to work out how
  // much of it was left when the hold started; `pausedMs` carries that across the hold.
  let armedAt = 0
  let armedMs = 0
  let pausedMs: number | undefined
  const repingMs = deps.repingMs ?? currentSettingsRepingMs(db)

  const enterHold = (hold: Hold): void => {
    const heldAt = new Date()
    pauseDeadline()
    setRunStatus('held', { heldReason: hold.reason, hold, heldAt })
    moveCard('stopped')
    journal.write({ type: 'gate', payload: { kind: 'hold', hold } })
    recordActivity(db, hub, {
      ticketId: ticket.id,
      runId,
      type: 'run_held',
      message: holdActivityMessage(ticket.title, hold),
    })
    hub.boardChanged()
    deps.onHeld?.()
    void ping(
      db,
      {
        ticketId: ticket.id,
        runId,
        title: `"${ticket.title}" is stopped on you`,
        body: holdPingText(hold),
      },
      { fetchImpl: deps.fetchImpl, webPush: deps.webPush },
    )
    if (repingMs > 0) {
      const timer = setTimeout(() => {
        const now = currentRun()
        if (now?.status === 'held' && now.heldAt?.getTime() === heldAt.getTime()) {
          void ping(
            db,
            {
              ticketId: ticket.id,
              runId,
              title: `"${ticket.title}" is still waiting on you`,
              body: holdPingText(hold),
            },
            { fetchImpl: deps.fetchImpl, webPush: deps.webPush },
          )
        }
      }, repingMs)
      timer.unref?.()
    }
  }

  const leaveHold = (): void => {
    resumeDeadline()
    setRunStatus('running', { heldReason: null, hold: null, heldAt: null })
    moveCard('running')
    journal.write({ type: 'gate', payload: { kind: 'resume' } })
    hub.boardChanged()
  }

  /** Holds the run until a human resolves it (or the run is aborted). */
  const holdFor = (hold: Hold): Promise<HoldResolution | { kind: 'abort' }> => {
    if (externalSignal.aborted) return Promise.resolve({ kind: 'abort' })
    enterHold(hold)
    return new Promise((resolve) => {
      pending = {
        hold,
        resolve: (r) => {
          pending = undefined
          if (r.kind !== 'abort') leaveHold()
          resolve(r)
        },
      }
    })
  }
  externalSignal.addEventListener('abort', () => pending?.resolve({ kind: 'abort' }), {
    once: true,
  })

  const armDeadline = (ms: number): void => {
    if (deadline) clearTimeout(deadline)
    armedAt = Date.now()
    armedMs = ms
    pausedMs = undefined
    deadline = setTimeout(() => {
      deadline = undefined
      timeExhausted = true
      journal.write({
        type: 'gate',
        payload: { kind: 'time_up', budgetMs: currentRun()?.budgetMs ?? ms },
      })
      // An adapter that can be suspended in place (a CLI subprocess) is held right now; the
      // Claude adapter can't, so its next tool call is where the gate holds it.
      if (!pending && session?.pause()) {
        void holdFor({ reason: 'time', budgetMs: currentRun()?.budgetMs ?? ms }).then((r) => {
          if (r.kind === 'continue') {
            grantMoreTime(r.extraMs)
            session?.resume()
          }
        })
      }
    }, ms)
    deadline.unref?.()
  }

  /** Stops the clock for the length of a hold. No-op once the budget is already spent — there is
   * nothing left to count down, and `grantMoreTime` is what re-arms in that case. */
  const pauseDeadline = (): void => {
    if (!deadline) return
    clearTimeout(deadline)
    deadline = undefined
    pausedMs = Math.max(0, armedMs - (Date.now() - armedAt))
  }

  /** Restarts the clock with whatever was left when the hold began. */
  const resumeDeadline = (): void => {
    if (pausedMs === undefined) return
    armDeadline(pausedMs)
  }

  const grantMoreTime = (extraMs: number): void => {
    timeExhausted = false
    const now = currentRun()
    db.drizzle
      .update(agentRuns)
      .set({ budgetMs: (now?.budgetMs ?? 0) + extraMs })
      .where(eq(agentRuns.id, runId))
      .run()
    journal.write({ type: 'gate', payload: { kind: 'continued', extraMs } })
    armDeadline(extraMs)
  }

  const holdIfOutOfTime = async (): Promise<boolean> => {
    if (!timeExhausted) return true
    const r = await holdFor({ reason: 'time', budgetMs: currentRun()?.budgetMs ?? 0 })
    if (r.kind === 'continue') {
      grantMoreTime(r.extraMs)
      return true
    }
    return false
  }

  // ---- idle turns ------------------------------------------------------------------------------
  // An agent that ends a turn without reporting an outcome is not necessarily finished: it may
  // have parked on background work expecting to be woken (nothing wakes it — its own turn ending
  // is what closes the session), or simply forgotten. Closing the session there fails a run that
  // was one sentence from succeeding, so we spend a turn asking. Bounded, because an agent that
  // ignores two direct instructions is stuck, and looping would burn the budget in silence.
  let idleNudges = 0

  const onIdle = (): string | null => {
    // Aborted, or out of time: the run is already going somewhere else. Let the session close.
    if (externalSignal.aborted || timeExhausted) return null
    if (pendingOutcome(db, runId)) return null
    if (idleNudges >= MAX_IDLE_NUDGES) {
      journal.write({
        type: 'text',
        payload: { text: 'stopped without reporting an outcome, twice over — giving up on it' },
      })
      return null
    }
    idleNudges++
    const last = idleNudges >= MAX_IDLE_NUDGES
    journal.write({
      type: 'text',
      payload: {
        text: last
          ? 'stopped without reporting an outcome — asked it one last time'
          : 'stopped without reporting an outcome — asked it to finish',
      },
    })
    return last ? FINAL_IDLE_NUDGE : FIRST_IDLE_NUDGE
  }

  const gate = async (req: GateRequest): Promise<GateDecision> => {
    if (!(await holdIfOutOfTime())) return { behavior: 'deny', reason: 'the run was stopped' }

    if (req.tool === ASK_USER_TOOL) {
      const question = typeof req.input.question === 'string' ? req.input.question : ''
      const options = Array.isArray(req.input.options)
        ? req.input.options.filter((o): o is string => typeof o === 'string')
        : []
      const r = await holdFor({ reason: 'question', question, options })
      if (r.kind !== 'answer') return { behavior: 'deny', reason: 'the run was stopped' }
      storeAnswer(runId, r.answer)
      return { behavior: 'allow', updatedInput: { ...req.input, answer: r.answer } }
    }

    const summary = callSummary(req.tool, req.input)
    const rule = matchRule(db, req.tool, summary)
    if (!rule || rule.decision === 'allow') return { behavior: 'allow' }
    if (rule.decision === 'never') {
      journal.write({
        type: 'gate',
        payload: { kind: 'never', tool: req.tool, summary, ruleId: rule.id, ruleTitle: rule.title },
      })
      return {
        behavior: 'deny',
        reason: `Your rules forbid this (${rule.title}). Do not retry it.`,
      }
    }

    const r = await holdFor({
      reason: 'permission',
      tool: req.tool,
      summary,
      ruleId: rule.id,
      ruleTitle: rule.title,
      publishes: rule.publishes,
    })
    if (r.kind === 'approve') return { behavior: 'allow' }
    if (r.kind === 'deny') {
      return {
        behavior: 'deny',
        reason: `The human denied this and says: ${r.note}. Everything you have done stays — take the note as your next instruction.`,
      }
    }
    return { behavior: 'deny', reason: 'the run was stopped' }
  }

  const live: LiveRun = {
    resolve: (res) => {
      if (!pending) return false
      const reason = pending.hold.reason
      const fits =
        (reason === 'permission' && (res.kind === 'approve' || res.kind === 'deny')) ||
        (reason === 'question' && res.kind === 'answer') ||
        (reason === 'time' && res.kind === 'continue')
      if (!fits) return false
      pending.resolve(res)
      return true
    },
    inject: (note) => session?.inject(note) ?? false,
    currentHold: () => pending?.hold,
  }

  try {
    const priorRuns = db.drizzle
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.ticketId, ticket.id))
      .orderBy(asc(agentRuns.id))
      .all()
      .filter((r) => r.id !== runId)

    // 2. build the run directory and compose the prompt. Earlier attempts' run dirs are torn down
    // first: their worktrees still hold `ticket/<id>` checked out, and git refuses to check the
    // same branch out twice. Safe here: runs are per-ticket serial.
    await cleanupRunDirs(
      store,
      priorRuns.map((r) => r.id),
    )
    const dir: RunDir = buildRunDir(store, runId)

    const adapter = deps.adapters.get(run.adapter)
    const repos = store.repos()
    if (adapter && !adapter.supportsGates) {
      // No tada tools, so no `use_repo`: check everything out up front. Tags are stamped at the
      // end for the repos whose branch actually moved.
      for (const repo of repos) {
        await addWorktree(store, dir, ticket.id, repo)
        journal.write({
          type: 'text',
          payload: { text: `made a worktree for ${repo.name} — off ${repo.defaultBranch}` },
        })
      }
    }
    if (externalSignal.aborted) {
      markCancelled()
      return
    }

    const thread = db.drizzle
      .select()
      .from(comments)
      .where(eq(comments.ticketId, ticket.id))
      .orderBy(asc(comments.createdAt), asc(comments.id))
      .all()
    const globalNotes = db.drizzle
      .select()
      .from(memoryNotes)
      .where(and(eq(memoryNotes.state, 'kept'), sql`json_array_length(${memoryNotes.tags}) = 0`))
      .orderBy(asc(memoryNotes.id))
      .all()

    const prompt = composePrompt({
      ticket: {
        id: ticket.id,
        title: ticket.title,
        description: ticket.description,
        repoTags: ticket.repoTags,
      },
      comments: thread.map((c) => ({ author: c.author, body: c.body, createdAt: c.createdAt })),
      notes: globalNotes.map((n) => ({ title: n.title, body: n.body })),
      repos: repos.map((r) => ({
        name: r.name,
        defaultBranch: r.defaultBranch,
        checkedOut: r.name in dir.repoDirs,
      })),
      folders: store
        .manifest()
        .sources.filter((s) => s.type === 'folder')
        .map((s) => s.name),
      tools: adapter?.supportsGates ?? true,
      priorRuns: priorRuns.map((r) => ({
        attemptNumber: r.attemptNumber,
        status: r.status,
        summary: r.summary,
      })),
    })
    // Kept next to the transcript for debugging (what exactly did this attempt see?). Best-effort.
    try {
      writeFileSync(join(dir.path, 'prompt.md'), prompt)
    } catch (err) {
      journal.write({
        type: 'error',
        payload: { message: `could not save prompt.md: ${String(err)}` },
      })
    }
    journal.write({
      type: 'text',
      payload: { text: `read the brief and ${globalNotes.length} memory notes` },
    })

    // 3. run the adapter under the time budget
    if (!adapter) {
      markFailed(`unknown adapter: ${run.adapter}`)
      return
    }
    if (!(await isAvailable(adapter))) {
      markFailed('adapter not available on this server')
      return
    }

    armDeadline(run.budgetMs)
    session = adapter.start({
      runDir: dir.path,
      prompt,
      model: run.model,
      effort: run.effort,
      mcpUrl: deps.mcpUrl ?? 'http://127.0.0.1:0/mcp',
      runToken: run.runToken,
      journal,
      signal: externalSignal,
      gate,
      onIdle,
    })
    // A suspended process never sees SIGTERM; wake it before the abort reaches it.
    externalSignal.addEventListener('abort', () => session?.resume(), { once: true })
    onLive?.(live)

    const result = await session.done.then(
      (r) => ({ kind: 'exit' as const, exitCode: r.exitCode }),
      (error: unknown) => ({ kind: 'error' as const, error }),
    )
    if (deadline) clearTimeout(deadline)

    // 4. decide the outcome
    if (externalSignal.aborted) {
      markCancelled()
      return
    }
    if (result.kind === 'error') {
      markFailed(result.error instanceof Error ? result.error.message : String(result.error))
      return
    }
    if (result.exitCode !== 0) {
      markFailed(`exited with code ${result.exitCode}`)
      return
    }

    // MCP is the primary outcome channel; the outcome file is the fallback for adapters that
    // can't call tools (codex/gemini), so it is only consulted when nothing arrived over MCP.
    let reported = pendingOutcome(db, runId)
    if (!reported) {
      const fromFile = readOutcomeFile(dir.path)
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

    // 5. done — the run files itself. Diff totals are the run's own branches vs default; agents
    // without tada tools earn their repo tags here (the ones with `use_repo` were tagged as they
    // checked repos out).
    let diffAdditions: number | null = null
    let diffDeletions: number | null = null
    try {
      // Re-read the layout from disk: worktrees made by `use_repo` mid-run aren't in `dir`.
      const finalDir = runDirFor(store, runId)
      const diffs = await runDiff(store, finalDir, ticket.id, { patch: false })
      if (diffs.length > 0) {
        diffAdditions = diffs.reduce((n, d) => n + d.additions, 0)
        diffDeletions = diffs.reduce((n, d) => n + d.deletions, 0)
      }
      if (!adapter.supportsGates) {
        for (const name of await reposAhead(store, finalDir, ticket.id))
          stampRepoTag(db, ticket.id, name)
      }
    } catch (err) {
      journal.write({ type: 'error', payload: { message: `diffstat failed: ${String(err)}` } })
    }

    setRunStatus('done', {
      summary: reported.summary,
      diffAdditions,
      diffDeletions,
      testsPassed: reported.testsPassed ?? null,
      finishedAt: new Date(),
    })
    moveCard('done', { doneAt: new Date() })
    recordActivity(db, hub, {
      ticketId: ticket.id,
      runId,
      type: 'run_done',
      message: `"${ticket.title}" finished and moved itself to done — ${reported.summary}`,
    })
    hub.boardChanged()
    await cleanupRunDirs(store, [runId])
  } catch (err) {
    markFailed(err instanceof Error ? err.message : String(err))
  } finally {
    if (deadline) clearTimeout(deadline)
  }
}

function currentSettingsRepingMs(db: TadaDb): number {
  return db.drizzle.select().from(settings).get()?.repingMs ?? 0
}

export function holdActivityMessage(title: string, hold: Hold): string {
  switch (hold.reason) {
    case 'permission':
      return `"${title}" is holding at ${hold.summary.split('\n')[0]?.slice(0, 80) ?? hold.tool} — your rule asks first`
    case 'question':
      return `"${title}" has a question for you`
    case 'time':
      return `"${title}" hit the ${humanizeMs(hold.budgetMs)} limit — stopped on you`
  }
}

/** Runs of `ticketId` that own the card right now: queued, running or held. */
export function liveRunFor(db: TadaDb, ticketId: number) {
  return db.drizzle
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.ticketId, ticketId), isNull(agentRuns.finishedAt)))
    .orderBy(asc(agentRuns.id))
    .all()
    .find((r) => r.status === 'queued' || r.status === 'running' || r.status === 'held')
}
