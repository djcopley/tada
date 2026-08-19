import { night } from '../src/design/tokens'
import { phaseChrome, progressValue, timerBounds, WIDGET_INK } from '../src/liveActivity/chrome'
import {
  actionRequest,
  failedProps,
  optimisticProps,
  parseTarget,
} from '../src/liveActivity/interactions'

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

test('a button target round-trips to the run and action it was drawn from', () => {
  expect(parseTarget('4128:approve:')).toEqual({
    runId: 4128,
    action: { kind: 'approve', label: 'Approve' },
  })
  expect(parseTarget('4128:answer:Postgres')).toEqual({
    runId: 4128,
    action: { kind: 'answer', label: 'Postgres', value: 'Postgres' },
  })
})

test('an answer value containing a colon still round-trips — only the first two colons split', () => {
  expect(parseTarget('4128:answer:use https://example.com')).toEqual({
    runId: 4128,
    action: { kind: 'answer', label: 'use https://example.com', value: 'use https://example.com' },
  })
})

test('an unparseable target, an empty answer, and a non-numeric run id all yield null', () => {
  expect(parseTarget('nonsense')).toBeNull()
  expect(parseTarget('4128:nonsense:')).toBeNull()
  expect(parseTarget('4128:answer:')).toBeNull()
  expect(parseTarget('notanid:approve:')).toBeNull()
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

test('the optimistic state clears the buttons and says the tap is in flight', () => {
  expect(optimisticProps(props)).toEqual({
    ...props,
    phase: 'working',
    agentLine: 'sending…',
    actions: [],
  })
})

test('the failed state admits it could not reach the server, with one way out', () => {
  expect(failedProps(props)).toEqual({
    ...props,
    phase: 'failed',
    agentLine: "couldn't reach tada — open the app",
    actions: [{ kind: 'open', label: 'Open' }],
  })
})
