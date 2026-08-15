import { describe, expect, test } from 'vitest'
import { composePrompt, type PromptRun } from '../src/runs/prompt.js'

describe('composePrompt', () => {
  const baseInput = {
    ticket: { id: 42, title: 'Fix login bug', description: 'Users cannot log in on mobile.' },
    comments: [],
    agentsMd: '# Agents\n\nAgent definitions here.',
    noteFiles: [] as string[],
    globalAgentsMd: '# Global\n\nCross-workspace charter.',
    globalNoteFiles: [] as string[],
    priorRuns: [] as PromptRun[],
  }

  test('output starts with # Task: <title>', () => {
    const result = composePrompt(baseInput)
    expect(result).toContain('# Task: Fix login bug')
  })

  test('contains description verbatim', () => {
    const result = composePrompt(baseInput)
    expect(result).toContain('Users cannot log in on mobile.')
  })

  test('renders comments in chronological order with author prefix', () => {
    const input = {
      ...baseInput,
      comments: [
        {
          author: 'human' as const,
          kind: 'note' as const,
          body: 'Please investigate',
          createdAt: new Date('2026-01-01'),
        },
        {
          author: 'agent' as const,
          kind: 'note' as const,
          body: 'Found the issue',
          createdAt: new Date('2026-01-02'),
        },
        {
          author: 'human' as const,
          kind: 'note' as const,
          body: 'Good work',
          createdAt: new Date('2026-01-03'),
        },
      ],
    }
    const result = composePrompt(input)
    expect(result).toContain('**human:** Please investigate')
    expect(result).toContain('**agent:** Found the issue')
    expect(result).toContain('**human:** Good work')
    // Verify chronological order
    const humanFirst = result.indexOf('**human:** Please investigate')
    const agentIdx = result.indexOf('**agent:** Found the issue')
    const humanLast = result.indexOf('**human:** Good work')
    expect(humanFirst).toBeLessThan(agentIdx)
    expect(agentIdx).toBeLessThan(humanLast)
  })

  test('skips ## Discussion section when comments is empty', () => {
    const input = {
      ...baseInput,
      comments: [],
    }
    const result = composePrompt(input)
    expect(result).not.toContain('## Discussion')
  })

  test('includes ## Workspace charter with agentsMd', () => {
    const input = {
      ...baseInput,
      agentsMd: '# Custom Agents\n\nCustom agent text',
    }
    const result = composePrompt(input)
    expect(result).toContain('## Workspace charter')
    expect(result).toContain('# Custom Agents')
    expect(result).toContain('Custom agent text')
  })

  test('lists note filenames under ## Workspace memory', () => {
    const input = {
      ...baseInput,
      noteFiles: ['build-quirks.md', 'api-behavior.md'],
    }
    const result = composePrompt(input)
    expect(result).toContain('## Workspace memory')
    expect(result).toContain('build-quirks.md, api-behavior.md')
  })

  test('shows (none yet) when noteFiles is empty', () => {
    const input = {
      ...baseInput,
      noteFiles: [],
    }
    const result = composePrompt(input)
    expect(result).toContain('## Workspace memory')
    expect(result).toContain('(none yet)')
  })

  test('workspace memory instructs use of the write_memory_note tool, not direct file writes', () => {
    const result = composePrompt(baseInput)
    expect(result).toContain('write_memory_note')
    expect(result).not.toContain('record it as a')
    expect(result).not.toContain('new markdown note in ./memory/notes/.')
  })

  test('includes ## Global memory with agentsMd verbatim and note filenames', () => {
    const input = {
      ...baseInput,
      globalAgentsMd: '# Global Charter\n\nApplies everywhere.',
      globalNoteFiles: ['global-quirk.md', 'shared-creds.md'],
    }
    const result = composePrompt(input)
    expect(result).toContain('## Global memory')
    expect(result).toContain('# Global Charter')
    expect(result).toContain('Applies everywhere.')
    expect(result).toContain('global-quirk.md, shared-creds.md')
  })

  test('## Global memory shows (none yet) when globalNoteFiles is empty', () => {
    const result = composePrompt(baseInput)
    expect(result).toContain('## Global memory')
    expect(result).toContain('(none yet)')
  })

  test('skips ## Previous attempts when priorRuns is empty', () => {
    const input = {
      ...baseInput,
      priorRuns: [],
    }
    const result = composePrompt(input)
    expect(result).not.toContain('## Previous attempts')
  })

  test('includes ## Previous attempts with items numbered by attemptNumber when priorRuns have summaries', () => {
    const input = {
      ...baseInput,
      priorRuns: [
        {
          attemptNumber: 1,
          summary: 'First attempt: Tried approach A',
          startedAt: new Date('2026-01-01T00:00:00Z'),
          finishedAt: new Date('2026-01-01T01:00:00Z'),
        },
        {
          attemptNumber: 2,
          summary: 'Second attempt: Tried approach B',
          startedAt: new Date('2026-01-02T00:00:00Z'),
          finishedAt: new Date('2026-01-02T01:00:00Z'),
        },
      ],
    }
    const result = composePrompt(input)
    expect(result).toContain('## Previous attempts')
    expect(result).toContain('1. First attempt: Tried approach A')
    expect(result).toContain('2. Second attempt: Tried approach B')
  })

  test('## Previous attempts skips runs with no summary but keeps numbering by attemptNumber', () => {
    const input = {
      ...baseInput,
      priorRuns: [
        {
          attemptNumber: 1,
          summary: null,
          startedAt: new Date('2026-01-01T00:00:00Z'),
          finishedAt: new Date('2026-01-01T01:00:00Z'),
        },
        {
          attemptNumber: 2,
          summary: 'Second attempt succeeded partially',
          startedAt: new Date('2026-01-02T00:00:00Z'),
          finishedAt: new Date('2026-01-02T01:00:00Z'),
        },
      ],
    }
    const result = composePrompt(input)
    expect(result).toContain('2. Second attempt succeeded partially')
    expect(result).not.toContain('1. ')
  })

  test('includes ## How to work with exact template and ticket id interpolated', () => {
    const input = {
      ...baseInput,
      ticket: { id: 42, title: 'Test', description: 'Test description' },
    }
    const result = composePrompt(input)
    expect(result).toContain('## How to work')
    expect(result).toContain(
      'Your working directory contains a checkout per repo on branch ticket/42',
    )
    expect(result).toContain(
      'Post progress or findings to your ticket with the tada MCP tool `update_ticket`',
    )
    expect(result).toContain('Attach non-PR artifacts with `attach_link`/`attach_file`')
    expect(result).toContain(
      'When finished, you MUST call `report_outcome` with status success or failed and a concise summary',
    )
    expect(result).toContain(
      'Do not open pull requests yourself; the system handles that after you finish',
    )
  })

  test('always includes ## Workspace charter section', () => {
    const input = {
      ...baseInput,
      agentsMd: 'Some agents content',
    }
    const result = composePrompt(input)
    expect(result).toContain('## Workspace charter')
  })

  test('always includes ## Workspace memory section', () => {
    const input = {
      ...baseInput,
    }
    const result = composePrompt(input)
    expect(result).toContain('## Workspace memory')
  })

  test('always includes ## How to work section', () => {
    const input = {
      ...baseInput,
    }
    const result = composePrompt(input)
    expect(result).toContain('## How to work')
  })

  test('ends with report_outcome instruction', () => {
    const result = composePrompt(baseInput)
    expect(result).toContain('report_outcome')
    // Verify it's in the final section
    const howToWorkIdx = result.indexOf('## How to work')
    const reportIdx = result.indexOf('report_outcome')
    expect(reportIdx).toBeGreaterThan(howToWorkIdx)
  })

  test('full example with all sections', () => {
    const input = {
      ticket: { id: 7, title: 'Implement authentication', description: 'Add JWT-based auth' },
      comments: [
        {
          author: 'human' as const,
          kind: 'note' as const,
          body: 'Start with JWT',
          createdAt: new Date('2026-01-01'),
        },
        {
          author: 'agent' as const,
          kind: 'note' as const,
          body: 'JWT implemented',
          createdAt: new Date('2026-01-02'),
        },
      ],
      agentsMd: '# Agents\n\nAgent list',
      noteFiles: ['jwt-config.md'],
      globalAgentsMd: '# Global\n\nShared charter',
      globalNoteFiles: ['global-note.md'],
      priorRuns: [
        {
          attemptNumber: 1,
          summary: 'Initial attempt failed',
          startedAt: new Date('2025-12-31T00:00:00Z'),
          finishedAt: new Date('2025-12-31T01:00:00Z'),
        },
      ],
    }
    const result = composePrompt(input)

    expect(result).toContain('# Task: Implement authentication')
    expect(result).toContain('Add JWT-based auth')
    expect(result).toContain('## Discussion')
    expect(result).toContain('**human:** Start with JWT')
    expect(result).toContain('**agent:** JWT implemented')
    expect(result).toContain('## Workspace charter')
    expect(result).toContain('# Agents')
    expect(result).toContain('## Global memory')
    expect(result).toContain('# Global')
    expect(result).toContain('global-note.md')
    expect(result).toContain('## Workspace memory')
    expect(result).toContain('jwt-config.md')
    expect(result).toContain('## Previous attempts')
    expect(result).toContain('1. Initial attempt failed')
    expect(result).toContain('## How to work')
    expect(result).toContain('ticket/7')
  })

  test('single note filename renders without comma', () => {
    const input = {
      ...baseInput,
      noteFiles: ['single.md'],
    }
    const result = composePrompt(input)
    expect(result).toContain('single.md')
    // Should not have trailing comma
    expect(result).toContain('Notes available in ./memory/notes: single.md')
  })

  test('multiple note filenames render comma-separated', () => {
    const input = {
      ...baseInput,
      noteFiles: ['first.md', 'second.md', 'third.md'],
    }
    const result = composePrompt(input)
    expect(result).toContain('first.md, second.md, third.md')
  })

  test('maintains section order: heading, feedback, description, discussion, charter, global memory, memory, attempts, howto', () => {
    const input = {
      ticket: { id: 99, title: 'Test task', description: 'Test description' },
      comments: [
        { author: 'human' as const, kind: 'note' as const, body: 'Comment', createdAt: new Date() },
      ],
      agentsMd: 'Agents',
      noteFiles: ['note.md'],
      globalAgentsMd: 'Global agents',
      globalNoteFiles: ['global-note.md'],
      priorRuns: [
        {
          attemptNumber: 1,
          summary: 'Summary',
          startedAt: new Date('2026-01-01T00:00:00Z'),
          finishedAt: new Date('2026-01-01T01:00:00Z'),
        },
      ],
    }
    const result = composePrompt(input)

    const taskIdx = result.indexOf('# Task:')
    const descIdx = result.indexOf('Test description')
    const discussIdx = result.indexOf('## Discussion')
    const charterIdx = result.indexOf('## Workspace charter')
    const globalMemoryIdx = result.indexOf('## Global memory')
    const memoryIdx = result.indexOf('## Workspace memory')
    const attemptsIdx = result.indexOf('## Previous attempts')
    const howtoIdx = result.indexOf('## How to work')

    expect(taskIdx).toBeLessThan(descIdx)
    expect(descIdx).toBeLessThan(discussIdx)
    expect(discussIdx).toBeLessThan(charterIdx)
    expect(charterIdx).toBeLessThan(globalMemoryIdx)
    expect(globalMemoryIdx).toBeLessThan(memoryIdx)
    expect(memoryIdx).toBeLessThan(attemptsIdx)
    expect(attemptsIdx).toBeLessThan(howtoIdx)
  })

  describe('send-back feedback', () => {
    const priorRun: PromptRun = {
      attemptNumber: 1,
      summary: 'Tried approach A',
      startedAt: new Date('2026-01-01T00:00:00Z'),
      finishedAt: new Date('2026-01-01T01:00:00Z'),
    }

    test('feedback left after the prior attempt finished renders as the first section after the title', () => {
      const input = {
        ...baseInput,
        priorRuns: [priorRun],
        comments: [
          {
            author: 'human' as const,
            kind: 'feedback' as const,
            body: 'Please also handle the edge case where the token is expired.',
            createdAt: new Date('2026-01-01T02:00:00Z'), // after finishedAt
          },
        ],
      }
      const result = composePrompt(input)

      expect(result).toContain('## Your feedback on attempt 1')
      expect(result).toContain('Please also handle the edge case where the token is expired.')

      const titleIdx = result.indexOf('# Task:')
      const feedbackIdx = result.indexOf('## Your feedback on attempt 1')
      const descIdx = result.indexOf(baseInput.ticket.description)
      expect(titleIdx).toBeLessThan(feedbackIdx)
      expect(feedbackIdx).toBeLessThan(descIdx)
    })

    test('feedback left before the prior attempt finished (already addressed) is not surfaced as a section', () => {
      const input = {
        ...baseInput,
        priorRuns: [priorRun],
        comments: [
          {
            author: 'human' as const,
            kind: 'feedback' as const,
            body: 'Old feedback, already addressed',
            createdAt: new Date('2026-01-01T00:30:00Z'), // before finishedAt
          },
        ],
      }
      const result = composePrompt(input)
      expect(result).not.toContain('## Your feedback on attempt')
    })

    test('only the latest feedback comment is surfaced as a section', () => {
      const input = {
        ...baseInput,
        priorRuns: [priorRun],
        comments: [
          {
            author: 'human' as const,
            kind: 'feedback' as const,
            body: 'Earlier feedback',
            createdAt: new Date('2026-01-01T02:00:00Z'),
          },
          {
            author: 'human' as const,
            kind: 'feedback' as const,
            body: 'Latest feedback',
            createdAt: new Date('2026-01-01T03:00:00Z'),
          },
        ],
      }
      const result = composePrompt(input)
      expect(result).toContain('## Your feedback on attempt 1\n\nLatest feedback')
    })

    test('no feedback section when there are no prior runs', () => {
      const input = {
        ...baseInput,
        priorRuns: [],
        comments: [
          {
            author: 'human' as const,
            kind: 'feedback' as const,
            body: 'Feedback with nothing to critique',
            createdAt: new Date(),
          },
        ],
      }
      const result = composePrompt(input)
      expect(result).not.toContain('## Your feedback on attempt')
    })
  })

  describe('nudge comments', () => {
    test('a nudge comment during an attempt is labeled with that attempt number in Discussion', () => {
      const input = {
        ...baseInput,
        priorRuns: [
          {
            attemptNumber: 1,
            summary: 'Tried approach A',
            startedAt: new Date('2026-01-01T00:00:00Z'),
            finishedAt: new Date('2026-01-01T01:00:00Z'),
          },
          {
            attemptNumber: 2,
            summary: null,
            startedAt: new Date('2026-01-02T00:00:00Z'),
            finishedAt: new Date('2026-01-02T01:00:00Z'),
          },
        ],
        comments: [
          {
            author: 'human' as const,
            kind: 'nudge' as const,
            body: 'Check the auth middleware too',
            createdAt: new Date('2026-01-02T00:30:00Z'), // during attempt 2
          },
        ],
      }
      const result = composePrompt(input)
      expect(result).toContain('**human:** Check the auth middleware too (nudge during attempt 2)')
    })

    test('note-kind comments are not labeled as nudges', () => {
      const input = {
        ...baseInput,
        priorRuns: [
          {
            attemptNumber: 1,
            summary: 'Tried approach A',
            startedAt: new Date('2026-01-01T00:00:00Z'),
            finishedAt: new Date('2026-01-01T01:00:00Z'),
          },
        ],
        comments: [
          {
            author: 'human' as const,
            kind: 'note' as const,
            body: 'Just a regular note',
            createdAt: new Date('2026-01-01T00:30:00Z'),
          },
        ],
      }
      const result = composePrompt(input)
      expect(result).toContain('**human:** Just a regular note')
      expect(result).not.toContain('(nudge during attempt')
    })
  })
})
