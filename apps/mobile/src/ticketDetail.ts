import type { ApiRun, ApiTicket, TicketOrigin } from '@tada/shared'
import { budgetLabel, elapsedLabel, runStatLine } from './control'
import { relativeTime } from './relativeTime'

/**
 * Pure formatting/logic for the ticket detail screen — split out from the screen component so
 * the header meta, stopped-card copy and run summary lines can be unit tested without rendering.
 * Instrument Ink content rules apply: sentence case, mono data, `·` separators.
 */

const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000

/** `"created 3d ago by you"` — plus the no-tags hint on a ticket that has never run: repo tags
 * are stamped by a run, so before one there is nothing to show yet. */
export function ticketMetaLine(ticket: Pick<ApiTicket, 'createdAt' | 'origin' | 'repoTags' | 'run'>): string {
  const who = ticket.origin === 'human' ? 'you' : 'agent'
  const base = `created ${relativeTime(ticket.createdAt)} by ${who}`
  if (ticket.repoTags.length === 0 && ticket.run === null) {
    return `${base} · no repo tags yet — the run tags what it touches`
  }
  return base
}

export function whoLabel(origin: TicketOrigin): string {
  return origin === 'human' ? 'you' : 'agent'
}

export type StoppedCopy = {
  title: string
  /** The small explanatory paragraph under the actions. */
  helper: string
}

/** Card title + helper copy for a run that is stopped on you, by *why* it stopped. Null for a
 * run that isn't stopped. */
export function stoppedCopy(run: ApiRun | null | undefined): StoppedCopy | null {
  if (!run) return null
  if (run.status === 'failed') {
    return {
      title: 'Failed',
      helper:
        'Failure never re-runs itself. A re-run is a fresh attempt — new worktree, memory re-read; the failed transcript stays on the ticket.',
    }
  }
  if (run.status !== 'held' || !run.hold) return null
  switch (run.hold.reason) {
    case 'permission':
      return {
        title: 'Waiting for permission',
        helper: `Stopped by your rule ${run.hold.ruleTitle} → ask. Holding freed its slot — the queue kept moving. Approving resumes it at the front; always allow also updates the rule and logs it in Today. On the last step the ticket moves itself to done.`,
      }
    case 'question':
      return {
        title: 'Waiting for your answer',
        helper: 'It is stopped and you are the reason. Your answer can be saved to memory so it never asks twice.',
      }
    case 'time':
      return {
        title: 'Out of time',
        helper: `Stopped at the ${budgetLabel(run.hold.budgetMs)} limit with everything it has done intact. Continuing picks up mid-run — no re-clone.`,
      }
  }
}

/** The recessed lines of a stopped card's agent well: `[prefix, text][]`. Callers color the last
 * line live (hold) or fail (failure). */
