import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../api/client'
import { useClient } from '../api/ClientContext'
import { keys, useCheckName, useCreateWorkspace, useKnownRepos } from '../api/queries'
import { useTheme } from '../design/ThemeContext'
import { space, type } from '../design/tokens'
import { showToast } from '../toast'
import { Checkbox, Dialog, Input } from './ui'

type Listener = () => void
const listeners = new Set<Listener>()

/** Opens the one "New workspace" dialog from any trigger — Control's own button and the
 * workspace switcher's `+ New workspace` row alike — mirroring showToast/openWorkspaceSwitcher's
 * module-level pub/sub so callers never need the dialog in their own tree. */
export function openNewWorkspaceDialog(): void {
  for (const listener of listeners) listener()
}

/**
 * Names the workspace on the server, then attaches any checked known repos before landing on
 * its board. Repos are optional — "you can attach more later in Settings." Mounted once near
 * the app root (see app/_layout.tsx); triggered by {@link openNewWorkspaceDialog}.
 */
/** The server's `{ error }` message from an ApiError, when it sent one. */
function apiErrorText(err: unknown): string | undefined {
  if (err instanceof ApiError && typeof err.body === 'object' && err.body !== null && 'error' in err.body) {
    const value = (err.body as { error: unknown }).error
    if (typeof value === 'string' && value) return value
  }
  return undefined
}

export function NewWorkspaceDialog() {
  const router = useRouter()
  const client = useClient()
  const qc = useQueryClient()
  const { colors } = useTheme()
  const [visible, setVisible] = useState(false)
  const [name, setName] = useState('')
  const [checkedRepos, setCheckedRepos] = useState<Set<string>>(new Set())
  const [createError, setCreateError] = useState('')

  const { data: knownRepos } = useKnownRepos()
  const { data: nameCheck } = useCheckName(name)
  const createWorkspace = useCreateWorkspace()

  useEffect(() => {
    const listener: Listener = () => setVisible(true)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  const close = () => {
    setVisible(false)
    setName('')
    setCreateError('')
    setCheckedRepos(new Set())
  }

  const toggleRepo = (url: string) => {
    setCheckedRepos((prev) => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })
  }

  const confirmCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    let workspace: { id: number }
    try {
      setCreateError('')
      workspace = await createWorkspace.mutateAsync(trimmed)
    } catch (err) {
      // The global handler toasts most failures but deliberately skips 409s (a screen's own
      // business), and a 400 for a name the live check waved through deserves the reason inline
      // either way — leave the dialog open with it.
      setCreateError(apiErrorText(err) ?? 'Could not create the workspace')
      return
    }
    // The workspace exists from here on, so a failed clone must not leave the dialog open (a
    // retry would just hit "name taken"): report which repo failed and land on Settings, where
    // sources are managed and the clone can be retried.
    let failed: string | undefined
    for (const url of checkedRepos) {
      try {
        await client.addSource(workspace.id, { type: 'repo', url })
      } catch (err) {
        const detail = apiErrorText(err)
        failed = detail ? `${url} (${detail})` : url
        break
      }
    }
    void qc.invalidateQueries({ queryKey: keys.workspaces })
    void qc.invalidateQueries({ queryKey: keys.workspace(workspace.id) })
    close()
    if (failed) {
      showToast(`Workspace created, but adding ${failed} failed`)
      router.navigate(`/workspaces/${workspace.id}/settings`)
    } else {
      router.navigate(`/workspaces/${workspace.id}/board`)
    }
  }

  const trimmedName = name.trim()
  const checkLine =
    trimmedName.length > 0 && nameCheck
      ? nameCheck.available
        ? `✓ id ${nameCheck.id} · available`
        : `✕ id ${nameCheck.id} · ${nameCheck.reason ?? 'taken'}`
      : null

  return (
    <Dialog
      visible={visible}
      title="New workspace"
      onClose={close}
      testID="new-workspace-dialog"
      confirm={{
        label: 'Create workspace',
        onPress: () => void confirmCreate(),
        disabled: createWorkspace.isPending || trimmedName.length === 0 || nameCheck?.available === false,
        loading: createWorkspace.isPending,
        testID: 'workspace-create-button',
      }}
    >
      <Text style={[type.caption, styles.explainer, { color: colors.textMuted }]}>
        A workspace holds its own board, memory and agent limits. It is created on your server.
      </Text>
      <Input
        testID="workspace-name-input"
        label="Name"
        placeholder="Name"
        autoFocus
        value={name}
        returnKeyType="done"
        onSubmitEditing={() => void confirmCreate()}
        onChangeText={(v) => {
          setName(v)
          if (createError) setCreateError('')
        }}
      />
      {checkLine ? (
        <Text
          testID="workspace-name-check"
          style={[type.monoSmall, { color: nameCheck?.available ? colors.okText : colors.failText }]}
        >
          {checkLine}
        </Text>
      ) : null}
      {createError ? (
        <Text testID="workspace-create-error" style={[type.caption, { color: colors.failText }]}>
          {createError}
        </Text>
      ) : null}

      <View style={styles.repos}>
        <Text style={[type.monoCaps, styles.reposLabel, { color: colors.textFaintSolid }]}>
          Attach repos — optional
        </Text>
        {(knownRepos ?? []).map((repo) => (
          <Checkbox
            key={repo.url}
            testID={`attach-repo-${repo.url}`}
            label={repo.name}
            checked={checkedRepos.has(repo.url)}
            onChange={() => toggleRepo(repo.url)}
          />
        ))}
        <Text style={[type.caption, { color: colors.textFaintSolid }]}>
          You can attach more later in Settings. Memory starts empty — global notes still apply.
        </Text>
      </View>
    </Dialog>
  )
}

const styles = StyleSheet.create({
  explainer: {
    marginTop: -2,
  },
  repos: {
    gap: space.sm - 1,
  },
  reposLabel: {
    textTransform: 'uppercase',
  },
})
