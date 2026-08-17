import type { ApiRunEvent } from '@tada/shared'
import {
  atPublishGate,
  gateCopy,
  gateFacts,
  gateTitle,
  lineTone,
  linesFrom,
  narrationText,
  runHeaderBadge,
  runMetaLine,
  terminalLine,
} from '../src/runActivity'

const ev = (type: ApiRunEvent['type'], payload: unknown, id = 1): ApiRunEvent => ({
  id,
  runId: 4,
  type,
  payload,
  createdAt: '2026-01-01T09:41:00.000Z',
})

describe('runMetaLine', () => {
  test('repo tags · run #id, or "no repo"', () => {
    expect(runMetaLine(['parlor-web'], 4128)).toBe('parlor-web · run #4128')
    expect(runMetaLine([], 7)).toBe('no repo · run #7')
  })
})

describe('runHeaderBadge', () => {
  const t0 = new Date('2026-01-01T00:00:00Z').getTime()
  test('running is live with elapsed; held is live with held-since; terminal states are words', () => {
    expect(runHeaderBadge({ status: 'running', startedAt: new Date(t0).toISOString(), heldAt: null }, t0 + 12 * 60_000)).toEqual({
      status: 'live',
      label: 'live · 12m',
    })
    expect(
      runHeaderBadge({ status: 'held', startedAt: new Date(t0).toISOString(), heldAt: new Date(t0 + 60_000).toISOString() }, t0 + 135 * 60_000),
    ).toEqual({ status: 'live', label: 'held · 2h 14m' })
    expect(runHeaderBadge({ status: 'done', startedAt: null, heldAt: null }, t0)).toEqual({ status: 'accepted', label: 'done' })
    expect(runHeaderBadge({ status: 'failed', startedAt: null, heldAt: null }, t0)).toEqual({ status: 'failed', label: 'failed' })
    expect(runHeaderBadge({ status: 'cancelled', startedAt: null, heldAt: null }, t0)).toEqual({ status: 'neutral', label: 'stopped' })
    expect(runHeaderBadge(undefined, t0)).toBeNull()
  })
})

describe('narrationText', () => {
  test('text, error, status transitions and outcomes', () => {
    expect(narrationText(ev('text', { text: 'read memory · 4 notes' }))).toBe('read memory · 4 notes')
    expect(narrationText(ev('error', { message: 'boom' }))).toBe('boom')
    expect(narrationText(ev('status', { kind: 'run_status', status: 'held' }))).toBe('stopped — waiting on you')
    expect(narrationText(ev('status', { kind: 'run_status', status: 'done' }))).toBe('finished and moved itself to done')
    expect(narrationText(ev('status', { kind: 'outcome', status: 'success', summary: 'ok' }))).toBe('reported success — ok')
  })

  test('tool calls become prose', () => {
    expect(narrationText(ev('tool_use', { name: 'Bash', inputPreview: '{"command":"pnpm test"}' }))).toBe('$ pnpm test')
    expect(narrationText(ev('tool_use', { name: 'Edit', inputPreview: '{"file_path":"src/a.ts"}' }))).toBe('editing src/a.ts')
    expect(narrationText(ev('tool_use', { name: 'Read', inputPreview: '{"file_path":"src/a.ts"}' }))).toBe('reading src/a.ts')
    expect(narrationText(ev('tool_use', { name: 'mcp__tada__use_repo', inputPreview: '{"name":"parlor-api"}' }))).toBe('checking out parlor-api')
    expect(narrationText(ev('tool_use', { name: 'mcp__tada__ask_user', inputPreview: '{}' }))).toBe('asking you a question')
    expect(narrationText(ev('tool_use', { name: 'Grep', inputPreview: 'not json' }))).toBe('grep')
  })

  test('gate events: hold by reason, resume, never, time_up, continued', () => {
    expect(
      narrationText(ev('gate', { kind: 'hold', hold: { reason: 'permission', tool: 'Bash', summary: 'gh pr create --base main', ruleId: 3, ruleTitle: 'Open a pull request', publishes: true } })),
    ).toBe('⏸ gh pr create --base main — stopped, waiting on you')
    expect(narrationText(ev('gate', { kind: 'hold', hold: { reason: 'question', question: 'which?', options: [] } }))).toBe('? which?')
    expect(narrationText(ev('gate', { kind: 'hold', hold: { reason: 'time', budgetMs: 30 * 60_000 } }))).toBe('⏸ hit the 30m limit — stopped, waiting on you')
    expect(narrationText(ev('gate', { kind: 'resume' }))).toBe('▸ resumed from that step')
    expect(narrationText(ev('gate', { kind: 'never', summary: 'git push --force', ruleTitle: 'Force-push or touch main' }))).toContain('your rule says never')
    expect(narrationText(ev('gate', { kind: 'time_up', budgetMs: 60_000 }))).toContain('1m budget spent')
    expect(narrationText(ev('gate', { kind: 'continued', extraMs: 30 * 60_000 }))).toBe('▸ given another 30m — continuing')
    expect(narrationText(ev('gate', { kind: 'unknown' }))).toBeNull()
  })

  test('lineTone: holds are live, never/errors fail, done is ok', () => {
    expect(lineTone(ev('gate', { kind: 'hold', hold: { reason: 'time', budgetMs: 1 } }))).toBe('hold')
    expect(lineTone(ev('gate', { kind: 'never' }))).toBe('error')
    expect(lineTone(ev('error', { message: 'x' }))).toBe('error')
    expect(lineTone(ev('status', { kind: 'run_status', status: 'done' }))).toBe('ok')
    expect(lineTone(ev('text', { text: 'x' }))).toBe('text')
    expect(lineTone(ev('tool_use', { name: 'Bash' }))).toBe('muted')
  })
})

