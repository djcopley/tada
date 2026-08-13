export interface PromptInput {
  ticket: { id: number; title: string; description: string }
  comments: Array<{ author: 'human' | 'agent'; body: string; createdAt: Date }>
  agentsMd: string
  noteFiles: string[]
  priorRunSummaries: string[]
}

export function composePrompt(input: PromptInput): string {
  const sections: string[] = []

  // Task heading
  sections.push(`# Task: ${input.ticket.title}`)
  sections.push('')

  // Description
  sections.push(input.ticket.description)
  sections.push('')

  // Discussion (only if comments exist)
  if (input.comments.length > 0) {
    sections.push('## Discussion')
    for (const comment of input.comments) {
      sections.push(`**${comment.author}:** ${comment.body}`)
    }
    sections.push('')
  }

  // Workspace charter (always)
  sections.push('## Workspace charter')
  sections.push(input.agentsMd)
  sections.push('')

  // Workspace memory (always)
  sections.push('## Workspace memory')
  const noteFilesStr = input.noteFiles.length > 0 ? input.noteFiles.join(', ') : '(none yet)'
  sections.push(`Notes available in ./memory/notes: ${noteFilesStr}`)
  sections.push('Read notes relevant to this task. If you learn something durable about this')
  sections.push('workspace (a build quirk, credential location, API behavior), record it as a')
  sections.push('new markdown note in ./memory/notes/.')
  sections.push('')

  // Previous attempts (only if priorRunSummaries exist)
  if (input.priorRunSummaries.length > 0) {
    sections.push('## Previous attempts')
    for (let i = 0; i < input.priorRunSummaries.length; i++) {
      sections.push(`${i + 1}. ${input.priorRunSummaries[i]}`)
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
