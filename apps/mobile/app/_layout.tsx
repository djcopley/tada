import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { type ReactNode, useMemo } from 'react'
import { ApiError } from '../src/api/client'
import { ConnectionProvider, useConnection } from '../src/ConnectionContext'
import { ToastHost } from '../src/toast'

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
      <AppQueryProvider>
        <Stack />
        <ToastHost />
      </AppQueryProvider>
    </ConnectionProvider>
  )
}