describe('gate copy', () => {
  const permission = { reason: 'permission' as const, tool: 'Bash', summary: 'gh pr create --title x', ruleId: 3, ruleTitle: 'Open a pull request', publishes: true }
  test('titles, facts and copy per reason', () => {
    expect(gateTitle(permission)).toBe('The agent wants to: open a pull request')
    expect(gateFacts(permission)).toEqual([
      ['call', 'gh pr create --title x'],
      ['rule', 'Open a pull request → ask'],
    ])
    expect(gateCopy(permission)).toContain('Nothing has reached github yet')
    expect(gateCopy({ ...permission, publishes: false })).not.toContain('Nothing has reached github yet')
    expect(gateTitle({ reason: 'question', question: 'which backoff?', options: ['30s', '5m'] })).toBe('which backoff?')
    expect(gateFacts({ reason: 'question', question: 'q', options: ['30s', '5m'] })).toEqual([['options', '30s · 5m']])
    expect(gateTitle({ reason: 'time', budgetMs: 1 })).toBe('It ran out of time')
    expect(gateCopy({ reason: 'time', budgetMs: 1 })).toBe('Continuing picks up mid-run — no re-clone.')
  })

  test('atPublishGate is only true when held on a publishing permission gate', () => {
    expect(atPublishGate({ status: 'held', hold: permission })).toBe(true)
    expect(atPublishGate({ status: 'held', hold: { ...permission, publishes: false } })).toBe(false)
    expect(atPublishGate({ status: 'held', hold: { reason: 'question', question: 'q', options: [] } })).toBe(false)
    expect(atPublishGate({ status: 'running', hold: null })).toBe(false)
    expect(atPublishGate(undefined)).toBe(false)
  })
})

describe('terminalLine & linesFrom', () => {
  test('terminal states', () => {
    expect(terminalLine({ status: 'done', summary: 'shipped' })).toEqual({ tone: 'ok', text: '✱ finished and moved itself to done — shipped' })
    expect(terminalLine({ status: 'failed', summary: null })).toEqual({ tone: 'error', text: '✕ run failed' })
    expect(terminalLine({ status: 'cancelled', summary: null })).toEqual({ tone: 'muted', text: 'stopped by you' })
    expect(terminalLine({ status: 'running', summary: null })).toBeNull()
  })

  test('linesFrom copies from a line to the end, stamped', () => {
    const events = [ev('text', { text: 'a' }, 1), ev('text', { text: 'b' }, 2), ev('tool_use', { name: null }, 3), ev('text', { text: 'c' }, 4)]
    const out = linesFrom(events, 2)
    expect(out.split('\n')).toHaveLength(2)
    expect(out).toContain('  b')
    expect(out).toContain('  c')
    expect(linesFrom(events, -1).split('\n')).toHaveLength(3)
  })
})
