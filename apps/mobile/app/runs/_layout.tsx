import { Redirect, Stack } from 'expo-router'
import { useConnection } from '../../src/ConnectionContext'

/**
 * Mirrors app/tickets/_layout.tsx: /runs sits outside the /workspaces and
 * /tickets subtrees (ticket detail navigates straight to /runs/[id]) so it
 * needs its own copy of the same connected-only guard.
 */
export default function RunsLayout() {
  const { connection } = useConnection()
  if (!connection) return <Redirect href="/connect" />
  return (
    <Stack>
      <Stack.Screen name="[id]" options={{ title: 'Run' }} />
    </Stack>
  )
}
