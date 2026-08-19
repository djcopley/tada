import { night } from '../src/design/tokens'
import { phaseChrome, progressValue, timerBounds, WIDGET_INK } from '../src/liveActivity/chrome'

test('orange is live for both working and your turn', () => {
  expect(phaseChrome('working').dot).toBe(night.live)
  expect(phaseChrome('yourTurn').dot).toBe(night.live)
})

test('sage is done and red is failure, and nothing else has a color', () => {
  expect(phaseChrome('done').dot).toBe(night.ok)
  expect(phaseChrome('failed').dot).toBe(night.fail)
})

test('each phase names itself in the compact presentation', () => {
  expect(phaseChrome('yourTurn').label).toBe('your turn')
  expect(phaseChrome('done').label).toBe('done')
  expect(phaseChrome('failed').label).toBe('failed')
  // working has no label: the compact trailing draws a live timer instead.
  expect(phaseChrome('working').label).toBe('')
})

test('every widget color is opaque — SwiftUI takes 6-digit hex only', () => {
  for (const [name, value] of Object.entries(WIDGET_INK)) {
    expect(`${name}=${value}`).toMatch(/=#[0-9A-Fa-f]{6}$/)
  }
})

test('a real budget bounds the timer at its own end', () => {
  const startedAt = 1_000_000
  const budgetEndsAt = 1_000_000 + 60 * 60 * 1000
  expect(timerBounds(startedAt, budgetEndsAt).upper).toEqual(new Date(budgetEndsAt))
})

test('an absent budget bounds the timer far beyond startedAt, not at it', () => {
  const startedAt = 1_000_000
  const { upper } = timerBounds(startedAt, undefined)
  // Not frozen at (or near) startedAt — the whole bug was upper collapsing onto lower.
  expect(upper.getTime() - startedAt).toBeGreaterThan(24 * 60 * 60 * 1000)
})

test('progress is clamped to [0, 1] against clock skew', () => {
  const now = Date.now()
  // startedAt in the future relative to "now" would otherwise go negative.
  expect(progressValue(now + 60_000, now + 120_000)).toBe(0)
  // Elapsed well past budgetEndsAt would otherwise exceed 1 before the outer Math.min.
  expect(progressValue(now - 120_000, now - 60_000)).toBe(1)
})
