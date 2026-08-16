import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useActiveWorkspace, useBoards, useWorkspaces } from '../../api/queries'
import { countNeedsYou } from '../../control'
import { useTheme } from '../../design/ThemeContext'
import { space } from '../../design/tokens'
import type { SectionKey } from '../../nav'
import { BottomStrip, Rail } from '../ui'

type Props = {
  active: SectionKey
  /** The workspace Board/Memory/Settings links scope to; undefined disables them. */
  workspaceId?: number
  testID?: string
}

/**
 * The web Rail, fed from the query cache: workspace line from the workspace list, Control's
 * needs-you badge from every board (the same queries Control itself keeps warm, so this costs
 * no extra requests). Drawn once by the tabs frame (see app/workspaces/_layout.tsx) rather than
 * per screen, so it stays put while the section content changes underneath.
 */
export function SectionRail({ active, workspaceId, testID }: Props) {
  const { data: workspaces } = useWorkspaces()
  const list = workspaces ?? []
  const workspace = list.find((w) => w.id === workspaceId)
  const boards = useBoards(list.map((w) => w.id))
  const needsYouCount = countNeedsYou(boards.map((b) => b.data))
  return (
    <Rail
      active={active}
      workspaceId={workspaceId}
      workspaceName={workspace?.name}
      sourceCount={workspace?.sourceCount}
      needsYouCount={needsYouCount}
      testID={testID}
    />
  )
}

/** The mobile BottomStrip in its padded, safe-area-aware well. Settings has no strip (it is a
 * pushed-feeling page with its own back header), so callers skip this for that section. */
export function SectionStrip({ active, workspaceId, testID }: Props) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  if (active === 'settings') return null
  return (
    <View
      style={[styles.stripWell, { backgroundColor: colors.ground, paddingBottom: space.md + insets.bottom }]}
    >
      <BottomStrip active={active} workspaceId={workspaceId} testID={testID} />
    </View>
  )
}

/**
 * The workspace a section's frame scopes to. Board/Memory/Settings carry it in the route;
 * Control (and global memory) fall back to the device's active workspace, then the first one —
 * the same rule Control uses for its own memory card.
 */
export function useFrameWorkspaceId(routeId: number | undefined): number | undefined {
  const { activeWorkspaceId } = useActiveWorkspace()
  const { data: workspaces } = useWorkspaces()
  return useMemo(() => {
    if (routeId !== undefined && Number.isFinite(routeId)) return routeId
    return activeWorkspaceId ?? workspaces?.[0]?.id
  }, [routeId, activeWorkspaceId, workspaces])
}

const styles = StyleSheet.create({
  stripWell: {
    paddingHorizontal: space.md,
    paddingTop: space.md,
  },
})
