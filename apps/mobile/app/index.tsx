import { Redirect } from 'expo-router'
import { useConnection } from '../src/ConnectionContext'

export default function Index() {
  const { connection } = useConnection()
  return connection ? <Redirect href="/workspaces" /> : <Redirect href="/connect" />
}
