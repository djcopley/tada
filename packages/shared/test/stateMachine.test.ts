import { describe, expect, it } from 'vitest'
import { canMoveCard, canTransitionRun } from '../src/stateMachine.js'

describe('canTransitionRun', () => {
  it('runs go queued -> running -> held <-> running -> done', () => {
    expect(canTransitionRun('queued', 'running')).toBe(true)
    expect(canTransitionRun('running', 'held')).toBe(true)
    expect(canTransitionRun('held', 'running')).toBe(true)
    expect(canTransitionRun('running', 'done')).toBe(true)
  })

  it('failure and cancellation are reachable from running and held', () => {
    expect(canTransitionRun('running', 'failed')).toBe(true)
    expect(canTransitionRun('held', 'failed')).toBe(true)
    expect(canTransitionRun('held', 'cancelled')).toBe(true)
    expect(canTransitionRun('queued', 'cancelled')).toBe(true)
  })

  it('terminal states are terminal — no auto-retry path exists', () => {
    for (const from of ['done', 'failed', 'cancelled'] as const) {
      for (const to of ['queued', 'running', 'held', 'done', 'failed', 'cancelled'] as const) {
        expect(canTransitionRun(from, to)).toBe(false)
      }
    }
    expect(canTransitionRun('queued', 'held')).toBe(false)
    expect(canTransitionRun('held', 'done')).toBe(false)
  })
})

describe('canMoveCard', () => {
  it('humans may put a card in backlog, queued or done', () => {
    expect(canMoveCard('human', 'backlog', 'queued')).toBe(true)
    expect(canMoveCard('human', 'stopped', 'backlog')).toBe(true)
    expect(canMoveCard('human', 'done', 'backlog')).toBe(true)
    expect(canMoveCard('human', 'queued', 'done')).toBe(true)
  })

  it('humans never move a card into running or stopped', () => {
    expect(canMoveCard('human', 'queued', 'running')).toBe(false)
    expect(canMoveCard('human', 'backlog', 'stopped')).toBe(false)
  })

  it('the orchestrator drives the run lanes', () => {
    expect(canMoveCard('orchestrator', 'queued', 'running')).toBe(true)
    expect(canMoveCard('orchestrator', 'running', 'stopped')).toBe(true)
    expect(canMoveCard('orchestrator', 'stopped', 'running')).toBe(true)
    expect(canMoveCard('orchestrator', 'running', 'done')).toBe(true)
    expect(canMoveCard('orchestrator', 'backlog', 'running')).toBe(false)
    expect(canMoveCard('orchestrator', 'done', 'backlog')).toBe(false)
  })
})
