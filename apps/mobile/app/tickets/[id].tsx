import type { ApiComment, ApiRun, ApiTicket } from '@tada/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native'
import { ApiError } from '../../src/api/client'
import { keys, useAccept, useBoard, useComment, useMemory, usePatchTicket, useSendBack, useTicket, useWorkspace } from '../../src/api/queries'
import { useWorkspaceSocket } from '../../src/api/useWorkspaceSocket'
import { CommentThread } from '../../src/components/CommentThread'
import {
  AttemptsCard,
  CardHeader,
  LinkedCard,
  MemoryReadCard,
  ReviewCard,
  SendItBackCard,
} from '../../src/components/ticket/TicketDetailCards'
import { AppHeader, Badge, Button, Card, Dialog, EmptyState, Input, Screen, Skeleton, Tag } from '../../src/components/ui'
import { useTheme } from '../../src/design/ThemeContext'
import { motion, radius, space, type } from '../../src/design/tokens'
import { useLayout } from '../../src/layout'
import { goToControl } from '../../src/nav'
import { relativeTime } from '../../src/relativeTime'
import { showToast } from '../../src/toast'
import {
  attemptRows,
  memorySummary,
  sendItBackCopy,
  ticketMetaLine,
  ticketStatusBadge,
} from '../../src/ticketDetail'
import type { LinkedFollowUp } from '../../src/ticketDetail'

const RUN_IN_PROGRESS_TOAST = 'Agent is working on this ticket — wait or cancel the run'
const ACTIVE_RUN_STATUSES: ReadonlySet<ApiRun['status']> = new Set(['queued', 'running'])
/** How long the accept-run TadaStar plays before the celebration flag clears — matches Control's
 * NeedsYouCard star (motion.tada + a small settle margin). */
const TADA_LIFETIME_MS = motion.tada + 400

type TicketDetailData = {
  ticket: ApiTicket
  comments: ApiComment[]
  runs: ApiRun[]
  followUps: LinkedFollowUp[]
}

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

