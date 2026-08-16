import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Pressable, Text } from 'react-native'
import { AppQueryProvider } from '../app/_layout'
import { ApiError } from '../src/api/client'
import { ConnectionProvider, useConnection } from '../src/ConnectionContext'
import { ToastHost } from '../src/toast'

// Only AppQueryProvider/ToastHost are exercised here; stub the router so
// importing app/_layout doesn't drag expo-router's native stack into Jest.
jest.mock('expo-router', () => ({
  Stack: () => null,
  Redirect: () => null,
  DarkTheme: { dark: true, colors: {} },
  DefaultTheme: { dark: false, colors: {} },
  ThemeProvider: ({ children }: { children: unknown }) => children,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}))

// app/_layout pulls in src/push, whose expo-notifications import needs
// native modules Jest doesn't have — stub it like push.test does.
jest.mock('expo-notifications', () => ({
  getExpoPushTokenAsync: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
}))

jest.mock('../src/settings', () => ({
  loadConnection: jest.fn(async () => ({ baseUrl: 'https://example.com', token: 'tok' })),
  saveConnection: jest.fn(async () => undefined),
  clearConnection: jest.fn(async () => undefined),
}))

import { clearConnection } from '../src/settings'

// Every probe hook below sets `gcTime: 0`: AppQueryProvider builds the app's real QueryClient,
// whose default 5-minute garbage-collect timers (armed when a probe unmounts) would otherwise keep
// this Jest worker alive long after the suite ends ("worker process has failed to exit
// gracefully").
const NO_GC = { gcTime: 0 } as const

function FailingProbe() {
  useQuery({
    ...NO_GC,
    queryKey: ['probe'],
    queryFn: () => {
      throw new ApiError(401, { error: 'unauthorized' })
    },
    retry: false,
  })
  return null
}

/** A minimal mutation-firing component so tests can drive the real
 * MutationCache.onError path configured in AppQueryProvider. */
function FailingMutationButton({ error }: { error: unknown }) {
  const mutation = useMutation({
    ...NO_GC,
    mutationFn: async () => {
      throw error
    },
  })
  return (
    <Pressable testID="fire-mutation" onPress={() => mutation.mutate()}>
      <Text>fire</Text>
    </Pressable>
  )
}

function renderWithProvider(children: ReactNode) {
  return render(
    <ConnectionProvider>
      <AppQueryProvider>
        {children}
        <ToastHost />
      </AppQueryProvider>
    </ConnectionProvider>,
  )
}

describe('global 401 handling', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('a 401 ApiError from any query triggers disconnect', async () => {
    await render(
      <ConnectionProvider>
        <AppQueryProvider>
            <FailingProbe />
        </AppQueryProvider>
      </ConnectionProvider>,
    )

    await waitFor(() => {
      expect(clearConnection).toHaveBeenCalled()
    })
  })
})

describe('global mutation error fallback toast', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('a non-401/409 ApiError from a mutation shows the body\'s error message as a toast', async () => {
    await renderWithProvider(<FailingMutationButton error={new ApiError(500, { error: 'boom' })} />)

    await fireEvent.press(screen.getByTestId('fire-mutation'))

    await waitFor(() => {
      expect(screen.getByTestId('toast-message')).toHaveTextContent('boom')
    })
  })

  test('a mutation error with no body.error string falls back to a generic message', async () => {
    await renderWithProvider(<FailingMutationButton error={new ApiError(500, {})} />)

    await fireEvent.press(screen.getByTestId('fire-mutation'))

    await waitFor(() => {
      expect(screen.getByTestId('toast-message')).toHaveTextContent('Something went wrong')
    })
  })

  test('a plain network error from a mutation also shows the fallback toast (and does not crash)', async () => {
    await renderWithProvider(<FailingMutationButton error={new Error('network down')} />)

    await fireEvent.press(screen.getByTestId('fire-mutation'))

    await waitFor(() => {
      expect(screen.getByTestId('toast-message')).toHaveTextContent('Something went wrong')
    })
  })

  test('a 401 mutation error triggers disconnect and does not also show the fallback toast', async () => {
    await renderWithProvider(<FailingMutationButton error={new ApiError(401, { error: 'unauthorized' })} />)

    await fireEvent.press(screen.getByTestId('fire-mutation'))

    await waitFor(() => {
      expect(clearConnection).toHaveBeenCalled()
    })
    expect(screen.queryByTestId('toast-message')).toBeNull()
  })

  test('a 409 mutation error does not trigger the fallback toast, leaving room for the screen\'s own specific toast', async () => {
    await renderWithProvider(<FailingMutationButton error={new ApiError(409, { error: 'conflict' })} />)

    await fireEvent.press(screen.getByTestId('fire-mutation'))

    // Give the rejected mutation a tick to settle (inside act, so its state update doesn't land
    // outside one), then assert no fallback toast appeared — a 409 is a screen's responsibility
    // to surface.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(screen.queryByTestId('toast-message')).toBeNull()
  })
})

