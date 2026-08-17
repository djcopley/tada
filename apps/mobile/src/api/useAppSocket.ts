import type { WsMessage } from '@tada/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useClient } from './ClientContext'
import { keys } from './queries'

const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 10000]

export interface UseAppSocketOptions {
  onRunEvent?: (msg: Extract<WsMessage, { type: 'run_event' }>) => void
}

/**
 * Opens the one WebSocket (there is one board, one room) and keeps queries fresh as the server
 * pushes changes:
 *
 *  - `board_changed` invalidates the board, every `['ticket', ...]` query (a blunt but correct
 *    freshness signal — a thread/run change can't be mapped back to its ticket client-side), the
 *    activity feed and memory (a human keep/dismiss or agent proposal rides on the same signal).
 *  - `activity` invalidates the feed and memory.
 *  - `rules_changed` invalidates the rule table (an "always allow" at a gate edits it).
 *  - `run_event` is forwarded verbatim to `onRunEvent`; a `status` event additionally refreshes
 *    the run itself and its transcript.
 *
 * Reconnects on close/error with capped backoff (1s, 2s, 4s, 8s, 10s, then holds at 10s) as long
 * as the component stays mounted; the attempt counter resets on a successful open.
 */
export function useAppSocket(
  { onRunEvent }: UseAppSocketOptions = {},
  WebSocketCtor: typeof WebSocket = globalThis.WebSocket,
) {
  const client = useClient()
  const queryClient = useQueryClient()
  const onRunEventRef = useRef(onRunEvent)
  useEffect(() => {
    onRunEventRef.current = onRunEvent
  }, [onRunEvent])

  useEffect(() => {
    let cancelled = false
    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0

    const connect = () => {
      if (cancelled) return
      socket = new WebSocketCtor(client.wsUrl())

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
          void queryClient.invalidateQueries({ queryKey: keys.board })
          void queryClient.invalidateQueries({ queryKey: ['ticket'] })
          void queryClient.invalidateQueries({ queryKey: keys.activity })
          void queryClient.invalidateQueries({ queryKey: keys.memory })
        } else if (msg.type === 'activity') {
          void queryClient.invalidateQueries({ queryKey: keys.activity })
          void queryClient.invalidateQueries({ queryKey: keys.memory })
        } else if (msg.type === 'rules_changed') {
          void queryClient.invalidateQueries({ queryKey: keys.rules })
        } else if (msg.type === 'run_event') {
          if (msg.event.type === 'status' || msg.event.type === 'gate') {
            void queryClient.invalidateQueries({ queryKey: keys.run(msg.runId) })
            void queryClient.invalidateQueries({ queryKey: ['latestRunEvent', msg.runId] })
            // The transcript stops polling once the run isn't live; the final lines land in it
            // around this event, so fetch it once more rather than leave the raw output stale.
            void queryClient.invalidateQueries({ queryKey: ['transcript', msg.runId] })
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
  }, [client, queryClient, WebSocketCtor])
}
