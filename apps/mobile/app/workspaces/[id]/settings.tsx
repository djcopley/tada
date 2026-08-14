import { useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Pressable,
  Modal,
  FlatList,
} from 'react-native'
import { useRemoveRepo, useAddRepo, usePatchWorkspace, useWorkspace } from '../../../src/api/queries'
import { ADAPTERS } from '../../../src/adapters'
import type { ApiError } from '../../../src/api/client'

export default function WorkspaceSettings() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const wsId = Number(id)

  const { data: workspace, isLoading } = useWorkspace(wsId)
  const removeRepo = useRemoveRepo(wsId)
  const addRepo = useAddRepo(wsId)
  const patchWorkspace = usePatchWorkspace(wsId)

  const [addRepoUrl, setAddRepoUrl] = useState('')
  const [addRepoError, setAddRepoError] = useState('')
  const [removeRepoError, setRemoveRepoError] = useState('')
  const [patchError, setPatchError] = useState('')

  const [showAdapterPicker, setShowAdapterPicker] = useState(false)
  const [showModelPicker, setShowModelPicker] = useState(false)

  interface SettingsState {
    selectedAdapter: string
    selectedModel: string
    concurrency: number
    timeoutMinutes: string
  }

  // Initialize from workspace if available, otherwise use defaults
  const [settings, setSettings] = useState<SettingsState>(() =>
    workspace
      ? {
          selectedAdapter: workspace.defaultAdapter,
          selectedModel: workspace.defaultModel,
          concurrency: workspace.concurrency,
          timeoutMinutes: String(workspace.timeoutMs / 60_000),
        }
      : {
          selectedAdapter: 'claude',
          selectedModel: 'sonnet',
          concurrency: 1,
          timeoutMinutes: '5',
        },
  )

  // Track if we've synced the workspace data to avoid syncing on every render
  const syncedWorkspaceIdRef = useRef<number | null>(null)

  // Sync state when workspace loads (if not already synced)
  useEffect(() => {
    if (workspace && workspace.id !== syncedWorkspaceIdRef.current) {
      syncedWorkspaceIdRef.current = workspace.id
      setSettings({
        selectedAdapter: workspace.defaultAdapter,
        selectedModel: workspace.defaultModel,
        concurrency: workspace.concurrency,
        timeoutMinutes: String(workspace.timeoutMs / 60_000),
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id])

  if (Number.isNaN(wsId)) {
    return (
      <View style={styles.center}>
        <Text>Invalid workspace</Text>
      </View>
    )
  }

  if (isLoading || !workspace) {
    return (
      <View style={styles.center}>
        <Text>Loading…</Text>
      </View>
    )
  }

  const validateRepoUrl = (url: string): boolean => {
    return url.startsWith('https://') || url.startsWith('git@')
  }

  const handleAddRepo = () => {
    setAddRepoError('')
    setRemoveRepoError('')

    if (!addRepoUrl.trim()) {
      setAddRepoError('URL cannot be empty')
      return
    }

    if (!validateRepoUrl(addRepoUrl)) {
      setAddRepoError('URL must start with https:// or git@')
      return
    }

    void addRepo.mutateAsync(addRepoUrl).then(() => {
      setAddRepoUrl('')
    }).catch((err) => {
      const apiErr = err as ApiError
      setAddRepoError(typeof apiErr.body === 'object' && apiErr.body !== null && 'error' in apiErr.body
        ? String((apiErr.body as Record<string, unknown>).error)
        : 'Failed to add repo')
    })
  }

  const handleRemoveRepo = (repoName: string) => {
    Alert.alert('Remove repository', `Are you sure you want to remove ${repoName}?`, [
      { text: 'Cancel', onPress: () => {} },
      {
        text: 'Remove',
        onPress: () => {
          setRemoveRepoError('')
          void removeRepo.mutateAsync(repoName).catch((err) => {
            const apiErr = err as ApiError
            setRemoveRepoError(typeof apiErr.body === 'object' && apiErr.body !== null && 'error' in apiErr.body
              ? String((apiErr.body as Record<string, unknown>).error)
              : 'Failed to remove repo')
          })
        },
        style: 'destructive',
      },
    ])
  }

  const handleAdapterChange = async (adapter: string) => {
    setSettings((prev) => ({ ...prev, selectedAdapter: adapter }))
    setShowAdapterPicker(false)

    // Check if current model is valid for new adapter
    const modelsForAdapter = ADAPTERS[adapter] ?? []
    let modelToSet = settings.selectedModel
    if (!modelsForAdapter.includes(settings.selectedModel)) {
      modelToSet = modelsForAdapter[0] ?? 'sonnet'
      setSettings((prev) => ({ ...prev, selectedModel: modelToSet }))
    }

    setPatchError('')
    try {
      await patchWorkspace.mutateAsync({ defaultAdapter: adapter, defaultModel: modelToSet })
    } catch (err) {
      const apiErr = err as ApiError
      setPatchError(typeof apiErr.body === 'object' && apiErr.body !== null && 'error' in apiErr.body
        ? String((apiErr.body as Record<string, unknown>).error)
        : `Error: ${apiErr.message}`)
    }
  }

  const handleModelChange = async (model: string) => {
    setSettings((prev) => ({ ...prev, selectedModel: model }))
    setShowModelPicker(false)

    setPatchError('')
    try {
      await patchWorkspace.mutateAsync({ defaultModel: model })
    } catch (err) {
      const apiErr = err as ApiError
      setPatchError(typeof apiErr.body === 'object' && apiErr.body !== null && 'error' in apiErr.body
        ? String((apiErr.body as Record<string, unknown>).error)
        : `Error: ${apiErr.message}`)
    }
  }

  const handleConcurrencyIncrement = () => {
    if (settings.concurrency < 4) {
      const newValue = settings.concurrency + 1
      setSettings((prev) => ({ ...prev, concurrency: newValue }))
      setPatchError('')
      void patchWorkspace.mutateAsync({ concurrency: newValue })
    }
  }

  const handleConcurrencyDecrement = () => {
    if (settings.concurrency > 1) {
      const newValue = settings.concurrency - 1
      setSettings((prev) => ({ ...prev, concurrency: newValue }))
      setPatchError('')
      void patchWorkspace.mutateAsync({ concurrency: newValue })
    }
  }

  const handleTimeoutBlur = () => {
    const minutes = parseInt(settings.timeoutMinutes, 10)
    if (!Number.isNaN(minutes) && minutes > 0) {
      const timeoutMs = minutes * 60_000
      setPatchError('')
      void patchWorkspace.mutateAsync({ timeoutMs })
    } else {
      // Reset to last-saved value if input is invalid
      if (workspace) {
        setSettings((prev) => ({ ...prev, timeoutMinutes: String(workspace.timeoutMs / 60_000) }))
      }
    }
  }

  const adapterList = Object.keys(ADAPTERS)
  const modelList = ADAPTERS[settings.selectedAdapter] ?? []

  return (
    <ScrollView style={styles.container}>
      {/* Repos Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Repositories</Text>

        {workspace.repos.map((repo) => (
          <View key={repo.name} style={styles.repoItem}>
            <View style={styles.repoInfo}>
              <Text style={styles.repoName}>{repo.name}</Text>
              <Text style={styles.repoUrl}>{repo.url}</Text>
            </View>
            <Pressable
              testID={`remove-repo-${repo.name}`}
              onPress={() => handleRemoveRepo(repo.name)}
              style={styles.removeButton}
            >
              <Text style={styles.removeButtonText}>Remove</Text>
            </Pressable>
          </View>
        ))}

        <View style={styles.addRepoContainer}>
          <TextInput
            testID="add-repo-url-input"
            style={styles.addRepoInput}
            placeholder="https://... or git@..."
            placeholderTextColor="#999"
            value={addRepoUrl}
            onChangeText={setAddRepoUrl}
          />
          <Pressable
            testID="add-repo-button"
            onPress={handleAddRepo}
            style={styles.addRepoButton}
          >
            <Text style={styles.addRepoButtonText}>Add</Text>
          </Pressable>
        </View>
        {addRepoError ? (
          <Text testID="add-repo-error" style={styles.errorText}>
            {addRepoError}
          </Text>
        ) : null}
        {removeRepoError ? (
          <Text testID="remove-repo-error" style={styles.errorText}>
            {removeRepoError}
          </Text>
        ) : null}
      </View>

      {/* Defaults Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Defaults</Text>

        <View style={styles.pickerRow}>
          <Text style={styles.label}>Adapter</Text>
          <Pressable
            testID="adapter-picker"
            onPress={() => setShowAdapterPicker(true)}
            style={styles.pickerButton}
          >
            <Text style={styles.pickerButtonText}>{settings.selectedAdapter}</Text>
          </Pressable>
        </View>

        <View style={styles.pickerRow}>
          <Text style={styles.label}>Model</Text>
          <Pressable
            testID="model-picker"
            onPress={() => setShowModelPicker(true)}
            style={styles.pickerButton}
          >
            <Text style={styles.pickerButtonText}>{settings.selectedModel}</Text>
          </Pressable>
        </View>

        {patchError ? (
          <Text testID="patch-error" style={styles.errorText}>
            {patchError}
          </Text>
        ) : null}
      </View>

      {/* Advanced Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Advanced</Text>

        <View style={styles.advancedRow}>
          <Text style={styles.label}>Concurrency</Text>
          <View style={styles.stepperContainer}>
            <Pressable
              testID="concurrency-decrement"
              onPress={handleConcurrencyDecrement}
              style={styles.stepperButton}
            >
              <Text style={styles.stepperButtonText}>−</Text>
            </Pressable>
            <Text style={styles.stepperValue}>{settings.concurrency}</Text>
            <Pressable
              testID="concurrency-increment"
              onPress={handleConcurrencyIncrement}
              style={styles.stepperButton}
            >
              <Text style={styles.stepperButtonText}>+</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.advancedRow}>
          <Text style={styles.label}>Timeout (minutes)</Text>
          <TextInput
            testID="timeout-minutes-input"
            style={styles.timeoutInput}
            keyboardType="numeric"
            value={settings.timeoutMinutes}
            onChangeText={(text) => setSettings((prev) => ({ ...prev, timeoutMinutes: text }))}
            onBlur={handleTimeoutBlur}
          />
        </View>
      </View>

      {/* Adapter Picker Modal */}
      <Modal
        visible={showAdapterPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAdapterPicker(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowAdapterPicker(false)}
        >
          <View style={styles.modalContent}>
            <FlatList
              data={adapterList}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => void handleAdapterChange(item)}
                  style={styles.modalItem}
                >
                  <Text style={[
                    styles.modalItemText,
                    item === settings.selectedAdapter && styles.modalItemTextSelected,
                  ]}>
                    {item}
                  </Text>
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>

      {/* Model Picker Modal */}
      <Modal
        visible={showModelPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowModelPicker(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowModelPicker(false)}
        >
          <View style={styles.modalContent}>
            <FlatList
              data={modelList}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => void handleModelChange(item)}
                  style={styles.modalItem}
                >
                  <Text style={[
                    styles.modalItemText,
                    item === settings.selectedModel && styles.modalItemTextSelected,
                  ]}>
                    {item}
                  </Text>
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 16,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    marginBottom: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e5e5',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
    color: '#000',
  },
  repoItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  repoInfo: {
    flex: 1,
  },
  repoName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#000',
    marginBottom: 4,
  },
  repoUrl: {
    fontSize: 12,
    color: '#666',
  },
  removeButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    backgroundColor: '#ff3b30',
  },
  removeButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
  },
  addRepoContainer: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 8,
  },
  addRepoInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: '#000',
  },
  addRepoButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
  },
  addRepoButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  errorText: {
    color: '#ff3b30',
    fontSize: 12,
    marginTop: 8,
  },
  pickerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  label: {
    fontSize: 14,
    color: '#000',
    fontWeight: '500',
  },
  pickerButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#f0f0f0',
    minWidth: 100,
    alignItems: 'center',
  },
  pickerButtonText: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500',
  },
  advancedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepperButton: {
    width: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepperButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#007AFF',
  },
  stepperValue: {
    fontSize: 16,
    fontWeight: '500',
    color: '#000',
    minWidth: 30,
    textAlign: 'center',
  },
  timeoutInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: '#000',
    width: 100,
    textAlign: 'right',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    maxHeight: '60%',
  },
  modalItem: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  modalItemText: {
    fontSize: 16,
    color: '#000',
  },
  modalItemTextSelected: {
    color: '#007AFF',
    fontWeight: '600',
  },
})
