import { Redirect, Tabs } from 'expo-router'
import { useConnection } from '../../src/ConnectionContext'

/**
 * Control / Board / Memory / Settings are tabs, not a stack: switching between them slides
 * sideways in the direction of travel (`animation: 'shift'`) and never piles screens up, and
 * picking another workspace just re-parameterises the Board/Memory/Settings tab in place. The
 * app draws its own Rail/BottomStrip, so the tab bar itself is hidden. Ticket and run screens
 * live in the root stack and still push over the whole group.
 *
 * Connected-only, like the other groups: redirects to /connect when no connection is stored
 * (ConnectionProvider only renders children once the persisted connection has loaded, so this
 * reflects the settled state — a 401 anywhere that clears it redirects these screens too).
 */
export default function WorkspacesLayout() {
  const { connection } = useConnection()
  if (!connection) return <Redirect href="/connect" />
  return (
    <Tabs
      tabBar={() => null}
      backBehavior="initialRoute"
      screenOptions={{ headerShown: false, animation: 'shift', lazy: true }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="[id]/board" />
      <Tabs.Screen name="[id]/memory" />
      <Tabs.Screen name="[id]/settings" />
    </Tabs>
  )
}
