import {
  durationLabel,
  holdingTag,
  isRepoUrl,
  maskToken,
  parsePatterns,
  repingLabel,
  ruleDetailLine,
  ruleProvenanceTag,
  sourceTag,
} from '../src/settingsScreen'

describe('settingsScreen helpers', () => {
  test('sourceTag distinguishes github repos, other git hosts, and folders', () => {
    expect(sourceTag({ type: 'repo', name: 'a', url: 'https://github.com/x/a.git' })).toBe('repo · github')
    expect(sourceTag({ type: 'repo', name: 'a', url: 'https://gitlab.com/x/a.git' })).toBe('repo · git')
    expect(sourceTag({ type: 'folder', name: 'specs', path: '/srv/specs' })).toBe('folder · server')
  })

  test('maskToken keeps the tada_ prefix and the last four', () => {
    expect(maskToken('tada_abcdefghijklmnop3f9a')).toBe('tada_••••••••••3f9a')
    expect(maskToken('secret1234')).toBe('••••••••••1234')
  })

  test('isRepoUrl accepts what git clones', () => {
    expect(isRepoUrl('https://github.com/x/y.git')).toBe(true)
    expect(isRepoUrl('git@github.com:x/y.git')).toBe(true)
    expect(isRepoUrl('file:///tmp/repo.git')).toBe(true)
    expect(isRepoUrl('not a url')).toBe(false)
  })

  test('duration and re-ping labels', () => {
    expect(durationLabel(15)).toBe('15 min')
    expect(durationLabel(60)).toBe('1 hour')
    expect(durationLabel(120)).toBe('2 hours')
    expect(repingLabel(0)).toBe('off')
    expect(repingLabel(60)).toBe('after 1 hour')
  })

  test('parsePatterns splits on newlines and commas', () => {
    expect(parsePatterns('*a*\n *b*, *c*\n\n')).toEqual(['*a*', '*b*', '*c*'])
  })

  test('rule tags and detail line carry provenance', () => {
    const gate = { source: 'gate' as const, updatedAt: '2026-08-17T10:00:00.000Z' }
    expect(ruleProvenanceTag(gate)).toMatch(/^set from a gate · aug 1[67]$/)
    expect(ruleProvenanceTag({ source: 'human', updatedAt: gate.updatedAt })).toBeNull()
    expect(holdingTag({ holdingCount: 0 })).toBeNull()
    expect(holdingTag({ holdingCount: 1 })).toBe('holding 1 run')
    expect(holdingTag({ holdingCount: 3 })).toBe('holding 3 runs')
    expect(ruleDetailLine({ description: 'pnpm db:migrate', source: 'gate', sourceRunId: 4127, patterns: [] })).toBe(
      'pnpm db:migrate · you chose always allow on run #4127',
    )
    expect(ruleDetailLine({ description: '', source: 'human', sourceRunId: null, patterns: ['*x*', '*y*'] })).toBe('*x*, *y*')
  })
})
