import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Button, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useCreateWorkspace, useWorkspaces } from '../../src/api/queries'
import { WorkspaceCard } from '../../src/components/WorkspaceCard'

export default function Workspaces() {
  const router = useRouter()
  const { data, isLoading, isRefetching, refetch } = useWorkspaces()
  const createWorkspace = useCreateWorkspace()

  const [modalVisible, setModalVisible] = useState(false)
  const [name, setName] = useState('')

  const openCreateModal = () => {
    setName('')
    setModalVisible(true)
  }

  const closeCreateModal = () => setModalVisible(false)

  const onCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      const workspace = await createWorkspace.mutateAsync(trimmed)
      setModalVisible(false)
      router.push(`/workspaces/${workspace.id}/board`)
    } catch {
      // Swallow here — the global mutation error handler already surfaces a
      // toast. Leave the modal open so the user can retry.
    }
  }

  const workspaces = data ?? []

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Workspaces</Text>
        <Pressable testID="create-workspace-button" style={styles.addButton} onPress={openCreateModal}>
          <Text style={styles.addButtonText}>+</Text>
        </Pressable>
      </View>

      {!isLoading && workspaces.length === 0 ? (
        <Text style={styles.empty}>No workspaces yet — create one to get started.</Text>
      ) : (
        <FlatList
          testID="workspaces-list"
          data={workspaces}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <WorkspaceCard
              workspace={item}
              onPress={() => router.push(`/workspaces/${item.id}/board`)}
            />
          )}
          refreshing={isRefetching}
          onRefresh={() => void refetch()}
        />
      )}

      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={closeCreateModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New workspace</Text>
            <TextInput
              testID="workspace-name-input"
              style={styles.input}
              placeholder="Name"
              autoFocus
              value={name}
              onChangeText={setName}
            />
            <View style={styles.modalActions}>
              <Button testID="workspace-cancel-button" title="Cancel" onPress={closeCreateModal} />
              <Button
                testID="workspace-create-button"
                title="Create"
                onPress={onCreate}
                disabled={createWorkspace.isPending || name.trim().length === 0}
              />
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
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  addButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1565c0',
  },
  addButtonText: {
    color: '#fff',
    fontSize: 20,
    lineHeight: 22,
  },
  empty: {
    flex: 1,
    textAlign: 'center',
    marginTop: 48,
    paddingHorizontal: 32,
    color: '#666',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCard: {
    width: '85%',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 20,
    gap: 12,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#888',
    borderRadius: 6,
    padding: 10,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
})