export function stoppedWellLines(run: ApiRun, ticketId: number): { prefix: string; text: string; accent: 'live' | 'fail' | null }[] {
  if (run.status === 'failed') {
    return [
      { prefix: '▸', text: run.summary?.trim() || 'the run stopped without a report', accent: null },
      { prefix: '✕', text: 'run failed — see the last 40 lines in the full log', accent: 'fail' },
    ]
  }
  const hold = run.hold
  if (run.status !== 'held' || !hold) return []
  switch (hold.reason) {
    case 'permission': {
      const stat = runStatLine(run).replace(/^run #\d+ · ?/, '')
      const context = `all work is committed on ticket/${ticketId}${stat ? ` · ${stat}` : ''}`
      return [
        { prefix: '▸', text: context, accent: null },
        { prefix: '⏸', text: hold.summary, accent: 'live' },
      ]
    }
    case 'question':
      return [{ prefix: '?', text: hold.question, accent: null }]
    case 'time':
      return [
        { prefix: '⏸', text: `stopped at the ${budgetLabel(hold.budgetMs)} limit · context kept`, accent: 'live' },
      ]
  }
}

/** The thread's orange hold line: `"holding at gh pr create — your rule asks first"`. */
export function holdThreadLine(run: ApiRun): string | null {
  if (run.status !== 'held' || !run.hold) return null
  switch (run.hold.reason) {
    case 'permission':
      return `holding at ${run.hold.summary.split('\n')[0]} — your rule asks first`
    case 'question':
      return 'holding on a question for you'
    case 'time':
      return `holding at the ${budgetLabel(run.hold.budgetMs)} limit — asking for more time`
  }
}

/** Mono lines for the "This run" card, in order. Data-driven: only what the run has. */
export function runCardLines(run: ApiRun, now: number = Date.now()): { text: string; accent: 'live' | 'ok' | 'fail' | 'muted' | null }[] {
  const lines: { text: string; accent: 'live' | 'ok' | 'fail' | 'muted' | null }[] = []
  lines.push({ text: `attempt ${run.attemptNumber} · ${run.adapter} · ${run.model}`, accent: 'muted' })
  if (run.status === 'queued') lines.push({ text: 'queued · starts when a slot frees', accent: 'muted' })
  if (run.startedAt) lines.push({ text: `started ${relativeTime(run.startedAt)}`, accent: null })
  if (run.status === 'running') lines.push({ text: `live · ${elapsedLabel(run.startedAt, now)}`, accent: 'live' })
  if (run.status === 'held') lines.push({ text: `held · ${elapsedLabel(run.heldAt ?? run.startedAt, now)}`, accent: 'live' })
  if (run.status === 'done') lines.push({ text: `done · moved itself to done ${run.finishedAt ? relativeTime(run.finishedAt) : ''}`.trim(), accent: 'ok' })
  if (run.status === 'failed') lines.push({ text: `failed ${run.finishedAt ? relativeTime(run.finishedAt) : ''}`.trim(), accent: 'fail' })
  if (run.status === 'cancelled') lines.push({ text: `stopped by you ${run.finishedAt ? relativeTime(run.finishedAt) : ''}`.trim(), accent: 'muted' })
  const stat = runStatLine(run).replace(/^run #\d+ · ?/, '')
  if (stat) lines.push({ text: stat, accent: null })
  lines.push({ text: `budget ${budgetLabel(run.budgetMs)}`, accent: 'muted' })
  return lines
}

/** "This run" card meta: `"#4128 · 41m of work"`. */
export function runCardMeta(run: ApiRun, now: number = Date.now()): string {
  const end = run.finishedAt ? new Date(run.finishedAt).getTime() : now
  const worked = run.startedAt ? elapsedLabel(run.startedAt, end) : null
  return worked ? `#${run.id} · ${worked} of work` : `#${run.id}`
}

/** One row per attempt for the Attempts card, latest first. */
export function attemptRows(runs: ApiRun[]): { runId: number; primary: string; detail: string }[] {
  return [...runs]
    .sort((a, b) => b.attemptNumber - a.attemptNumber)
    .map((run) => ({
      runId: run.id,
      primary: `attempt ${run.attemptNumber} · ${run.status}`,
      detail: run.summary?.trim() || (run.finishedAt ? relativeTime(run.finishedAt) : run.startedAt ? `started ${relativeTime(run.startedAt)}` : 'not started'),
    }))
}

/** A done ticket may be undone for 24 hours. */
export function canUndoDone(ticket: Pick<ApiTicket, 'column' | 'doneAt'>, now: number = Date.now()): boolean {
  if (ticket.column !== 'done' || !ticket.doneAt) return false
  return now - new Date(ticket.doneAt).getTime() < UNDO_WINDOW_MS
}

/** Placeholder for the note input, by ticket state. */
export function notePlaceholder(run: ApiRun | null | undefined): string {
  if (run?.status === 'running' || run?.status === 'held') return 'Add a note — the agent reads it at its next step'
  return 'Add a note — the agent reads it when the run starts'
}
