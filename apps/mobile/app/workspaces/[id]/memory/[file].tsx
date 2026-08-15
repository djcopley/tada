import { useLocalSearchParams } from 'expo-router'
import { MemoryEditorScreen } from '../../../../src/components/memory/MemoryEditorScreen'

export default function WorkspaceMemoryEditor() {
  const { id, file } = useLocalSearchParams<{ id: string; file: string }>()
  return <MemoryEditorScreen scope="workspace" wsId={Number(id)} file={file} />
}
