import type { BottomTabBarProps } from 'expo-router/js-tabs'
import type { SectionKey } from '../../nav'
import { useLayout } from '../../layout'
import { SectionRail, SectionStrip, useFrameWorkspaceId } from './SectionFrame'

/** Tab route name (app/workspaces/…) → the section it is. */
const SECTION_BY_ROUTE: Record<string, SectionKey> = {
  index: 'control',
  '[id]/board': 'board',
  '[id]/memory': 'memory',
  '[id]/settings': 'settings',
}

/**
 * The tabs navigator's `tabBar`: the Rail on the left when wide, the BottomStrip below when
 * narrow. Living here — outside the animated scenes — is the whole point: switching sections
 * shifts only the content, and the frame itself never slides in and out. The active section and
 * its workspace come from the navigator's own state, so a deep link or a workspace switch that
 * re-parameterises a tab is reflected without any screen having to tell us.
 */
export function SectionTabBar({ state }: BottomTabBarProps) {
  const { wide } = useLayout()
  const route = state.routes[state.index]
  const active = (route && SECTION_BY_ROUTE[route.name]) ?? 'control'
  const rawId = (route?.params as { id?: string } | undefined)?.id
  const workspaceId = useFrameWorkspaceId(rawId === undefined ? undefined : Number(rawId))
  if (wide) return <SectionRail active={active} workspaceId={workspaceId} testID={`${active}-rail`} />
  return <SectionStrip active={active} workspaceId={workspaceId} testID={`${active}-bottom-strip`} />
}
