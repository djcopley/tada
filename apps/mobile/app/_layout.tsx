import {
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
  IBMPlexMono_600SemiBold,
} from '@expo-google-fonts/ibm-plex-mono'
import {
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
} from '@expo-google-fonts/instrument-sans'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { type ReactNode, useEffect, useMemo } from 'react'
import { StyleSheet } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ApiError } from '../src/api/client'
import { ConnectionProvider, useConnection } from '../src/ConnectionContext'
import { WorkspaceSwitcher } from '../src/components/WorkspaceSwitcher'
import { ThemeProvider, useTheme } from '../src/design/ThemeContext'
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

/** Status bar tracks the Ink theme, not the OS scheme. */
function ThemedStatusBar() {
  const { scheme } = useTheme()
  return <StatusBar style={scheme === 'day' ? 'dark' : 'light'} />
}

/**
 * WorkspaceSwitcher needs a TadaClient (via useClient), which only exists
 * once ConnectionProvider has a saved connection — guard its mount so the
 * connect screen (no connection yet) never renders it.
 */
function ConnectedWorkspaceSwitcher() {
  const { connection } = useConnection()
  if (!connection) return null
  return <WorkspaceSwitcher />
}

export default function RootLayout() {
  // Screens design their own type with these faces; hold rendering one frame
  // until they're ready so nothing flashes in the system font.
  const [fontsLoaded] = useFonts({
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
  })
  if (!fontsLoaded) return null

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ThemedStatusBar />
          <ConnectionProvider>
            <PushSetup />
            <AppQueryProvider>
              {/*
                Every group under here (/workspaces, /tickets, /runs) has its own
                Stack. Headers are drawn by the shared AppHeader component inside
                each screen, so every native header stays hidden.
              */}
              <Stack screenOptions={{ headerShown: false }} />
              <ConnectedWorkspaceSwitcher />
              <ToastHost />
            </AppQueryProvider>
          </ConnectionProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
})
