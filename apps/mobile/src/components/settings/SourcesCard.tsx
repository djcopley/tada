import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { ApiError } from '../../api/client'
import { useAddSource, useRemoveSource, useSources } from '../../api/queries'
import { useTheme } from '../../design/ThemeContext'
import { space, type } from '../../design/tokens'
import { isRepoUrl, sourceTag } from '../../settingsScreen'
import { Button, Dialog, Input, Tag } from '../ui'
import { SettingsRow, SettingsSection } from './SettingsSection'

function apiErrorMessage(err: unknown, fallback: string): string {
  const body = (err as ApiError | undefined)?.body
  return typeof body === 'object' && body !== null && 'error' in body
    ? String((body as Record<string, unknown>).error)
    : fallback
}

/** Sources: the repos (clones) and folders every run may work out of. */
export function SourcesCard() {
  const { colors } = useTheme()
  const { data: sources } = useSources()
  const addSource = useAddSource()
  const removeSource = useRemoveSource()

  const [toRemove, setToRemove] = useState<string | null>(null)
  const [showAddRepo, setShowAddRepo] = useState(false)
  const [repoUrl, setRepoUrl] = useState('')
  const [repoError, setRepoError] = useState('')
  const [showAddFolder, setShowAddFolder] = useState(false)
  const [folderPath, setFolderPath] = useState('')
  const [folderError, setFolderError] = useState('')

  const list = sources ?? []
  const removing = list.find((s) => s.name === toRemove)

  const handleAddRepo = () => {
    setRepoError('')
    const url = repoUrl.trim()
    if (!url) return setRepoError('URL cannot be empty')
    if (!isRepoUrl(url)) return setRepoError('Enter a git URL (https://, ssh://, git@host:path or file://)')
    addSource.mutate(
      { type: 'repo', url },
      {
        onSuccess: () => {
          setShowAddRepo(false)
          setRepoUrl('')
        },
        onError: (err) => setRepoError(err instanceof ApiError && err.status === 409 ? 'That repo is already connected' : apiErrorMessage(err, 'Failed to add repo')),
      },
    )
  }

  const handleAddFolder = () => {
    setFolderError('')
    const path = folderPath.trim()
    if (!path) return setFolderError('Path cannot be empty')
    if (!path.startsWith('/')) return setFolderError('Path must be absolute — it has to exist on the server')
    addSource.mutate(
      { type: 'folder', path },
      {
        onSuccess: () => {
          setShowAddFolder(false)
          setFolderPath('')
        },
        onError: (err) => setFolderError(apiErrorMessage(err, 'Failed to add folder')),
      },
    )
  }

  const errorText = (testID: string, message: string) => (
    <Text testID={testID} accessibilityRole="alert" style={[type.caption, { color: colors.failText }]}>
      {message}
    </Text>
  )

  return (
    <SettingsSection title="Sources" testID="settings-sources">
      {list.length === 0 ? (
        <SettingsRow>
          <Text style={[type.caption, { color: colors.textFaintSolid }]}>
            No repos or folders yet — the agent runs out of an empty folder until you add some.
          </Text>
        </SettingsRow>
      ) : (
        list.map((source) => (
          <SettingsRow key={source.name} testID={`source-${source.name}`}>
            <Text style={[type.mono, styles.shrink, { color: colors.text }]} numberOfLines={1}>
              {source.name}
            </Text>
            <Tag label={sourceTag(source)} />
            <View style={styles.flex1} />
            <Button testID={`remove-source-${source.name}`} variant="ghost" small label="Remove" onPress={() => setToRemove(source.name)} />
          </SettingsRow>
        ))
      )}
      <SettingsRow last>
        <Button testID="open-add-repo" variant="secondary" small label="Add repo" onPress={() => setShowAddRepo(true)} />
        <Button testID="open-add-folder" variant="secondary" small label="Add folder" onPress={() => setShowAddFolder(true)} />
      </SettingsRow>

      <Dialog
        visible={showAddRepo}
        title="Add repository"
        onClose={() => {
          setShowAddRepo(false)
          setRepoUrl('')
          setRepoError('')
        }}
        testID="add-repo-dialog"
        confirm={{ label: 'Add', onPress: handleAddRepo, disabled: addSource.isPending, loading: addSource.isPending, testID: 'add-repo-confirm' }}
      >
        <Text style={[type.caption, { color: colors.textMuted }]}>The server clones it once; runs make a worktree per ticket.</Text>
        <Input
          testID="add-repo-url-input"
          label="Repository URL"
          placeholder="https://…, git@…, ssh://… or file://…"
          mono
          autoCapitalize="none"
          autoCorrect={false}
          value={repoUrl}
          onChangeText={setRepoUrl}
          returnKeyType="done"
          onSubmitEditing={handleAddRepo}
          containerStyle={styles.field}
        />
        {addSource.isPending ? <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>cloning…</Text> : null}
        {repoError ? errorText('add-repo-error', repoError) : null}
      </Dialog>

      <Dialog
        visible={showAddFolder}
        title="Add folder"
        onClose={() => {
          setShowAddFolder(false)
          setFolderPath('')
          setFolderError('')
        }}
        testID="add-folder-dialog"
        confirm={{ label: 'Add', onPress: handleAddFolder, disabled: addSource.isPending, loading: addSource.isPending, testID: 'add-folder-confirm' }}
      >
        <Text style={[type.caption, { color: colors.textMuted }]}>Must be an absolute path that exists on the server.</Text>
        <Input
          testID="add-folder-path-input"
          label="Folder path"
          placeholder="/srv/docs/parlor-specs"
          mono
          autoCapitalize="none"
          autoCorrect={false}
          value={folderPath}
          onChangeText={setFolderPath}
          returnKeyType="done"
          onSubmitEditing={handleAddFolder}
          containerStyle={styles.field}
        />
        {folderError ? errorText('add-folder-error', folderError) : null}
      </Dialog>

      <Dialog
        visible={toRemove !== null}
        title={removing?.type === 'folder' ? 'Detach folder?' : 'Remove repository?'}
        onClose={() => setToRemove(null)}
        confirm={{
          label: 'Remove',
          destructive: true,
          onPress: () => {
            const name = toRemove
            setToRemove(null)
            if (name) removeSource.mutate(name)
          },
          testID: 'remove-source-confirm',
        }}
      >
        <Text style={[type.body, { color: colors.textMuted }]}>
          {removing?.type === 'folder'
            ? `${toRemove ?? ''} will no longer be attached. The folder on the server is not deleted.`
            : `${toRemove ?? ''} will be removed and its clone deleted. The remote repository is not touched.`}
        </Text>
      </Dialog>
    </SettingsSection>
  )
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  shrink: { flexShrink: 1 },
  field: { marginTop: space.sm },
})
