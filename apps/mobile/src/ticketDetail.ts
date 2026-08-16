import type { ApiComment, ApiMemoryNote, ApiRun, ColumnKind, QueueState, TicketOrigin } from '@tada/shared'
import type { BadgeStatus } from './components/ui/Badge'
import { heldWord, prNumberFromUrl } from './control'
import { relativeTime } from './relativeTime'

/**
 * Pure formatting/logic for the ticket detail screen — split out from the screen component so
 * the attempts-history math, review copy and memory summary can be unit tested without
 * rendering. Instrument Ink content rules apply: sentence case, mono data, `·` separators.
 */

/** `"parlor · parlor-web · created 3d ago by you"` — workspace, first repo source, relative
 * created time + who filed it. `origin` decides "you" (human) vs "agent" (a filed follow-up). */
export function ticketMetaLine(
  workspaceName: string,
  firstSourceName: string | undefined,
  createdAt: string,
  origin: TicketOrigin,
): string {
  const parts = [workspaceName]
  if (firstSourceName) parts.push(firstSourceName)
  return `${parts.join(' · ')} · created ${relativeTime(createdAt)} by ${origin === 'human' ? 'you' : 'agent'}`
}

/** Header Badge for the ticket's overall disposition — `null` when the column carries no
 * signal worth badging (backlog/ready), matching Instrument Ink's three-signal palette. */
export function ticketStatusBadge(
  columnKind: ColumnKind | undefined,
  queueState: QueueState,
  latestRun?: ApiRun,
): { status: BadgeStatus; label: string } | null {
  if (queueState === 'held') {
    return heldWord(latestRun) === 'stopped' ? { status: 'neutral', label: 'stopped' } : { status: 'failed', label: 'failed' }
  }
  switch (columnKind) {
    case 'in_review':
      return { status: 'accepted', label: 'your turn' }
    case 'in_progress':
      return { status: 'live', label: 'live' }
    case 'done':
      return { status: 'accepted', label: 'done' }
    default:
      return null
  }
}

/** `"pr #481 · +412 −38 · 214 tests pass"` — the review card's mono sub-line under the agent's
 * summary. Omits any piece the run lacks; no leading "attempt N" (that's already the header Tag). */
export function reviewStatLine(run: ApiRun): string {
  const parts: string[] = []
  const pr = prNumberFromUrl(run.prUrl)
  if (pr) parts.push(`pr #${pr}`)
  if (run.diffAdditions != null && run.diffDeletions != null) {
    parts.push(`+${run.diffAdditions} −${run.diffDeletions}`)
  }
  if (run.testsPassed != null) parts.push(`${run.testsPassed} tests pass`)
  return parts.join(' · ')
}

/** Spec deviation approved for this build: accept just closes the ticket, so the helper copy
 * under the review card's actions reads this instead of the artboard's merge/branch/close sentence. */
export const REVIEW_ACCEPT_HELPER_COPY = 'On accept the ticket is closed.'

/** Artboard line 284's copy verbatim, except the attempt number: the mock shows "attempt 3" for
 * its example ticket (currently on attempt 2), which would be flatly wrong copy on any ticket
 * not in that exact state — so it's parameterized on the *next* attempt number instead of
 * hardcoded. */
export function sendItBackCopy(nextAttemptNumber: number): string {
  return `Your feedback becomes attempt ${nextAttemptNumber}'s first instruction, verbatim. Be as specific as the brief.`
}

/** `"12m"` / `"1h 4m"` wall-clock duration between two timestamps — `null` if either is missing
 * or the run hasn't finished. Distinct from `elapsedLabel` (control.ts), which measures against
 * "now" for a still-running attempt; this measures a closed span. */
export function runDuration(startedAt: string | null, finishedAt: string | null): string | null {
  if (!startedAt || !finishedAt) return null
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  const totalMinutes = Math.round(ms / 60_000)
  if (totalMinutes < 60) return `${totalMinutes}m`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
}

export type AttemptRow = {
  id: number
  /** The latest run — rendered in ok-text with its pr/duration detail line. */
  current: boolean
  primary: string
  detail?: string
  /** The feedback quote for an earlier attempt that was sent back. */
  quote?: string
}

