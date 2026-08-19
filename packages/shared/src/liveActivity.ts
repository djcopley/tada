import type { Hold, RunStatus } from './domain.js'

/** How long the finished card stays on the lock screen before iOS removes it. */
export const ACTIVITY_DISMISSAL_MS = 4000

/** The agent's well is one line. Longer than this and it wraps, which the design forbids. */
const AGENT_LINE_MAX = 120

export type ActivityPhase = 'working' | 'yourTurn' | 'done' | 'failed'

/** A button on the card. `kind` is what the app calls; the widget only draws `label`. */
export interface ActivityAction {
  kind: 'approve' | 'deny' | 'answer' | 'continue' | 'stop' | 'rerun' | 'open'
  label: string
  /** For `answer`: the option text sent back to the agent. */
  value?: string
}

/**
 * The Live Activity's content state. This object is JSON-stringified into the APNs payload and
 * handed straight to the widget, so it is the one contract between the two — keep it small, and
 * keep everything the card renders in it. Dates are epoch ms because the payload is JSON.
 */
export interface LiveActivityProps {
  runId: number
  ticketId: number
  /** The ticket title — your voice: sentence case, Instrument Sans. */
  title: string
  phase: ActivityPhase
  /** The agent's voice: one line, lowercase, present tense. */
  agentLine: string
  /** The compact presentation counts up from here locally, so the clock costs no pushes. */
  startedAt: number
  /** When the time budget runs out. Absent for a run without one — the bar is then not drawn. */
  budgetEndsAt?: number
  /** At most two, drawn in order. */
  actions: ActivityAction[]
}

export interface ActivitySource {
  ticket: { id: number; title: string }
  run: {
    id: number
    status: RunStatus
    hold: Hold | null
    /** Nullable on the row: a queued run has not started. */
    startedAt: Date | null
    budgetMs: number
  }
  /** The agent's most recent line — run summary, latest activity message, or null. */
  line: string | null
  /** Injected so tests are deterministic. */
  now?: Date
}

/** One sentence naming what stopped a run. Shared because the ping and the card must not differ. */
export function holdPingText(hold: Hold): string {
  switch (hold.reason) {
    case 'permission':
      return `wants to: ${hold.ruleTitle} — ${hold.summary}`
    case 'question':
      return hold.question
    case 'time':
      return 'out of time — continue, or stop it'
  }
}

function clamp(line: string): string {
  return line.length <= AGENT_LINE_MAX ? line : `${line.slice(0, AGENT_LINE_MAX - 1).trimEnd()}…`
}

function heldActions(hold: Hold): ActivityAction[] {
  switch (hold.reason) {
    case 'permission':
      // "Always allow" is deliberately absent: it rewrites the rule table permanently, and a
      // half-asleep tap on a lock screen is the worst place in the product to make that change.
      return [
        { kind: 'approve', label: 'Approve' },
        { kind: 'deny', label: 'Deny' },
      ]
    case 'question': {
      const options = hold.options.slice(0, 2)
      if (options.length === 0) return [{ kind: 'open', label: 'Open' }]
      return options.map((option) => ({ kind: 'answer' as const, label: option, value: option }))
    }
    case 'time':
      return [
        { kind: 'continue', label: 'Continue' },
        { kind: 'stop', label: 'Stop' },
      ]
  }
}

/**
 * The whole state table, as one pure function. Returns null for a run that owns no card —
 * `queued` has not started and `cancelled` is a run you stopped on purpose, and neither is worth
 * the lock screen.
 */
export function runToActivityProps(src: ActivitySource): LiveActivityProps | null {
  const { ticket, run } = src
  const now = src.now ?? new Date()
  if (run.status === 'queued' || run.status === 'cancelled') return null

  const startedAt = (run.startedAt ?? now).getTime()
  const hold = run.status === 'held' ? run.hold : null

  const phase: ActivityPhase =
    run.status === 'held' ? 'yourTurn' : run.status === 'running' ? 'working' : run.status

  const agentLine = hold ? holdPingText(hold) : (src.line ?? 'working')

  const actions: ActivityAction[] = hold
    ? heldActions(hold)
    : run.status === 'failed'
      ? [
          { kind: 'rerun', label: 'Re-run' },
          { kind: 'open', label: 'Open' },
        ]
      : []

  return {
    runId: run.id,
    ticketId: ticket.id,
    title: ticket.title,
    phase,
    agentLine: clamp(agentLine),
    startedAt,
    // A zero budget means "no budget" in settings, and a bar with no end is a lie.
    ...(run.budgetMs > 0 ? { budgetEndsAt: startedAt + run.budgetMs } : {}),
    actions,
  }
}
