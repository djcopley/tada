import { describe, expect, test } from 'vitest'
import { isGoneStatus } from '../src/webPush.js'

describe('isGoneStatus', () => {
  test('treats 404 and 410 as a dead subscription', () => {
    expect(isGoneStatus({ statusCode: 410 })).toBe(true)
    expect(isGoneStatus({ statusCode: 404 })).toBe(true)
  })

  test('treats anything else as a transient failure worth keeping the row for', () => {
    expect(isGoneStatus({ statusCode: 500 })).toBe(false)
    expect(isGoneStatus({ statusCode: 429 })).toBe(false)
    expect(isGoneStatus(new Error('network down'))).toBe(false)
    expect(isGoneStatus(null)).toBe(false)
    expect(isGoneStatus(undefined)).toBe(false)
  })
})
