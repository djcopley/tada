import { useLocalSearchParams, useNavigation } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native'
import { useMemory, usePutMemory } from '../../../../src/api/queries'
import { AppHeader, Button, Dialog, EmptyState, Screen, Skeleton } from '../../../../src/components/ui'
import { useTheme } from '../../../../src/design/ThemeContext'
import { fonts, space, type } from '../../../../src/design/tokens'
import { showToast } from '../../../../src/toast'

export default function MemoryEditor() {
  const { id, file } = useLocalSearchParams<{ id: string; file: string }>()
  const wsId = Number(id)
  const navigation = useNavigation()
  const { colors } = useTheme()

  const { data: memoryData, isLoading } = useMemory(wsId)
  const putMemory = usePutMemory(wsId)

  const [editedBody, setEditedBody] = useState('')
  const [leaveGuard, setLeaveGuard] = useState<{ action: unknown } | null>(null)
  const lastFileRef = useRef<string | undefined>(undefined)

  // Compute original body from memoryData
  const getOriginalBody = (): string => {
    if (!memoryData || !file) return ''
    if (file === 'AGENTS.md') {
      return memoryData.agentsMd
    }
    const note = memoryData.notes.find((n) => n.file === file)
    return note?.body ?? ''
  }

  const originalBody = getOriginalBody()
  const isDirty = editedBody !== originalBody

  // Initialize/reset editedBody when file or data changes
  useEffect(() => {
    if (!memoryData || !file) return
    if (file !== lastFileRef.current) {
      lastFileRef.current = file
      setEditedBody(originalBody)
    }
  }, [memoryData, file, originalBody])

  // Unsaved-changes guard: intercept navigating away while dirty.
  const dirtyRef = useRef(false)
  useEffect(() => {
    dirtyRef.current = isDirty && !putMemory.isPending
  }, [isDirty, putMemory.isPending])
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (!dirtyRef.current) return
      e.preventDefault()
      setLeaveGuard({ action: e.data.action })
    })
    return unsubscribe
  }, [navigation])

  if (Number.isNaN(wsId) || !file) {
    return (
      <Screen>
        <AppHeader title="Note" back />
        <EmptyState icon="alert-circle" message="This note doesn't exist." />
      </Screen>
    )
  }

  if (isLoading || !memoryData) {
    return (
      <Screen>
        <AppHeader title={file ?? 'Note'} back />
        <View style={styles.skeletons}>
          <Skeleton height={14} width="90%" />
          <Skeleton height={14} width="75%" />
          <Skeleton height={14} width="85%" />
        </View>
      </Screen>
    )
  }

  const handleSave = () => {
    void putMemory
      .mutateAsync({ file, body: editedBody })
      .then(() => {
        showToast('Saved')
      })
      .catch(() => {
        // The global mutation error handler already surfaces a toast.
      })
  }

  const discardAndLeave = () => {
    dirtyRef.current = false
    const action = leaveGuard?.action
    setLeaveGuard(null)
    if (action) navigation.dispatch(action as never)
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <AppHeader title={file} back>
        <View style={styles.saveRow}>
          {isDirty ? (
            <Text style={[type.monoSmall, { color: colors.liveText }]}>UNSAVED CHANGES</Text>
          ) : (
            <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>SAVED</Text>
          )}
          <Button
            testID="memory-save-button"
            label="Save"
            onPress={handleSave}
            disabled={!isDirty}
            loading={putMemory.isPending}
            small
          />
        </View>
      </AppHeader>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <TextInput
          testID="memory-editor-input"
          style={[styles.editor, { color: colors.text }]}
          multiline
          value={editedBody}
          onChangeText={setEditedBody}
          editable={!putMemory.isPending}
          placeholder="Write notes for your agents…"
          placeholderTextColor={colors.textFaintSolid}
        />
      </KeyboardAvoidingView>

      <Dialog
        visible={leaveGuard !== null}
        title="Discard changes?"
        onClose={() => setLeaveGuard(null)}
        cancelLabel="Keep editing"
        confirm={{ label: 'Discard', destructive: true, onPress: discardAndLeave }}
      >
        <Text style={[type.body, { color: colors.textMuted }]}>
          This note has unsaved changes that will be lost.
        </Text>
      </Dialog>
    </Screen>
  )
}

const styles = StyleSheet.create({
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
