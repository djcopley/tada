import { useNavigation, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native'
import { useDeleteMemory, useGlobalMemory, useGlobalPutMemory, useMemory, usePutMemory } from '../../api/queries'
import { AppHeader, Button, Dialog, EmptyState, Screen, Skeleton } from '../ui'
import { useTheme } from '../../design/ThemeContext'
import { fonts, space, type } from '../../design/tokens'
import { showToast } from '../../toast'

type Props = { scope: 'workspace'; wsId: number; file?: string } | { scope: 'global'; file?: string }

/** Note editor for both scopes — workspace-scoped `/workspaces/:id/memory/:file` and global
 * `/memory/:file`. Identical behavior either way: mono editor, unsaved-changes guard, AGENTS.md
 * seeded from `agentsMd`, everything else from the matching entry in `notes`. */
export function MemoryEditorScreen(props: Props) {
  const { scope, file } = props
  const wsId = props.scope === 'workspace' ? props.wsId : undefined
  // Header back target when opened cold (deep link / refresh): the list this note belongs to.
  const listHref = scope === 'workspace' ? `/workspaces/${wsId}/memory` : '/memory'
  const navigation = useNavigation()
  const { colors } = useTheme()

  const workspaceMemory = useMemory(scope === 'workspace' ? wsId : undefined)
  const globalMemory = useGlobalMemory()
  const putMemory = usePutMemory(wsId ?? -1)
  const putGlobalMemory = useGlobalPutMemory()
  const deleteMemory = useDeleteMemory(scope === 'workspace' ? wsId : undefined)
  const router = useRouter()
  const [confirmDelete, setConfirmDelete] = useState(false)
  // The charter is pinned; only notes can be deleted.
  const deletable = file !== 'AGENTS.md'

  const memoryData = scope === 'workspace' ? workspaceMemory.data : globalMemory.data
  const isLoading = scope === 'workspace' ? workspaceMemory.isLoading : globalMemory.isLoading
  const isError = scope === 'workspace' ? workspaceMemory.isError : globalMemory.isError
  const saving = scope === 'workspace' ? putMemory.isPending : putGlobalMemory.isPending

  const [editedBody, setEditedBody] = useState('')
  const [leaveGuard, setLeaveGuard] = useState<{ action: unknown } | null>(null)
  const lastFileRef = useRef<string | undefined>(undefined)

  const getOriginalBody = (): string => {
    if (!memoryData || !file) return ''
    if (file === 'AGENTS.md') return memoryData.agentsMd
    const note = memoryData.notes.find((n) => n.file === file)
    return note?.body ?? ''
  }

  const originalBody = getOriginalBody()
  const isDirty = editedBody !== originalBody

  useEffect(() => {
    if (!memoryData || !file) return
    if (file !== lastFileRef.current) {
      lastFileRef.current = file
      setEditedBody(originalBody)
    }
  }, [memoryData, file, originalBody])

  const dirtyRef = useRef(false)
  useEffect(() => {
    dirtyRef.current = isDirty && !saving
  }, [isDirty, saving])
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (!dirtyRef.current) return
      e.preventDefault()
      setLeaveGuard({ action: e.data.action })
    })
    return unsubscribe
  }, [navigation])

  if ((scope === 'workspace' && Number.isNaN(wsId)) || isError) {
    return (
      <Screen>
        <AppHeader title="Note" back backHref={listHref} />
        <EmptyState icon="alert-circle" message="This workspace doesn't exist." />
      </Screen>
    )
  }

  if (!file) {
    return (
      <Screen>
        <AppHeader title="Note" back backHref={listHref} />
        <EmptyState icon="alert-circle" message="This note doesn't exist." />
      </Screen>
    )
  }

  if (isLoading || !memoryData) {
    return (
      <Screen>
        <AppHeader title={file} back backHref={listHref} />
        <View style={styles.skeletons}>
          <Skeleton height={14} width="90%" />
          <Skeleton height={14} width="75%" />
          <Skeleton height={14} width="85%" />
        </View>
      </Screen>
    )
  }

  const handleSave = () => {
    const mutation =
      scope === 'workspace'
        ? putMemory.mutateAsync({ file, body: editedBody })
        : putGlobalMemory.mutateAsync({ file, body: editedBody })
    void mutation
      .then(() => {
        showToast('Saved')
      })
      .catch(() => {
        // The global mutation error handler already surfaces a toast.
      })
  }

  const handleDelete = () => {
    setConfirmDelete(false)
    dirtyRef.current = false
    deleteMemory.mutate(file, {
      onSuccess: () => {
        showToast(`Deleted ${file}`)
        router.replace(listHref)
      },
    })
  }

  const discardAndLeave = () => {
    dirtyRef.current = false
    const action = leaveGuard?.action
    setLeaveGuard(null)
    if (action) navigation.dispatch(action as never)
  }

  return (
    // Workspace notes sit inside the Memory tab, whose frame already pads the bottom safe area.
    <Screen edges={scope === 'workspace' ? ['top'] : ['top', 'bottom']}>
      <AppHeader title={file} back backHref={listHref}>
        <View style={styles.saveRow}>
          {isDirty ? (
            <Text style={[type.monoSmall, { color: colors.liveText }]}>UNSAVED CHANGES</Text>
          ) : (
            <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>SAVED</Text>
          )}
          <Button testID="memory-save-button" label="Save" onPress={handleSave} disabled={!isDirty} loading={saving} small />
        </View>
      </AppHeader>
      {deletable ? (
        <View style={styles.deleteRow}>
          <Button
            testID="memory-delete-button"
            variant="ghost"
            small
            icon="trash-2"
            label="Delete note"
            onPress={() => setConfirmDelete(true)}
          />
        </View>
      ) : null}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <TextInput
          testID="memory-editor-input"
          style={[styles.editor, { color: colors.text }]}
          multiline
          value={editedBody}
          onChangeText={setEditedBody}
          editable={!saving}
          placeholder="Write notes for your agents…"
          placeholderTextColor={colors.textFaintSolid}
        />
      </KeyboardAvoidingView>

      <Dialog
        visible={confirmDelete}
        title={`Delete ${file}?`}
        onClose={() => setConfirmDelete(false)}
        testID="memory-delete-dialog"
        confirm={{ label: 'Delete', destructive: true, onPress: handleDelete, testID: 'memory-delete-confirm' }}
      >
        <Text style={[type.body, { color: colors.textMuted }]}>
          Agents stop reading it before their next run. This cannot be undone.
        </Text>
      </Dialog>

      <Dialog
        visible={leaveGuard !== null}
        title="Discard changes?"
        onClose={() => setLeaveGuard(null)}
        cancelLabel="Keep editing"
        confirm={{ label: 'Discard', destructive: true, onPress: discardAndLeave }}
      >
        <Text style={[type.body, { color: colors.textMuted }]}>This note has unsaved changes that will be lost.</Text>
      </Dialog>
    </Screen>
  )
}

const styles = StyleSheet.create({
  deleteRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: space.lg,
  },
  flex: {
    flex: 1,
  },
  skeletons: {
    padding: space.lg,
    gap: space.md,
  },
  saveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  editor: {
    flex: 1,
    padding: space.lg,
    fontFamily: fonts.mono,
    fontSize: 13,
    lineHeight: 20,
    textAlignVertical: 'top',
  },
})
