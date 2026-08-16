import { useRouter } from 'expo-router'
import { AppHeader, EmptyState, Screen } from '../src/components/ui'
import { goToControl } from '../src/nav'

/** Our own page for a URL that matches no route (a typo, a stale link) — instead of Expo
 * Router's default "Unmatched Route" page with its sitemap link. */
export default function NotFound() {
  const router = useRouter()
  return (
    <Screen testID="not-found">
      <AppHeader title="tada" back backHref="/workspaces" />
      <EmptyState
        icon="alert-circle"
        message="There's nothing at this address."
        action={{ label: 'Back to Control', onPress: () => goToControl(router) }}
      />
    </Screen>
  )
}
