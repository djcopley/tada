import type { RuleDecision } from '@tada/shared'
import { asc } from 'drizzle-orm'
import type { TadaDb } from './db/index.js'
import { rules } from './db/schema.js'

export type RuleRow = typeof rules.$inferSelect

export interface DefaultRule {
  title: string
  description: string
  tool: string
  patterns: string[]
  decision: RuleDecision
  publishes: boolean
}

/**
 * The seed rule table. First match wins, so the `never` rule for force-pushes and main comes
 * before the general "push a branch" allow. The pull request is the one review moment: pushes run
 * (a pushed branch is inert), publishing asks. Anything no rule matches is allowed.
 */
export const DEFAULT_RULES: readonly DefaultRule[] = [
  {
    title: 'Force-push or touch main',
    description: 'git push --force, git push origin main',
    tool: 'Bash',
    patterns: [
      '*git push*--force*',
      '*git push*-f *',
      '*git push* main',
      '*git push* main *',
      '*git push*:main*',
      '*git push* master',
      '*git push* master *',
      '*git push*:master*',
    ],
    decision: 'never',
    publishes: true,
  },
  {
    title: 'Push a branch',
    description: 'git push · any branch but main · inert until a pr exists',
    tool: 'Bash',
    patterns: ['*git push*'],
    decision: 'allow',
    publishes: true,
  },
  {
    title: 'Open a pull request',
    description: 'github · gh pr create · the review moment',
    tool: 'Bash',
    patterns: ['*gh pr create*'],
    decision: 'ask',
    publishes: true,
  },
  {
    title: 'Merge or close a pull request',
    description: 'github · gh pr merge, gh pr close',
    tool: 'Bash',
    patterns: ['*gh pr merge*', '*gh pr close*'],
    decision: 'ask',
    publishes: true,
  },
]

/** A glob where `*` matches anything (including nothing) and everything else is literal. */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${escaped}$`, 's')
}

/**
 * The one-line rendering of a tool call that rules match against and gates display: the shell
 * command for Bash, the file path for file tools, otherwise the input as compact JSON.
 */
export function callSummary(tool: string, input: unknown): string {
  const rec = (input ?? {}) as Record<string, unknown>
  if (tool === 'Bash' && typeof rec.command === 'string') return rec.command
  for (const key of ['file_path', 'path', 'notebook_path', 'url']) {
    if (typeof rec[key] === 'string') return rec[key]
  }
  const json = JSON.stringify(input) ?? ''
  return json.length > 500 ? `${json.slice(0, 500)}…` : json
}

export function ruleMatches(
  rule: Pick<RuleRow, 'tool' | 'patterns'>,
  tool: string,
  summary: string,
): boolean {
  if (rule.tool !== '*' && rule.tool !== tool) return false
  if (rule.patterns.length === 0) return true
  return rule.patterns.some((p) => globToRegExp(p).test(summary))
}

/** The first rule (by position) matching this call, or undefined — in which case the call is
 * allowed. */
export function matchRule(db: TadaDb, tool: string, summary: string): RuleRow | undefined {
  const all = db.drizzle.select().from(rules).orderBy(asc(rules.position), asc(rules.id)).all()
  return all.find((r) => ruleMatches(r, tool, summary))
}
