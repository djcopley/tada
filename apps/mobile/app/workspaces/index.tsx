import type { ApiTicket, ApiWorkspaceListItem } from '@tada/shared'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { useBoards, useCreateWorkspace, useWorkspaces } from '../../src/api/queries'
import {
  AgentLine,
  AgentPanel,
  AppHeader,
  Card,
  Dialog,
  EmptyState,
  Input,
  Screen,
  Skeleton,
  StatusTag,
} from '../../src/components/ui'
import { WorkspaceCard } from '../../src/components/WorkspaceCard'
import { useTheme } from '../../src/design/ThemeContext'
import { space, type } from '../../src/design/tokens'

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']

function countWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n)
}

type TriageTicket = { ticket: ApiTicket; workspace: ApiWorkspaceListItem; failed: boolean }
type LiveTicket = { ticket: ApiTicket; workspace: ApiWorkspaceListItem }

/**
 * Control — the home screen. Cross-workspace triage: what needs you first,
 * which agents are live right now, then the workspaces themselves.
 */
export default function Control() {
  const router = useRouter()
  const { colors } = useTheme()
  const { data, isLoading, isRefetching, refetch } = useWorkspaces()
  const createWorkspace = useCreateWorkspace()

  const workspaces = data ?? []
  const boards = useBoards(workspaces.map((w) => w.id))

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

  // Fold every loaded board into the triage lists. Boards still loading
  // simply contribute nothing yet; counts on the workspace rows cover them.
  const needsYou: TriageTicket[] = []
  const liveNow: LiveTicket[] = []
  boards.forEach((query, index) => {
    const workspace = workspaces[index]
    if (!query.data || !workspace) return
    for (const column of query.data.columns) {
      for (const ticket of column.tickets) {
        if (column.kind === 'in_review') {
          needsYou.push({ ticket, workspace, failed: false })
        } else if (ticket.queueState === 'held') {
          needsYou.push({ ticket, workspace, failed: true })
        } else if (column.kind === 'in_progress') {
          liveNow.push({ ticket, workspace })
        }
      }
    }
  })

  const liveCount = workspaces.reduce((sum, w) => sum + w.runningCount, 0)

  const headline =
    needsYou.length === 0
      ? 'All quiet'
      : `${countWord(needsYou.length)} thing${needsYou.length === 1 ? '' : 's'} need${needsYou.length === 1 ? 's' : ''} you`
  const subline =
    liveCount > 0
      ? `${liveCount} agent${liveCount === 1 ? '' : 's'} live right now`
      : needsYou.length === 0
        ? 'nothing waiting on you'
        : 'no agents live right now'

  const sectionLabel = (label: string, tone: 'default' | 'live' = 'default') => (
    <Text
      style={[
        type.monoCaps,
        styles.sectionLabel,
        { color: tone === 'live' ? colors.liveText : colors.textFaintSolid },
      ]}
    >
      {label}
    </Text>
  )

  const header = (
    <View style={styles.headerBlock}>
      <View>
        <Text style={[type.display, { color: colors.text }]}>{headline}</Text>
        <Text style={[type.monoSmall, styles.subline, { color: colors.textFaintSolid }]}>{subline}</Text>
      </View>

      {needsYou.length > 0 && (
        <View style={styles.section}>
          {sectionLabel(`Needs you · ${needsYou.length}`)}
          {needsYou.map(({ ticket, workspace, failed }) => (
            <Card
              key={ticket.id}
              testID={`needs-you-${ticket.id}`}
              onPress={() => router.push(`/tickets/${ticket.id}`)}
              style={styles.triageCard}
            >
              <Text numberOfLines={2} style={[type.bodyStrong, { color: colors.text }]}>
                {ticket.title}
              </Text>
              <View style={styles.triageMeta}>
                <StatusTag
                  status={
                    failed ? { label: 'Failed', signal: 'fail' } : { label: 'Your turn', signal: 'ok' }
                  }
                />
                <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>
                  {`${workspace.name} · #${ticket.id}`}
                </Text>
              </View>
            </Card>
          ))}
        </View>
      )}

      {liveNow.length > 0 && (
        <View style={styles.section}>
          {sectionLabel(`Live now · ${liveNow.length}`, 'live')}
          <AgentPanel testID="live-now-panel">
            {liveNow.map(({ ticket, workspace }) => (
              <Pressable
                key={ticket.id}
                accessibilityRole="button"
                accessibilityLabel={`Watch ${ticket.title}`}
                onPress={() => router.push(`/tickets/${ticket.id}`)}
              >
                <AgentLine>{`${ticket.title.toLowerCase()} · ${workspace.name}`}</AgentLine>
              </Pressable>
            ))}
          </AgentPanel>
        </View>
      )}

      {workspaces.length > 0 && sectionLabel('Workspaces')}
    </View>
  )

  return (
    <Screen>
      <AppHeader
        title=""
        wordmark
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
          ListHeaderComponent={header}
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
          label: 'Create workspace',
          onPress: () => void onCreate(),
          disabled: createWorkspace.isPending || name.trim().length === 0,
          loading: createWorkspace.isPending,
          testID: 'workspace-create-button',
        }}
      >
        <Text style={[type.caption, { color: colors.textMuted }]}>
          A workspace holds its own board, memory and agent limits. It is created on your server.
        </Text>
        <Input
          testID="workspace-name-input"
          label="Name"
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
    paddingBottom: space.xxl,
  },
  headerBlock: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    gap: space.xl,
  },
  subline: {
    marginTop: space.xs,
  },
  section: {
    gap: space.sm,
  },
  sectionLabel: {
    textTransform: 'uppercase',
  },
  triageCard: {
    gap: space.sm,
  },
  triageMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm + 2,
  },
})
