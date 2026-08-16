import { useFocusEffect } from 'expo-router'
import { useCallback } from 'react'
import { useActiveWorkspace } from './api/queries'

/**
 * A workspace-scoped tab (Board / Memory / Settings) makes its workspace the active one whenever
 * it is focused, so Control's strip, the switcher's check mark and the next Board tap all follow
 * the workspace you were just looking at instead of snapping back to the first one.
 */
export function useClaimActiveWorkspace(wsId: number | undefined): void {
  const { setActiveWorkspaceId } = useActiveWorkspace()
  useFocusEffect(
    useCallback(() => {
      if (wsId !== undefined && Number.isFinite(wsId)) setActiveWorkspaceId(wsId)
    }, [wsId, setActiveWorkspaceId]),
  )
}
