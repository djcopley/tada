import type { ApiComment, ApiRun, ApiTicket } from '@tada/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { ApiError } from '../../src/api/client'
import { keys, useBoard, useComment, usePatchTicket, useTicket, useWorkspace } from '../../src/api/queries'
import { CommentThread } from '../../src/components/CommentThread'
import { RunRow } from '../../src/components/RunRow'
import { TicketActions } from '../../src/components/TicketActions'
import { showToast } from '../../src/toast'

const RUN_IN_PROGRESS_TOAST = 'Agent is working on this ticket — wait or cancel the run'
const ACTIVE_RUN_STATUSES: ReadonlySet<ApiRun['status']> = new Set(['queued', 'running'])

export default function TicketDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const ticketId = Number(id)
  const { data, isLoading } = useTicket(ticketId)

  if (Number.isNaN(ticketId)) {
    return (
      <View style={styles.center}>
        <Text>Invalid ticket</Text>
      </View>
    )
  }

  if (isLoading || !data) {
    return (
      <View style={styles.center}>
        <Text>Loading…</Text>
      </View>
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
  const { ticket, comments, runs } = data

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

  const sendComment = (body: string) => {
    comment.mutate(body)
  }

  const column = board?.columns.find((c) => c.id === ticket.columnId)
  const adapter = ticket.adapterOverride ?? workspace?.defaultAdapter ?? '—'
  const model = ticket.modelOverride ?? workspace?.defaultModel ?? '—'

  return (
    <ScrollView testID="ticket-detail" style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        {editing ? (
          <View style={styles.editForm}>
            <TextInput
              testID="ticket-title-input"
              style={styles.titleInput}
              value={titleDraft}
              onChangeText={setTitleDraft}
            />
            <TextInput
              testID="ticket-description-input"
              style={styles.descriptionInput}
              value={descriptionDraft}
              onChangeText={setDescriptionDraft}
              multiline
              placeholder="Description"
            />
            <View style={styles.editActions}>
              <Pressable testID="ticket-edit-cancel" style={styles.editButton} onPress={cancelEdit}>
                <Text>Cancel</Text>
              </Pressable>
              <Pressable testID="ticket-edit-save" style={styles.editButton} onPress={saveEdit}>
                <Text>Save</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable testID="ticket-edit-trigger" onPress={startEdit} disabled={hasActiveRun}>
            <Text testID="ticket-title" style={styles.title}>
              {ticket.title}
            </Text>
            {ticket.description ? (
              <Text testID="ticket-description" style={styles.description}>
                {ticket.description}
              </Text>
            ) : null}
          </Pressable>
        )}
      </View>

      <View style={styles.chipRow}>
        {column && (
          <Text testID="chip-column" style={styles.chip}>
            {column.title}
          </Text>
        )}
        <Text testID="chip-agent" style={styles.chip}>{`${adapter} · ${model}`}</Text>
        {ticket.queueState && (
          <Text testID="chip-queue-state" style={styles.badge}>
            {ticket.queueState}
          </Text>
        )}
      </View>

      <CommentThread comments={comments} onSend={sendComment} sending={comment.isPending} />

      <View style={styles.runsSection}>
        <Text style={styles.sectionTitle}>Runs</Text>
        {runs.map((run) => (
          <RunRow
            key={run.id}
            run={run}
            onPress={() => router.push(`/runs/${run.id}?ticketId=${run.ticketId}`)}
          />
        ))}
      </View>

      <Pressable testID="ticket-actions-button" style={styles.actionsButton} onPress={() => setActionsVisible(true)}>
        <Text style={styles.actionsButtonText}>Actions</Text>
      </Pressable>

      {workspace && board && (
        <TicketActions
          ticket={ticket}
          columns={board.columns}
          workspace={workspace}
          visible={actionsVisible}
          onClose={() => setActionsVisible(false)}
        />
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 16,
  },
  section: {
    gap: 6,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  description: {
    fontSize: 14,
    color: '#333',
  },
  editForm: {
    gap: 8,
  },
  titleInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#888',
    borderRadius: 6,
    padding: 10,
    fontSize: 18,
    fontWeight: '700',
  },
  descriptionInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#888',
    borderRadius: 6,
    padding: 10,
    minHeight: 80,
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  editButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  chip: {
    fontSize: 12,
    color: '#555',
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: 'hidden',
  },
  badge: {
    fontSize: 11,
    color: '#b35c00',
    backgroundColor: '#fff3e0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: 'hidden',
  },
  runsSection: {
    gap: 4,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  actionsButton: {
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#1565c0',
  },
  actionsButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
})
