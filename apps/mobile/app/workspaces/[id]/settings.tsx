import { useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, View, Pressable } from 'react-native'
import { useRemoveRepo, useAddRepo, usePatchWorkspace, useWorkspace } from '../../../src/api/queries'
import { ADAPTERS } from '../../../src/adapters'
import type { ApiError } from '../../../src/api/client'
import {
  AppHeader,
  Button,
  Card,
  Dialog,
  EmptyState,
  Icon,
  Input,
  ListRow,
  Screen,
  Sheet,
  Skeleton,
} from '../../../src/components/ui'
import { useTheme } from '../../../src/design/ThemeContext'
import { humanize } from '../../../src/design/status'
import { radius, space, type } from '../../../src/design/tokens'

function apiErrorMessage(err: unknown, fallback: string): string {
  const apiErr = err as ApiError
  return typeof apiErr.body === 'object' && apiErr.body !== null && 'error' in apiErr.body
    ? String((apiErr.body as Record<string, unknown>).error)
    : fallback
}

export default function WorkspaceSettings() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const wsId = Number(id)
  const { colors } = useTheme()

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
  const [repoToRemove, setRepoToRemove] = useState<string | null>(null)

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
      <Screen>
        <AppHeader title="Settings" back />
        <EmptyState icon="alert-circle" message="This workspace doesn't exist." />
      </Screen>
    )
  }

  if (isLoading || !workspace) {
    return (
      <Screen>
        <AppHeader title="Settings" back />
        <View style={styles.skeletons}>
          <Skeleton height={140} style={{ borderRadius: radius.md }} />
          <Skeleton height={120} style={{ borderRadius: radius.md }} />
        </View>
      </Screen>
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

    void addRepo
      .mutateAsync(addRepoUrl)
      .then(() => {
        setAddRepoUrl('')
      })
      .catch((err) => {
        setAddRepoError(apiErrorMessage(err, 'Failed to add repo'))
      })
  }

  const confirmRemoveRepo = () => {
    const repoName = repoToRemove
    setRepoToRemove(null)
    if (!repoName) return
    setRemoveRepoError('')
    void removeRepo.mutateAsync(repoName).catch((err) => {
      setRemoveRepoError(apiErrorMessage(err, 'Failed to remove repo'))
    })
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
      setPatchError(apiErrorMessage(err, `Error: ${(err as ApiError).message}`))
    }
  }

  const handleModelChange = async (model: string) => {
    setSettings((prev) => ({ ...prev, selectedModel: model }))
    setShowModelPicker(false)

    setPatchError('')
    try {
      await patchWorkspace.mutateAsync({ defaultModel: model })
    } catch (err) {
      setPatchError(apiErrorMessage(err, `Error: ${(err as ApiError).message}`))
    }
  }

  const handleConcurrencyIncrement = () => {
    if (settings.concurrency < 4) {
      const newValue = settings.concurrency + 1
      setSettings((prev) => ({ ...prev, concurrency: newValue }))
      setPatchError('')
      // The global mutation error handler already surfaces a toast on
      // failure; nothing local to do here.
      void patchWorkspace.mutateAsync({ concurrency: newValue }).catch(() => {})
    }
  }

  const handleConcurrencyDecrement = () => {
    if (settings.concurrency > 1) {
      const newValue = settings.concurrency - 1
      setSettings((prev) => ({ ...prev, concurrency: newValue }))
      setPatchError('')
      void patchWorkspace.mutateAsync({ concurrency: newValue }).catch(() => {})
    }
  }

  const handleTimeoutBlur = () => {
    const minutes = parseInt(settings.timeoutMinutes, 10)
    if (!Number.isNaN(minutes) && minutes > 0) {
      const timeoutMs = minutes * 60_000
      setPatchError('')
      void patchWorkspace.mutateAsync({ timeoutMs }).catch(() => {})
    } else {
      // Reset to last-saved value if input is invalid
      if (workspace) {
        setSettings((prev) => ({ ...prev, timeoutMinutes: String(workspace.timeoutMs / 60_000) }))
      }
    }
  }

  const adapterList = Object.keys(ADAPTERS)
  const modelList = ADAPTERS[settings.selectedAdapter] ?? []

  const sectionTitle = (title: string) => (
    <Text style={[type.monoSmall, styles.sectionTitle, { color: colors.inkMuted }]}>{title}</Text>
  )

  const errorText = (testID: string, message: string) => (
    <Text testID={testID} accessibilityRole="alert" style={[type.caption, { color: colors.signalRed }]}>
      {message}
    </Text>
  )

  return (
    <Screen>
      <AppHeader title="Settings" back />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.section}>
          {sectionTitle('REPOSITORIES')}
          <Card style={styles.sectionCard}>
            {workspace.repos.length === 0 ? (
              <Text style={[type.caption, { color: colors.inkFaint }]}>
                No repositories — agents will run without a codebase.
              </Text>
            ) : (
              workspace.repos.map((repo) => (
                <ListRow
                  key={repo.name}
                  icon="git-branch"
                  title={repo.name}
                  subtitle={repo.url}
                  trailing={
                    <Pressable
                      testID={`remove-repo-${repo.name}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${repo.name}`}
                      hitSlop={8}
                      onPress={() => setRepoToRemove(repo.name)}
                      style={({ pressed }) => [styles.removeButton, pressed && { opacity: 0.6 }]}
                    >
                      <Icon name="trash-2" size={16} color={colors.signalRed} />
                    </Pressable>
                  }
                />
              ))
            )}
            <View style={styles.addRepoRow}>
              <Input
                testID="add-repo-url-input"
                placeholder="https://… or git@…"
                mono
                autoCapitalize="none"
                autoCorrect={false}
                value={addRepoUrl}
                onChangeText={setAddRepoUrl}
                containerStyle={styles.addRepoInput}
              />
              <Button testID="add-repo-button" label="Add" onPress={handleAddRepo} small />
            </View>
            {addRepoError ? errorText('add-repo-error', addRepoError) : null}
            {removeRepoError ? errorText('remove-repo-error', removeRepoError) : null}
          </Card>
        </View>

        <View style={styles.section}>
          {sectionTitle('DEFAULTS')}
          <Card style={styles.sectionCard}>
            <ListRow
              testID="adapter-picker"
              icon="cpu"
              title="Agent"
              trailing={
                <Text style={[type.mono, { color: colors.inkMuted }]}>
                  {humanize(settings.selectedAdapter)}
                </Text>
              }
              onPress={() => setShowAdapterPicker(true)}
            />
            <ListRow
              testID="model-picker"
              icon="layers"
              title="Model"
              trailing={
                <Text style={[type.mono, { color: colors.inkMuted }]}>
                  {humanize(settings.selectedModel)}
                </Text>
              }
              onPress={() => setShowModelPicker(true)}
            />
            {patchError ? errorText('patch-error', patchError) : null}
          </Card>
        </View>

        <View style={styles.section}>
          {sectionTitle('ADVANCED')}
          <Card style={styles.sectionCard}>
            <ListRow
              icon="git-merge"
              title="Concurrency"
              subtitle="Agents working at once (1–4)"
              trailing={
                <View style={styles.stepper}>
                  <Pressable
                    testID="concurrency-decrement"
                    accessibilityRole="button"
                    accessibilityLabel="Decrease concurrency"
                    onPress={handleConcurrencyDecrement}
                    style={({ pressed }) => [
                      styles.stepperButton,
                      { backgroundColor: colors.surfaceAlt },
                      pressed && { opacity: 0.6 },
                    ]}
                  >
                    <Icon name="minus" size={16} />
                  </Pressable>
                  <Text style={[type.mono, styles.stepperValue, { color: colors.ink }]}>
                    {settings.concurrency}
                  </Text>
                  <Pressable
                    testID="concurrency-increment"
                    accessibilityRole="button"
                    accessibilityLabel="Increase concurrency"
                    onPress={handleConcurrencyIncrement}
                    style={({ pressed }) => [
                      styles.stepperButton,
                      { backgroundColor: colors.surfaceAlt },
                      pressed && { opacity: 0.6 },
                    ]}
                  >
                    <Icon name="plus" size={16} />
                  </Pressable>
                </View>
              }
            />
            <ListRow
              icon="clock"
              title="Timeout"
              subtitle="Minutes before a run is stopped"
              trailing={
                <TextInput
                  testID="timeout-minutes-input"
                  style={[
                    styles.timeoutInput,
                    type.mono,
                    { color: colors.ink, borderColor: colors.line, backgroundColor: colors.surface },
                  ]}
                  keyboardType="numeric"
                  value={settings.timeoutMinutes}
                  onChangeText={(text) => setSettings((prev) => ({ ...prev, timeoutMinutes: text }))}
                  onBlur={handleTimeoutBlur}
                />
              }
            />
          </Card>
        </View>
      </ScrollView>

      <Sheet visible={showAdapterPicker} onClose={() => setShowAdapterPicker(false)}>
        {adapterList.map((item) => (
          <ListRow
            key={item}
            title={humanize(item)}
            trailing={
              item === settings.selectedAdapter ? <Icon name="check" size={16} color={colors.ink} /> : null
            }
            onPress={() => void handleAdapterChange(item)}
          />
        ))}
      </Sheet>

      <Sheet visible={showModelPicker} onClose={() => setShowModelPicker(false)}>
        {modelList.map((item) => (
          <ListRow
            key={item}
            title={humanize(item)}
            trailing={
              item === settings.selectedModel ? <Icon name="check" size={16} color={colors.ink} /> : null
            }
            onPress={() => void handleModelChange(item)}
          />
        ))}
      </Sheet>

      <Dialog
        visible={repoToRemove !== null}
        title="Remove repository?"
        onClose={() => setRepoToRemove(null)}
        confirm={{
          label: 'Remove',
          destructive: true,
          onPress: confirmRemoveRepo,
          testID: 'remove-repo-confirm',
        }}
      >
        <Text style={[type.body, { color: colors.inkMuted }]}>
          {`${repoToRemove ?? ''} will be removed from this workspace. The repository itself is not deleted.`}
        </Text>
      </Dialog>
    </Screen>
  )
}

const styles = StyleSheet.create({
  skeletons: {
    padding: space.lg,
    gap: space.lg,
  },
  content: {
    padding: space.lg,
    gap: space.xxl,
  },
  section: {
    gap: space.sm,
  },
  sectionTitle: {
    letterSpacing: 1.2,
  },
  sectionCard: {
    gap: space.sm,
  },
  removeButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addRepoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  addRepoInput: {
    flex: 1,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  stepperButton: {
    width: 36,
    height: 36,
    borderRadius: radius.sm + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: {
    minWidth: 24,
    textAlign: 'center',
  },
  timeoutInput: {
    borderWidth: 1,
    borderRadius: radius.sm + 2,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    width: 72,
    textAlign: 'right',
  },
})
