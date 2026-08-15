import type { ApiComment, ApiRun, ApiTicket } from '@tada/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { ApiError } from '../../src/api/client'
import { keys, useBoard, useComment, usePatchTicket, useTicket, useWorkspace } from '../../src/api/queries'
import { useWorkspaceSocket } from '../../src/api/useWorkspaceSocket'
import { CommentThread } from '../../src/components/CommentThread'
import { RunRow } from '../../src/components/RunRow'
import { TicketActions } from '../../src/components/TicketActions'
import { AppHeader, Button, Card, EmptyState, Icon, Input, Screen, Skeleton, StatusTag, Tag } from '../../src/components/ui'
import { useTheme } from '../../src/design/ThemeContext'
import { humanize, queueStateVisual } from '../../src/design/status'
import { radius, space, type } from '../../src/design/tokens'
import { showToast } from '../../src/toast'

const RUN_IN_PROGRESS_TOAST = 'Agent is working on this ticket — wait or cancel the run'
const ACTIVE_RUN_STATUSES: ReadonlySet<ApiRun['status']> = new Set(['queued', 'running'])

export default function TicketDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const ticketId = Number(id)
  const { data, isLoading } = useTicket(ticketId)

  if (Number.isNaN(ticketId)) {
    return (
      <Screen>
        <AppHeader title="Ticket" back />
        <EmptyState icon="alert-circle" message="This ticket doesn't exist." />
      </Screen>
    )
  }

  if (isLoading || !data) {
    return (
      <Screen>
        <AppHeader title="…" back />
        <View style={styles.skeletons}>
          <Skeleton height={120} style={{ borderRadius: radius.card }} />
          <Skeleton height={200} style={{ borderRadius: radius.card }} />
        </View>
      </Screen>
    )
  }

  return <TicketDetailBody ticketId={ticketId} data={data} />
}

