import type { ApiComment, ApiRun, ApiTicket, ApiWorkspaceDetail } from '@tada/shared'
import { heldWord, prNumberFromUrl } from '../control'
import { bareAge } from '../relativeTime'

/**
 * Pure formatting/logic for the Board screen's ticket cards — split out so
 * the mono meta lines (source, age, retry, run stats) can be unit tested
 * without rendering. Instrument Ink content rules apply throughout: mono
 * data, `·` separators, lowercase relative times.
 */

/** First attached repo's name — Board has no per-ticket repo, so the workspace's primary
 * source stands in for the `parlor-api` prefix on minimal cards. */
export function primarySourceName(workspace: ApiWorkspaceDetail): string | undefined {
  return workspace.sources[0]?.name
}

function withSource(source: string | undefined, rest: string): string {
  return source ? `${source} · ${rest}` : rest
}

/** Backlog/queued minimal meta: `<source> · <age>`. */
export function minimalCardMeta(workspace: ApiWorkspaceDetail, ticket: ApiTicket, now: number): string {
  return withSource(primarySourceName(workspace), bareAge(ticket.createdAt, now))
}

/** The top queued ticket in Queued reads `<source> · next up` in place of its age. */
export function nextUpMeta(workspace: ApiWorkspaceDetail): string {
  return withSource(primarySourceName(workspace), 'next up')
}

/** A held ticket (queueState 'held') carries a prior failed or stopped run — its meta says so
 * and names the attempt a re-queue would start (`failed · retry as attempt 2`), replacing
 * source/age entirely, so it never reads like a scheduled retry or an ordinary queued card.
 * `null` when there's no run yet to retry from. */
export function retryMeta(latestRun: ApiRun | undefined): string | null {
  if (!latestRun) return null
  return `${heldWord(latestRun)} · retry as attempt ${latestRun.attemptNumber + 1}`
}

/** In-review card meta: `attempt N · pr #X · tests pass`, omitting any piece the run lacks. */
export function reviewMeta(run: ApiRun | undefined): string {
  if (!run) return ''
  const parts = [`attempt ${run.attemptNumber}`]
  const pr = prNumberFromUrl(run.prUrl)
  if (pr) parts.push(`pr #${pr}`)
  if (run.testsPassed) parts.push('tests pass')
  return parts.join(' · ')
}

/** Done card meta: `pr #N merged · <age>` when the latest run shipped a PR, else
 * `no pr · <workspace> task · <age>`. */
export function doneMeta(workspace: ApiWorkspaceDetail, run: ApiRun | undefined, ticket: ApiTicket, now: number): string {
  const age = bareAge(run?.finishedAt ?? run?.createdAt ?? ticket.createdAt, now)
  const pr = prNumberFromUrl(run?.prUrl)
  return pr ? `pr #${pr} merged · ${age}` : `no pr · ${workspace.name.toLowerCase()} task · ${age}`
}

/** `follow-up of <parent title lowercased>` for a proposal card — `undefined` when the parent
 * ticket isn't resolvable (its id isn't on this board). */
export function followUpOfLabel(parentTitle: string | undefined): string | undefined {
  return parentTitle ? `follow-up of ${parentTitle.toLowerCase()}` : undefined
}

/** Latest agent word for the running card's one-line well: the last agent comment, else the
 * latest run's summary. Mirrors Control's `agentTextFor`. */
export function agentWellText(detail: { comments: ApiComment[]; runs: ApiRun[] } | undefined): string | undefined {
  if (!detail) return undefined
  const agentComments = detail.comments.filter((c) => c.author === 'agent')
  const last = agentComments[agentComments.length - 1]
  if (last) return last.body
  return detail.runs[detail.runs.length - 1]?.summary ?? undefined
}

/** A pending agent proposal — dashed-border card, not part of the normal drag flow. */
export function isProposalTicket(ticket: ApiTicket): boolean {
  return ticket.origin === 'agent' && ticket.proposalState === 'pending'
}
