import { relativeTime } from '../src/relativeTime'

const NOW = new Date('2026-08-13T12:00:00.000Z')

describe('relativeTime', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(NOW)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('just now for sub-minute ages', () => {
    expect(relativeTime(new Date(NOW.getTime() - 30_000).toISOString())).toBe('just now')
  })

  test('minutes ago', () => {
    expect(relativeTime(new Date(NOW.getTime() - 5 * 60_000).toISOString())).toBe('5m ago')
  })

  test('hours ago', () => {
    expect(relativeTime(new Date(NOW.getTime() - 3 * 60 * 60_000).toISOString())).toBe('3h ago')
  })

  test('days ago', () => {
    expect(relativeTime(new Date(NOW.getTime() - 2 * 24 * 60 * 60_000).toISOString())).toBe('2d ago')
  })
})
