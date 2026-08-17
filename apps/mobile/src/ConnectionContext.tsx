import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
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

  // Memoized on the connection's identity, not rebuilt per render: `client` is a dependency of
  // every socket effect downstream, so a fresh TadaClient on each provider render would tear down
  // and reopen every workspace socket on any root re-render (a theme toggle, say). `connection`
  // only gets a new identity when it is actually loaded/connected/cleared - exactly the moments a
  // reconnect is the right behaviour.
  const client = useMemo(() => (connection ? new TadaClient(connection) : null), [connection])
  const value: ConnectionState = useMemo(
    () => ({ connection, client, connect, disconnect }),
    [connection, client, connect, disconnect],
  )

  if (loading) return null

  // Always wrap in ClientProvider (even with a null client pre-connect) so the app subtree
  // below never remounts when `connection` flips from null to a real value — an unmount here
  // would reset every screen's local state (and drop the Connect screen's just-rendered
  // checklist) right as the app navigates to /.
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
