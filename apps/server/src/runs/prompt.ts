export interface PromptRun {
  attemptNumber: number
  status: string
  summary: string | null
}

export interface PromptComment {
  author: 'human' | 'agent'
  body: string
  createdAt: Date
}

export interface PromptNote {
  title: string
  body: string
}

export interface PromptRepo {
  name: string
  defaultBranch: string
  /** Set when the repo is already checked out in the run dir (agents without tada tools). */
  checkedOut: boolean
}

export interface PromptInput {
  ticket: { id: number; title: string; description: string }
  comments: PromptComment[]
  /** Untagged (global) memory notes — every run reads these. */
  notes: PromptNote[]
  repos: PromptRepo[]
  folders: string[]
  /** Whether the agent can call the tada MCP tools (use_repo, ask_user, report_outcome, ...). */
  tools: boolean
  /** Every prior run for this ticket, ascending by attemptNumber. */
  priorRuns: PromptRun[]
}

export function composePrompt(input: PromptInput): string {
  const s: string[] = []
  const branch = `ticket/${input.ticket.id}`

  s.push(`# Task: ${input.ticket.title}`, '')
  s.push(input.ticket.description, '')

  if (input.comments.length > 0) {
    s.push('## Thread')
    s.push('Notes from the human are instructions; your own earlier updates are context.')
    for (const c of input.comments)
      s.push(`**${c.author === 'human' ? 'human' : 'you'}:** ${c.body}`)
    s.push('')
  }

  s.push('## Memory')
  if (input.notes.length === 0) {
    s.push('(no notes yet)')
  } else {
    for (const n of input.notes) s.push(`### ${n.title}`, n.body, '')
  }
  if (input.tools) {
    s.push(
      'If you learn something durable (a build quirk, a convention, an API behaviour) save it with the `write_memory_note` tool — a human keeps or dismisses it.',
    )
  }
  s.push('')

  s.push('## Where you work')
  s.push(
    'You are in a run directory of your own. `scratch/` is yours. Not every task needs code changes — some are operational.',
  )
  if (input.repos.length === 0) {
    s.push('No repos are connected.')
  } else if (input.tools) {
    s.push(
      `Repos you may work in: ${input.repos.map((r) => `${r.name} (default branch ${r.defaultBranch})`).join(', ')}.`,
    )
    s.push(
      `Before touching a repo call \`use_repo\` with its name: it checks out a fresh worktree at ./<name> on branch \`${branch}\` and hands you the memory notes for that repo. Only check out repos you actually need — the ticket is tagged with what you touch.`,
    )
  } else {
    s.push(
      `Repos are checked out under this directory, each on branch \`${branch}\`: ${input.repos.map((r) => `./${r.name} (off ${r.defaultBranch})`).join(', ')}.`,
    )
  }
  if (input.folders.length > 0) {
    s.push(
      `Attached folders (read them, don't rewrite them): ${input.folders.map((f) => `./${f}`).join(', ')}.`,
    )
  }
  s.push('')

  const summarized = input.priorRuns.filter((r) => r.summary != null)
  if (summarized.length > 0) {
    s.push('## Previous attempts')
    for (const r of summarized) s.push(`${r.attemptNumber}. (${r.status}) ${r.summary}`)
    s.push('')
  }

  s.push('## How to work')
  s.push(`- Commit your work on \`${branch}\`. Small, well-described commits.`)
  s.push(
    "- When the work is ready, push the branch and open a pull request yourself (`git push -u origin <branch>`, then `gh pr create`). Some commands are gated by the human's rules: a gated call pauses until they approve, and a denied call comes back with their note — follow the note and carry on.",
  )
  if (input.tools) {
    s.push(
      '- Post progress and findings on the ticket with `update_ticket`; attach artifacts with `attach_link` / `attach_file`.',
    )
    s.push(
      '- If you need a decision from the human, call `ask_user` (with options when there is a natural choice). It pauses until they answer.',
    )
    s.push(
      '- Work you discover but that is out of scope: file it with `propose_ticket` instead of doing it.',
    )
    s.push(
      '- When finished, you MUST call `report_outcome` with status success or failed and a concise summary. A run that never reports is a failure.',
    )
  }

  return s.join('\n')
}
