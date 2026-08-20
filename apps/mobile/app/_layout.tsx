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
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavigationThemeProvider } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { type ReactNode, useEffect, useMemo, useRef } from 'react'
import { StyleSheet } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { WebSafeAreaShim } from '../src/design/webSafeArea'
import { AppSocketProvider } from '../src/api/AppSocketContext'
import { ApiError } from '../src/api/client'
import { ConnectionProvider, useConnection } from '../src/ConnectionContext'
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
  const { disconnect, connection } = useConnection()

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
      defaultOptions: {
        queries: {
          // A 4xx (404 for an unknown id, 400 for a bad one) won't get better on retry — surface
          // it immediately so screens can show their not-found state instead of a long skeleton.
          retry: (failureCount, error) =>
            !(error instanceof ApiError && error.status < 500) && failureCount < 3,
        },
      },
    })
  }, [disconnect])

  // The QueryClient itself now survives connect/disconnect (ConnectionProvider always renders
  // through the same ClientProvider slot, so this subtree no longer remounts on that transition
  // — see ConnectionContext.tsx). That's the right call for local component state, but it means
  // nothing implicitly wipes the query cache anymore either: without this, a disconnect (incl.
  // the global 401 path) followed by reconnecting — same server with a replaced token, or a
  // different server entirely — would render stale workspaces/boards/memory/activity from the
  // old connection, and server-assigned ids could collide across servers.
  //
  // resetQueries() — not clear() — whenever the connection's identity changes, skipping the
  // initial mount (nothing cached yet, no need to reset and no reason to force a double-fetch on
  // a normal launch). This matters for the in-place case specifically: replacing the API token
  // for the *same* server (Settings' "Replace" flow) doesn't navigate anywhere, so the screen
  // stays mounted with live query observers throughout. queryCache.clear() only removes cache
  // entries from the store — it doesn't notify a still-subscribed observer, so a mounted screen
  // would keep rendering its pre-replace data indefinitely (the old bug this replaced). Query's
  // own reset(), which resetQueries() calls per matching query, dispatches a state change that
  // *does* notify observers, and resetQueries() additionally refetches every currently-active
  // one — exactly what a still-mounted screen needs to pick up data from the new connection.
  // (Screens that unmount instead, e.g. after a full disconnect, become inactive as part of the
  // same render pass via GuardedStack's redirect — see src/components/GuardedStack.tsx — so
  // resetQueries() never tries to refetch them with a stale or absent client.)
  //
  // Deliberately not layering clear() in alongside this: queryCache.findAll() (which
  // resetQueries() uses to find what to reset) only sees entries still in the cache, so clear()
  // before it would leave resetQueries() with nothing to act on, and clear()'s cancel-in-flight-
  // fetch behavior right after would abort the very refetches resetQueries() just kicked off.
  // resetQueries() alone is the minimal combination that's actually correct — inactive entries
  // it resets (rather than removes) still show no stale data (state resets to empty/pending) and
  // fall out of the cache normally via their configured gcTime once nothing observes them.
  const identity = connection ? `${connection.baseUrl}::${connection.token}` : null
  const previousIdentityRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (previousIdentityRef.current === undefined) {
      previousIdentityRef.current = identity
      return
    }
    if (previousIdentityRef.current !== identity) {
      void queryClient.resetQueries()
    }
    previousIdentityRef.current = identity
  }, [identity, queryClient])

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

/** Status bar tracks the Ink theme, not the OS scheme. */
function ThemedStatusBar() {
  const { scheme } = useTheme()
  return <StatusBar style={scheme === 'day' ? 'dark' : 'light'} />
}

/**
 * Hands the navigators our palette. Without this they fall back to React Navigation's default
 * light theme, and the tabs' 'shift' animation (which slides scenes apart) exposes that
 * background as a light band/flash on the dark ground during every section switch.
 */
function NavigationTheme({ children }: { children: ReactNode }) {
  const { scheme, colors } = useTheme()
  const theme = useMemo(() => {
    const base = scheme === 'day' ? DefaultTheme : DarkTheme
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: colors.live,
        background: colors.ground,
        card: colors.ground,
        text: colors.text,
        border: colors.borderSubtle,
      },
    }
  }, [scheme, colors])
  return <NavigationThemeProvider value={theme}>{children}</NavigationThemeProvider>
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
        {/* Inside the provider, because it corrects the insets the provider reports — an
            installed iOS PWA reports none. See webSafeArea.tsx. */}
        <WebSafeAreaShim>
          <ThemeProvider>
            <ThemedStatusBar />
            <ConnectionProvider>
              <PushSetup />
              <AppQueryProvider>
                {/*
                  Every group under here ((tabs), /tickets, /runs, /notes) has its own Stack.
                  Headers are drawn by the shared AppHeader component inside each screen, so every
                  native header stays hidden.
                */}
                <AppSocketProvider>
                  <NavigationTheme>
                    <Stack screenOptions={{ headerShown: false }} />
                  </NavigationTheme>
                </AppSocketProvider>
                <ToastHost />
              </AppQueryProvider>
            </ConnectionProvider>
          </ThemeProvider>
        </WebSafeAreaShim>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
})
