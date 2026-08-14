import { Redirect, Stack } from 'expo-router'
import { useConnection } from '../ConnectionContext'

/**
 * Connected-only route group: redirects to /connect when no connection is
 * stored. ConnectionProvider only renders children once the persisted
 * connection has loaded, so `connection` reflects the settled state — a 401
 * anywhere that clears it redirects these screens too. Native headers stay
 * hidden; every screen draws the shared AppHeader instead.
 */
export function GuardedStack() {
  const { connection } = useConnection()
  if (!connection) return <Redirect href="/connect" />
  return <Stack screenOptions={{ headerShown: false }} />
}
