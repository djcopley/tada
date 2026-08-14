import { Redirect, Stack } from 'expo-router'
import { useConnection } from '../../src/ConnectionContext'

/**
 * Guards every screen under /workspaces. ConnectionProvider only ever
 * renders its children once the persisted connection has loaded, so by the
 * time this runs `connection` reflects the settled state — a 401 elsewhere
 * that clears it will redirect these screens too instead of leaving them
 * mounted with a null client.
 */
export default function WorkspacesLayout() {
  const { connection } = useConnection()
  if (!connection) return <Redirect href="/connect" />
  return (
    <Stack>
      {/* The list screen draws its own "Workspaces" heading. */}
      <Stack.Screen name="index" options={{ headerShown: false }} />
      {/* Board overrides this with the workspace name once it loads. */}
      <Stack.Screen name="[id]/board" options={{ title: 'Board' }} />
      <Stack.Screen name="[id]/settings" options={{ title: 'Settings' }} />
      <Stack.Screen name="[id]/memory/index" options={{ title: 'Memory' }} />
      <Stack.Screen name="[id]/memory/[file]" options={{ title: 'Note' }} />
    </Stack>
  )
}