function TicketDetailBody({
  ticketId,
  data,
}: {
  ticketId: number
  data: { ticket: ApiTicket; comments: ApiComment[]; runs: ApiRun[] }
}) {
  const router = useRouter()
  const qc = useQueryClient()
  const { colors } = useTheme()
  const { ticket, comments, runs } = data

  useWorkspaceSocket(ticket.workspaceId)

  const { data: board } = useBoard(ticket.workspaceId)
  const { data: workspace } = useWorkspace(ticket.workspaceId)
  const patchTicket = usePatchTicket(ticket.workspaceId)
  const comment = useComment(ticketId)

  const [editing, setEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState(ticket.title)
  const [descriptionDraft, setDescriptionDraft] = useState(ticket.description)
  const [actionsVisible, setActionsVisible] = useState(false)

  const hasActiveRun = runs.some((r) => ACTIVE_RUN_STATUSES.has(r.status))

  const startEdit = () => {
    if (hasActiveRun) return
    setTitleDraft(ticket.title)
    setDescriptionDraft(ticket.description)
    setEditing(true)
  }

  const cancelEdit = () => setEditing(false)

  const saveEdit = () => {
    const trimmedTitle = titleDraft.trim()
    if (!trimmedTitle) return
    patchTicket.mutate(
      { id: ticket.id, patch: { title: trimmedTitle, description: descriptionDraft } },
      {
        onSuccess: () => setEditing(false),
        onError: (error) => {
          if (error instanceof ApiError && error.status === 409) {
            showToast(RUN_IN_PROGRESS_TOAST)
            void qc.invalidateQueries({ queryKey: keys.ticket(ticketId) })
            setEditing(false)
          }
        },
      },
    )
  }

  const sendComment = (body: string): Promise<void> =>
    new Promise((resolve, reject) => {
      comment.mutate(body, {
        onSuccess: () => resolve(),
        onError: (error) => reject(error),
      })
    })

  const column = board?.columns.find((c) => c.id === ticket.columnId)
  const adapter = ticket.adapterOverride ?? workspace?.defaultAdapter ?? '—'
  const model = ticket.modelOverride ?? workspace?.defaultModel ?? '—'
  const queueVisual = queueStateVisual(ticket.queueState)

  return (
    <Screen edges={['top', 'bottom']}>
      <AppHeader title={`Ticket #${ticket.id}`} back />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView testID="ticket-detail" style={styles.flex} contentContainerStyle={styles.content}>
          <Card style={styles.titleCard}>
            {editing ? (
              <View style={styles.editForm}>
                <Input
                  testID="ticket-title-input"
                  label="Title"
                  value={titleDraft}
                  onChangeText={setTitleDraft}
                />
                <Input
                  testID="ticket-description-input"
                  label="Description"
                  value={descriptionDraft}
                  onChangeText={setDescriptionDraft}
                  multiline
                  placeholder="What should the agent do, in detail?"
                />
                <View style={styles.editActions}>
                  <Button testID="ticket-edit-cancel" variant="ghost" label="Cancel" onPress={cancelEdit} small />
                  <Button
                    testID="ticket-edit-save"
                    label="Save changes"
                    onPress={saveEdit}
                    loading={patchTicket.isPending}
                    small
                  />
                </View>
              </View>
            ) : (
              <Pressable
                testID="ticket-edit-trigger"
                accessibilityRole="button"
                accessibilityLabel={hasActiveRun ? 'Editing locked while a run is active' : 'Edit ticket'}
                onPress={startEdit}
                disabled={hasActiveRun}
              >
                <View style={styles.titleRow}>
                  <Text testID="ticket-title" style={[type.title, styles.title, { color: colors.text }]}>
                    {ticket.title}
                  </Text>
                  <Icon
                    name={hasActiveRun ? 'lock' : 'edit-2'}
                    size={16}
                    color={colors.textFaintSolid}
                  />
                </View>
                {ticket.description ? (
                  <Text testID="ticket-description" style={[type.body, styles.description, { color: colors.textMuted }]}>
                    {ticket.description}
                  </Text>
                ) : (
                  <Text style={[type.caption, styles.description, { color: colors.textFaintSolid }]}>
                    {hasActiveRun ? 'Editing is locked while an agent is working.' : 'Tap to add a description.'}
                  </Text>
                )}
              </Pressable>
            )}

            <View style={styles.chipRow}>
              {column && (
                <View testID="chip-column">
                  <Tag label={column.title.toLowerCase()} />
                </View>
              )}
              <View testID="chip-agent">
                <Tag label={`${humanize(adapter).toLowerCase()} · ${humanize(model).toLowerCase()}`} />
              </View>
              {queueVisual && (
                <View testID="chip-queue-state">
                  <StatusTag status={queueVisual} />
                </View>
              )}
            </View>
          </Card>

          <View style={styles.section}>
            <Text style={[type.monoCaps, styles.sectionTitle, { color: colors.textFaintSolid }]}>THREAD</Text>
            <CommentThread comments={comments} onSend={sendComment} sending={comment.isPending} />
          </View>

          <View style={styles.section}>
            <Text style={[type.monoCaps, styles.sectionTitle, { color: colors.textFaintSolid }]}>ATTEMPTS</Text>
            {runs.length === 0 ? (
              <Text style={[type.caption, { color: colors.textFaintSolid }]}>
                No runs yet — send this ticket to Ready to dispatch an agent.
              </Text>
            ) : (
              runs.map((run) => (
                <RunRow
                  key={run.id}
                  run={run}
                  onPress={() => router.push(`/runs/${run.id}`)}
                />
              ))
            )}
          </View>
        </ScrollView>

        <View style={[styles.actionBar, { borderTopColor: colors.borderSubtle, backgroundColor: colors.ground }]}>
          <Button
            testID="ticket-actions-button"
            icon="more-horizontal"
            label="Actions"
            onPress={() => setActionsVisible(true)}
          />
        </View>
      </KeyboardAvoidingView>

      {workspace && board && (
        <TicketActions
          ticket={ticket}
          columns={board.columns}
          workspace={workspace}
          visible={actionsVisible}
          onClose={() => setActionsVisible(false)}
        />
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  skeletons: {
    padding: space.lg,
    gap: space.lg,
  },
  content: {
    padding: space.lg,
    gap: space.xxl,
  },
  titleCard: {
    gap: space.lg,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  title: {
    flex: 1,
  },
  description: {
    marginTop: space.sm,
  },
  editForm: {
    gap: space.md,
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    alignItems: 'center',
  },
  section: {
    gap: space.sm,
  },
  sectionTitle: {
    letterSpacing: 1.2,
  },
  actionBar: {
    padding: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
})
