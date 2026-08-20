import { describe, expect, test } from 'vitest'
import { holdPingText } from '../src/holds.js'

describe('holdPingText', () => {
  test('names what stopped the run', () => {
    expect(
      holdPingText({
        reason: 'permission',
        tool: 'Bash',
        summary: 'git push',
        ruleId: 1,
        ruleTitle: 'push to a remote',
        publishes: true,
      }),
    ).toBe('wants to: push to a remote — git push')
    expect(holdPingText({ reason: 'question', question: 'which?', options: [] })).toBe('which?')
    expect(holdPingText({ reason: 'time', budgetMs: 1 })).toContain('out of time')
  })
})
