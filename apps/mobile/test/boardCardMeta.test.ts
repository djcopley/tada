import type { ApiRun, ApiTicket, ApiWorkspaceDetail } from '@tada/shared'
import {
  agentWellText,
  doneMeta,
  followUpOfLabel,
  isProposalTicket,
  minimalCardMeta,
  nextUpMeta,
  primarySourceName,
  retryMeta,
  reviewMeta,
} from '../src/board/cardMeta'

const NOW = new Date('2026-08-15T12:00:00.000Z').getTime()

function workspace(overrides: Partial<ApiWorkspaceDetail> = {}): ApiWorkspaceDetail {
  return {
    id: 1,
    name: 'parlor',
    defaultAdapter: 'claude',
    defaultModel: 'sonnet',
    defaultEffort: 'default',
    concurrency: 1,
    timeoutMs: 60_000,
    createdAt: '2026-01-01T00:00:00.000Z',
    sources: [{ type: 'repo', name: 'parlor-api' }],
    ...overrides,
  }
}

function ticket(overrides: Partial<ApiTicket> = {}): ApiTicket {
  return {
    id: 1,
    workspaceId: 1,
    columnId: 1,
    title: 'Migrate icon set to Lucide',
    description: '',
    position: 1,
    queueState: null,
    adapterOverride: null,
    modelOverride: null,
    effortOverride: null,
    origin: 'human',
    proposalState: null,
    followUpOfTicketId: null,
    createdAt: '2026-08-13T12:00:00.000Z',
    ...overrides,
  }
}

function run(overrides: Partial<ApiRun> = {}): ApiRun {
  return {
    id: 1,
    ticketId: 1,
    adapter: 'claude',
    model: 'sonnet',
    effort: 'default',
    attemptNumber: 1,
    status: 'running',
    branch: null,
    prUrl: null,
    summary: null,
    diffAdditions: null,
    diffDeletions: null,
    testsPassed: null,
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-08-13T12:00:00.000Z',
    ...overrides,
  }
}

describe('primarySourceName', () => {
  test('the first attached source', () => {
    expect(primarySourceName(workspace())).toBe('parlor-api')
  })
  test('undefined when there are no sources', () => {
    expect(primarySourceName(workspace({ sources: [] }))).toBeUndefined()
  })
})

describe('minimalCardMeta', () => {
  test('source · age', () => {
    expect(minimalCardMeta(workspace(), ticket({ createdAt: '2026-08-13T12:00:00.000Z' }), NOW)).toBe(
      'parlor-api · 2d',
    )
  })
  test('bare age when there is no source', () => {
    expect(minimalCardMeta(workspace({ sources: [] }), ticket({ createdAt: '2026-08-13T12:00:00.000Z' }), NOW)).toBe(
      '2d',
    )
  })
})

describe('nextUpMeta', () => {
  test('source · next up', () => {
    expect(nextUpMeta(workspace())).toBe('parlor-api · next up')
  })
})

describe('retryMeta', () => {
  test('null with no prior run', () => {
    expect(retryMeta(undefined)).toBeNull()
  })
  test('the attempt about to run, one past the failed attempt', () => {
    expect(retryMeta(run({ attemptNumber: 1, status: 'failed' }))).toBe('retry · attempt 2')
  })
})

describe('reviewMeta', () => {
  test('empty with no run', () => {
    expect(reviewMeta(undefined)).toBe('')
  })
  test('attempt only when there is no pr and no passing tests', () => {
    expect(reviewMeta(run({ attemptNumber: 1 }))).toBe('attempt 1')
  })
  test('attempt, pr, and tests pass', () => {
    expect(
      reviewMeta(run({ attemptNumber: 2, prUrl: 'https://github.com/x/y/pull/481', testsPassed: 12 })),
    ).toBe('attempt 2 · pr #481 · tests pass')
  })
  test('omits "tests pass" when testsPassed is zero', () => {
    expect(reviewMeta(run({ attemptNumber: 2, testsPassed: 0 }))).toBe('attempt 2')
  })
})

describe('doneMeta', () => {
  test('pr merged · age when the run has a pr', () => {
    const finished = run({ prUrl: 'https://github.com/x/y/pull/468', finishedAt: '2026-08-08T12:00:00.000Z' })
    expect(doneMeta(workspace(), finished, ticket(), NOW)).toBe('pr #468 merged · 1w')
  })
  test('no pr · <workspace> task · age when the run shipped no pr', () => {
    const finished = run({ prUrl: null, finishedAt: '2026-08-08T12:00:00.000Z' })
    expect(doneMeta(workspace({ name: 'Ops' }), finished, ticket(), NOW)).toBe('no pr · ops task · 1w')
  })
  test('falls back to the ticket createdAt with no run at all', () => {
    expect(doneMeta(workspace(), undefined, ticket({ createdAt: '2026-08-08T12:00:00.000Z' }), NOW)).toBe(
      'no pr · parlor task · 1w',
    )
  })
})

describe('followUpOfLabel', () => {
  test('undefined with no resolvable parent', () => {
    expect(followUpOfLabel(undefined)).toBeUndefined()
  })
  test('lowercases the parent title', () => {
    expect(followUpOfLabel('Add CSV Export')).toBe('follow-up of add csv export')
  })
})

describe('agentWellText', () => {
  test('undefined with no detail', () => {
    expect(agentWellText(undefined)).toBeUndefined()
  })
  test('the last agent comment body', () => {
    expect(
      agentWellText({
        comments: [
          { id: 1, ticketId: 1, author: 'human', kind: 'note', body: 'hi', createdAt: '2026-01-01T00:00:00.000Z' },
          { id: 2, ticketId: 1, author: 'agent', kind: 'note', body: 'suite ×20 — all green so far', createdAt: '2026-01-01T00:00:00.000Z' },
        ],
        runs: [],
      }),
    ).toBe('suite ×20 — all green so far')
  })
  test('falls back to the latest run summary with no agent comment', () => {
    expect(agentWellText({ comments: [], runs: [run({ summary: 'reading src/auth.ts' })] })).toBe(
      'reading src/auth.ts',
    )
  })
  test('undefined with neither', () => {
    expect(agentWellText({ comments: [], runs: [] })).toBeUndefined()
  })
})

describe('isProposalTicket', () => {
  test('true for a pending agent proposal', () => {
    expect(isProposalTicket(ticket({ origin: 'agent', proposalState: 'pending' }))).toBe(true)
  })
  test('false for a human ticket', () => {
    expect(isProposalTicket(ticket({ origin: 'human', proposalState: null }))).toBe(false)
  })
  test('false for an agent ticket that is not (or no longer) pending', () => {
    expect(isProposalTicket(ticket({ origin: 'agent', proposalState: null }))).toBe(false)
  })
})
