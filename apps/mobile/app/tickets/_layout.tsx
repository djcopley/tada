import { Redirect, Stack } from 'expo-router'
import { useConnection } from '../../src/ConnectionContext'

/**
 * Mirrors app/workspaces/_layout.tsx: /tickets sits outside the
 * /workspaces subtree (Board navigates straight to /tickets/[id]) so it
 * needs its own copy of the same connected-only guard.
 */
export default function TicketsLayout() {
  const { connection } = useConnection()
  if (!connection) return <Redirect href="/connect" />
  return <Stack />
}
