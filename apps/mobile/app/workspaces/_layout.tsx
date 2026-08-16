import { Redirect } from 'expo-router'
import { Tabs } from 'expo-router/js-tabs'
import { useConnection } from '../../src/ConnectionContext'
import { SectionTabBar } from '../../src/components/frame/SectionTabBar'
import { useLayout } from '../../src/layout'

/**
 * Control / Board / Memory / Settings are tabs, not a stack: switching between them never piles
 * screens up, and picking another workspace just re-parameterises the Board/Memory/Settings tab
 * in place. Ticket and run screens live in the root stack and still push over the whole group.
 *
 * The frame (web Rail / mobile BottomStrip) is the navigator's tab bar — drawn once, outside the
 * scenes — so it stays put while the content switches. Narrow is the mobile paradigm and slides
 * sideways in the direction of travel (`animation: 'shift'`); wide is pages behind a sidebar and
 * just swaps, the way a website does.
 *
 * Connected-only, like the other groups: redirects to /connect when no connection is stored
 * (ConnectionProvider only renders children once the persisted connection has loaded, so this
 * reflects the settled state — a 401 anywhere that clears it redirects these screens too).
 */
export default function WorkspacesLayout() {
  const { connection } = useConnection()
  const { wide } = useLayout()
  if (!connection) return <Redirect href="/connect" />
  return (
    <Tabs
      // The navigator calls `tabBar` as a plain function, so hooks only work behind an element.
      tabBar={(props) => <SectionTabBar {...props} />}
      // Back retraces the tabs you actually visited (Board → gear → Settings → back lands on
      // Board, as the browser does on web), rather than always snapping to Control.
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        lazy: true,
        animation: wide ? 'none' : 'shift',
        tabBarPosition: wide ? 'left' : 'bottom',
      }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="[id]/board" />
      <Tabs.Screen name="[id]/memory" />
      <Tabs.Screen name="[id]/settings" />
    </Tabs>
  )
}
