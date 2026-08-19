import { describe, expect, test } from 'vitest'
import type { Hold } from '../src/domain.js'
import { runToActivityProps } from '../src/liveActivity.js'

const ticket = { id: 7, title: 'Add CSV export to the reports page' }
const base = {
  id: 4128,
  startedAt: new Date('2026-08-18T03:02:00Z'),
  budgetMs: 1_800_000,
  hold: null as Hold | null,
}
const now = new Date('2026-08-18T03:14:00Z')

test('a running run is working, with no actions', () => {
  const props = runToActivityProps({
    ticket,
    run: { ...base, status: 'running' },
    line: 'writing the export query',
    now,
  })
  expect(props).toEqual({
    runId: 4128,
    ticketId: 7,
    title: 'Add CSV export to the reports page',
    phase: 'working',
    agentLine: 'writing the export query',
    startedAt: base.startedAt.getTime(),
    budgetEndsAt: base.startedAt.getTime() + 1_800_000,
    actions: [],
  })
})

test('a permission hold is your turn, and offers approve and deny', () => {
  const hold: Hold = {
    reason: 'permission',
    tool: 'Bash',
    summary: 'git push origin main',
    ruleId: 3,
    ruleTitle: 'push a branch',
    publishes: true,
  }
  const props = runToActivityProps({
    ticket,
    run: { ...base, status: 'held', hold },
    line: null,
    now,
  })
  expect(props?.phase).toBe('yourTurn')
  expect(props?.agentLine).toBe('wants to: push a branch — git push origin main')
  expect(props?.actions).toEqual([
    { kind: 'approve', label: 'Approve' },
    { kind: 'deny', label: 'Deny' },
  ])
})

test('a question hold offers at most two of its own options', () => {
  const hold: Hold = {
    reason: 'question',
    question: 'which store?',
    options: ['Postgres', 'SQLite', 'Redis'],
  }
  const props = runToActivityProps({
    ticket,
    run: { ...base, status: 'held', hold },
    line: null,
    now,
  })
  expect(props?.agentLine).toBe('which store?')
  expect(props?.actions).toEqual([
    { kind: 'answer', label: 'Postgres', value: 'Postgres' },
    { kind: 'answer', label: 'SQLite', value: 'SQLite' },
  ])
})

test('a question hold with no options falls back to opening the app', () => {
  const hold: Hold = { reason: 'question', question: 'what now?', options: [] }
  const props = runToActivityProps({
    ticket,
    run: { ...base, status: 'held', hold },
    line: null,
    now,
  })
  expect(props?.actions).toEqual([{ kind: 'open', label: 'Open' }])
})

test('a time hold offers continue and stop', () => {
  const hold: Hold = { reason: 'time', budgetMs: 1_800_000 }
  const props = runToActivityProps({
    ticket,
    run: { ...base, status: 'held', hold },
    line: null,
    now,
  })
  expect(props?.agentLine).toContain('out of time')
  expect(props?.actions).toEqual([
    { kind: 'continue', label: 'Continue' },
    { kind: 'stop', label: 'Stop' },
  ])
})

test('done and failed carry their summary; failed offers re-run', () => {
  const done = runToActivityProps({
    ticket,
    run: { ...base, status: 'done' },
    line: 'merged pr #481',
    now,
  })
  expect(done?.phase).toBe('done')
  expect(done?.actions).toEqual([])

  const failed = runToActivityProps({
    ticket,
    run: { ...base, status: 'failed' },
    line: 'reports.spec.ts:214 — expected 50 rows, got 0',
    now,
  })
  expect(failed?.phase).toBe('failed')
  expect(failed?.actions).toEqual([
    { kind: 'rerun', label: 'Re-run' },
    { kind: 'open', label: 'Open' },
  ])
})

test('queued and cancelled runs own no card', () => {
  expect(
    runToActivityProps({ ticket, run: { ...base, status: 'queued' }, line: null, now }),
  ).toBeNull()
  expect(
    runToActivityProps({ ticket, run: { ...base, status: 'cancelled' }, line: null, now }),
  ).toBeNull()
})

test('a run with no startedAt times from now, and a zero budget shows no bar', () => {
  const props = runToActivityProps({
    ticket,
    run: { ...base, status: 'running', startedAt: null, budgetMs: 0 },
    line: null,
    now,
  })
  expect(props?.startedAt).toBe(now.getTime())
  expect(props?.budgetEndsAt).toBeUndefined()
})

describe('agentLine never runs to two lines', () => {
  test('a long line is truncated with an ellipsis', () => {
    const props = runToActivityProps({
      ticket,
      run: { ...base, status: 'running' },
      line: 'x'.repeat(200),
      now,
    })
    expect(props?.agentLine.length).toBeLessThanOrEqual(120)
    expect(props?.agentLine.endsWith('…')).toBe(true)
  })
})
