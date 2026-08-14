import { positionBetween } from '../src/board/positions'

describe('positionBetween', () => {
  test('both undefined defaults to 1', () => {
    expect(positionBetween(undefined, undefined)).toBe(1)
  })

  test('after undefined places one past before', () => {
    expect(positionBetween(2, undefined)).toBe(3)
  })

  test('before undefined places one before after', () => {
    expect(positionBetween(undefined, 2)).toBe(1)
  })

  test('both defined takes the midpoint', () => {
    expect(positionBetween(1, 2)).toBe(1.5)
  })
})
