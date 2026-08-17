import { useLocalSearchParams } from 'expo-router'
import { NoteEditorScreen } from '../../src/components/memory/NoteEditorScreen'

export default function NoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <NoteEditorScreen id={id} />
}
