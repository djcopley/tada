import type { ApiMemoryNote } from '@tada/shared'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import {
  useActiveWorkspace,
  useDiscardNote,
  useGlobalMemory,
  useGlobalPutMemory,
  useKeepNote,
  useMemory,
  usePutMemory,
  useWorkspace,
} from '../../api/queries'
import {
  AgentPanel,
  AppHeader,
  BottomStrip,
  Button,
  Card,
  Dialog,
  EmptyState,
  IconButton,
  Input,
  Rail,
  Screen,
  Skeleton,
} from '../ui'
import { useTheme } from '../../design/ThemeContext'
import { useLayout } from '../../layout'
import { hhmm } from '../../control'
import { bareAge } from '../../relativeTime'
import { space, type } from '../../design/tokens'
import { showToast } from '../../toast'
import { openWorkspaceSwitcher } from '../WorkspaceSwitcher'
import { CardHeader } from '../ticket/TicketDetailCards'
import { useClaimActiveWorkspace } from '../../useClaimActiveWorkspace'

const DAY_MS = 24 * 60 * 60 * 1000

/** `HH:MM` for same-day notes, otherwise the coarser `2w`-style bucket — mirrors the artboard's
 * `by agent · 07:58` for a note learned today, falling back to a bare age for older ones. */
function noteAge(iso: string): string {
  return Date.now() - new Date(iso).getTime() < DAY_MS ? hhmm(iso) : bareAge(iso)
}

/** AGENTS.md has no `title` field of its own (it's a raw string, not a note) — pull the first
 * markdown heading as its card title, falling back to a generic label for a headerless file. */
