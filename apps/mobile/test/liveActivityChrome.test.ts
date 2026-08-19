import { night } from '../src/design/tokens'
import { phaseChrome, progressValue, timerBounds, WIDGET_INK } from '../src/liveActivity/chrome'
import type { ApiRun, ApiTicket } from '@tada/shared'
import { actionRequest, focusedActivityProps, parseTarget, pickFocusedTicket } from '../src/liveActivity/interactions'

test('orange is live for both working and your turn', () => {
  expect(phaseChrome('working').dot).toBe(night.live)
  expect(phaseChrome('yourTurn').dot).toBe(night.live)
})

test('sage is done and red is failure, and nothing else has a color', () => {
  expect(phaseChrome('done').dot).toBe(night.ok)
  expect(phaseChrome('failed').dot).toBe(night.fail)
})

test('each phase names itself in the compact presentation', () => {
  expect(phaseChrome('yourTurn').label).toBe('your turn')
  expect(phaseChrome('done').label).toBe('done')
  expect(phaseChrome('failed').label).toBe('failed')
  // working has no label: the compact trailing draws a live timer instead.
  expect(phaseChrome('working').label).toBe('')
})

test('every widget color is opaque — SwiftUI takes 6-digit hex only', () => {
  for (const [name, value] of Object.entries(WIDGET_INK)) {
    expect(`${name}=${value}`).toMatch(/=#[0-9A-Fa-f]{6}$/)
  }
})

test('a real budget bounds the timer at its own end', () => {
  const startedAt = 1_000_000
  const budgetEndsAt = 1_000_000 + 60 * 60 * 1000
  expect(timerBounds(startedAt, budgetEndsAt).upper).toEqual(new Date(budgetEndsAt))
})

test('an absent budget bounds the timer far beyond startedAt, not at it', () => {
  const startedAt = 1_000_000
  const { upper } = timerBounds(startedAt, undefined)
  // Not frozen at (or near) startedAt — the whole bug was upper collapsing onto lower.
  expect(upper.getTime() - startedAt).toBeGreaterThan(24 * 60 * 60 * 1000)
})

test('progress is clamped to [0, 1] against clock skew', () => {
  const now = Date.now()
  // startedAt in the future relative to "now" would otherwise go negative.
  expect(progressValue(now + 60_000, now + 120_000)).toBe(0)
  // Elapsed well past budgetEndsAt would otherwise exceed 1 before the outer Math.min.
  expect(progressValue(now - 120_000, now - 60_000)).toBe(1)
})

const props = {
  runId: 4128, ticketId: 7, title: 't', phase: 'yourTurn' as const,
  agentLine: 'l', startedAt: 0, actions: [],
}

test('a button target round-trips to the action it was drawn from', () => {
  expect(parseTarget('approve:')).toEqual({ kind: 'approve', label: 'Approve' })
  expect(parseTarget('answer:Postgres')).toEqual({ kind: 'answer', label: 'Postgres', value: 'Postgres' })
  expect(parseTarget('nonsense')).toBeNull()
})

test('each action names the route it calls', () => {
  expect(actionRequest(props, { kind: 'approve', label: 'Approve' })).toEqual({
    path: '/runs/4128/approve',
    body: { alwaysAllow: false },
  })
  expect(actionRequest(props, { kind: 'deny', label: 'Deny' })).toEqual({
    path: '/runs/4128/deny',
    body: { note: 'denied from the lock screen' },
  })
  expect(actionRequest(props, { kind: 'answer', label: 'Postgres', value: 'Postgres' })).toEqual({
    path: '/runs/4128/answer',
    body: { answer: 'Postgres' },
  })
  expect(actionRequest(props, { kind: 'stop', label: 'Stop' })).toEqual({
    path: '/runs/4128/cancel',
    body: {},
  })
  // Re-run is filed against the ticket, not the run — which is why ticketId rides in the props.
  expect(actionRequest(props, { kind: 'rerun', label: 'Re-run' })).toEqual({
    path: '/tickets/7/rerun',
    body: {},
  })
  expect(actionRequest(props, { kind: 'open', label: 'Open' })).toBeNull()
})

function run(overrides: Partial<ApiRun>): ApiRun {
  return {
    id: 1,
    ticketId: 1,
    adapter: 'claude',
    model: 'opus',
    effort: 'high',
    attemptNumber: 1,
    status: 'running',
    heldReason: null,
    hold: null,
    heldAt: null,
    budgetMs: 0,
    summary: null,
    diffAdditions: null,
    diffDeletions: null,
    testsPassed: null,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date(0).toISOString(),
    ...overrides,
  }
}

function ticket(overrides: Partial<ApiTicket>): ApiTicket {
  return {
    id: 1,
    column: 'running',
    title: 'a ticket',
    description: '',
    position: 0,
    repoTags: [],
    origin: 'human',
    proposalState: null,
    followUpOfTicketId: null,
    createdAt: new Date(0).toISOString(),
    doneAt: null,
    run: null,
    ...overrides,
  }
}

test('a held run outranks a merely-running one, regardless of order', () => {
  const running = ticket({ id: 1, run: run({ id: 10, ticketId: 1, status: 'running' }) })
  const held = ticket({ id: 2, run: run({ id: 20, ticketId: 2, status: 'held' }) })
  expect(pickFocusedTicket([running, held])?.id).toBe(2)
  expect(pickFocusedTicket([held, running])?.id).toBe(2)
})

test('between two equally-ranked runs, the most recently started wins', () => {
  const older = ticket({
    id: 1,
    run: run({ id: 10, ticketId: 1, status: 'running', startedAt: new Date(1000).toISOString() }),
  })
  const newer = ticket({
    id: 2,
    run: run({ id: 20, ticketId: 2, status: 'running', startedAt: new Date(2000).toISOString() }),
  })
  expect(pickFocusedTicket([older, newer])?.id).toBe(2)
})

test('a ticket with no run, or a queued/done/failed one, is never focused', () => {
  const idle = ticket({ id: 1, run: null })
  const queued = ticket({ id: 2, run: run({ id: 20, ticketId: 2, status: 'queued' }) })
  expect(pickFocusedTicket([idle, queued])).toBeNull()
})

test('focusedActivityProps rebuilds the focused ticket into the shape the server pushes', () => {
  const held = ticket({
    id: 7,
    title: 'fix the thing',
    run: run({
      id: 4128,
      ticketId: 7,
      status: 'held',
      hold: { reason: 'question', question: 'which db?', options: ['Postgres', 'SQLite'] },
      startedAt: new Date(1000).toISOString(),
    }),
  })
  expect(focusedActivityProps([held])).toEqual({
    runId: 4128,
    ticketId: 7,
    title: 'fix the thing',
    phase: 'yourTurn',
    agentLine: 'which db?',
    startedAt: 1000,
    actions: [
      { kind: 'answer', label: 'Postgres', value: 'Postgres' },
      { kind: 'answer', label: 'SQLite', value: 'SQLite' },
    ],
  })
})
