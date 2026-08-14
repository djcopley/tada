import { useMutation, useQuery } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'
import { Pressable, Text } from 'react-native'
import { AppQueryProvider } from '../app/_layout'
import { ApiError } from '../src/api/client'
import { ConnectionProvider } from '../src/ConnectionContext'
import { ToastHost } from '../src/toast'

// Only AppQueryProvider/ToastHost are exercised here; stub the router so
// importing app/_layout doesn't drag expo-router's native stack into Jest.
jest.mock('expo-router', () => ({
  Stack: () => null,
  Redirect: () => null,
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

function FailingProbe() {
  useQuery({
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

    // Give the rejected mutation a tick to settle, then assert no fallback
    // toast appeared — a 409 is a screen's responsibility to surface.
    await waitFor(() => {
      expect(screen.getByTestId('fire-mutation')).toBeTruthy()
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByTestId('toast-message')).toBeNull()
  })
})
