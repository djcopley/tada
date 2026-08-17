import type { ApiRun, ApiTicket } from '@tada/shared'
import {
  allowedMoveTargets,
  canDropInto,
  doneMeta,
  followUpOfLabel,
  heldGroupTitle,
  laneCount,
  minimalMeta,
  nextUpMeta,
  repoLabel,
  stoppedBadge,
  stoppedWell,
} from '../src/board/cardMeta'

const NOW = new Date('2026-08-17T12:00:00.000Z').getTime()

function run(overrides: Partial<ApiRun>): ApiRun {
  return {
    id: 4128,
    ticketId: 1,
    adapter: 'claude',
    model: 'sonnet',
    effort: 'medium',
    attemptNumber: 1,
    status: 'queued',
    heldReason: null,
    hold: null,
    heldAt: null,
    budgetMs: 1_800_000,
    summary: null,
    diffAdditions: null,
    diffDeletions: null,
    testsPassed: null,
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-08-17T09:00:00.000Z',
    ...overrides,
  }
}

function ticket(overrides: Partial<ApiTicket> = {}): ApiTicket {
  return {
    id: 1,
    column: 'backlog',
    title: 'Migrate icon set to Lucide',
    description: '',
    position: 1,
    repoTags: [],
    origin: 'human',
    proposalState: null,
    followUpOfTicketId: null,
    createdAt: '2026-08-15T12:00:00.000Z',
    doneAt: null,
    run: null,
    ...overrides,
  }
}

const permissionHold = {
  reason: 'permission' as const,
  tool: 'Bash',
  summary: 'gh pr create --base main --head csv-export',
  ruleId: 3,
  ruleTitle: 'Open a pull request',
  publishes: true,
}

describe('lane headers', () => {
  test('done spells out self-filed and the undo window', () => {
    expect(laneCount('backlog', 3)).toBe('3')
    expect(laneCount('done', 3)).toBe('3 · self-filed · undo for 24h')
  })
})

describe('card meta', () => {
  test('repo tags are the prefix; a tagless ticket says no repo', () => {
    expect(repoLabel(ticket())).toBe('no repo')
    expect(repoLabel(ticket({ repoTags: ['parlor-web'] }))).toBe('parlor-web')
    expect(minimalMeta(ticket({ repoTags: ['parlor-web'] }), NOW)).toBe('parlor-web · 2d')
    expect(nextUpMeta(ticket({ repoTags: ['parlor-api'] }))).toBe('parlor-api · next up')
  })

  test('done meta: a run that filed itself today reads "moved itself · HH:MM", else the age', () => {
    const doneAt = new Date(NOW - 60 * 60 * 1000).toISOString()
    const d = new Date(doneAt)
    const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    expect(doneMeta(ticket({ column: 'done', repoTags: ['parlor-api'], doneAt, run: run({ status: 'done' }) }), NOW)).toBe(
      `parlor-api · moved itself · ${hhmm}`,
    )
    const lastWeek = new Date(NOW - 7 * 24 * 60 * 60 * 1000).toISOString()
    expect(doneMeta(ticket({ column: 'done', repoTags: ['ops'], doneAt: lastWeek }), NOW)).toBe('ops · 1w')
  })

  test('follow-up label lowercases the parent title', () => {
    expect(followUpOfLabel('Add CSV export')).toBe('follow-up of add csv export')
    expect(followUpOfLabel(undefined)).toBeUndefined()
  })
})

describe('stopped cards', () => {
  test('permission hold: ⏸ command · held Xm, live orange', () => {
    const heldAt = new Date(NOW - 134 * 60_000).toISOString()
    const r = run({ status: 'held', heldReason: 'permission', hold: permissionHold, heldAt })
    expect(stoppedWell(r, NOW)).toEqual({ glyph: '⏸', text: 'gh pr create --base main --head csv-export · held 2h 14m', live: true })
    expect(stoppedBadge(r)).toEqual({ label: 'permission', failed: false })
    expect(heldGroupTitle(r)).toBe('Held at gh pr create --base main --head csv-expo')
  })

  test('question and time holds', () => {
    const q = run({ status: 'held', heldReason: 'question', hold: { reason: 'question', question: 'which backoff?', options: ['30s', '5m'] } })
    expect(stoppedWell(q, NOW)).toEqual({ glyph: '?', text: 'which backoff?', live: false })
    expect(stoppedBadge(q)?.label).toBe('question')
    const t = run({ status: 'held', heldReason: 'time', hold: { reason: 'time', budgetMs: 1_800_000 } })
    expect(stoppedWell(t, NOW)).toEqual({ glyph: '⏸', text: '30m limit · context kept', live: false })
    expect(stoppedBadge(t)?.label).toBe('out of time')
    expect(heldGroupTitle(t)).toBe('Out of time')
  })

  test('failure is the only red', () => {
    const f = run({ status: 'failed', summary: 'playwright install failed twice' })
    expect(stoppedWell(f, NOW)).toEqual({ glyph: '✕', text: 'playwright install failed twice', live: false })
    expect(stoppedBadge(f)).toEqual({ label: 'failed', failed: true })
    expect(stoppedWell(run({ status: 'running' }), NOW)).toBeNull()
  })
})

describe('move rules mirror the server', () => {
  test('a backlog card may go to queued or done; done card can be undone', () => {
    expect(allowedMoveTargets(ticket())).toEqual(['queued', 'done'])
    expect(allowedMoveTargets(ticket({ column: 'done' }))).toEqual(['backlog', 'queued'])
  })

  test('a live run owns the card: only backlog (stop) is offered', () => {
    const held = ticket({ column: 'stopped', run: run({ status: 'held', heldReason: 'permission', hold: permissionHold }) })
    expect(allowedMoveTargets(held)).toEqual(['backlog'])
    expect(canDropInto(held, 'queued')).toBe(false)
    expect(canDropInto(held, 'backlog')).toBe(true)
    // a failed card is free again
    const failed = ticket({ column: 'stopped', run: run({ status: 'failed' }) })
    expect(allowedMoveTargets(failed)).toEqual(['backlog', 'queued', 'done'])
  })

  test('a pending proposal cannot be queued; nobody drops into running or stopped', () => {
    const p = ticket({ origin: 'agent', proposalState: 'pending' })
    expect(allowedMoveTargets(p)).toEqual(['done'])
    expect(canDropInto(ticket(), 'running')).toBe(false)
    expect(canDropInto(ticket(), 'stopped')).toBe(false)
    expect(canDropInto(ticket({ column: 'queued' }), 'queued')).toBe(true)
  })
})
