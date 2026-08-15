import type { CommentKind } from '@tada/shared'

export interface PromptRun {
  attemptNumber: number
  summary: string | null
  startedAt: Date | null
  finishedAt: Date | null
}

export interface PromptComment {
  author: 'human' | 'agent'
  kind: CommentKind
  body: string
  createdAt: Date
}

export interface PromptInput {
  ticket: { id: number; title: string; description: string }
  comments: PromptComment[]
  agentsMd: string
  noteFiles: string[]
  globalAgentsMd: string
  globalNoteFiles: string[]
  /** Every prior run for this ticket (excluding the one being composed for), ascending by
   * attemptNumber. Used both to number "## Previous attempts" and to figure out which attempt a
   * feedback/nudge comment landed during. */
  priorRuns: PromptRun[]
}

/** The attempt number active at `at`: the highest-attempt prior run whose startedAt is <= `at`.
 * This covers both "during that run" and "in the gap right after it finished, before the next
 * attempt started" - exactly where send-back feedback and nudges land. Undefined if `at`
 * predates every prior run's start. */
function attemptActiveAt(sortedPriorRuns: PromptRun[], at: Date): number | undefined {
  let result: number | undefined
  for (const run of sortedPriorRuns) {
    if (run.startedAt && run.startedAt.getTime() <= at.getTime()) {
      result = run.attemptNumber
    }
  }
  return result
}

export function composePrompt(input: PromptInput): string {
  const sections: string[] = []

  const sortedPriorRuns = [...input.priorRuns].sort((a, b) => a.attemptNumber - b.attemptNumber)
  const lastPriorRun = sortedPriorRuns.at(-1)

  // Task heading
  sections.push(`# Task: ${input.ticket.title}`)
  sections.push('')

  // Feedback from the most recent send-back (only if it was left after the attempt it critiques
  // actually finished - otherwise it's stale, already-addressed feedback from an earlier round).
  // Rendered first so the agent can't miss it.
  const latestFeedback = [...input.comments]
    .filter((c) => c.kind === 'feedback' && c.author === 'human')
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .at(-1)
  if (
    latestFeedback &&
    lastPriorRun?.finishedAt &&
    latestFeedback.createdAt.getTime() > lastPriorRun.finishedAt.getTime()
  ) {
    sections.push(`## Your feedback on attempt ${lastPriorRun.attemptNumber}`)
    sections.push('')
    sections.push(latestFeedback.body)
    sections.push('')
  }

  // Description
  sections.push(input.ticket.description)
  sections.push('')

  // Discussion (only if comments exist)
  if (input.comments.length > 0) {
    sections.push('## Discussion')
    for (const comment of input.comments) {
      const nudgeAttempt =
        comment.kind === 'nudge' ? attemptActiveAt(sortedPriorRuns, comment.createdAt) : undefined
      const suffix = nudgeAttempt !== undefined ? ` (nudge during attempt ${nudgeAttempt})` : ''
      sections.push(`**${comment.author}:** ${comment.body}${suffix}`)
    }
    sections.push('')
  }

  // Workspace charter (always)
  sections.push('## Workspace charter')
  sections.push(input.agentsMd)
  sections.push('')

  // Global memory (always) - shared across every workspace
  sections.push('## Global memory')
  sections.push(input.globalAgentsMd)
  const globalNoteFilesStr =
    input.globalNoteFiles.length > 0 ? input.globalNoteFiles.join(', ') : '(none yet)'
  sections.push(`Notes available in ./memory-global/notes: ${globalNoteFilesStr}`)
  sections.push('')

  // Workspace memory (always)
  sections.push('## Workspace memory')
  const noteFilesStr = input.noteFiles.length > 0 ? input.noteFiles.join(', ') : '(none yet)'
  sections.push(`Notes available in ./memory/notes: ${noteFilesStr}`)
  sections.push('Read notes relevant to this task. If you learn something durable about this')
  sections.push('workspace (a build quirk, credential location, API behavior), use the')
  sections.push('write_memory_note tool to save durable learnings.')
  sections.push('')

  // Previous attempts (only if any prior run has a summary), numbered by the run's actual
  // attemptNumber (not array position) so a failed, summary-less attempt doesn't shift numbering.
  const summarizedRuns = sortedPriorRuns.filter((r) => r.summary != null)
  if (summarizedRuns.length > 0) {
    sections.push('## Previous attempts')
    for (const run of summarizedRuns) {
      sections.push(`${run.attemptNumber}. ${run.summary}`)
    }
    sections.push('')
  }

  // How to work (always)
  sections.push('## How to work')
  sections.push(
    `- Your working directory contains a checkout per repo on branch ticket/${input.ticket.id}; commit your work there. Not every task needs code changes — some are operational.`,
  )
  sections.push(
    '- Post progress or findings to your ticket with the tada MCP tool `update_ticket`. Attach non-PR artifacts with `attach_link`/`attach_file`.',
  )
  sections.push(
    '- When finished, you MUST call `report_outcome` with status success or failed and a concise summary. Do not open pull requests yourself; the system handles that after you finish.',
  )

  return sections.join('\n')
}