describe('query cache reset across connections', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('an inactive cache entry (no live observer) does not survive disconnect -> reconnect', async () => {
    // Seeded directly rather than via a mounted useQuery: with resetQueries() (not clear()),
    // an *active* observer's entry gets reset AND refetched — this test is specifically about
    // the no-observer case, where reset must still leave no stale data behind for whenever
    // something eventually reads this key again.
    function CacheInspector() {
      const qc = useQueryClient()
      const { connect, disconnect } = useConnection()
      const [snapshot, setSnapshot] = useState('unchecked')
      return (
        <>
          <Pressable testID="seed-cache" onPress={() => qc.setQueryData(['probe-data'], 'seeded')}>
            <Text>seed</Text>
          </Pressable>
          <Pressable
            testID="check-cache"
            onPress={() => setSnapshot(String(qc.getQueryData(['probe-data'])))}
          >
            <Text>check</Text>
          </Pressable>
          <Text testID="cache-snapshot">{snapshot}</Text>
          <Pressable testID="do-disconnect" onPress={() => void disconnect()}>
            <Text>disconnect</Text>
          </Pressable>
          <Pressable
            testID="do-reconnect"
            onPress={() => void connect({ baseUrl: 'https://example.com', token: 'tok2' })}
          >
            <Text>reconnect</Text>
          </Pressable>
        </>
      )
    }

    await renderWithProvider(<CacheInspector />)

    await fireEvent.press(screen.getByTestId('seed-cache'))
    await fireEvent.press(screen.getByTestId('check-cache'))
    expect(screen.getByTestId('cache-snapshot')).toHaveTextContent('seeded')

    await fireEvent.press(screen.getByTestId('do-disconnect'))
    await fireEvent.press(screen.getByTestId('check-cache'))
    expect(screen.getByTestId('cache-snapshot')).toHaveTextContent('undefined')

    // Reconnecting — same server, replaced token — must not resurrect the old data either.
    await fireEvent.press(screen.getByTestId('do-reconnect'))
    await fireEvent.press(screen.getByTestId('check-cache'))
    expect(screen.getByTestId('cache-snapshot')).toHaveTextContent('undefined')
  })

  test('a same-server token replace makes a still-mounted live observer actually refetch and re-render with new data', async () => {
    // This is the case clear() got wrong: Settings' "Replace" flow never navigates away, so its
    // useWorkspace/useAdapters-style observers stay mounted and subscribed straight through the
    // identity change. Proving this needs more than checking the store — the queryFn must be
    // called again AND the still-mounted component must re-render with the new result, not just
    // have its cache entry silently wiped out from under it.
    let call = 0
    const probeFetch = jest.fn(async () => {
      call += 1
      return call === 1 ? 'pre-replace' : 'post-replace'
    })

    function Probe() {
      const { data } = useQuery({ ...NO_GC, queryKey: ['probe-data'], queryFn: probeFetch, staleTime: Infinity })
      return <Text testID="probe-value">{data ?? 'loading'}</Text>
    }

    function ReplaceTokenButton() {
      const { connect } = useConnection()
      return (
        <Pressable
          testID="do-replace-token"
          onPress={() => void connect({ baseUrl: 'https://example.com', token: 'tok2' })}
        >
          <Text>replace token</Text>
        </Pressable>
      )
    }

    await renderWithProvider(
      <>
        <Probe />
        <ReplaceTokenButton />
      </>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('probe-value')).toHaveTextContent('pre-replace')
    })
    expect(probeFetch).toHaveBeenCalledTimes(1)

    // Same baseUrl as the settings mock's initial connection ('https://example.com'), only the
    // token changes — the in-place "Replace" path, not a full disconnect/reconnect.
    await fireEvent.press(screen.getByTestId('do-replace-token'))

    await waitFor(() => {
      expect(screen.getByTestId('probe-value')).toHaveTextContent('post-replace')
    })
    expect(probeFetch).toHaveBeenCalledTimes(2)
  })

  test('a normal launch (connection already settled before AppQueryProvider mounts) does not clear on mount', async () => {
    const probeFetch = jest.fn(async () => 'seeded')

    function Probe() {
      const { data } = useQuery({ ...NO_GC, queryKey: ['probe-data'], queryFn: probeFetch, staleTime: Infinity })
      return <Text testID="probe-value">{data ?? 'loading'}</Text>
    }

    await renderWithProvider(<Probe />)

    await waitFor(() => {
      expect(screen.getByTestId('probe-value')).toHaveTextContent('seeded')
    })
    // No connect/disconnect happened — the identity effect's initial run must not itself
    // trigger a clear (that would double-fetch on every ordinary app launch).
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(probeFetch).toHaveBeenCalledTimes(1)
  })
})
