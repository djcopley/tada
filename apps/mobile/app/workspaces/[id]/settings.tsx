import type { ApiAdapterInfo, ApiSource } from '@tada/shared'
import { useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { ApiError, TadaClient } from '../../../src/api/client'
import {
  useAddSource,
  useAdapters,
  usePatchWorkspace,
  useRemoveSource,
  useWorkspace,
} from '../../../src/api/queries'
import {
  AppHeader,
  Button,
  Card,
  Dialog,
  EmptyState,
  Icon,
  Input,
  Menu,
  ListRow,
  Rail,
  Screen,
  Skeleton,
  Stepper,
  Tag,
} from '../../../src/components/ui'
import { useConnection } from '../../../src/ConnectionContext'
import { useTheme } from '../../../src/design/ThemeContext'
import { humanize } from '../../../src/design/status'
import { radius, space, type } from '../../../src/design/tokens'
import { useLayout } from '../../../src/layout'
import { showToast } from '../../../src/toast'

const TIMEOUT_OPTIONS_MIN = [10, 15, 30, 60] as const
const CONCURRENCY_MIN = 1
const CONCURRENCY_MAX = 8

function apiErrorMessage(err: unknown, fallback: string): string {
  const apiErr = err as ApiError
  return typeof apiErr.body === 'object' && apiErr.body !== null && 'error' in apiErr.body
    ? String((apiErr.body as Record<string, unknown>).error)
    : fallback
}

/** `repo · github` when the clone URL is a github.com remote, `repo · git` for any other repo
 * host, `folder · server` for a bare local path. */
function sourceTag(source: ApiSource): string {
  if (source.type === 'folder') return 'folder · server'
  return source.url?.includes('github.com') ? 'repo · github' : 'repo · git'
}

function maskToken(token: string): string {
  const last4 = token.slice(-4)
  return `tada_${'•'.repeat(10)}${last4}`
}

interface LocalDefaults {
  adapter: string
  model: string
  effort: string
  concurrency: number
  timeoutMs: number
}

export default function WorkspaceSettings() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const wsId = Number(id)
  const { colors } = useTheme()
  const { wide } = useLayout()
  const { connection, connect, disconnect } = useConnection()

  const { data: workspace, isLoading } = useWorkspace(wsId)
  const { data: adapters } = useAdapters()
  const removeSource = useRemoveSource(wsId)
  const addSource = useAddSource(wsId)
  const patchWorkspace = usePatchWorkspace(wsId)

  const [local, setLocal] = useState<LocalDefaults>({
    adapter: 'claude',
    model: 'sonnet',
    effort: 'default',
    concurrency: 1,
    timeoutMs: 30 * 60_000,
  })
  const syncedWorkspaceIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (workspace && workspace.id !== syncedWorkspaceIdRef.current) {
      syncedWorkspaceIdRef.current = workspace.id
      setLocal({
        adapter: workspace.defaultAdapter,
        model: workspace.defaultModel,
        effort: workspace.defaultEffort,
        concurrency: workspace.concurrency,
        timeoutMs: workspace.timeoutMs,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id])

  const [repoToRemove, setRepoToRemove] = useState<string | null>(null)
  const [removeRepoError, setRemoveRepoError] = useState('')

  const [showAddRepo, setShowAddRepo] = useState(false)
  const [addRepoUrl, setAddRepoUrl] = useState('')
  const [addRepoError, setAddRepoError] = useState('')

  const [showAddFolder, setShowAddFolder] = useState(false)
  const [addFolderPath, setAddFolderPath] = useState('')
  const [addFolderError, setAddFolderError] = useState('')

  const [agentError, setAgentError] = useState('')
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [showTimeoutMenu, setShowTimeoutMenu] = useState(false)

  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [showReplaceToken, setShowReplaceToken] = useState(false)
  const [newToken, setNewToken] = useState('')
  const [replacingToken, setReplacingToken] = useState(false)

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
          <Skeleton height={140} style={{ borderRadius: radius.control }} />
          <Skeleton height={120} style={{ borderRadius: radius.control }} />
        </View>
      </Screen>
    )
  }

  // ---------------------------------------------------------------- sources
  const validateRepoUrl = (url: string): boolean => url.startsWith('https://') || url.startsWith('git@')

  const handleAddRepo = () => {
    setAddRepoError('')
    if (!addRepoUrl.trim()) {
      setAddRepoError('URL cannot be empty')
      return
    }
    if (!validateRepoUrl(addRepoUrl)) {
      setAddRepoError('URL must start with https:// or git@')
      return
    }
    void addSource
      .mutateAsync({ type: 'repo', url: addRepoUrl })
      .then(() => {
        setShowAddRepo(false)
        setAddRepoUrl('')
      })
      .catch((err) => setAddRepoError(apiErrorMessage(err, 'Failed to add repo')))
  }

  const handleAddFolder = () => {
    setAddFolderError('')
    if (!addFolderPath.trim()) {
      setAddFolderError('Path cannot be empty')
      return
    }
    if (!addFolderPath.startsWith('/')) {
      setAddFolderError('Path must be absolute — it has to exist on the server')
      return
    }
    void addSource
      .mutateAsync({ type: 'folder', path: addFolderPath })
      .then(() => {
        setShowAddFolder(false)
        setAddFolderPath('')
      })
      .catch((err) => setAddFolderError(apiErrorMessage(err, 'Failed to add folder')))
  }

  const confirmRemoveRepo = () => {
    const repoName = repoToRemove
    setRepoToRemove(null)
    if (!repoName) return
    setRemoveRepoError('')
    void removeSource.mutateAsync(repoName).catch((err) => {
      setRemoveRepoError(apiErrorMessage(err, 'Failed to remove repo'))
    })
  }

  // ---------------------------------------------------------------- agent
  const currentAdapterInfo: ApiAdapterInfo | undefined = adapters?.find((a) => a.id === local.adapter)

  const chooseHarness = (adapter: ApiAdapterInfo) => {
    if (!adapter.available || adapter.id === local.adapter) return
    const model = adapter.models[0] ?? ''
    const effort = adapter.efforts[0] ?? ''
    setLocal((prev) => ({ ...prev, adapter: adapter.id, model, effort }))
    setAgentError('')
    void patchWorkspace
      .mutateAsync({ defaultAdapter: adapter.id, defaultModel: model, defaultEffort: effort })
      .catch((err) => setAgentError(apiErrorMessage(err, 'Failed to update the harness')))
  }

  const chooseModel = (model: string) => {
    setShowModelMenu(false)
    if (model === local.model) return
    setLocal((prev) => ({ ...prev, model }))
    setAgentError('')
    void patchWorkspace
      .mutateAsync({ defaultModel: model })
      .catch((err) => setAgentError(apiErrorMessage(err, 'Failed to update the model')))
  }

  const chooseEffort = (effort: string) => {
    if (effort === local.effort) return
    setLocal((prev) => ({ ...prev, effort }))
    setAgentError('')
    void patchWorkspace
      .mutateAsync({ defaultEffort: effort })
      .catch((err) => setAgentError(apiErrorMessage(err, 'Failed to update the effort')))
  }

  // ---------------------------------------------------------------- run limits
  const setConcurrency = (next: number) => {
    setLocal((prev) => ({ ...prev, concurrency: next }))
    void patchWorkspace.mutateAsync({ concurrency: next }).catch(() => {})
  }
  const incrementConcurrency = () => {
    if (local.concurrency < CONCURRENCY_MAX) setConcurrency(local.concurrency + 1)
  }
  const decrementConcurrency = () => {
    if (local.concurrency > CONCURRENCY_MIN) setConcurrency(local.concurrency - 1)
  }

  const chooseTimeout = (minutes: number) => {
    setShowTimeoutMenu(false)
    const timeoutMs = minutes * 60_000
    if (timeoutMs === local.timeoutMs) return
    setLocal((prev) => ({ ...prev, timeoutMs }))
    void patchWorkspace.mutateAsync({ timeoutMs }).catch(() => {})
  }

  // ---------------------------------------------------------------- global
  const closeReplaceToken = () => {
    setShowReplaceToken(false)
    setNewToken('')
  }

  const handleReplaceToken = async () => {
    const trimmed = newToken.trim()
    if (!trimmed || !connection) return
    setReplacingToken(true)
    try {
      // Validate the new token against the server before persisting it — an unauthenticated
      // route wouldn't catch a typo'd token.
      const probeClient = new TadaClient({ baseUrl: connection.baseUrl, token: trimmed })
      await probeClient.status()
      await connect({ baseUrl: connection.baseUrl, token: trimmed })
      closeReplaceToken()
    } catch {
      showToast('Could not verify the new token')
    } finally {
      setReplacingToken(false)
    }
  }

  const sectionTitle = (title: string) => (
    <Text style={[type.monoCaps, styles.sectionTitle, { color: colors.textFaintSolid }]}>{title}</Text>
  )

  const errorText = (testID: string, message: string) => (
    <Text testID={testID} accessibilityRole="alert" style={[type.caption, { color: colors.failText }]}>
      {message}
    </Text>
  )

  const currentTimeoutMinutes = Math.round(local.timeoutMs / 60_000)

  // ================================================================== sections
  const sourcesSection = (
    <View style={styles.section}>
      {sectionTitle('SOURCES — THIS WORKSPACE ONLY')}
      <Card style={styles.sourcesCard}>
        {workspace.sources.length === 0 ? (
          <Text style={[type.caption, { color: colors.textFaintSolid }]}>
            No repositories — agents will run without a codebase.
          </Text>
        ) : (
          workspace.sources.map((source) => (
            <View key={source.name} style={[styles.sourceRow, { borderBottomColor: colors.borderSubtle }]}>
              <Text style={[type.mono, { color: colors.text }]}>{source.name}</Text>
              <Tag label={sourceTag(source)} />
              <View style={styles.flex1} />
              <Button
                testID={`remove-repo-${source.name}`}
                variant="ghost"
                small
                label="Remove"
                onPress={() => setRepoToRemove(source.name)}
              />
            </View>
          ))
        )}
        <View style={styles.addRow}>
          <Button testID="open-add-repo" variant="secondary" small label="Add repo" onPress={() => setShowAddRepo(true)} />
          <Button
            testID="open-add-folder"
            variant="secondary"
            small
            label="Add folder"
            onPress={() => setShowAddFolder(true)}
          />
        </View>
        {removeRepoError ? errorText('remove-repo-error', removeRepoError) : null}
      </Card>
    </View>
  )

  const agentSection = (
    <View style={styles.section}>
      {sectionTitle('AGENT')}
      <Card style={styles.agentCard}>
        <View style={styles.agentRow}>
          <Text style={[type.caption, styles.rowLabel, { color: colors.text }]}>Harness</Text>
          {(adapters ?? []).map((adapter) => (
            <View key={adapter.id} style={styles.segmentedItem}>
              <Button
                testID={`harness-${adapter.id}`}
                variant={adapter.id === local.adapter ? 'secondary' : 'ghost'}
                small
                label={adapter.label}
                disabled={!adapter.available}
                onPress={() => chooseHarness(adapter)}
              />
              {!adapter.available ? (
                <Text
                  testID={`harness-hint-${adapter.id}`}
                  style={[type.caption, styles.hint, { color: colors.textFaintSolid }]}
                >
                  not installed on the server
                </Text>
              ) : null}
            </View>
          ))}
        </View>

        <View style={styles.agentRow}>
          <Text style={[type.caption, styles.rowLabel, { color: colors.text }]}>Model</Text>
          <Button
            testID="model-menu-trigger"
            variant="secondary"
            small
            label={`${humanize(local.model)} ▾`}
            onPress={() => setShowModelMenu(true)}
          />
          <Text style={[type.caption, styles.rowLabel, styles.effortLabel, { color: colors.text }]}>Effort</Text>
          {(currentAdapterInfo?.efforts ?? []).map((effort) => (
            <Button
              key={effort}
              testID={`effort-${effort}`}
              variant={effort === local.effort ? 'secondary' : 'ghost'}
              small
              label={humanize(effort)}
              onPress={() => chooseEffort(effort)}
            />
          ))}
        </View>

        <Text style={[type.caption, { color: colors.textFaintSolid }]}>
          Model and effort options come from the selected harness.
        </Text>
        {agentError ? errorText('agent-error', agentError) : null}
      </Card>
    </View>
  )

  const limitsSection = (
    <View style={styles.section}>
      {sectionTitle('RUN LIMITS')}
      <Card style={styles.limitsCard}>
        <View style={[styles.limitRow, { borderBottomColor: colors.borderSubtle }]}>
          <View>
            <Text style={[type.bodyStrong, { color: colors.text }]}>Concurrent runs</Text>
            <Text style={[type.caption, { color: colors.textFaintSolid }]}>Agents working at once</Text>
          </View>
          <View style={styles.flex1} />
          <Stepper
            testID="concurrency-stepper"
            value={local.concurrency}
            min={CONCURRENCY_MIN}
            max={CONCURRENCY_MAX}
            onDecrement={decrementConcurrency}
            onIncrement={incrementConcurrency}
          />
        </View>
        <View style={styles.limitRow}>
          <View>
            <Text style={[type.bodyStrong, { color: colors.text }]}>Per-run timeout</Text>
            <Text style={[type.caption, { color: colors.textFaintSolid }]}>Runs are stopped past this</Text>
          </View>
          <View style={styles.flex1} />
          <Button
            testID="timeout-menu-trigger"
            variant="secondary"
            small
            label={`${currentTimeoutMinutes} min ▾`}
            onPress={() => setShowTimeoutMenu(true)}
          />
        </View>
      </Card>
    </View>
  )

  const globalSection = (
    <View style={styles.section}>
      {sectionTitle('GLOBAL — APPLIES TO EVERY WORKSPACE')}
      <Card style={styles.globalCard}>
        <View style={[styles.limitRow, { borderBottomColor: colors.borderSubtle }]}>
          <Text style={[type.caption, styles.rowLabel, { color: colors.text }]}>Server</Text>
          <View style={[styles.dot, { backgroundColor: colors.okText }]} />
          <Text style={[type.mono, { color: colors.textMuted }]}>{connection?.baseUrl ?? '—'}</Text>
          <View style={styles.flex1} />
          <Button
            testID="disconnect-button"
            variant="destructive"
            small
            label="Disconnect"
            onPress={() => setConfirmDisconnect(true)}
          />
        </View>
        <View style={!wide ? [styles.limitRow, { borderBottomColor: colors.borderSubtle }] : styles.limitRow}>
          <Text style={[type.caption, styles.rowLabel, { color: colors.text }]}>API token</Text>
          <Text testID="masked-token" style={[type.mono, { color: colors.textMuted }]}>
            {connection ? maskToken(connection.token) : '—'}
          </Text>
          <View style={styles.flex1} />
          <Button
            testID="open-replace-token"
            variant="secondary"
            small
            label="Replace"
            onPress={() => setShowReplaceToken(true)}
          />
        </View>
        {!wide ? (
          <View style={styles.limitRow}>
            <View>
              <Text style={[type.bodyStrong, { color: colors.text }]}>Night watch</Text>
              <Text style={[type.caption, { color: colors.textFaintSolid }]}>
                Dark ink is the default; flip for paper day
              </Text>
            </View>
            <View style={styles.flex1} />
            <NarrowThemeSwitch />
          </View>
        ) : null}
      </Card>
    </View>
  )

  const dialogs = (
    <>
      <Dialog
        visible={showAddRepo}
        title="Add repository"
        onClose={() => {
          setShowAddRepo(false)
          setAddRepoUrl('')
          setAddRepoError('')
        }}
        testID="add-repo-dialog"
        confirm={{
          label: 'Add',
          onPress: handleAddRepo,
          disabled: addSource.isPending,
          loading: addSource.isPending,
          testID: 'add-repo-confirm',
        }}
      >
        <Input
          testID="add-repo-url-input"
          label="Repository URL"
          placeholder="https://… or git@…"
          mono
          autoCapitalize="none"
          autoCorrect={false}
          value={addRepoUrl}
          onChangeText={setAddRepoUrl}
        />
        {addRepoError ? errorText('add-repo-error', addRepoError) : null}
      </Dialog>

      <Dialog
        visible={showAddFolder}
        title="Add folder"
        onClose={() => {
          setShowAddFolder(false)
          setAddFolderPath('')
          setAddFolderError('')
        }}
        testID="add-folder-dialog"
        confirm={{
          label: 'Add',
          onPress: handleAddFolder,
          disabled: addSource.isPending,
          loading: addSource.isPending,
          testID: 'add-folder-confirm',
        }}
      >
        <Text style={[type.caption, { color: colors.textMuted }]}>Must be an absolute path that exists on the server.</Text>
        <Input
          testID="add-folder-path-input"
          label="Folder path"
          placeholder="/srv/repos/parlor-specs"
          mono
          autoCapitalize="none"
          autoCorrect={false}
          value={addFolderPath}
          onChangeText={setAddFolderPath}
        />
        {addFolderError ? errorText('add-folder-error', addFolderError) : null}
      </Dialog>

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
        <Text style={[type.body, { color: colors.textMuted }]}>
          {`${repoToRemove ?? ''} will be removed from this workspace. The repository itself is not deleted.`}
        </Text>
      </Dialog>

      <Menu visible={showModelMenu} onClose={() => setShowModelMenu(false)} testID="model-menu">
        {(currentAdapterInfo?.models ?? []).map((model) => (
          <ListRow
            key={model}
            testID={`model-option-${model}`}
            title={humanize(model)}
            trailing={model === local.model ? <Icon name="check" size={16} color={colors.text} /> : null}
            onPress={() => chooseModel(model)}
          />
        ))}
      </Menu>

      <Menu visible={showTimeoutMenu} onClose={() => setShowTimeoutMenu(false)} testID="timeout-menu">
        {TIMEOUT_OPTIONS_MIN.map((minutes) => (
          <ListRow
            key={minutes}
            testID={`timeout-option-${minutes}`}
            title={`${minutes} min`}
            trailing={
              minutes === currentTimeoutMinutes ? <Icon name="check" size={16} color={colors.text} /> : null
            }
            onPress={() => chooseTimeout(minutes)}
          />
        ))}
      </Menu>

      <Dialog
        visible={confirmDisconnect}
        title="Disconnect from server?"
        onClose={() => setConfirmDisconnect(false)}
        confirm={{
          label: 'Disconnect',
          destructive: true,
          onPress: () => {
            setConfirmDisconnect(false)
            void disconnect()
          },
          testID: 'disconnect-confirm',
        }}
      >
        <Text style={[type.body, { color: colors.textMuted }]}>
          {"You'll be sent back to the connect screen. Nothing on the server is touched."}
        </Text>
      </Dialog>

      <Dialog
        visible={showReplaceToken}
        title="Replace API token"
        onClose={closeReplaceToken}
        testID="replace-token-dialog"
        confirm={{
          label: 'Replace',
          onPress: () => void handleReplaceToken(),
          disabled: replacingToken || newToken.trim().length === 0,
          loading: replacingToken,
          testID: 'replace-token-confirm',
        }}
      >
        <Input
          testID="replace-token-input"
          label="API token"
          mono
          secureTextEntry
          autoFocus
          value={newToken}
          onChangeText={setNewToken}
        />
      </Dialog>
    </>
  )

  if (wide) {
    return (
      <View style={[styles.wideRoot, { backgroundColor: colors.ground }]} testID="settings-wide">
        <Rail
          active="settings"
          workspaceId={wsId}
          workspaceName={workspace.name}
          sourceCount={workspace.sources.length}
          testID="settings-rail"
        />
        <ScrollView contentContainerStyle={styles.wideContent}>
          <View style={styles.headerRow}>
            <Text style={[type.display, { color: colors.text }]}>Settings</Text>
            <Text style={[type.mono, { color: colors.textFaintSolid }]}>{workspace.name}</Text>
          </View>
          {sourcesSection}
          {agentSection}
          {limitsSection}
          {globalSection}
        </ScrollView>
        {dialogs}
      </View>
    )
  }

  return (
    <Screen testID="settings-narrow">
      <AppHeader title="Settings" back />
      <ScrollView contentContainerStyle={styles.content}>
        {sourcesSection}
        {agentSection}
        {limitsSection}
        {globalSection}
      </ScrollView>
      {dialogs}
    </Screen>
  )
}

