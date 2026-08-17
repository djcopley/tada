import type { ApiRule, ApiSource } from '@tada/shared'

/**
 * Pure formatting/logic for the Settings screen — split out so tag text, token masking, URL
 * validation, option lists and rule provenance can be unit tested without rendering.
 */

export const CONCURRENCY_MIN = 1
// Matches the server's bound (routes/settings.ts patch schema).
export const CONCURRENCY_MAX = 16

/** Per-run time budget choices, in minutes. */
export const TIMEOUT_OPTIONS_MIN = [15, 30, 60, 120, 240] as const

/** Re-ping-while-held choices, in minutes; 0 = never. */
export const REPING_OPTIONS_MIN = [0, 30, 60, 120] as const

/** "15 min" / "1 hour" / "2 hours" — the label a duration menu shows. */
export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = minutes / 60
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hour${hours === 1 ? '' : 's'}`
}

/** "after 1 hour" / "off" for the re-ping menu. */
export function repingLabel(minutes: number): string {
  return minutes === 0 ? 'off' : `after ${durationLabel(minutes)}`
}

/** `repo · github` when the clone URL is a github.com remote, `repo · git` for any other repo
 * host, `folder · server` for a bare local path. */
export function sourceTag(source: ApiSource): string {
  if (source.type === 'folder') return 'folder · server'
  return source.url?.includes('github.com') ? 'repo · github' : 'repo · git'
}

/** Everything but the last four characters hidden — the token's `tada_` prefix stays readable
 * when it has one. */
export function maskToken(token: string): string {
  const prefix = token.startsWith('tada_') ? 'tada_' : ''
  const last4 = token.slice(-4)
  return `${prefix}${'•'.repeat(10)}${last4}`
}

/** Anything git itself clones: https/ssh/git/file URLs and scp-style git@host:path. */
export function isRepoUrl(url: string): boolean {
  return /^(https?|ssh|git|file):\/\/\S+$/.test(url) || /^[\w.-]+@[\w.-]+:\S+$/.test(url)
}

/** "Add a rule" takes patterns as free text — one per line or comma separated. */
export function parsePatterns(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
}

/** `set from a gate · aug 17` — the provenance Tag on a rule "Always allow" wrote. */
export function ruleProvenanceTag(rule: Pick<ApiRule, 'source' | 'updatedAt'>): string | null {
  if (rule.source !== 'gate') return null
  const d = new Date(rule.updatedAt)
  const month = d.toLocaleString('en-US', { month: 'short' }).toLowerCase()
  return `set from a gate · ${month} ${d.getDate()}`
}

/** `holding 1 run` / `holding 3 runs`, or null when nothing is held on the rule. */
export function holdingTag(rule: Pick<ApiRule, 'holdingCount'>): string | null {
  if (rule.holdingCount <= 0) return null
  return `holding ${rule.holdingCount} run${rule.holdingCount === 1 ? '' : 's'}`
}

/** The mono line under a rule title: its description, plus where a gate-set rule came from. */
export function ruleDetailLine(rule: Pick<ApiRule, 'description' | 'source' | 'sourceRunId' | 'patterns'>): string {
  const base = rule.description || rule.patterns.join(', ')
  if (rule.source === 'gate' && rule.sourceRunId != null) {
    return base ? `${base} · you chose always allow on run #${rule.sourceRunId}` : `you chose always allow on run #${rule.sourceRunId}`
  }
  return base
}
