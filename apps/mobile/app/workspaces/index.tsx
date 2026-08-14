import { useRouter } from 'expo-router'
import { useState } from 'react'
import { FlatList, StyleSheet, View } from 'react-native'
import { useCreateWorkspace, useWorkspaces } from '../../src/api/queries'
import { AppHeader, Dialog, EmptyState, Input, Screen, Skeleton } from '../../src/components/ui'
import { WorkspaceCard } from '../../src/components/WorkspaceCard'
import { space } from '../../src/design/tokens'

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
    <Screen>
      <AppHeader
        title="Dispatch"
        actions={[
          { icon: 'plus', label: 'New workspace', onPress: openCreateModal, testID: 'create-workspace-button' },
        ]}
      />

      {isLoading ? (
        <View style={styles.skeletons}>
          <Skeleton height={84} />
          <Skeleton height={84} />
          <Skeleton height={84} />
        </View>
      ) : workspaces.length === 0 ? (
        <EmptyState
          icon="inbox"
          message="No workspaces yet — create one to start dispatching work."
          action={{ label: 'New workspace', onPress: openCreateModal }}
        />
      ) : (
        <FlatList
          testID="workspaces-list"
          data={workspaces}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
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

      <Dialog
        visible={modalVisible}
        title="New workspace"
        onClose={closeCreateModal}
        confirm={{
          label: 'Create',
          onPress: () => void onCreate(),
          disabled: createWorkspace.isPending || name.trim().length === 0,
          loading: createWorkspace.isPending,
          testID: 'workspace-create-button',
        }}
      >
        <Input
          testID="workspace-name-input"
          placeholder="Name"
          autoFocus
          value={name}
          onChangeText={setName}
        />
      </Dialog>
    </Screen>
  )
}

const styles = StyleSheet.create({
  skeletons: {
    padding: space.lg,
    gap: space.md,
  },
  listContent: {
    paddingVertical: space.sm,
  },
})
