import { describe, expect, test } from 'vitest'
import { linkDecision } from '../src/links.js'

const APP = 'app://tada'
const DEV = 'http://localhost:8081'

describe('linkDecision', () => {
  test('keeps the app itself in the window', () => {
    expect(linkDecision('app://tada/board', APP)).toBe('internal')
    expect(linkDecision('http://localhost:8081/board', DEV)).toBe('internal')
  })

  test('sends other http(s) URLs to the system browser', () => {
    expect(linkDecision('https://github.com/tada/pull/1', APP)).toBe('external')
    expect(linkDecision('http://192.168.1.20:4300/health', APP)).toBe('external')
  })

  test('sends a different origin out even on the same scheme', () => {
    expect(linkDecision('http://localhost:9999/', DEV)).toBe('external')
  })

  test('blocks schemes that are neither the app nor the web', () => {
    expect(linkDecision('file:///etc/passwd', APP)).toBe('block')
    expect(linkDecision('javascript:alert(1)', APP)).toBe('block')
    expect(linkDecision('app://evil/', APP)).toBe('block')
  })

  test('blocks anything unparseable', () => {
    expect(linkDecision('not a url', APP)).toBe('block')
  })
})
