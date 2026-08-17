import { Redirect } from 'expo-router'
import { Tabs } from 'expo-router/js-tabs'
import { StyleSheet } from 'react-native'
import { useConnection } from '../../src/ConnectionContext'
import { SectionTabBar } from '../../src/components/frame/SectionTabBar'
import { useLayout } from '../../src/layout'

/**
 * Control / Board / Memory / Settings are tabs, not a stack: switching between them never piles
 * screens up. Ticket, run and note screens live in the root stack and push over the whole group.
 *
 * The frame (web Rail / mobile BottomStrip) is the navigator's tab bar — drawn once, outside the
 * scenes — so it stays put while the content switches. Narrow is the mobile paradigm and slides
 * sideways in the direction of travel (`animation: 'shift'`); wide is pages behind a sidebar and
 * just swaps, the way a website does.
 *
 * Connected-only: redirects to /connect when no connection is stored (ConnectionProvider only
 * renders children once the persisted connection has loaded, so this reflects the settled state
 * — a 401 anywhere that clears it redirects these screens too).
 */
export default function TabsLayout() {
  const { connection } = useConnection()
  const { wide } = useLayout()
  if (!connection) return <Redirect href="/connect" />
  return (
    <Tabs
      // The navigator calls `tabBar` as a plain function, so hooks only work behind an element.
      tabBar={(props) => <SectionTabBar {...props} />}
      // Back retraces the tabs you actually visited (Board → Settings → back lands on Board, as
      // the browser does on web), rather than always snapping to Control.
      backBehavior="history"
      screenOptions={({ navigation }) => ({
        headerShown: false,
        lazy: true,
        animation: wide ? 'none' : 'shift',
        tabBarPosition: wide ? 'left' : 'bottom',
        // On web, react-native-screens is off, so inactive tab scenes stay laid out beneath the
        // active one — still focusable with Tab and read by screen readers. Wide has no scene
        // animation, so a blurred scene can simply be display:none. (Narrow keeps them laid out:
        // the shift animation needs both scenes visible while it runs.)
        sceneStyle: wide && !navigation.isFocused() ? styles.hiddenScene : undefined,
      })}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="board" />
      <Tabs.Screen name="memory" />
      <Tabs.Screen name="settings" />
    </Tabs>
  )
}

const styles = StyleSheet.create({
  hiddenScene: { display: 'none' },
})
