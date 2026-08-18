import { act, renderHook } from '@testing-library/react-native'
import { type ReactNode, useState } from 'react'
import { AppSocketProvider, type RunEventMessage, useRunEventListener } from '../src/api/AppSocketContext'

let mockCaptured: ((msg: RunEventMessage) => void) | undefined
let mockMounts = 0
jest.mock('../src/api/useAppSocket', () => ({
  useAppSocket: (opts: { onRunEvent?: (msg: RunEventMessage) => void }) => {
    mockMounts += 1
    mockCaptured = opts.onRunEvent
  },
}))
jest.mock('../src/ConnectionContext', () => ({
  useConnection: () => ({ connection: { baseUrl: 'https://x', token: 't' } }),
}))

const msg = (runId: number): RunEventMessage =>
  ({ type: 'run_event', runId, event: { id: 1, runId, type: 'text', payload: { text: 'hi' }, createdAt: '' } }) as RunEventMessage

function wrapper({ children }: { children: ReactNode }) {
  return <AppSocketProvider>{children}</AppSocketProvider>
}

describe('AppSocketProvider', () => {
  beforeEach(() => {
    mockCaptured = undefined
    mockMounts = 0
  })

  test('one socket per tree, fanned out to listeners; a listener unsubscribes on unmount', async () => {
    const a = jest.fn()
    const b = jest.fn()
    const { unmount } = await renderHook(
      () => {
        useRunEventListener(a)
        useRunEventListener(b)
      },
      { wrapper },
    )
    expect(mockMounts).toBe(1)

    mockCaptured?.(msg(7))
    expect(a).toHaveBeenCalledWith(msg(7))
    expect(b).toHaveBeenCalledWith(msg(7))

    await unmount()
    mockCaptured?.(msg(8))
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  test('the latest callback is the one invoked, without resubscribing', async () => {
    const first = jest.fn()
    const second = jest.fn()
    const { result } = await renderHook(
      () => {
        const [fn, setFn] = useState<(m: RunEventMessage) => void>(() => first)
        useRunEventListener(fn)
        return setFn
      },
      { wrapper },
    )
    await act(async () => result.current(() => second))
    mockCaptured?.(msg(1))
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith(msg(1))
  })

  test('is a no-op without a provider', async () => {
    const fn = jest.fn()
    const { unmount } = await renderHook(() => useRunEventListener(fn))
    expect(mockMounts).toBe(0)
    unmount()
  })
})
