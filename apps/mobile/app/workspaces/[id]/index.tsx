import { Redirect, useLocalSearchParams } from 'expo-router'

/** `/workspaces/:id` on its own means the board. */
export default function WorkspaceIndex() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <Redirect href={`/workspaces/${id}/board`} />
}
