import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { resolveBundlePath } from '../src/bundle.js'

const ROOT = '/bundle'
const files = new Set([
  path.join(ROOT, 'index.html'),
  path.join(ROOT, 'board.html'),
  path.join(ROOT, 'runs', '[id]', 'index.html'),
  path.join(ROOT, '_expo', 'static', 'js', 'app.js'),
])
const isFile = (p: string) => files.has(p)

describe('resolveBundlePath', () => {
  test('serves index.html for the root', () => {
    expect(resolveBundlePath(ROOT, '/', isFile)).toBe(path.join(ROOT, 'index.html'))
  })

  test('serves an exact asset hit', () => {
    expect(resolveBundlePath(ROOT, '/_expo/static/js/app.js', isFile)).toBe(
      path.join(ROOT, '_expo', 'static', 'js', 'app.js'),
    )
  })

  test('serves the .html sibling Expo writes per route', () => {
    expect(resolveBundlePath(ROOT, '/board', isFile)).toBe(path.join(ROOT, 'board.html'))
  })

  test('serves a directory index', () => {
    expect(resolveBundlePath(ROOT, '/runs/[id]', isFile)).toBe(
      path.join(ROOT, 'runs', '[id]', 'index.html'),
    )
  })

  test('falls back to index.html so client-side routes resolve', () => {
    expect(resolveBundlePath(ROOT, '/tickets/42', isFile)).toBe(path.join(ROOT, 'index.html'))
  })

  test('decodes percent-encoded paths', () => {
    expect(resolveBundlePath(ROOT, '/runs/%5Bid%5D', isFile)).toBe(
      path.join(ROOT, 'runs', '[id]', 'index.html'),
    )
  })

  test('rejects a path that escapes the bundle', () => {
    expect(resolveBundlePath(ROOT, '/../../etc/passwd', isFile)).toBeNull()
    expect(resolveBundlePath(ROOT, '/..%2f..%2fetc/passwd', isFile)).toBeNull()
  })

  test('rejects a malformed escape rather than throwing', () => {
    expect(resolveBundlePath(ROOT, '/%E0%A4%A', isFile)).toBeNull()
  })
})
