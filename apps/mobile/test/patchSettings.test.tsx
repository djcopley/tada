import type { ApiSettings } from '@tada/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'
import { ClientProvider } from '../src/api/ClientContext'
import { keys, usePatchSettings, useSettings } from '../src/api/queries'
import { makeTestQueryClient } from './helpers/queryClient'

jest.mock('../src/toast', () => ({ showToast: jest.fn() }))

const base: ApiSettings = {
  adapter: 'claude',
  model: 'sonnet',
  effort: 'medium',
  concurrency: 1,
  timeoutMs: 60_000,
  pingChannel: 'push',
  repingMs: 0,
}

type Deferred = { resolve: (v: ApiSettings) => void; reject: (e: unknown) => void }
let server: ApiSettings
let pending: { patch: Partial<ApiSettings>; d: Deferred }[]
const mockSettings = jest.fn(async () => server)
const mockPatch = jest.fn(
  (patch: Partial<ApiSettings>) =>
    new Promise<ApiSettings>((resolve, reject) => {
      pending.push({ patch, d: { resolve, reject } })
    }),
)
const fakeClient = { settings: mockSettings, patchSettings: mockPatch } as unknown as import('../src/api/client').TadaClient

/** Land the i-th outstanding PATCH the way the server would: merge, respond with the whole row. */
function land(i: number) {
  const [p] = pending.splice(i, 1)
  if (!p) throw new Error('no pending patch')
  server = { ...server, ...p.patch }
  p.d.resolve(server)
}

let queryClient: QueryClient
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ClientProvider client={fakeClient}>{children}</ClientProvider>
    </QueryClientProvider>
  )
}

function useHarness() {
  return { settings: useSettings(), patch: usePatchSettings() }
}

describe('usePatchSettings', () => {
  beforeEach(() => {
    server = { ...base }
    pending = []
    queryClient = makeTestQueryClient()
    mockSettings.mockClear()
    mockPatch.mockClear()
  })

  test('applies optimistically, so a second tap builds on the first instead of repeating it', async () => {
    const { result, unmount } = await renderHook(useHarness, { wrapper })
    await waitFor(() => expect(result.current.settings.data?.concurrency).toBe(1))

    await act(async () => {
      const c = result.current.settings.data!.concurrency
      result.current.patch.mutate({ concurrency: c + 1 })
    })
    await waitFor(() => expect(result.current.settings.data?.concurrency).toBe(2))
    await act(async () => {
      const c = result.current.settings.data!.concurrency
      result.current.patch.mutate({ concurrency: c + 1 })
    })
    await waitFor(() => expect(result.current.settings.data?.concurrency).toBe(3))
    expect(mockPatch.mock.calls.map((c) => c[0])).toEqual([{ concurrency: 2 }, { concurrency: 3 }])

    await act(async () => {
      land(0)
      land(0)
    })
    await waitFor(() => expect(result.current.settings.data?.concurrency).toBe(3))
    unmount()
  })

  test('a slow earlier response cannot stomp a faster later one for a different field', async () => {
    const { result, unmount } = await renderHook(useHarness, { wrapper })
    await waitFor(() => expect(result.current.settings.data?.model).toBe('sonnet'))

    await act(async () => {
      result.current.patch.mutate({ model: 'opus' })
      result.current.patch.mutate({ effort: 'high' })
    })
    await waitFor(() => expect(result.current.settings.data).toMatchObject({ model: 'opus', effort: 'high' }))

    // effort lands first (fast), then the model PATCH — whose response body predates effort=high.
    await act(async () => {
      const effortIdx = pending.findIndex((p) => 'effort' in p.patch)
      land(effortIdx)
    })
    // Simulate the model response carrying stale effort, as a real out-of-order reply would.
    await act(async () => {
      const p = pending.shift()!
      p.d.resolve({ ...base, model: 'opus', effort: 'medium' })
      server = { ...server, model: 'opus' }
    })
    // Before the reconcile refetch has a chance to paper over it: only `model` was taken from
    // that response.
    expect(queryClient.getQueryData<ApiSettings>(keys.settings)).toMatchObject({ model: 'opus', effort: 'high' })
    await waitFor(() => expect(mockSettings.mock.calls.length).toBeGreaterThan(1))
    await waitFor(() => expect(result.current.settings.data).toMatchObject({ model: 'opus', effort: 'high' }))
    unmount()
  })

  test('on error only the failed field rolls back', async () => {
    const { result, unmount } = await renderHook(useHarness, { wrapper })
    await waitFor(() => expect(result.current.settings.data?.model).toBe('sonnet'))

    await act(async () => {
      result.current.patch.mutate({ model: 'opus' })
      result.current.patch.mutate({ effort: 'high' })
    })
    await waitFor(() => expect(result.current.settings.data).toMatchObject({ model: 'opus', effort: 'high' }))

    await act(async () => {
      const modelIdx = pending.findIndex((p) => 'model' in p.patch)
      const [p] = pending.splice(modelIdx, 1)
      p!.d.reject(new Error('boom'))
    })
    await waitFor(() => expect(result.current.settings.data?.model).toBe('sonnet'))
    // effort's optimistic value survives its sibling's failure
    expect(queryClient.getQueryData<ApiSettings>(keys.settings)?.effort).toBe('high')
    unmount()
  })
})
