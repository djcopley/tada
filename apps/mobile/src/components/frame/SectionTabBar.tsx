import type { BottomTabBarProps } from 'expo-router/js-tabs'
import { useLayout } from '../../layout'
import type { SectionKey } from '../../nav'
import { SectionRail, SectionStrip } from './SectionFrame'

/** Tab route name (app/(tabs)/…) → the section it is. */
const SECTION_BY_ROUTE: Record<string, SectionKey> = {
  index: 'control',
  board: 'board',
  memory: 'memory',
  settings: 'settings',
}

/**
 * The tabs navigator's `tabBar`: the Rail on the left when wide, the BottomStrip below when
 * narrow. Living here — outside the animated scenes — is the whole point: switching sections
 * shifts only the content, and the frame itself never slides in and out. The active section
 * comes from the navigator's own state, so a deep link is reflected without any screen having to
 * tell us.
 */
export function SectionTabBar({ state }: BottomTabBarProps) {
  const { wide } = useLayout()
  const route = state.routes[state.index]
  const active = (route && SECTION_BY_ROUTE[route.name]) ?? 'control'
  if (wide) return <SectionRail active={active} testID={`${active}-rail`} />
  return <SectionStrip active={active} testID={`${active}-bottom-strip`} />
}
