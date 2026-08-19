import type { Hold } from '@tada/shared'
import {
  holdFromRunEvent,
  holdNotification,
  isDesktop,
  notifyDesktop,
} from '../src/desktop'

const PERMISSION: Hold = {
  reason: 'permission',
  tool: 'Bash',
  summary: 'git push',
  ruleId: 1,
  ruleTitle: 'push to a remote',
  publishes: true,
}

describe('isDesktop', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).tadaDesktop
  })

  test('is false in a plain browser or on a device', () => {
    expect(isDesktop()).toBe(false)
  })

  test('is true when the Electron preload has exposed the bridge', () => {
    ;(globalThis as Record<string, unknown>).tadaDesktop = {
      notify: () => {},
      onOpenRun: () => () => {},
    }
    expect(isDesktop()).toBe(true)
  })
})

describe('notifyDesktop', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).tadaDesktop
  })

  test('does nothing without a bridge', () => {
    expect(() => notifyDesktop({ title: 'a', body: 'b' })).not.toThrow()
  })

  test('forwards to the bridge', () => {
    const notify = jest.fn()
    ;(globalThis as Record<string, unknown>).tadaDesktop = { notify, onOpenRun: () => () => {} }
    notifyDesktop({ title: 'a', body: 'b', runId: 7 })
    expect(notify).toHaveBeenCalledWith({ title: 'a', body: 'b', runId: 7 })
  })
})

describe('holdFromRunEvent', () => {
  test('reads the hold out of a gate event', () => {
    expect(holdFromRunEvent({ type: 'gate', payload: { kind: 'hold', hold: PERMISSION } })).toEqual(
      PERMISSION,
    )
  })

  test('ignores the other gate kinds and other events', () => {
    expect(holdFromRunEvent({ type: 'gate', payload: { kind: 'resume' } })).toBeNull()
    expect(holdFromRunEvent({ type: 'status', payload: { status: 'running' } })).toBeNull()
    expect(holdFromRunEvent({ type: 'gate', payload: null })).toBeNull()
  })
})

describe('holdNotification', () => {
  test('says which run stopped and why', () => {
    expect(holdNotification(12, PERMISSION)).toEqual({
      title: 'Run #12 stopped on you',
      body: 'wants to: push to a remote — git push',
      runId: 12,
    })
  })
})
