import { describe, expect, test } from 'vitest'
import { composePrompt, type PromptInput } from '../src/runs/prompt.js'

const base: PromptInput = {
  ticket: { id: 7, title: 'Add CSV export', description: 'Stream it.', repoTags: [] },
  comments: [],
  notes: [],
  repos: [{ name: 'web', defaultBranch: 'main', checkedOut: false }],
  folders: [],
  tools: true,
  priorRuns: [],
}

describe('composePrompt', () => {
  test('tools: repos are lazy via use_repo, memory inline, report_outcome required', () => {
    const p = composePrompt({ ...base, notes: [{ title: 'Safety', body: 'never force-push' }] })
    expect(p).toContain('# Task: Add CSV export')
    expect(p).toContain('### Safety\nnever force-push')
    expect(p).toContain('`use_repo`')
    expect(p).toContain('ticket/7')
    expect(p).toContain('report_outcome')
    expect(p).toContain('ask_user')
    expect(p).toContain('gh pr create')
  })

  test("a ticket's repo tags become a starting hint; unconnected tags are dropped", () => {
    const p = composePrompt({ ...base, ticket: { ...base.ticket, repoTags: ['web', 'gone'] } })
    expect(p).toContain('already tagged for web')
    expect(p).not.toContain('gone')
    expect(composePrompt(base)).not.toContain('already tagged for')
  })

  test('no tools: repos already checked out, no tool instructions', () => {
    const p = composePrompt({
      ...base,
      tools: false,
      repos: [{ name: 'web', defaultBranch: 'main', checkedOut: true }],
    })
    expect(p).toContain('./web (off main)')
    expect(p).not.toContain('use_repo')
    expect(p).not.toContain('report_outcome')
  })

  test('thread, folders, prior attempts', () => {
    const p = composePrompt({
      ...base,
      comments: [{ author: 'human', body: 'split it', createdAt: new Date() }],
      folders: ['specs'],
      priorRuns: [
        { attemptNumber: 1, status: 'failed', summary: 'crashed' },
        { attemptNumber: 2, status: 'cancelled', summary: null },
      ],
    })
    expect(p).toContain('**human:** split it')
    expect(p).toContain('./specs')
    expect(p).toContain('1. (failed) crashed')
    expect(p).not.toContain('2. (cancelled)')
  })
})
