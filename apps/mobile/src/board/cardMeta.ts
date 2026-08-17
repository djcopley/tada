import type { ApiRun, ApiTicket, ColumnKind } from '@tada/shared'
import { holdLine, isSinceLocalMidnight, stoppedSince } from '../control'
import { heldReasonLabel } from '../design/status'
import { bareAge } from '../relativeTime'

/**
 * Pure formatting/logic for the Board screen's lanes and cards — split out so the mono meta
 * lines and move rules can be unit tested without rendering. Instrument Ink content rules apply:
 * mono data, `·` separators, lowercase relative times.
 */

export const LANES: readonly ColumnKind[] = ['backlog', 'queued', 'running', 'stopped', 'done']

export const LANE_TITLES: Record<ColumnKind, string> = {
  backlog: 'Backlog',
  queued: 'Queued',
  running: 'Running',
  stopped: 'Stopped on you',
  done: 'Done',
}

/** The count text beside a lane title. Done spells out its two promises. */
export function laneCount(kind: ColumnKind, count: number): string {
  return kind === 'done' ? `${count} · self-filed · undo for 24h` : String(count)
}

/** Repo tags are output — the run stamps them. Until then a card reads "no repo". */
export function repoLabel(ticket: Pick<ApiTicket, 'repoTags'>): string {
  return ticket.repoTags.length > 0 ? ticket.repoTags.join(', ') : 'no repo'
}

/** Backlog/queued/done minimal meta: `<repo> · <age>`. */
export function minimalMeta(ticket: ApiTicket, now: number): string {
  return `${repoLabel(ticket)} · ${bareAge(ticket.createdAt, now)}`
}

/** The top queued ticket reads `<repo> · next up` in place of its age. */
export function nextUpMeta(ticket: ApiTicket): string {
  return `${repoLabel(ticket)} · next up`
}

/** Done card meta: `<repo> · moved itself · HH:MM` for a run that filed itself today, else
 * `<repo> · <age>` (age of the filing, falling back to creation). */
export function doneMeta(ticket: ApiTicket, now: number): string {
  const run = ticket.run
  const filedAt = ticket.doneAt ?? run?.finishedAt ?? ticket.createdAt
  if (run?.status === 'done' && ticket.doneAt && isSinceLocalMidnight(ticket.doneAt, new Date(now))) {
    const d = new Date(ticket.doneAt)
    return `${repoLabel(ticket)} · moved itself · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return `${repoLabel(ticket)} · ${bareAge(filedAt, now)}`
}

export type StoppedWell = { glyph: string; text: string; live: boolean }

/** The one-line recessed well on a stopped card: `⏸ gh pr create · held 2h 14m` for a
 * permission hold (live orange), `? which backoff…` for a question, `⏸ 30m limit · context kept`
 * for time, `✕ <reason>` for a failure. `null` when the run isn't stopped. */
export function stoppedWell(run: ApiRun | null | undefined, now: number): StoppedWell | null {
  if (!run) return null
  if (run.status === 'failed') return { glyph: '✕', text: run.summary?.trim() || 'run failed', live: false }
  if (run.status !== 'held' || !run.hold) return null
  const line = holdLine(run.hold)
  switch (run.hold.reason) {
    case 'permission':
      return { glyph: '⏸', text: `${line} · ${stoppedSince(run, now)}`, live: true }
    case 'question':
      return { glyph: '?', text: line, live: false }
    case 'time':
      return { glyph: '⏸', text: line, live: false }
  }
}

/** Badge word for a stopped card: the hold reason, or "failed". */
export function stoppedBadge(run: ApiRun | null | undefined): { label: string; failed: boolean } | null {
  if (!run) return null
  if (run.status === 'failed') return { label: 'failed', failed: true }
  if (run.status === 'held' && run.heldReason) return { label: heldReasonLabel(run.heldReason), failed: false }
  return null
}

/** `follow-up of <parent title lowercased>` for a proposal card — `undefined` when the parent
 * ticket isn't resolvable (its id isn't on this board). */
export function followUpOfLabel(parentTitle: string | undefined): string | undefined {
  return parentTitle ? `follow-up of ${parentTitle.toLowerCase()}` : undefined
}

/** A pending agent proposal — dashed-border card, not part of the normal drag flow. */
export function isProposalTicket(ticket: ApiTicket): boolean {
  return ticket.origin === 'agent' && ticket.proposalState === 'pending'
}

/** A run that owns the card right now (running or held): the only human move is to backlog. */
export function hasLiveRun(ticket: ApiTicket): boolean {
  return ticket.run?.status === 'running' || ticket.run?.status === 'held'
}

export type HumanTarget = 'backlog' | 'queued' | 'done'

/** Where a human may put this card, mirroring the server: backlog/queued/done, never running or
 * stopped; a card whose run is live may only go to backlog (which stops the run); a pending
 * proposal can't be queued until kept. The current lane is excluded (a reorder isn't a move). */
export function allowedMoveTargets(ticket: ApiTicket): HumanTarget[] {
  if (hasLiveRun(ticket)) return ticket.column === 'backlog' ? [] : ['backlog']
  const all: HumanTarget[] = ['backlog', 'queued', 'done']
  return all.filter((t) => t !== ticket.column && !(t === 'queued' && isProposalTicket(ticket)))
}

/** Whether a dragged card may be dropped into `kind` (same-lane reorder always allowed). */
export function canDropInto(ticket: ApiTicket, kind: ColumnKind): boolean {
  if (kind === ticket.column) return kind !== 'running' && kind !== 'stopped'
  return (allowedMoveTargets(ticket) as ColumnKind[]).includes(kind)
}

/** The mono "held at …" caption for the context menu's held group. */
export function heldGroupTitle(run: ApiRun | null | undefined): string | null {
  if (run?.status === 'failed') return 'Failed'
  if (run?.status !== 'held' || !run.hold) return null
  switch (run.hold.reason) {
    case 'permission':
      return `Held at ${run.hold.summary.split('\n')[0]?.slice(0, 40)}`
    case 'question':
      return 'Held on a question'
    case 'time':
      return 'Out of time'
  }
}
