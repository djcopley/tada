import type { ApiRunEvent } from '@tada/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'
import { ClientProvider } from '../src/api/ClientContext'
import { useRunEvents } from '../src/api/useRunEvents'

function evt(overrides: Partial<ApiRunEvent> = {}): ApiRunEvent {
  return {
    id: 1,
    runId: 7,
    type: 'text',
    payload: { text: 'hi' },
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const mockRunEvents = jest.fn()
const fakeClient = { runEvents: mockRunEvents } as unknown as import('../src/api/client').TadaClient

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={queryClient}>
      <ClientProvider client={fakeClient}>{children}</ClientProvider>
    </QueryClientProvider>
  )
}

jest.setTimeout(15000)

describe('useRunEvents', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  test('accumulates pages across polls, advancing the after param by the highest id seen', async () => {
    const e1 = evt({ id: 1 })
    const e2 = evt({ id: 2 })
    const e3 = evt({ id: 3 })
    mockRunEvents.mockResolvedValueOnce([e1, e2]).mockResolvedValueOnce([e3])

    const { result, unmount } = await renderHook(() => useRunEvents(7, { live: true }), { wrapper })
    try {
      await waitFor(() => {
        expect(result.current.events).toEqual([e1, e2])
      })
      expect(mockRunEvents).toHaveBeenNthCalledWith(1, 7, undefined)

      // The second page arrives on the next 2s poll (real timers) — wait past
      // that interval for the accumulated list and the advanced `after` param.
      await waitFor(
        () => {
          expect(result.current.events).toEqual([e1, e2, e3])
        },
        { timeout: 4000, interval: 250 },
      )
      expect(mockRunEvents).toHaveBeenNthCalledWith(2, 7, 2)
    } finally {
      await unmount()
    }
  })

  test('does not duplicate a server event that reappears in a later page', async () => {
    const e1 = evt({ id: 1 })
    const e2 = evt({ id: 2 })
    // Second page repeats e2 (e.g. a refetch race) alongside a genuinely new e3.
    mockRunEvents.mockResolvedValueOnce([e1, e2]).mockResolvedValueOnce([e2, evt({ id: 3 })])

    const { result, unmount } = await renderHook(() => useRunEvents(7, { live: true }), { wrapper })
    try {
      await waitFor(() => {
        expect(result.current.events).toHaveLength(2)
      })

      await waitFor(
        () => {
          expect(result.current.events).toHaveLength(3)
        },
        { timeout: 4000, interval: 250 },
      )

      expect(result.current.events.map((e) => e.id)).toEqual([1, 2, 3])
    } finally {
      await unmount()
    }
  })

  test('ingest appends WS-delivered events with decreasing synthetic ids and never dedupes them', async () => {
    mockRunEvents.mockResolvedValue([])

    const { result, unmount } = await renderHook(() => useRunEvents(7, { live: false }), { wrapper })
    try {
      await waitFor(() => {
        expect(mockRunEvents).toHaveBeenCalled()
      })

      await act(async () => {
        result.current.ingest({ type: 'text', payload: { text: 'hello from ws' } })
      })
      await act(async () => {
        result.current.ingest({ type: 'text', payload: { text: 'hello from ws' } })
      })

      await waitFor(() => {
        expect(result.current.events).toHaveLength(2)
      })
      const first = result.current.events[0]
      const second = result.current.events[1]
      expect(first).toBeDefined()
      expect(second).toBeDefined()
      expect(first?.id).toBeLessThan(0)
      expect(second?.id).toBeLessThan(first?.id ?? 0)
      expect(first?.runId).toBe(7)
    } finally {
      await unmount()
    }
  })

  test('does not poll when live is false', async () => {
    mockRunEvents.mockResolvedValue([evt({ id: 1 })])

    const { result, unmount } = await renderHook(() => useRunEvents(7, { live: false }), { wrapper })
    try {
      await waitFor(() => {
        expect(result.current.events).toHaveLength(1)
      })

      expect(mockRunEvents).toHaveBeenCalledTimes(1)
    } finally {
      await unmount()
    }
  })
})
