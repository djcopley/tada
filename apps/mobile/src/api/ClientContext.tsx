import { createContext, type ReactNode, useContext } from 'react'
import type { TadaClient } from './client'

const ClientContext = createContext<TadaClient | null>(null)

export function ClientProvider({
  client,
  children,
}: {
  client: TadaClient | null
  children: ReactNode
}) {
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>
}

export function useClient(): TadaClient {
  const client = useContext(ClientContext)
  if (!client) throw new Error('useClient must be used within a ClientProvider with an active connection')
  return client
}
