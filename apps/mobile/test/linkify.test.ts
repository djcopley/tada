import { plainTextLinks, splitLinks } from '../src/linkify'

describe('splitLinks', () => {
  test('markdown links become label + url segments; surrounding text kept', () => {
    expect(splitLinks('see [CI run](https://ci.example/123) please')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', label: 'CI run', url: 'https://ci.example/123' },
      { kind: 'text', text: ' please' },
    ])
  })

  test('bare URLs are linked with trailing punctuation left as text', () => {
    expect(splitLinks('open https://x.com/foo).')).toEqual([
      { kind: 'text', text: 'open ' },
      { kind: 'link', label: 'https://x.com/foo', url: 'https://x.com/foo' },
      { kind: 'text', text: ').' },
    ])
  })

  test('both kinds in one body, in order', () => {
    const segs = splitLinks('[a](https://a.io) and https://b.io')
    expect(segs.filter((s) => s.kind === 'link').map((s) => (s.kind === 'link' ? s.url : ''))).toEqual([
      'https://a.io',
      'https://b.io',
    ])
  })

  test('plain text has no link segments', () => {
    expect(splitLinks('no links')).toEqual([{ kind: 'text', text: 'no links' }])
  })
})

describe('plainTextLinks', () => {
  test('collapses markdown links to their label', () => {
    expect(plainTextLinks('▸ [CI run](https://ci.example/123) done')).toBe('▸ CI run done')
  })
})
