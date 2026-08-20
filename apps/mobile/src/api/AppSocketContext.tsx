import type { WsMessage } from '@tada/shared'
import { createContext, type MutableRefObject, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef } from 'react'
import { useConnection } from '../ConnectionContext'
import { useAppSocket } from './useAppSocket'

export type RunEventMessage = Extract<WsMessage, { type: 'run_event' }>
type Listener = (msg: RunEventMessage) => void

const RunEventBus = createContext<{ subscribe: (fn: Listener) => () => void } | null>(null)

/**
 * Mounts the one WebSocket for the whole app, once, and fans `run_event` messages out to whoever
 * asked via {@link useRunEventListener}.
 *
 * Screens used to each call `useAppSocket()` themselves. Under the tabs navigator every visited
 * tab stays mounted, so a user who had touched Control, Board, Memory and Settings and pushed a
 * ticket was holding five or six sockets to one room, each running the same invalidation block
 * per message and each with its own reconnect back-off after a server restart. One socket here,
 * subscriptions below.
 *
 * Only connects once a connection exists — before that there is no client to build a URL from,
 * and nothing to keep fresh.
 */
export function AppSocketProvider({ children }: { children: ReactNode }) {
  const { connection } = useConnection()
  const listeners = useRef(new Set<Listener>())
  const subscribe = useCallback((fn: Listener) => {
    listeners.current.add(fn)
    return () => {
      listeners.current.delete(fn)
    }
  }, [])
  const value = useMemo(() => ({ subscribe }), [subscribe])
  return (
    <RunEventBus.Provider value={value}>
      {connection ? <SocketMount listeners={listeners} /> : null}
      {children}
    </RunEventBus.Provider>
  )
}

/** Separate component so `useAppSocket` (which needs a live client) only mounts once connected. */
function SocketMount({ listeners }: { listeners: MutableRefObject<Set<Listener>> }) {
  const onRunEvent = useCallback(
    (msg: RunEventMessage) => {
      for (const fn of listeners.current) fn(msg)
    },
    [listeners],
  )
  useAppSocket({ onRunEvent })
  return null
}

/**
 * Subscribe to `run_event` messages from the shared socket for as long as the caller is mounted.
 * The latest `fn` is always the one called, so callers need not memoise it. A no-op when no
 * provider is mounted (unit tests render screens bare).
 */
export function useRunEventListener(fn: Listener): void {
  const bus = useContext(RunEventBus)
  const ref = useRef(fn)
  useEffect(() => {
    ref.current = fn
  }, [fn])
  useEffect(() => {
    if (!bus) return
    return bus.subscribe((msg) => ref.current(msg))
  }, [bus])
}
