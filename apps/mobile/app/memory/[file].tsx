import { useLocalSearchParams } from 'expo-router'
import { MemoryEditorScreen } from '../../src/components/memory/MemoryEditorScreen'

export default function GlobalMemoryEditor() {
  const { file } = useLocalSearchParams<{ file: string }>()
  return <MemoryEditorScreen scope="global" file={file} />
}
