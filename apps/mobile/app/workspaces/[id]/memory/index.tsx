import { useLocalSearchParams } from 'expo-router'
import { MemoryListScreen } from '../../../../src/components/memory/MemoryListScreen'

export default function WorkspaceMemoryList() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <MemoryListScreen scope="workspace" wsId={Number(id)} />
}
