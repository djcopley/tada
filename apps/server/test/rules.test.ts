import { describe, expect, test } from 'vitest'
import { callSummary, DEFAULT_RULES, globToRegExp, matchRule, ruleMatches } from '../src/rules.js'
import { makeTestApp } from './helpers/testApp.js'

describe('rules', () => {
  test('globToRegExp: * matches anything, everything else is literal', () => {
    expect(globToRegExp('*gh pr create*').test('cd x && gh pr create --title y')).toBe(true)
    expect(globToRegExp('gh pr create*').test('cd x && gh pr create')).toBe(false)
    expect(globToRegExp('a.b').test('axb')).toBe(false)
    expect(globToRegExp('*').test('')).toBe(true)
  })

  test('callSummary: the command for Bash, the path for file tools, json otherwise', () => {
    expect(callSummary('Bash', { command: 'ls' })).toBe('ls')
    expect(callSummary('Write', { file_path: '/a', content: 'x' })).toBe('/a')
    expect(callSummary('mcp__x__y', { a: 1 })).toBe('{"a":1}')
    expect(callSummary('Bash', undefined)).toBe('')
  })

  test('ruleMatches: tool must match (or be *), any pattern may match, no patterns = all', () => {
    expect(ruleMatches({ tool: 'Bash', patterns: ['*push*'] }, 'Bash', 'git push')).toBe(true)
    expect(ruleMatches({ tool: 'Bash', patterns: ['*push*'] }, 'Write', 'git push')).toBe(false)
    expect(ruleMatches({ tool: '*', patterns: [] }, 'Write', 'anything')).toBe(true)
  })

  test('the default table: force-push and main are never, plain push allowed, pr create/merge ask', async () => {
    const t = await makeTestApp()
    const decide = (cmd: string) => matchRule(t.db, 'Bash', cmd)?.decision ?? 'unmatched'
    expect(decide('git push --force origin feature')).toBe('never')
    expect(decide('git push -f origin feature')).toBe('never')
    expect(decide('git push origin main')).toBe('never')
    expect(decide('git push origin HEAD:main')).toBe('never')
    expect(decide('git push -u origin ticket/4')).toBe('allow')
    expect(decide('gh pr create --fill')).toBe('ask')
    expect(decide('gh pr merge 12')).toBe('ask')
    expect(decide('gh pr close 12')).toBe('ask')
    expect(decide('gh pr view 12')).toBe('unmatched')
    expect(decide('pnpm test')).toBe('unmatched')
    expect(DEFAULT_RULES.every((r) => r.publishes)).toBe(true)
  })
})
