import { render } from '@testing-library/react-native'
import { DesktopBridge } from '../src/components/DesktopBridge'

const mockListeners = new Set<(msg: unknown) => void>()

jest.mock('../src/api/AppSocketContext', () => ({
  useRunEventListener: (fn: (msg: unknown) => void) => {
    mockListeners.add(fn)
  },
}))

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }))

const HOLD = {
  reason: 'question' as const,
  question: 'which branch?',
  options: ['main', 'develop'],
}

function emit(msg: unknown): void {
  for (const fn of mockListeners) fn(msg)
}

describe('DesktopBridge', () => {
  afterEach(() => {
    mockListeners.clear()
    delete (globalThis as Record<string, unknown>).tadaDesktop
  })

  test('notifies the shell when a run holds', async () => {
    const notify = jest.fn()
    ;(globalThis as Record<string, unknown>).tadaDesktop = { notify, onOpenRun: () => () => {} }
    await render(<DesktopBridge />)

    emit({ type: 'run_event', runId: 12, event: { type: 'gate', payload: { kind: 'hold', hold: HOLD } } })

    expect(notify).toHaveBeenCalledWith({
      title: 'Run #12 stopped on you',
      body: 'which branch?',
      runId: 12,
    })
  })

  test('stays quiet for events that are not holds', async () => {
    const notify = jest.fn()
    ;(globalThis as Record<string, unknown>).tadaDesktop = { notify, onOpenRun: () => () => {} }
    await render(<DesktopBridge />)

    emit({ type: 'run_event', runId: 12, event: { type: 'gate', payload: { kind: 'resume' } } })
    emit({ type: 'run_event', runId: 12, event: { type: 'status', payload: { status: 'done' } } })

    expect(notify).not.toHaveBeenCalled()
  })

  test('renders and does nothing without a bridge', async () => {
    await render(<DesktopBridge />)
  })
})
