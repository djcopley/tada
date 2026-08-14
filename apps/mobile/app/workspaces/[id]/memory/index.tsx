import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useMemory, usePutMemory } from '../../../../src/api/queries'
import { showToast } from '../../../../src/toast'

export default function MemoryList() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const wsId = Number(id)
  const router = useRouter()

  const { data: memoryData, isLoading } = useMemory(wsId)
  const putMemory = usePutMemory(wsId)

  const [showNamePrompt, setShowNamePrompt] = useState(false)
  const [newNoteName, setNewNoteName] = useState('')
  const [nameError, setNameError] = useState('')

  if (Number.isNaN(wsId)) {
    return (
      <View style={styles.center}>
        <Text>Invalid workspace</Text>
      </View>
    )
  }

  if (isLoading || !memoryData) {
    return (
      <View style={styles.center}>
        <Text>Loading…</Text>
      </View>
    )
  }

  // Build the file list: AGENTS.md first, then notes sorted by name
  const files: { name: string; isAgents: boolean }[] = [
    { name: 'AGENTS.md', isAgents: true },
    ...memoryData.notes
      .map((n) => ({ name: n.name, isAgents: false }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  ]

  const handleFilePress = (fileName: string) => {
    router.push(`/workspaces/${wsId}/memory/${encodeURIComponent(fileName)}`)
  }

  const isValidName = (name: string): boolean => {
    // Must not contain '/' or '..'
    if (name.includes('/') || name.includes('..')) {
      return false
    }
    // Must be a valid basename (no leading/trailing slashes, etc)
    const basename = name.split('/').pop() || ''
    return basename === name
  }

  const handleCreateNote = () => {
    setNameError('')
    setNewNoteName('')
    setShowNamePrompt(true)
  }

  const handleSubmitName = () => {
    if (!newNoteName.trim()) {
      setNameError('Name cannot be empty')
      return
    }

    if (!isValidName(newNoteName)) {
      setNameError('Invalid name (no / or .. allowed)')
      return
    }

    // Append .md if missing
    const fileName = newNoteName.endsWith('.md') ? newNoteName : `${newNoteName}.md`

    setShowNamePrompt(false)
    setNewNoteName('')
    setNameError('')

    // Create the note with empty body
    void putMemory
      .mutateAsync({ file: fileName, body: '' })
      .then(() => {
        showToast(`Created ${fileName}`)
        router.push(`/workspaces/${wsId}/memory/${encodeURIComponent(fileName)}`)
      })
      .catch(() => {
        // The global mutation error handler already surfaces a toast.
      })
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Memory</Text>
        <Pressable testID="memory-add-button" onPress={handleCreateNote} style={styles.addButton}>
          <Text style={styles.addButtonText}>+</Text>
        </Pressable>
      </View>

      <FlatList
        testID="memory-list"
        data={files}
        keyExtractor={(item) => item.name}
        renderItem={({ item }) => (
          <Pressable
            testID={`memory-file-${item.name}`}
            onPress={() => handleFilePress(item.name)}
            style={styles.fileItem}
          >
            <Text style={styles.fileName}>{item.name}</Text>
          </Pressable>
        )}
      />

      <Modal visible={showNamePrompt} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>New Note</Text>
            <TextInput
              testID="memory-name-input"
              style={styles.nameInput}
              placeholder="note-name (or note-name.md)"
              value={newNoteName}
              onChangeText={(text) => {
                setNewNoteName(text)
                setNameError('')
              }}
              editable={!putMemory.isPending}
            />
            {nameError ? (
              <Text testID="memory-name-error" style={styles.errorText}>
                {nameError}
              </Text>
            ) : null}
            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.button, styles.cancelButton]}
                onPress={() => {
                  setShowNamePrompt(false)
                  setNewNoteName('')
                  setNameError('')
                }}
              >
                <Text style={styles.buttonText}>Cancel</Text>
              </Pressable>
              <Pressable
                testID="memory-name-submit"
                style={[styles.button, styles.submitButton]}
                onPress={handleSubmitName}
                disabled={putMemory.isPending}
              >
                <Text style={[styles.buttonText, putMemory.isPending && styles.disabledText]}>
                  Create
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
    fontSize: 20,
    fontWeight: '600',
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButtonText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '600',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  fileName: {
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    width: '80%',
    maxWidth: 300,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  nameInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
    fontSize: 16,
  },
  errorText: {
    color: '#ff3b30',
    fontSize: 14,
    marginBottom: 12,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  button: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#f0f0f0',
  },
  submitButton: {
    backgroundColor: '#007AFF',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  disabledText: {
    opacity: 0.6,
  },
})
