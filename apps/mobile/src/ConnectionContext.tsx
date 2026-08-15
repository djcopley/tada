import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { ClientProvider } from './api/ClientContext'
import { TadaClient } from './api/client'
import { clearConnection, loadConnection, saveConnection, type Connection } from './settings'

interface ConnectionState {
  connection: Connection | null
  client: TadaClient | null
  connect: (c: Connection) => Promise<void>
  disconnect: () => Promise<void>
}

const ConnectionContext = createContext<ConnectionState | null>(null)

/**
 * Loads the persisted connection on mount and exposes it (plus a client
 * bound to it) to the rest of the app. Renders nothing until the initial
 * load resolves, so nothing downstream (including routing) runs against a
 * not-yet-known connection state.
 */
export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [connection, setConnection] = useState<Connection | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadConnection().then((c) => {
      if (cancelled) return
      setConnection(c)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const connect = useCallback(async (c: Connection) => {
    await saveConnection(c)
    setConnection(c)
  }, [])

  const disconnect = useCallback(async () => {
    await clearConnection()
    setConnection(null)
  }, [])

  if (loading) return null

  const client = connection ? new TadaClient(connection) : null
  const value: ConnectionState = { connection, client, connect, disconnect }

  // Always wrap in ClientProvider (even with a null client pre-connect) so the app subtree
  // below never remounts when `connection` flips from null to a real value — an unmount here
  // would reset every screen's local state (and drop the Connect screen's just-rendered
  // checklist) right as the app navigates to /workspaces.
  return (
    <ConnectionContext.Provider value={value}>
      <ClientProvider client={client}>{children}</ClientProvider>
    </ConnectionContext.Provider>
  )
}

export function useConnection(): ConnectionState {
  const ctx = useContext(ConnectionContext)
  if (!ctx) throw new Error('useConnection must be used within a ConnectionProvider')
  return ctx
}
