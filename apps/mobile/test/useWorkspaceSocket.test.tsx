import type { WsMessage } from '@tada/shared'
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { makeTestQueryClient } from './helpers/queryClient'
import { renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'
import { ClientProvider } from '../src/api/ClientContext'
import { keys } from '../src/api/queries'
import { useWorkspaceSocket } from '../src/api/useWorkspaceSocket'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  url: string
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  close() {
    this.closed = true
  }

  emitOpen() {
    this.onopen?.()
  }

  emitMessage(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) })
  }

  emitClose() {
    this.onclose?.()
  }

  emitError() {
    this.onerror?.()
  }
}

const fakeClient = {
  wsUrl: (wsId: number) => `wss://example.test/ws?workspaceId=${wsId}`,
} as unknown as import('../src/api/client').TadaClient

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ClientProvider client={fakeClient}>{children}</ClientProvider>
      </QueryClientProvider>
    )
  }
}

describe('useWorkspaceSocket', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
  })

  test('board_changed invalidates board and workspaces (and ticket-prefixed) queries', async () => {
    const queryClient = makeTestQueryClient()
    const spy = jest.spyOn(queryClient, 'invalidateQueries')

    await renderHook(
      () => useWorkspaceSocket(1, undefined, FakeWebSocket as unknown as typeof WebSocket),
      { wrapper: makeWrapper(queryClient) },
    )

    const socket = FakeWebSocket.instances[0]
    expect(socket).toBeDefined()
    const msg: WsMessage = { type: 'board_changed', workspaceId: 1 }
    socket?.emitMessage(msg)

    expect(spy).toHaveBeenCalledWith({ queryKey: keys.board(1) })
    expect(spy).toHaveBeenCalledWith({ queryKey: keys.workspaces })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['ticket'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: keys.activity() })
  })

  test('activity invalidates keys.activity()', async () => {
    const queryClient = makeTestQueryClient()
    const spy = jest.spyOn(queryClient, 'invalidateQueries')

    await renderHook(
      () => useWorkspaceSocket(1, undefined, FakeWebSocket as unknown as typeof WebSocket),
      { wrapper: makeWrapper(queryClient) },
    )

    const socket = FakeWebSocket.instances[0]
    const msg: WsMessage = { type: 'activity', workspaceId: 1 }
    socket?.emitMessage(msg)

    expect(spy).toHaveBeenCalledWith({ queryKey: keys.activity() })
  })

  test('run_event is forwarded to onRunEvent', async () => {
    const queryClient = makeTestQueryClient()
    const onRunEvent = jest.fn()

    await renderHook(
      () =>
        useWorkspaceSocket(1, { onRunEvent }, FakeWebSocket as unknown as typeof WebSocket),
      { wrapper: makeWrapper(queryClient) },
    )

    const socket = FakeWebSocket.instances[0]
    const msg: WsMessage = { type: 'run_event', runId: 42, event: { type: 'text', payload: { text: 'hi' } } }
    socket?.emitMessage(msg)

    expect(onRunEvent).toHaveBeenCalledWith(msg)
  })

  test('malformed message is ignored without throwing', async () => {
    const queryClient = makeTestQueryClient()
    const spy = jest.spyOn(queryClient, 'invalidateQueries')

    await renderHook(
      () => useWorkspaceSocket(1, undefined, FakeWebSocket as unknown as typeof WebSocket),
      { wrapper: makeWrapper(queryClient) },
    )

    const socket = FakeWebSocket.instances[0]
    expect(() => socket?.emitMessage('{ not valid json')).not.toThrow()
    expect(spy).not.toHaveBeenCalled()
  })

  test('close schedules a reconnect with growing backoff delays', async () => {
    jest.useFakeTimers()
    try {
      const queryClient = makeTestQueryClient()

      await renderHook(
        () => useWorkspaceSocket(1, undefined, FakeWebSocket as unknown as typeof WebSocket),
        { wrapper: makeWrapper(queryClient) },
      )

      expect(FakeWebSocket.instances).toHaveLength(1)

      FakeWebSocket.instances[0]?.emitClose()
      expect(FakeWebSocket.instances).toHaveLength(1)
      jest.advanceTimersByTime(999)
      expect(FakeWebSocket.instances).toHaveLength(1)
      jest.advanceTimersByTime(1)
      expect(FakeWebSocket.instances).toHaveLength(2)

      FakeWebSocket.instances[1]?.emitClose()
      jest.advanceTimersByTime(1999)
      expect(FakeWebSocket.instances).toHaveLength(2)
      jest.advanceTimersByTime(1)
      expect(FakeWebSocket.instances).toHaveLength(3)
    } finally {
      jest.useRealTimers()
    }
  })

  test('a successful reconnect resets the backoff so the next drop starts back at 1s', async () => {
    jest.useFakeTimers()
    try {
      const queryClient = makeTestQueryClient()

      await renderHook(
        () => useWorkspaceSocket(1, undefined, FakeWebSocket as unknown as typeof WebSocket),
        { wrapper: makeWrapper(queryClient) },
      )

      expect(FakeWebSocket.instances).toHaveLength(1)

      // First drop: reconnects at 1s (attempt 0 -> delay 1000ms).
      FakeWebSocket.instances[0]?.emitClose()
      jest.advanceTimersByTime(1000)
      expect(FakeWebSocket.instances).toHaveLength(2)

      // The reconnected socket opens successfully, which should reset the
      // backoff attempt counter back to 0.
      FakeWebSocket.instances[1]?.emitOpen()

      // Second drop, long after the first: without the reset this would
      // require the escalated 2000ms delay. With the reset it must fire at
      // 1000ms again.
      FakeWebSocket.instances[1]?.emitClose()
      jest.advanceTimersByTime(999)
      expect(FakeWebSocket.instances).toHaveLength(2)
      jest.advanceTimersByTime(1)
      expect(FakeWebSocket.instances).toHaveLength(3)
    } finally {
      jest.useRealTimers()
    }
  })

  test('unmount closes the socket and cancels any pending reconnect', async () => {
    jest.useFakeTimers()
    try {
      const queryClient = makeTestQueryClient()

      const { unmount } = await renderHook(
        () => useWorkspaceSocket(1, undefined, FakeWebSocket as unknown as typeof WebSocket),
        { wrapper: makeWrapper(queryClient) },
      )

      const socket = FakeWebSocket.instances[0]
      expect(socket).toBeDefined()

      await unmount()

      expect(socket?.closed).toBe(true)

      // Even a close event firing after unmount (or advancing time) must not
      // create a new socket — the timer was cancelled and onclose detached.
      socket?.emitClose()
      jest.advanceTimersByTime(20000)
      expect(FakeWebSocket.instances).toHaveLength(1)
    } finally {
      jest.useRealTimers()
    }
  })

  test('undefined wsId does not construct a socket', async () => {
    const queryClient = makeTestQueryClient()

    await renderHook(
      () => useWorkspaceSocket(undefined, undefined, FakeWebSocket as unknown as typeof WebSocket),
      { wrapper: makeWrapper(queryClient) },
    )

    expect(FakeWebSocket.instances).toHaveLength(0)
  })
})
