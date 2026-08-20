import { describe, expect, test } from 'vitest'
import { DEFAULT_SIZE, parseBounds, restoreBounds } from '../src/bounds.js'

const MAIN = { x: 0, y: 0, width: 1920, height: 1080 }
const SECOND = { x: 1920, y: 0, width: 1440, height: 900 }

describe('parseBounds', () => {
  test('reads a saved record', () => {
    expect(parseBounds('{"x":10,"y":20,"width":800,"height":600}')).toEqual({
      x: 10,
      y: 20,
      width: 800,
      height: 600,
    })
  })

  test('rejects absent, malformed and incomplete records', () => {
    expect(parseBounds(null)).toBeNull()
    expect(parseBounds('not json')).toBeNull()
    expect(parseBounds('{"x":10,"y":20}')).toBeNull()
    expect(parseBounds('{"x":10,"y":20,"width":"800","height":600}')).toBeNull()
  })
})

describe('restoreBounds', () => {
  test('falls back to the default size with no saved bounds', () => {
    expect(restoreBounds(null, [MAIN])).toEqual(DEFAULT_SIZE)
  })

  test('restores bounds that sit on an attached display', () => {
    const saved = { x: 100, y: 80, width: 1000, height: 700 }
    expect(restoreBounds(saved, [MAIN, SECOND])).toEqual(saved)
  })

  test('drops the position when the display it was on is gone', () => {
    const saved = { x: 2200, y: 100, width: 1000, height: 700 }
    expect(restoreBounds(saved, [MAIN])).toEqual({ width: 1000, height: 700 })
  })

  test('clamps a window larger than every display', () => {
    const saved = { x: 0, y: 0, width: 4000, height: 3000 }
    expect(restoreBounds(saved, [MAIN])).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
  })

  test('clamps a window too small to use', () => {
    const saved = { x: 0, y: 0, width: 120, height: 90 }
    expect(restoreBounds(saved, [MAIN])).toEqual({ x: 0, y: 0, width: 600, height: 480 })
  })
})
