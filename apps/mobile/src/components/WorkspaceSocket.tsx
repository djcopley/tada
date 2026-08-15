import { useWorkspaceSocket } from '../api/useWorkspaceSocket'

/**
 * Renderless: opens (and keeps alive, with reconnect/backoff) one workspace's socket via the
 * existing `useWorkspaceSocket` hook, which invalidates board/workspace/activity queries as
 * `board_changed`/`activity` messages arrive.
 *
 * `useWorkspaceSocket` binds a single workspace id at hook-call time, which is fine for a
 * screen scoped to one workspace but not for Control, which watches every workspace at once —
 * a variable-length list can't drive a variable number of hook calls directly (Rules of Hooks).
 * Mounting one of these per workspace, keyed by id, gives Control one live socket per workspace
 * without breaking that rule.
 */
export function WorkspaceSocket({
  workspaceId,
  WebSocketCtor,
}: {
  workspaceId: number
  WebSocketCtor?: typeof WebSocket
}) {
  useWorkspaceSocket(workspaceId, undefined, WebSocketCtor)
  return null
}
