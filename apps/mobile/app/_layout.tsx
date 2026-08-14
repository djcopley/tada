import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { type ReactNode, useEffect, useMemo } from 'react'
import { ApiError } from '../src/api/client'
import { ConnectionProvider, useConnection } from '../src/ConnectionContext'
import { registerForPush, useNotificationDeepLinks } from '../src/push'
import { showToast, ToastHost } from '../src/toast'

const GENERIC_MUTATION_ERROR = 'Something went wrong'

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && typeof error.body === 'object' && error.body !== null && 'error' in error.body) {
    const value = (error.body as Record<string, unknown>).error
    if (typeof value === 'string') return value
  }
  return GENERIC_MUTATION_ERROR
}

/**
 * Registers this device for push once per connection (the effect re-runs
 * only when `connection` itself changes, i.e. on connect/disconnect — not
 * on every render, even though `client` is a fresh instance each render)
 * and keeps notification-tap deep links wired for the lifetime of the app.
 * Renders nothing; must live inside ConnectionProvider to reach the client.
 */
function PushSetup() {
  const { connection, client } = useConnection()

  useEffect(() => {
    if (!connection || !client) return
    void registerForPush(client)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection])

  useNotificationDeepLinks()

  return null
}

/**
 * Owns the TanStack Query client. Lives inside ConnectionProvider so its
 * global error handler can react to a 401 from any query/mutation by
 * dropping the stored connection, which routing then turns into a redirect
 * to /connect.
 */
export function AppQueryProvider({ children }: { children: ReactNode }) {
  const { disconnect } = useConnection()

  const queryClient = useMemo(() => {
    const onError = (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        void disconnect()
      }
    }
    // Mutations get an extra fallback: any ApiError/network failure that
    // isn't a 401 (handled above by the global disconnect) and isn't a 409
    // (screens that care about conflicts already show their own specific
    // toast — surfacing this one too would double-toast) shows a generic
    // toast, so a failing mutation is never silent just because a screen
    // didn't bother wiring its own onError.
    const onMutationError = (error: unknown) => {
      onError(error)
      if (error instanceof ApiError && (error.status === 401 || error.status === 409)) return
      showToast(errorMessage(error))
    }
    return new QueryClient({
      queryCache: new QueryCache({ onError }),
      mutationCache: new MutationCache({ onError: onMutationError }),
    })
  }, [disconnect])

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

export default function RootLayout() {
  return (
    <ConnectionProvider>
      <PushSetup />
      <AppQueryProvider>
        {/*
          Every group under here (/workspaces, /tickets, /runs) has its own
          Stack that renders the visible header. Without this the root Stack
          draws a second header above it titled after the group segment.
        */}
        <Stack screenOptions={{ headerShown: false }} />
        <ToastHost />
      </AppQueryProvider>
    </ConnectionProvider>
  )
}
