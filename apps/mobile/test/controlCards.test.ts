import type { ApiMemoryNote, ApiRun } from '@tada/shared'
import { holdGlyph, noteDigest, stoppedHint, stoppedStatLine } from '../src/components/control/ControlCards'
import { todayMeta } from '../app/(tabs)/index'

function run(overrides: Partial<ApiRun>): ApiRun {
  return {
    id: 4128,
    ticketId: 1,
    adapter: 'claude',
    model: 'sonnet',
    effort: 'medium',
    attemptNumber: 1,
    status: 'held',
    heldReason: 'permission',
    hold: { reason: 'permission', tool: 'Bash', summary: 'gh pr create', ruleId: 3, ruleTitle: 'Open a pull request', publishes: true },
    heldAt: null,
    budgetMs: 1_800_000,
    summary: null,
    diffAdditions: 412,
    diffDeletions: 38,
    testsPassed: 214,
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-08-17T00:00:00.000Z',
    ...overrides,
  }
}

describe('control card helpers', () => {
  test('holdGlyph: ⏸ for permission and time, ? for a question, ✕ for failure', () => {
    expect(holdGlyph(run({}))).toBe('⏸')
    expect(holdGlyph(run({ heldReason: 'time', hold: { reason: 'time', budgetMs: 1 } }))).toBe('⏸')
    expect(holdGlyph(run({ heldReason: 'question', hold: { reason: 'question', question: 'q', options: [] } }))).toBe('?')
    expect(holdGlyph(run({ status: 'failed', hold: null, heldReason: null }))).toBe('✕')
    expect(holdGlyph(null)).toBe('▸')
  })

  test('stoppedHint names what resolving the hold does', () => {
    expect(stoppedHint(run({}))).toBe('resumes at this step · then moves itself to done')
    expect(stoppedHint(run({ hold: { reason: 'question', question: 'q', options: [] } }))).toBe('your answer can be saved to memory')
    expect(stoppedHint(run({ hold: { reason: 'time', budgetMs: 1 } }))).toBe('continuing picks up mid-run — no re-clone')
    expect(stoppedHint(run({ status: 'failed', hold: null }))).toContain('fresh attempt')
    expect(stoppedHint(run({ status: 'running', hold: null }))).toBe('')
  })

  test('stoppedStatLine: run stats, "context kept" when out of time, "nothing published" on failure', () => {
    expect(stoppedStatLine(run({}))).toBe('run #4128 · +412 −38 · 214 tests pass')
    expect(stoppedStatLine(run({ hold: { reason: 'time', budgetMs: 1 } }))).toBe('run #4128 · +412 −38 · 214 tests pass · context kept')
    expect(stoppedStatLine(run({ status: 'failed', hold: null, diffAdditions: null, diffDeletions: null, testsPassed: null }))).toBe(
      'run #4128 · nothing published',
    )
  })

  test('noteDigest is the first non-heading line, else the title', () => {
    const note = (body: string): ApiMemoryNote => ({
      id: 1,
      title: 'Safety',
      body,
      tags: [],
      author: 'human',
      runId: null,
      state: 'kept',
      createdAt: '',
      updatedAt: '',
    })
    expect(noteDigest(note('# Safety\nnever force-push'))).toBe('never force-push')
    expect(noteDigest(note('  \n'))).toBe('Safety')
  })

  test('todayMeta is a lowercase "mon d"', () => {
    expect(todayMeta(new Date(2026, 7, 17, 10).getTime())).toBe('aug 17')
  })
})
