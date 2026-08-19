import { night } from '../src/design/tokens'
import { phaseChrome, WIDGET_INK } from '../src/liveActivity/chrome'

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