function TicketDetailBody({ ticketId, data }: { ticketId: number; data: TicketDetailData }) {
  const router = useRouter()
  const qc = useQueryClient()
  const { colors } = useTheme()
  const { wide } = useLayout()
  const { ticket, comments, runs, followUps } = data

  useWorkspaceSocket(ticket.workspaceId)

  const { data: board } = useBoard(ticket.workspaceId)
  const { data: workspace } = useWorkspace(ticket.workspaceId)
  const { data: memory } = useMemory(ticket.workspaceId)
  const patchTicket = usePatchTicket(ticket.workspaceId)
  const comment = useComment(ticketId)
  const accept = useAccept()
  const sendBack = useSendBack()

  const [editing, setEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState(ticket.title)
  const [descriptionDraft, setDescriptionDraft] = useState(ticket.description)
  const [celebrating, setCelebrating] = useState(false)
  const [sendBackVisible, setSendBackVisible] = useState(false)
  const [sendBackFeedback, setSendBackFeedback] = useState('')

  const hasActiveRun = runs.some((r) => ACTIVE_RUN_STATUSES.has(r.status))
  const latestRun = runs[runs.length - 1]
  const column = board?.columns.find((c) => c.id === ticket.columnId)
  const inReview = column?.kind === 'in_review' && latestRun !== undefined

  const startEdit = () => {
    if (hasActiveRun) return
    setTitleDraft(ticket.title)
    setDescriptionDraft(ticket.description)
    setEditing(true)
  }

  const cancelEdit = () => setEditing(false)

  const handle409 = (error: unknown, after?: () => void) => {
    if (error instanceof ApiError && error.status === 409) {
      showToast(RUN_IN_PROGRESS_TOAST)
      void qc.invalidateQueries({ queryKey: keys.ticket(ticketId) })
      after?.()
    }
  }

  const saveEdit = () => {
    const trimmedTitle = titleDraft.trim()
    if (!trimmedTitle) return
    patchTicket.mutate(
      { id: ticket.id, patch: { title: trimmedTitle, description: descriptionDraft } },
      {
        onSuccess: () => setEditing(false),
        onError: (error) => handle409(error, () => setEditing(false)),
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

  const celebrate = () => {
    setCelebrating(true)
    setTimeout(() => setCelebrating(false), TADA_LIFETIME_MS)
  }

  const doAccept = () => {
    accept.mutate(ticket.id, {
      onSuccess: () => celebrate(),
      onError: (error) => handle409(error),
    })
  }

  const closeSendBack = () => {
    setSendBackVisible(false)
    setSendBackFeedback('')
  }

  const confirmSendBack = () => {
    const feedback = sendBackFeedback.trim()
    if (!feedback) return
    sendBack.mutate(
      { ticketId: ticket.id, feedback },
      {
        onSuccess: closeSendBack,
        onError: (error) => handle409(error, closeSendBack),
      },
    )
  }

  const badge = ticketStatusBadge(column?.kind, ticket.queueState)
  const metaLine = ticketMetaLine(workspace?.name ?? '—', workspace?.sources[0]?.name, ticket.createdAt, ticket.origin)
  const rows = attemptRows(runs, comments)
  const memoryInfo = memorySummary(memory?.notes ?? [])

  const header = (
    <View style={styles.headerRow}>
      <Button
        testID="ticket-back"
        variant="ghost"
        small
        icon="chevron-left"
        label="Control"
        onPress={() => goToControl(router)}
      />
      <View style={styles.spacer} />
      {badge ? <Badge testID="ticket-status-badge" status={badge.status} label={badge.label} /> : null}
      {latestRun ? <Tag testID="ticket-attempt-tag" label={`attempt ${latestRun.attemptNumber}`} /> : null}
    </View>
  )

  const titleBlock = (
    <View style={styles.titleBlock}>
      <Text testID="ticket-title" style={[type.title, { color: colors.text }]}>
        {ticket.title}
      </Text>
      <Text testID="ticket-meta" style={[type.mono, styles.metaText, { color: colors.textFaintSolid }]}>
        {metaLine}
      </Text>
    </View>
  )

  const reviewCard =
    inReview && latestRun ? (
      <ReviewCard
        testID="review-card"
        run={latestRun}
        agoLabel={relativeTime(latestRun.finishedAt ?? latestRun.createdAt)}
        accepting={accept.isPending}
        celebrate={celebrating}
        onAccept={doAccept}
        onSendBack={() => setSendBackVisible(true)}
        onOpenPr={() => {
          if (latestRun.prUrl) void Linking.openURL(latestRun.prUrl)
        }}
      />
    ) : null

  const briefCard = (
    <Card testID="brief-card" style={styles.card}>
      <CardHeader title="Brief" meta="what the agent reads" />
      {editing ? (
        <View style={styles.editForm}>
          <Input testID="brief-title-input" label="Title" value={titleDraft} onChangeText={setTitleDraft} />
          <Input
            testID="brief-description-input"
            label="Description"
            value={descriptionDraft}
            onChangeText={setDescriptionDraft}
            multiline
            placeholder="What should the agent do, in detail?"
          />
          <View style={styles.editActions}>
            <Button testID="brief-edit-cancel" variant="ghost" small label="Cancel" onPress={cancelEdit} />
            <Button
              testID="brief-edit-save"
              small
              label="Save changes"
              loading={patchTicket.isPending}
              onPress={saveEdit}
            />
          </View>
        </View>
      ) : (
        <>
          <Text style={[type.body, { color: colors.textMuted }]}>{ticket.description || 'No description yet.'}</Text>
          <Button
            testID="brief-edit-trigger"
            variant="ghost"
            small
            label={hasActiveRun ? 'Locked while running' : 'Edit brief'}
            disabled={hasActiveRun}
            onPress={startEdit}
            style={styles.selfStart}
          />
        </>
      )}
    </Card>
  )

  const threadSection = (
    <View style={styles.section}>
      <Text style={[type.monoCaps, styles.sectionTitle, { color: colors.textFaintSolid }]}>THREAD</Text>
      <CommentThread comments={comments} onSend={sendComment} sending={comment.isPending} />
    </View>
  )

  const rightRail = (
    <View style={styles.rightRail}>
      <AttemptsCard testID="attempts-card" rows={rows} />
      <LinkedCard testID="linked-card" followUps={followUps} />
      <MemoryReadCard testID="memory-card" keptTitles={memoryInfo.keptTitles} highlighted={memoryInfo.highlighted} />
      <SendItBackCard testID="send-it-back-card" copy={sendItBackCopy((latestRun?.attemptNumber ?? 0) + 1)} />
    </View>
  )

  return (
    <Screen edges={['top', 'bottom']} testID="ticket-detail-screen">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView testID="ticket-detail" style={styles.flex} contentContainerStyle={styles.content}>
          {header}
          {titleBlock}
          {wide ? (
            <View style={styles.wideGrid}>
              <View style={styles.leftColumn}>
                {reviewCard}
                {briefCard}
                {threadSection}
              </View>
              <View style={styles.rightColumn}>{rightRail}</View>
            </View>
          ) : (
            <View style={styles.narrowStack}>
              {reviewCard}
              {briefCard}
              {threadSection}
              {rightRail}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <Dialog
        visible={sendBackVisible}
        title="Send back"
        onClose={closeSendBack}
        testID="send-back-dialog"
        confirm={{
          label: 'Send back',
          onPress: confirmSendBack,
          disabled: sendBack.isPending || sendBackFeedback.trim().length === 0,
          loading: sendBack.isPending,
          testID: 'send-back-confirm',
        }}
      >
        <Text style={[type.caption, { color: colors.textMuted }]}>
          What should the agent change before its next attempt?
        </Text>
        <Input
          testID="send-back-feedback-input"
          label="Feedback"
          placeholder="What needs to change?"
          multiline
          autoFocus
          value={sendBackFeedback}
          onChangeText={setSendBackFeedback}
        />
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
    gap: space.lg,
  },
  content: {
    padding: space.lg,
    gap: space.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  spacer: {
    flex: 1,
  },
  titleBlock: {
    gap: 5,
  },
  metaText: {
    marginTop: 1,
  },
  wideGrid: {
    flexDirection: 'row',
    gap: space.xl,
    alignItems: 'flex-start',
  },
  leftColumn: {
    flex: 1.5,
    gap: space.md,
  },
  rightColumn: {
    flex: 1,
    gap: space.md,
  },
  narrowStack: {
    gap: space.md,
  },
  rightRail: {
    gap: space.md,
  },
  card: {
    gap: space.sm + 2,
  },
  editForm: {
    gap: space.md,
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space.sm,
  },
  selfStart: {
    alignSelf: 'flex-start',
  },
  section: {
    gap: space.sm,
  },
  sectionTitle: {
    letterSpacing: 1.2,
  },
})
