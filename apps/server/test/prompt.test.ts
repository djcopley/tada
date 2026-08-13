import { describe, expect, test } from 'vitest'
import { composePrompt } from '../src/runs/prompt.js'

describe('composePrompt', () => {
  const baseInput = {
    ticket: { id: 42, title: 'Fix login bug', description: 'Users cannot log in on mobile.' },
    comments: [],
    agentsMd: '# Agents\n\nAgent definitions here.',
    noteFiles: [] as string[],
    priorRunSummaries: [] as string[],
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
        { author: 'human' as const, body: 'Please investigate', createdAt: new Date('2026-01-01') },
        { author: 'agent' as const, body: 'Found the issue', createdAt: new Date('2026-01-02') },
        { author: 'human' as const, body: 'Good work', createdAt: new Date('2026-01-03') },
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

  test('includes exact memory instruction sentence with ticket id interpolated', () => {
    const input = {
      ...baseInput,
      ticket: { id: 42, title: 'Test', description: 'Test description' },
    }
    const result = composePrompt(input)
    // The exact sentence from the brief
    expect(result).toContain(
      'Read notes relevant to this task. If you learn something durable about this\nworkspace (a build quirk, credential location, API behavior), record it as a\nnew markdown note in ./memory/notes/.',
    )
  })

  test('skips ## Previous attempts when priorRunSummaries is empty', () => {
    const input = {
      ...baseInput,
      priorRunSummaries: [],
    }
    const result = composePrompt(input)
    expect(result).not.toContain('## Previous attempts')
  })

  test('includes ## Previous attempts with numbered items when priorRunSummaries is non-empty', () => {
    const input = {
      ...baseInput,
      priorRunSummaries: ['First attempt: Tried approach A', 'Second attempt: Tried approach B'],
    }
    const result = composePrompt(input)
    expect(result).toContain('## Previous attempts')
    expect(result).toContain('1. First attempt: Tried approach A')
    expect(result).toContain('2. Second attempt: Tried approach B')
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
        { author: 'human' as const, body: 'Start with JWT', createdAt: new Date('2026-01-01') },
        { author: 'agent' as const, body: 'JWT implemented', createdAt: new Date('2026-01-02') },
      ],
      agentsMd: '# Agents\n\nAgent list',
      noteFiles: ['jwt-config.md'],
      priorRunSummaries: ['Initial attempt failed'],
    }
    const result = composePrompt(input)

    expect(result).toContain('# Task: Implement authentication')
    expect(result).toContain('Add JWT-based auth')
    expect(result).toContain('## Discussion')
    expect(result).toContain('**human:** Start with JWT')
    expect(result).toContain('**agent:** JWT implemented')
    expect(result).toContain('## Workspace charter')
    expect(result).toContain('# Agents')
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

  test('maintains section order: heading, description, discussion, charter, memory, attempts, howtow', () => {
    const input = {
      ticket: { id: 99, title: 'Test task', description: 'Test description' },
      comments: [{ author: 'human' as const, body: 'Comment', createdAt: new Date() }],
      agentsMd: 'Agents',
      noteFiles: ['note.md'],
      priorRunSummaries: ['Summary'],
    }
    const result = composePrompt(input)

    const taskIdx = result.indexOf('# Task:')
    const descIdx = result.indexOf('Test description')
    const discussIdx = result.indexOf('## Discussion')
    const charterIdx = result.indexOf('## Workspace charter')
    const memoryIdx = result.indexOf('## Workspace memory')
    const attemptsIdx = result.indexOf('## Previous attempts')
    const howtoIdx = result.indexOf('## How to work')

    expect(taskIdx).toBeLessThan(descIdx)
    expect(descIdx).toBeLessThan(discussIdx)
    expect(discussIdx).toBeLessThan(charterIdx)
    expect(charterIdx).toBeLessThan(memoryIdx)
    expect(memoryIdx).toBeLessThan(attemptsIdx)
    expect(attemptsIdx).toBeLessThan(howtoIdx)
  })
})