export function agentsMdTitle(agentsMd: string): string {
  const match = agentsMd.match(/^#\s+(.+)/m)
  return match?.[1] ? match[1].trim() : 'Charter'
}

/** Strips a leading `# <heading>` markdown title line (and the blank line usually following it)
 * from a note/AGENTS.md body before it renders as a card preview. The title already renders in
 * the card's own header, so the preview underneath should start at the body text — the artboard
 * never shows the heading twice (e.g. `# Conventions` leaking in as the first preview line). */
export function stripLeadingHeading(body: string): string {
  return body.replace(/^#[ \t]+[^\r\n]*\r?\n?\r?\n?/, '').trimStart()
}

function isValidName(name: string): boolean {
  if (name.includes('/') || name.includes('..')) return false
  const basename = name.split('/').pop() || ''
  return basename === name
}

type Props = { scope: 'workspace'; wsId: number } | { scope: 'global' }

/**
 * One screen, two scopes: `/workspaces/:id/memory` and `/memory`. Workspace scope shows a
 * "Global" summary card (every global note's body, tap to jump into global scope); global scope
 * IS that same note set, shown directly with no summary card wrapping it.
 */
export function MemoryListScreen(props: Props) {
  const { scope } = props
  const wsId = props.scope === 'workspace' ? props.wsId : undefined
  const router = useRouter()
  const { colors } = useTheme()
  const { wide } = useLayout()

  const workspaceMemory = useMemory(scope === 'workspace' ? wsId : undefined)
  const globalMemory = useGlobalMemory()
  const { data: workspace } = useWorkspace(wsId)
  const { activeWorkspaceId } = useActiveWorkspace()
  useClaimActiveWorkspace(scope === 'workspace' ? wsId : undefined)

  const putMemory = usePutMemory(wsId ?? -1)
  const putGlobalMemory = useGlobalPutMemory()
  const keepNote = useKeepNote(wsId)
  const discardNote = useDiscardNote(wsId)

  const [showNamePrompt, setShowNamePrompt] = useState(false)
  const [newNoteName, setNewNoteName] = useState('')
  const [nameError, setNameError] = useState('')
  const [discardTarget, setDiscardTarget] = useState<ApiMemoryNote | null>(null)

  if (scope === 'workspace' && Number.isNaN(wsId)) {
    return (
      <Screen>
        <AppHeader title="Memory" back />
        <EmptyState icon="alert-circle" message="This workspace doesn't exist." />
      </Screen>
    )
  }

  const data = scope === 'workspace' ? workspaceMemory.data : globalMemory.data
  const isLoading = scope === 'workspace' ? workspaceMemory.isLoading : globalMemory.isLoading
  const isError = scope === 'workspace' ? workspaceMemory.isError : globalMemory.isError

  if (isError) {
    return (
      <Screen>
        <AppHeader title="Memory" back />
        <EmptyState icon="alert-circle" message="This workspace doesn't exist." />
      </Screen>
    )
  }

  if (isLoading || !data) {
    return (
      <Screen>
        <AppHeader title="Memory" back />
        <View style={styles.skeletons}>
          <Skeleton height={92} />
          <Skeleton height={92} />
          <Skeleton height={92} />
        </View>
      </Screen>
    )
  }

  const notes = data.notes
  const kept = notes.filter((n) => n.state === 'kept')
  const pending = notes.filter((n) => n.state === 'pending' && n.author === 'agent')
  const globalNotes = globalMemory.data?.notes ?? []
  const globalKept = globalNotes.filter((n) => n.state === 'kept')

  const agentsMdBody = stripLeadingHeading(data.agentsMd).trim()

  const editorHref = (file: string) =>
    scope === 'workspace' ? `/workspaces/${wsId}/memory/${encodeURIComponent(file)}` : `/memory/${encodeURIComponent(file)}`

  const goToGlobal = () => router.push('/memory')

  // Rail/BottomStrip need a workspace to scope Board/Settings links to — in global scope there's
  // no workspace param at all, so fall back to whichever one is active on-device.
  const navWorkspaceId = scope === 'workspace' ? wsId : activeWorkspaceId

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
    const fileName = newNoteName.endsWith('.md') ? newNoteName : `${newNoteName}.md`
    setShowNamePrompt(false)
    setNewNoteName('')
    setNameError('')

    const mutation =
      scope === 'workspace'
        ? putMemory.mutateAsync({ file: fileName, body: '' })
        : putGlobalMemory.mutateAsync({ file: fileName, body: '' })

    void mutation
      .then(() => {
        showToast(`Created ${fileName}`)
        router.push(editorHref(fileName))
      })
      .catch(() => {
        // The global mutation error handler already surfaces a toast.
      })
  }

  const creating = scope === 'workspace' ? putMemory.isPending : putGlobalMemory.isPending

  const confirmDiscard = () => {
    const target = discardTarget
    setDiscardTarget(null)
    if (target) discardNote.mutate(target.id)
  }

  const switcherLabel = scope === 'workspace' ? `${workspace?.name ?? '…'} ▾` : 'global ▾'
  const switcherTrigger = (
    <Button
      testID="memory-workspace-switcher"
      variant="secondary"
      small
      label={switcherLabel}
      onPress={() => openWorkspaceSwitcher('memory')}
    />
  )

  const listBody = (
    <>
      <Card testID="memory-note-AGENTS.md" onPress={() => router.push(editorHref('AGENTS.md'))} style={styles.card}>
        <CardHeader title={agentsMdTitle(data.agentsMd)} meta="pinned" />
        {agentsMdBody ? (
          <Text numberOfLines={3} style={[type.monoSmall, { color: colors.textMuted }]}>
            {agentsMdBody}
          </Text>
        ) : (
          <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>empty</Text>
        )}
      </Card>

      {scope === 'workspace' ? (
        <>
          <Card testID="memory-global-card" onPress={goToGlobal} style={styles.card}>
            <CardHeader title="Global" meta={`every workspace · ${globalKept.length}`} />
            <View style={styles.globalBody}>
              {globalKept.map((n) => (
                <Text key={n.id} style={[type.monoSmall, { color: colors.textMuted }]}>
                  {stripLeadingHeading(n.body)}
                </Text>
              ))}
            </View>
          </Card>

          <View style={styles.divider}>
            <Text style={[type.monoCaps, styles.caps, { color: colors.textFaintSolid }]}>
              {`${(workspace?.name ?? '').toUpperCase()} · ${notes.length} NOTES`}
            </Text>
            <View style={[styles.dividerLine, { backgroundColor: colors.borderSubtle }]} />
          </View>
        </>
      ) : null}

      {kept.map((n) => (
        <Card key={n.id} testID={`memory-note-${n.file}`} onPress={() => router.push(editorHref(n.file))} style={styles.card}>
          <CardHeader
            title={n.title}
            meta={n.author === 'human' ? `edited by you · ${bareAge(n.updatedAt)}` : `by agent · ${bareAge(n.updatedAt)}`}
          />
          <Text style={[type.monoSmall, { color: colors.textMuted }]}>{stripLeadingHeading(n.body)}</Text>
        </Card>
      ))}

      {pending.length > 0 ? (
        <View style={styles.pendingList}>
          {pending.map((n) => (
            <View key={n.id} style={styles.pendingBlock}>
              <AgentPanel
                testID={`memory-pending-${n.id}`}
                header={`learned: ${n.title}`}
                meta={`by agent · ${noteAge(n.updatedAt)}`}
              >
                <Text style={[type.mono, { color: colors.agentText }]}>{n.body}</Text>
              </AgentPanel>
              <View style={styles.actionsRow}>
                <Button
                  testID={`memory-pending-${n.id}-keep`}
                  variant="secondary"
                  small
                  label="Keep"
                  loading={keepNote.isPending && keepNote.variables === n.id}
                  onPress={() => keepNote.mutate(n.id)}
                />
                <Button
                  testID={`memory-pending-${n.id}-discard`}
                  variant="ghost"
                  small
                  label="Discard"
                  onPress={() => setDiscardTarget(n)}
                />
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </>
  )

  const dialogs = (
    <>
      <Dialog
        visible={showNamePrompt}
        title="New note"
        onClose={closePrompt}
        confirm={{
          label: 'Create',
          onPress: handleSubmitName,
          disabled: creating,
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
          editable={!creating}
        />
        {nameError ? (
          <Text testID="memory-name-error" accessibilityRole="alert" style={[type.caption, { color: colors.failText }]}>
            {nameError}
          </Text>
        ) : null}
      </Dialog>

      <Dialog
        visible={discardTarget !== null}
        title="Discard note?"
        onClose={() => setDiscardTarget(null)}
        testID="memory-discard-dialog"
        confirm={{
          label: 'Discard',
          destructive: true,
          onPress: confirmDiscard,
          loading: discardNote.isPending,
          testID: 'memory-discard-confirm',
        }}
      >
        <Text style={[type.body, { color: colors.textMuted }]}>
          {`"${discardTarget?.title ?? ''}" will be deleted — the agent won't see it again.`}
        </Text>
      </Dialog>
    </>
  )

  const explainer = (
    <Text style={[type.caption, styles.intro, { color: colors.textMuted }]}>
      The agent reads every note before a run — and may add its own. Plain text, edit freely.
    </Text>
  )

  const newNoteButton = (small: boolean) => (
    <Button
      testID="memory-add-button"
      variant="primary"
      small={small}
      label="New note"
      onPress={() => {
        setNameError('')
        setNewNoteName('')
        setShowNamePrompt(true)
      }}
    />
  )

  const notesCount = <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>{`${notes.length} notes`}</Text>

  if (wide) {
    return (
      <View style={[styles.wideRoot, { backgroundColor: colors.ground }]} testID="memory-wide">
        <Rail
          active="memory"
          workspaceId={navWorkspaceId}
          workspaceName={workspace?.name}
          sourceCount={workspace?.sources.length}
          testID="memory-rail"
        />
        <ScrollView contentContainerStyle={styles.wideContent}>
          <View style={styles.column}>
            <View style={styles.headerRow}>
              <Text style={[type.display, { color: colors.text }]}>Memory</Text>
              {switcherTrigger}
              {notesCount}
              <View style={styles.spacer} />
              {newNoteButton(false)}
            </View>
            {explainer}
            {listBody}
          </View>
        </ScrollView>
        {dialogs}
      </View>
    )
  }

  return (
    <Screen edges={['top', 'bottom']} testID="memory-narrow">
      <View style={styles.narrowHeader}>
        <Text style={[type.title, { color: colors.text }]}>Memory</Text>
        {switcherTrigger}
        <View style={styles.spacer} />
        {newNoteButton(true)}
        {navWorkspaceId !== undefined ? (
          <IconButton
            testID="memory-settings-button"
            icon="settings"
            label="Settings"
            size="sm"
            onPress={() => router.navigate(`/workspaces/${navWorkspaceId}/settings`)}
          />
        ) : null}
      </View>
      <View style={styles.narrowMeta}>{notesCount}</View>

      <ScrollView contentContainerStyle={styles.narrowContent}>
        {explainer}
        {listBody}
      </ScrollView>

      <View style={styles.bottomStripWrap}>
        <BottomStrip active="memory" workspaceId={navWorkspaceId} testID="memory-bottom-strip" />
      </View>

      {dialogs}
    </Screen>
  )
}

const styles = StyleSheet.create({
  skeletons: {
    padding: space.lg,
    gap: space.md,
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
  column: {
    width: '100%',
    maxWidth: 680,
    gap: space.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  narrowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
  },
  narrowMeta: {
    paddingHorizontal: space.lg,
    paddingTop: space.xs,
  },
  spacer: {
    flex: 1,
  },
  intro: {
    lineHeight: 19,
  },
  narrowContent: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.md,
    gap: space.md,
  },
  bottomStripWrap: {
    padding: space.md,
  },
  card: {
    gap: space.sm,
  },
  globalBody: {
    gap: 6,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: 2,
  },
  caps: {
    textTransform: 'uppercase',
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  pendingList: {
    gap: space.sm,
  },
  pendingBlock: {
    gap: space.sm,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
})
