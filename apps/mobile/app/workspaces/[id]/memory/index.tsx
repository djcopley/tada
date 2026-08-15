import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { FlatList, StyleSheet, Text, View } from 'react-native'
import { useMemory, usePutMemory } from '../../../../src/api/queries'
import { AppHeader, Dialog, EmptyState, Input, ListRow, Screen, Skeleton } from '../../../../src/components/ui'
import { useTheme } from '../../../../src/design/ThemeContext'
import { radius, space, type } from '../../../../src/design/tokens'
import { showToast } from '../../../../src/toast'

export default function MemoryList() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const wsId = Number(id)
  const router = useRouter()
  const { colors } = useTheme()

  const { data: memoryData, isLoading } = useMemory(wsId)
  const putMemory = usePutMemory(wsId)

  const [showNamePrompt, setShowNamePrompt] = useState(false)
  const [newNoteName, setNewNoteName] = useState('')
  const [nameError, setNameError] = useState('')

  if (Number.isNaN(wsId)) {
    return (
      <Screen>
        <AppHeader title="Memory" back />
        <EmptyState icon="alert-circle" message="This workspace doesn't exist." />
      </Screen>
    )
  }

  if (isLoading || !memoryData) {
    return (
      <Screen>
        <AppHeader title="Memory" back />
        <View style={styles.skeletons}>
          <Skeleton height={52} />
          <Skeleton height={52} />
          <Skeleton height={52} />
        </View>
      </Screen>
    )
  }

  // Build the file list: AGENTS.md first, then notes sorted by name
  const files: { name: string; isAgents: boolean }[] = [
    { name: 'AGENTS.md', isAgents: true },
    ...memoryData.notes
      .map((n) => ({ name: n.file, isAgents: false }))
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

  const closePrompt = () => {
    setShowNamePrompt(false)
    setNewNoteName('')
    setNameError('')
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
    <Screen>
      <AppHeader
        title="Memory"
        back
        actions={[{ icon: 'plus', label: 'New note', onPress: handleCreateNote, testID: 'memory-add-button' }]}
      />

      <Text style={[type.caption, styles.intro, { color: colors.textMuted }]}>
        The agent reads every note before a run — and may add its own. Plain text, edit freely.
      </Text>

      <FlatList
        testID="memory-list"
        data={files}
        keyExtractor={(item) => item.name}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <ListRow
            testID={`memory-file-${item.name}`}
            icon={item.isAgents ? 'compass' : 'file-text'}
            title={item.name}
            trailing={
              item.isAgents ? (
                <View style={[styles.pinnedTag, { backgroundColor: colors.raised2 }]}>
                  <Text style={[type.monoSmall, { color: colors.textMuted }]}>PINNED</Text>
                </View>
              ) : undefined
            }
            onPress={() => handleFilePress(item.name)}
          />
        )}
      />

      <Dialog
        visible={showNamePrompt}
        title="New note"
        onClose={closePrompt}
        confirm={{
          label: 'Create',
          onPress: handleSubmitName,
          disabled: putMemory.isPending,
          testID: 'memory-name-submit',
        }}
      >
        <Input
          testID="memory-name-input"
          placeholder="note-name (or note-name.md)"
          mono
          autoFocus
          value={newNoteName}
          onChangeText={(text) => {
            setNewNoteName(text)
            setNameError('')
          }}
          editable={!putMemory.isPending}
        />
        {nameError ? (
          <Text
            testID="memory-name-error"
            accessibilityRole="alert"
            style={[type.caption, { color: colors.failText }]}
          >
            {nameError}
          </Text>
        ) : null}
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
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  intro: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
  },
  pinnedTag: {
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.tag,
  },
})