const TERMINAL_LABEL: Partial<Record<ApiRun['status'], string>> = {
  failed: 'failed',
  cancelled: 'cancelled',
}

/** Attempts card rows, latest attempt first. The latest run is always "current" (in review /
 * running / queued / failed / cancelled, with its pr + duration). Every earlier run was
 * necessarily resolved one of two ways: sent back (still `needs_review` — the only path to a
 * next attempt without failing) or failed outright — paired 1:1 in order with this ticket's
 * `feedback`-kind comments, which sendBack posts exactly one of per earlier attempt. */
export function attemptRows(
  runs: ApiRun[],
  comments: ApiComment[],
  opts: { accepted?: boolean } = {},
): AttemptRow[] {
  const sorted = [...runs].sort((a, b) => a.attemptNumber - b.attemptNumber)
  const feedback = comments
    .filter((c) => c.kind === 'feedback')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  let feedbackIndex = 0

  const rows = sorted.map((run, i): AttemptRow => {
    const isCurrent = i === sorted.length - 1
    if (isCurrent) {
      // Accepting a ticket moves the card to Done but leaves the run row at needs_review, so the
      // caller says when the latest attempt is actually the accepted one.
      const label =
        run.status === 'needs_review'
          ? opts.accepted
            ? 'accepted'
            : 'in review now'
          : run.status === 'running'
            ? 'running now'
            : run.status === 'queued'
              ? 'queued'
              : (TERMINAL_LABEL[run.status] ?? run.status)
      const detailParts: string[] = []
      const pr = prNumberFromUrl(run.prUrl)
      if (pr) detailParts.push(`pr #${pr}`)
      const duration = runDuration(run.startedAt, run.finishedAt)
      if (duration) detailParts.push(`ran ${duration}`)
      return {
        id: run.id,
        current: true,
        primary: `#${run.attemptNumber} ${label}`,
        detail: detailParts.length ? detailParts.join(' · ') : undefined,
      }
    }

    if (run.status === 'needs_review') {
      const note = feedback[feedbackIndex]
      feedbackIndex += 1
      return {
        id: run.id,
        current: false,
        primary: `#${run.attemptNumber} sent back ${relativeTime(note?.createdAt ?? run.finishedAt ?? run.createdAt)}`,
        quote: note ? `"${note.body}"` : undefined,
      }
    }

    return {
      id: run.id,
      current: false,
      primary: `#${run.attemptNumber} ${TERMINAL_LABEL[run.status] ?? run.status} ${relativeTime(run.finishedAt ?? run.createdAt)}`,
    }
  })

  return rows.reverse()
}

export type LinkedFollowUp = { id: number; title: string }

/** `"proposed by agent · in backlog"` — verbatim per the artboard; every follow-up ticket
 * reaching this card has already been filed as a real ticket (the pending keep/dismiss decision
 * lives on Control, not here). */
export const FOLLOW_UP_META = 'proposed by agent · in backlog'

/** `"conventions · testing · <highlighted>"` — kept note titles, lowercase, joined by `·`, with
 * the newest kept agent note pulled out and highlighted separately (ok-text) rather than folded
 * into the plain list. */
export function memorySummary(notes: ApiMemoryNote[]): { keptTitles: string[]; highlighted?: string } {
  const kept = notes.filter((n) => n.state === 'kept')
  const agentKept = kept.filter((n) => n.author === 'agent')
  const newest = agentKept.length
    ? agentKept.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b))
    : undefined
  const keptTitles = kept.filter((n) => n.id !== newest?.id).map((n) => n.title.toLowerCase())
  const highlighted = newest ? (noteGist(newest.body) || newest.title) : undefined
  return { keptTitles, highlighted }
}

/** First real line of a note body: the leading `# heading` (already the title) is dropped and
 * the rest collapsed to one line, so a multi-paragraph markdown note reads as a one-line gist. */
export function noteGist(body: string): string {
  return body
    .replace(/^\s*#[^\n]*\n?/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')
    .trim()
}
