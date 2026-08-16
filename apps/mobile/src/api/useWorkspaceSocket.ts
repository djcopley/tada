import type { WsMessage } from '@tada/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useClient } from './ClientContext'
import { keys } from './queries'

const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 10000]

export interface UseWorkspaceSocketOptions {
  onRunEvent?: (msg: Extract<WsMessage, { type: 'run_event' }>) => void
}

/**
 * Opens one WebSocket per mounted workspace and keeps queries fresh as the
 * server pushes changes:
 *
 *  - `board_changed` invalidates that workspace's board, the workspace list
 *    (position/column summaries live there too), and — since a `run_event`
 *    can't be mapped back to the ticket it belongs to on the client without
 *    an extra lookup — every `['ticket', ...]` query as a blunt but correct
 *    freshness signal. Cheap: it's a prefix invalidation, not a refetch
 *    storm, and only fires on actual board-affecting changes.
 *  - `activity` and `board_changed` both invalidate `keys.activity()` — the
 *    bare `['activity']` key, which is a prefix of every scoped
 *    `keys.activity(workspaceId)` variant, so one invalidation refreshes
 *    the per-workspace feed and the cross-workspace "all" feed alike.
 *  - `run_event` is forwarded verbatim to `onRunEvent`, if given; screens
 *    that care (run activity) filter by runId and ingest into their own
 *    event feed. This hook does no run-specific bookkeeping itself.
 *
 * Reconnects on close/error with capped backoff (1s, 2s, 4s, 8s, 10s, then
 * holds at 10s) as long as the component stays mounted. The backoff attempt
 * counter resets to 0 on a successful `onopen`, so a brief connectivity blip
 * during an otherwise long healthy session starts its next reconnect back at
 * 1s rather than staying escalated at 10s. `wsId` may be `undefined` (e.g. a
 * ticket screen before its workspaceId has loaded) — in that case no socket
 * is opened.
 */
export function useWorkspaceSocket(
  wsId: number | undefined,
  { onRunEvent }: UseWorkspaceSocketOptions = {},
  WebSocketCtor: typeof WebSocket = globalThis.WebSocket,
) {
  const client = useClient()
  const queryClient = useQueryClient()
  const onRunEventRef = useRef(onRunEvent)
  useEffect(() => {
    onRunEventRef.current = onRunEvent
  }, [onRunEvent])

  useEffect(() => {
    if (wsId === undefined) return

    let cancelled = false
    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0

    const connect = () => {
      if (cancelled) return
      socket = new WebSocketCtor(client.wsUrl(wsId))

      socket.onopen = () => {
        attempt = 0
      }

      socket.onmessage = (event) => {
        let msg: WsMessage
        try {
          msg = JSON.parse(String(event.data)) as WsMessage
        } catch {
          return
        }
        if (msg.type === 'board_changed') {
          void queryClient.invalidateQueries({ queryKey: keys.board(wsId) })
          void queryClient.invalidateQueries({ queryKey: keys.workspaces })
          void queryClient.invalidateQueries({ queryKey: ['ticket'] })
          void queryClient.invalidateQueries({ queryKey: keys.activity() })
        } else if (msg.type === 'activity') {
          void queryClient.invalidateQueries({ queryKey: keys.activity() })
        } else if (msg.type === 'run_event') {
          // A status event is the run finishing/starting: refresh the run itself (the run screen
          // otherwise kept polling and showing "live" until a refocus) and the board it's on.
          if (msg.event.type === 'status') {
            void queryClient.invalidateQueries({ queryKey: keys.run(msg.runId) })
            void queryClient.invalidateQueries({ queryKey: ['latestRunEvent', msg.runId] })
          }
          onRunEventRef.current?.(msg)
        }
      }

      const scheduleReconnect = () => {
        if (cancelled || reconnectTimer !== null) return
        const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]
        attempt += 1
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          connect()
        }, delay)
      }

      socket.onclose = scheduleReconnect
      socket.onerror = scheduleReconnect
    }

    connect()

    return () => {
      cancelled = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (socket) {
        socket.onopen = null
        socket.onclose = null
        socket.onerror = null
        socket.onmessage = null
        socket.close()
      }
    }
  }, [wsId, client, queryClient, WebSocketCtor])
}
