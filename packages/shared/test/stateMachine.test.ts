import { describe, expect, test } from 'vitest'
import { canMoveCard, canTransitionRun } from '../src/stateMachine.js'

describe('canTransitionRun', () => {
  test.each([
    ['queued', 'running', true],
    ['queued', 'cancelled', true],
    ['running', 'needs_review', true],
    ['running', 'failed', true],
    ['running', 'cancelled', true],
    ['queued', 'needs_review', false],
    ['needs_review', 'running', false],
    ['failed', 'running', false],
    ['running', 'queued', false],
  ] as const)('%s -> %s = %s', (from, to, ok) => {
    expect(canTransitionRun(from, to)).toBe(ok)
  })
})

describe('canMoveCard', () => {
  test('orchestrator: ready->in_progress, in_progress->in_review, in_progress->ready only', () => {
    expect(canMoveCard('orchestrator', 'ready', 'in_progress')).toBe(true)
    expect(canMoveCard('orchestrator', 'in_progress', 'in_review')).toBe(true)
    expect(canMoveCard('orchestrator', 'in_progress', 'ready')).toBe(true)
    expect(canMoveCard('orchestrator', 'backlog', 'ready')).toBe(false)
    expect(canMoveCard('orchestrator', 'in_review', 'done')).toBe(false)
  })
  test('human: anywhere except into in_progress', () => {
    expect(canMoveCard('human', 'backlog', 'ready')).toBe(true)
    expect(canMoveCard('human', 'in_review', 'done')).toBe(true)
    expect(canMoveCard('human', 'in_review', 'ready')).toBe(true)
    expect(canMoveCard('human', 'ready', 'in_progress')).toBe(false)
  })
})
