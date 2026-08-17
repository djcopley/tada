import type { ActivityType, ApiBoard, ApiRun, ApiTicket, Hold } from '@tada/shared'
import { useEffect, useState } from 'react'

/**
 * Pure formatting/logic for the Control screen and the frame — split out from the screen
 * component so triage copy, activity glyphs and run-stat formatting can be unit tested without
 * rendering. Instrument Ink content rules apply: sentence case, mono data, `·` separators,
 * lowercase relative times.
 */

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']

export function countWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n)
}

/** "Three runs are stopped on you" / "One run is stopped on you" / "Nothing is stopped on you". */
export function headlineFor(stoppedCount: number): string {
  if (stoppedCount === 0) return 'Nothing is stopped on you'
  return `${countWord(stoppedCount)} run${stoppedCount === 1 ? ' is' : 's are'} stopped on you`
}

/** Mono subline: "5 ran overnight · 4 moved themselves to done", degrading to "nothing ran
 * overnight" when nothing finished since local midnight. */
export function overnightSubline(ranOvernight: number, selfFiled: number): string {
  if (ranOvernight === 0) return 'nothing ran overnight'
  const filed = selfFiled === 0 ? '' : ` · ${selfFiled} moved ${selfFiled === 1 ? 'itself' : 'themselves'} to done`
  return `${ranOvernight} ran overnight${filed}`
}

export function localMidnight(now: Date = new Date(Date.now())): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

// `new Date(Date.now())` rather than the bare `new Date()`: `new Date()` reads the system clock
// directly and does NOT go through the (mockable) `Date.now()` static, which would silently break
// tests that freeze "now" that way.
export function isSinceLocalMidnight(iso: string, now: Date = new Date(Date.now())): boolean {
  return new Date(iso).getTime() >= localMidnight(now).getTime()
}

/** Every ticket on the board, in one list. */
export function allTickets(board: ApiBoard | undefined): ApiTicket[] {
  if (!board) return []
  return [...board.backlog, ...board.queued, ...board.running, ...board.stopped, ...board.done]
}

/** How many runs are stopped on you: the stopped lane (held or failed). The Rail's Control badge
 * (drawn outside that screen, in the tabs frame) uses this so both always agree. */
export function countStoppedOnYou(board: ApiBoard | undefined): number {
  return board?.stopped.length ?? 0
}

/** Runs that finished (any terminal state) since local midnight, and how many of those filed
 * themselves as done. */
export function overnightCounts(board: ApiBoard | undefined, now: Date = new Date(Date.now())): { ran: number; selfFiled: number } {
  let ran = 0
  let selfFiled = 0
  for (const ticket of allTickets(board)) {
    const run = ticket.run
    if (!run?.finishedAt || !isSinceLocalMidnight(run.finishedAt, now)) continue
    ran += 1
    if (run.status === 'done') selfFiled += 1
  }
  return { ran, selfFiled }
}

export type ActivityGlyph = { glyph: string; colorKey: 'okText' | 'liveText' | 'failText' | 'text' }

const ACTIVITY_GLYPHS: Partial<Record<ActivityType, ActivityGlyph>> = {
  run_done: { glyph: '✱', colorKey: 'okText' },
  run_failed: { glyph: '✕', colorKey: 'failText' },
  run_held: { glyph: '⏸', colorKey: 'liveText' },
  approved: { glyph: '✓', colorKey: 'text' },
  always_allowed: { glyph: '✓', colorKey: 'text' },
  denied: { glyph: '↩', colorKey: 'text' },
  answered: { glyph: '✓', colorKey: 'text' },
  continued: { glyph: '▸', colorKey: 'text' },
  follow_up_filed: { glyph: '+', colorKey: 'liveText' },
  memory_proposed: { glyph: '✎', colorKey: 'liveText' },
}

/** Glyph + color for a Today row; `null` for types rendered plain (run_started, ticket_created,
 * run_cancelled, note_kept, note_discarded, undone). */
export function activityGlyph(type: ActivityType): ActivityGlyph | null {
  return ACTIVITY_GLYPHS[type] ?? null
}

/** Splits `message` around a `"title"` quoted substring so callers can render the ticket title
 * in bold inline, or `null` if the title isn't (quoted-)present. */
export function splitOnQuotedTitle(
  message: string,
  title: string | null,
): { before: string; title: string; after: string } | null {
  if (!title) return null
  const quoted = `"${title}"`
  const idx = message.indexOf(quoted)
  if (idx === -1) return null
  return { before: message.slice(0, idx), title, after: message.slice(idx + quoted.length) }
}

/** `HH:MM` local-time stamp for the Today card. */
export function hhmm(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** "run #4128 · +412 −38 · 214 tests pass" — omits any piece the run lacks. */
export function runStatLine(run: ApiRun | undefined | null): string {
  if (!run) return ''
  const parts = [`run #${run.id}`]
  if (run.diffAdditions != null && run.diffDeletions != null) parts.push(`+${run.diffAdditions} −${run.diffDeletions}`)
  if (run.testsPassed != null) parts.push(`${run.testsPassed} tests pass`)
  return parts.join(' · ')
}

/** Bare "12m" / "1h 4m" elapsed label — the mono meta trailing a live RunStatusChip. */
export function elapsedLabel(since: string | null | undefined, now: number = Date.now()): string {
  if (!since) return '0m'
  const diffMs = Math.max(0, now - new Date(since).getTime())
  const totalMinutes = Math.floor(diffMs / 60_000)
  if (totalMinutes < 60) return `${totalMinutes}m`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
}

/** "held 2h 14m" for a held run, "failed 20m ago" for a failed one, "" otherwise. */
export function stoppedSince(run: ApiRun | null | undefined, now: number = Date.now()): string {
  if (!run) return ''
  if (run.status === 'held') return `held ${elapsedLabel(run.heldAt ?? run.startedAt, now)}`
  if (run.status === 'failed') return `failed ${elapsedLabel(run.finishedAt, now)} ago`
  return ''
}

/** "30m" / "1h" for a time budget in ms. */
export function budgetLabel(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const h = minutes / 60
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`
}

/** The one-line agent-voice text for a hold — the recessed line under a stopped card. */
export function holdLine(hold: Hold): string {
  switch (hold.reason) {
    case 'permission':
      return hold.summary.split('\n')[0] ?? hold.tool
    case 'question':
      return hold.question
    case 'time':
      return `${budgetLabel(hold.budgetMs)} limit · context kept`
  }
}

/** "0 slots free · next:" pill text. */
export function slotPillText(free: number): string {
  return `${free} ${free === 1 ? 'slot' : 'slots'} free · next:`
}

/** Re-renders every `intervalMs` so elapsed labels ("12m") tick forward while a screen stays
 * open, without polling the server. Jest fake timers drive it in tests. */
export function useNowTick(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