/** Night watch/day switch — narrow-only (wide gets the same control in the Rail footer). Lives
 * as its own component only so it can call useTheme for scheme/setScheme without threading them
 * through the whole screen. */
function NarrowThemeSwitch() {
  const { colors, scheme, setScheme } = useTheme()
  return (
    <Switch
      testID="theme-switch"
      accessibilityLabel="Day mode"
      value={scheme === 'day'}
      onValueChange={(on) => setScheme(on ? 'day' : 'night')}
      trackColor={{ true: colors.live, false: colors.raised2 }}
      thumbColor={colors.raised}
    />
  )
}

const styles = StyleSheet.create({
  skeletons: {
    padding: space.lg,
    gap: space.lg,
  },
  wideRoot: {
    flex: 1,
    flexDirection: 'row',
  },
  wideContent: {
    flexGrow: 1,
    alignItems: 'center',
    padding: space.xxl,
  },
  headerRow: {
    width: '100%',
    maxWidth: 680,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.sm,
    marginBottom: space.lg,
  },
  content: {
    padding: space.lg,
    gap: space.xl,
  },
  section: {
    gap: space.sm,
    width: '100%',
    maxWidth: 680,
  },
  sectionTitle: {
    textTransform: 'uppercase',
  },
  sourcesCard: {
    gap: 0,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  addRow: {
    flexDirection: 'row',
    gap: space.sm,
    paddingVertical: space.sm + 2,
  },
  agentCard: {
    gap: space.md,
  },
  agentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  rowLabel: {
    fontWeight: '500',
  },
  effortLabel: {
    marginLeft: space.sm,
  },
  segmentedItem: {
    alignItems: 'center',
    gap: 2,
  },
  hint: {
    maxWidth: 96,
    textAlign: 'center',
  },
  limitsCard: {
    gap: 0,
  },
  limitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'transparent',
  },
  globalCard: {
    gap: 0,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  flex1: {
    flex: 1,
  },
})
