import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { type ReactNode, useEffect, useMemo } from 'react'
import { ApiError } from '../src/api/client'
import { ConnectionProvider, useConnection } from '../src/ConnectionContext'
import { registerForPush, useNotificationDeepLinks } from '../src/push'
import { ToastHost } from '../src/toast'

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
    return new QueryClient({
      queryCache: new QueryCache({ onError }),
      mutationCache: new MutationCache({ onError }),
    })
  }, [disconnect])

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

export default function RootLayout() {
  return (
    <ConnectionProvider>
      <PushSetup />
      <AppQueryProvider>
        <Stack />
        <ToastHost />
      </AppQueryProvider>
    </ConnectionProvider>
  )
}
