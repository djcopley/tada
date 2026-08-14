import { useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useMemory, usePutMemory } from '../../../../src/api/queries'
import { showToast } from '../../../../src/toast'

export default function MemoryEditor() {
  const { id, file } = useLocalSearchParams<{ id: string; file: string }>()
  const wsId = Number(id)

  const { data: memoryData, isLoading } = useMemory(wsId)
  const putMemory = usePutMemory(wsId)

  const [editedBody, setEditedBody] = useState('')
  const lastFileRef = useRef<string | undefined>(undefined)

  // Compute original body from memoryData
  const getOriginalBody = (): string => {
    if (!memoryData || !file) return ''
    if (file === 'AGENTS.md') {
      return memoryData.agentsMd
    }
    const note = memoryData.notes.find((n) => n.name === file)
    return note?.body ?? ''
  }

  const originalBody = getOriginalBody()

  // Initialize/reset editedBody when file or data changes
  useEffect(() => {
    if (!memoryData || !file) return
    if (file !== lastFileRef.current) {
      lastFileRef.current = file
      setEditedBody(originalBody)
    }
  }, [memoryData, file, originalBody])

  if (Number.isNaN(wsId) || !file) {
    return (
      <View style={styles.center}>
        <Text>Invalid parameters</Text>
      </View>
    )
  }

  if (isLoading || !memoryData) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    )
  }

  const isDirty = editedBody !== originalBody

  const handleSave = () => {
    void putMemory.mutateAsync({ file, body: editedBody }).then(() => {
      showToast('Saved')
      // After save succeeds, update lastFileRef to mark this content as saved
      // The isDirty will become false since editedBody now equals originalBody
    })
  }

  const handleContentChange = (text: string) => {
    setEditedBody(text)
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{file}</Text>
        <Pressable
          testID="memory-save-button"
          onPress={handleSave}
          disabled={!isDirty || putMemory.isPending}
          style={[
            styles.saveButton,
            (!isDirty || putMemory.isPending) && styles.saveButtonDisabled,
          ]}
        >
          {putMemory.isPending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.saveButtonText}>Save</Text>
          )}
        </Pressable>
      </View>

      <TextInput
        testID="memory-editor-input"
        style={styles.editor}
        multiline
        value={editedBody}
        onChangeText={handleContentChange}
        editable={!putMemory.isPending}
        placeholder="Enter your notes here..."
        placeholderTextColor="#999"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e5e5',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    flex: 1,
  },
  saveButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    minWidth: 60,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    backgroundColor: '#ccc',
    opacity: 0.6,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editor: {
    flex: 1,
    padding: 16,
    fontSize: 14,
    fontFamily: 'Courier New',
    textAlignVertical: 'top',
  },
})
