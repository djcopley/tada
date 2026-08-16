import { useEffect, useState } from 'react'
import type { ActivityType, ApiRun } from '@tada/shared'

/**
 * Pure formatting/logic for the Control screen — split out from the screen
 * component so triage copy, activity glyphs and run-stat formatting can be
 * unit tested without rendering. Instrument Ink content rules apply: sentence
 * case, mono data, `·` separators, lowercase relative times.
 */

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']

export function countWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n)
}

/** "Two things need you" / "One thing needs you" / "All quiet" at zero. */
export function headlineFor(needsYouCount: number): string {
  if (needsYouCount === 0) return 'All quiet'
  return `${countWord(needsYouCount)} thing${needsYouCount === 1 ? '' : 's'} need${
    needsYouCount === 1 ? 's' : ''
  } you`
}

/** Mono subline: runs finished since local midnight + pending agent notes, degrading
 * gracefully to "nothing ran overnight" when nothing happened. */
export function overnightSubline(runsFinished: number, pendingNotes: number): string {
  const runsPart = runsFinished === 0 ? 'nothing ran overnight' : `${runsFinished} ran overnight`
  if (pendingNotes === 0) return runsPart
  const notePart = pendingNotes === 1 ? 'memory grew by one note' : `memory grew by ${pendingNotes} notes`
  return `${runsPart} · ${notePart}`
}

export function localMidnight(now: Date = new Date(Date.now())): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

// `new Date(Date.now())` rather than the bare `new Date()` in both defaults above: `new Date()`
// reads the system clock directly and does NOT go through the (mockable, explicitly-called)
// `Date.now()` static — jest.spyOn(Date, 'now') has no effect on it, which would silently break
// tests that freeze "now" that way. Routing through `Date.now()` keeps this consistent with
// `elapsedLabel`/`useNowTick` and makes it testable the same way.
export function isSinceLocalMidnight(iso: string, now: Date = new Date(Date.now())): boolean {
  return new Date(iso).getTime() >= localMidnight(now).getTime()
}

export type ActivityGlyph = { glyph: string; colorKey: 'okText' | 'liveText' | 'failText' }

const ACTIVITY_GLYPHS: Partial<Record<ActivityType, ActivityGlyph>> = {
  accepted: { glyph: '✱', colorKey: 'okText' },
  follow_up_filed: { glyph: '+', colorKey: 'liveText' },
  memory_written: { glyph: '✎', colorKey: 'liveText' },
  run_failed: { glyph: '✕', colorKey: 'failText' },
}

/** Glyph + color for an activity row; `null` for types the artboard renders plain
 * (run_started, needs_review, sent_back, ticket_created, note_kept, note_discarded). */
export function activityGlyph(type: ActivityType): ActivityGlyph | null {
  return ACTIVITY_GLYPHS[type] ?? null
}

/** Splits `message` around a `"title"` quoted substring so callers can render the
 * ticket title in bold inline, or `null` if the title isn't (quoted-)present. */
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

/** Pulls the trailing PR number off a GitHub-style PR URL ("…/pull/481" → "481"). */
export function prNumberFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const match = url.match(/(\d+)\/?$/)
  return match?.[1] ?? null
}

/** "attempt 2 · pr #481 · +412 −38 · 214 tests pass" — omits any piece the run lacks. */
export function runStatLine(run: ApiRun | undefined): string {
  if (!run) return ''
  const parts = [`attempt ${run.attemptNumber}`]
  const pr = prNumberFromUrl(run.prUrl)
  if (pr) parts.push(`pr #${pr}`)
  if (run.diffAdditions != null && run.diffDeletions != null) {
    parts.push(`+${run.diffAdditions} −${run.diffDeletions}`)
  }
  if (run.testsPassed != null) parts.push(`${run.testsPassed} tests pass`)
  return parts.join(' · ')
}

/** "attempt 1 · timed out at 30m" when the failed run left a summary, else "attempt 1 · failed". */
export function failureLine(run: ApiRun | undefined): string {
  if (!run) return ''
  return `attempt ${run.attemptNumber} · ${run.summary && run.summary.trim() ? run.summary : 'failed'}`
}

/** Bare "12m" / "1h 4m" elapsed label — the mono meta trailing a live RunStatusChip. */
export function elapsedLabel(startedAt: string | null | undefined, now: number = Date.now()): string {
  if (!startedAt) return '0m'
  const diffMs = Math.max(0, now - new Date(startedAt).getTime())
  const totalMinutes = Math.floor(diffMs / 60_000)
  if (totalMinutes < 60) return `${totalMinutes}m`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
}

/** "1 slot free — next: <title>" / "3 slots free — next: <title>". */
export function slotPillText(slots: number, nextTitle: string): string {
  return `${slots} ${slots === 1 ? 'slot' : 'slots'} free — next: ${nextTitle}`
}

/**
 * Terse mobile-artboard meta line for a needs-you card: `"parlor · 2h · pr #481"`
 * (in-review) or `"parlor · 7h · timed out at 30m"` (failed) — workspace, elapsed since the
 * ticket was created, short marker. The marker is omitted (not the whole line) when there's
 * nothing to show: no PR yet on a review ticket, or no run at all.
 */
export function narrowNeedsYouMeta(
  workspaceName: string,
  createdAt: string,
  now: number,
  failed: boolean,
  run: ApiRun | undefined,
): string {
  const elapsed = elapsedLabel(createdAt, now)
  // Narrow has no room for the full failure summary (that's the wide card's job) — a short
  // marker only: "timed out" when the reason mentions a timeout, else the bare "failed".
  const marker = failed
    ? /timed?\s*out|timeout/i.test(run?.summary ?? '')
      ? 'timed out'
      : 'failed'
    : prNumberFromUrl(run?.prUrl)
      ? `pr #${prNumberFromUrl(run?.prUrl)}`
      : undefined
  return marker ? `${workspaceName} · ${elapsed} · ${marker}` : `${workspaceName} · ${elapsed}`
}

/** Mobile-artboard subline variant: `"3 ran overnight · at 03:12 one failed"` when a run failed
 * since local midnight (`"… · since 03:12 four failed"` for several), else the same graceful
 * degradation as `overnightSubline`. */
export function narrowOvernightSubline(
  runsFinished: number,
  failureAt: string | null,
  failureCount = failureAt ? 1 : 0,
): string {
  if (runsFinished === 0) return 'nothing ran overnight'
  if (failureAt && failureCount > 1) {
    return `${runsFinished} ran overnight · since ${failureAt} ${countWord(failureCount).toLowerCase()} failed`
  }
  if (failureAt) return `${runsFinished} ran overnight · at ${failureAt} one failed`
  return `${runsFinished} ran overnight`
}

/** Re-renders every `intervalMs` so live-run elapsed labels ("12m") tick forward while the
 * Control screen stays open, without polling the server. Jest fake timers drive it in tests. */
export function useNowTick(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
