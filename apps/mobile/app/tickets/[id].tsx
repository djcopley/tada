import type { ApiTicketDetail } from '@tada/shared'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { type ReactNode, useState } from 'react'
import { KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native'
import { ApiError } from '../../src/api/client'
import { useCancelRun, useMoveTicket, useNote, usePatchTicket, useTicket } from '../../src/api/queries'
import { AgentWell, AttemptsCard, CardHeader, IfYouDenyCard, LinkedCard, StoppedCard, ThisRunCard } from '../../src/components/ticket/TicketCards'
import { Thread } from '../../src/components/ticket/Thread'
import { AppHeader, Badge, Button, Card, Dialog, EmptyState, Input, RunStatusChip, Screen, Skeleton, Tag } from '../../src/components/ui'
import { elapsedLabel, hhmm, useNowTick } from '../../src/control'
import { isStoppedOnYou, runVisual } from '../../src/design/status'
import { useTheme } from '../../src/design/ThemeContext'
import { radius, space, type } from '../../src/design/tokens'
import { useLayout } from '../../src/layout'
import { splitLinks } from '../../src/linkify'
import { goToControl } from '../../src/nav'
import { canUndoDone, ticketMetaLine } from '../../src/ticketDetail'
import { showToast } from '../../src/toast'

export default function TicketDetail() {
  const { id, edit } = useLocalSearchParams<{ id: string; edit?: string }>()
  const ticketId = Number(id)
  const { data, isLoading, error } = useTicket(ticketId)

  // Only a real 404 says the ticket is gone. Any other first-load error (server restarting, no
  // network) used to render the same "doesn't exist" — telling you a real ticket had vanished.
  const missing = Number.isNaN(ticketId) || (error instanceof ApiError && error.status === 404)
  if (missing || (error && !data)) {
    return (
      <Screen>
        <AppHeader title="Ticket" back />
        <EmptyState
          icon="alert-circle"
          message={missing ? "This ticket doesn't exist." : "Couldn't reach the server — go back and try again."}
        />
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

  return <TicketDetailBody ticketId={ticketId} ticket={data} startEditing={edit === '1'} />
}

function TicketDetailBody({ ticketId, ticket, startEditing = false }: { ticketId: number; ticket: ApiTicketDetail; startEditing?: boolean }) {
  const router = useRouter()
  const { colors } = useTheme()
  const { wide } = useLayout()
  const now = useNowTick()

  const patchTicket = usePatchTicket()
  const moveTicket = useMoveTicket()
  // The server 409s a move while a run is live ("stop the run first"); the global handler skips
  // 409s, so without this the button un-spun and the optimistic move rolled back in silence.
  const move = (column: 'backlog' | 'queued') =>
    moveTicket.mutate(
      { id: ticketId, to: { column } },
      {
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409) showToast('A run is on this ticket — stop it first')
        },
      },
    )
  const cancelRun = useCancelRun()
  const note = useNote(ticketId)

  const [editing, setEditing] = useState(startEditing)
  const [titleDraft, setTitleDraft] = useState(ticket.title)
  const [descriptionDraft, setDescriptionDraft] = useState(ticket.description)
  const [confirmStop, setConfirmStop] = useState(false)

  const run = ticket.run
  const visual = runVisual(run)
  // Stopped-on-you is a *lane*, not just a run status: a failed run whose card you've dragged back
  // to backlog is no longer asking anything of you, so the red card and its actions go with it.
  const stopped = ticket.column === 'stopped' && isStoppedOnYou(run)

  const startEdit = () => {
    setTitleDraft(ticket.title)
    setDescriptionDraft(ticket.description)
    setEditing(true)
  }
  const saveEdit = () => {
    const title = titleDraft.trim()
    if (!title) return
    patchTicket.mutate({ id: ticketId, patch: { title, description: descriptionDraft } }, { onSuccess: () => setEditing(false) })
  }

  const sendNote = (body: string): Promise<void> =>
    new Promise((resolve, reject) => {
      note.mutate(body, {
        onSuccess: ({ delivered }) => {
          showToast(delivered ? 'Note delivered' : 'Note saved for the next run')
          resolve()
        },
        onError: reject,
      })
    })

  const header = (
    <View style={styles.headerRow}>
      <Button testID="ticket-back" variant="ghost" small icon="chevron-left" label="Control" onPress={() => goToControl(router)} />
      <View style={styles.spacer} />
      {visual ? (
        <Badge
          testID="ticket-status-badge"
          status={visual.signal === 'live' ? 'live' : visual.signal === 'ok' ? 'accepted' : visual.signal === 'fail' ? 'failed' : 'neutral'}
          label={run?.status === 'held' ? 'held' : visual.label}
        />
      ) : (
        <Badge testID="ticket-status-badge" status="neutral" label={ticket.column} />
      )}
      {ticket.repoTags.map((tag) => (
        <Tag key={tag} testID={`ticket-repo-tag-${tag}`} label={tag} />
      ))}
      {run ? <Tag testID="ticket-run-tag" label={`run #${run.id}`} /> : null}
    </View>
  )

  const titleBlock = (
    <View style={styles.titleBlock}>
      <Text testID="ticket-title" style={[type.title, { color: colors.text }]}>
        {ticket.title}
      </Text>
      <Text testID="ticket-meta" style={[type.monoSmall, { color: colors.textFaintSolid }]}>
        {ticketMetaLine(ticket)}
      </Text>
    </View>
  )

  const description = ticket.description ? (
    <Text style={[type.body, { color: colors.textMuted }]}>
      {splitLinks(ticket.description).map((seg, i) =>
        seg.kind === 'text' ? (
          <Text key={`t-${i}`}>{seg.text}</Text>
        ) : (
          <Text key={`l-${i}`} style={{ color: colors.liveText, textDecorationLine: 'underline' }} onPress={() => void Linking.openURL(seg.url)}>
            {seg.label}
          </Text>
        ),
      )}
    </Text>
  ) : (
    <Text style={[type.body, { color: colors.textFaintSolid }]}>No brief yet.</Text>
  )

  const briefCard = (
    <Card testID="brief-card" style={styles.card}>
      <CardHeader title="Brief" meta="what the agent reads" />
      {editing ? (
        <View style={styles.editForm}>
          <Input testID="brief-title-input" label="Title" value={titleDraft} onChangeText={setTitleDraft} />
          <Input testID="brief-description-input" label="Brief — what the agent reads" value={descriptionDraft} onChangeText={setDescriptionDraft} multiline />
          <View style={styles.editActions}>
            <Button testID="brief-edit-cancel" variant="ghost" small label="Cancel" onPress={() => setEditing(false)} />
            <Button testID="brief-edit-save" small label="Save changes" disabled={titleDraft.trim().length === 0} loading={patchTicket.isPending} onPress={saveEdit} />
          </View>
        </View>
      ) : (
        <>
          {description}
          <View style={styles.row}>
            <Button testID="brief-edit-trigger" variant="ghost" small label="Edit brief" onPress={startEdit} />
          </View>
        </>
      )}
    </Card>
  )

  // The idle/live state strip under the brief — everything that isn't a hold. Keyed on the
  // ticket's *lane*, with the run only adding colour: a card the human moved (undo from done, a
  // failed run dragged back to backlog) keeps its old run status, and rendering from that alone
  // showed a "done" chip or a red card on a ticket that was sitting in backlog with no way to
  // queue it.
  const queueRow = (hint: string) => (
    <View style={styles.row}>
      <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>{hint}</Text>
      <View style={styles.spacer} />
      <Button testID="ticket-queue" small label="Queue" loading={moveTicket.isPending} onPress={() => move('queued')} />
    </View>
  )
  let stateStrip: ReactNode = null
  if (!run) {
    stateStrip = (
      <View style={styles.stateBlock}>
        <AgentWell testID="no-runs-well">
          <Text style={[type.mono, { color: colors.agentTextMuted }]}>no runs yet · it works out of your folder, in a git worktree per repo it touches</Text>
        </AgentWell>
        <View style={styles.row}>
          <Button testID="ticket-queue" small label="Queue" loading={moveTicket.isPending} onPress={() => move('queued')} />
          <View style={styles.spacer} />
          <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>starts the moment a slot is free</Text>
        </View>
      </View>
    )
  } else if (ticket.column === 'queued') {
    stateStrip = (
      <View style={styles.row}>
        <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>queued · starts when a slot frees</Text>
        <View style={styles.spacer} />
        <Button testID="ticket-to-backlog" variant="ghost" small label="Move to backlog" onPress={() => move('backlog')} />
      </View>
    )
  } else if (ticket.column === 'running' && run.status === 'running') {
    stateStrip = (
      <View style={styles.row}>
        <RunStatusChip testID="ticket-live-chip" status="live" label="live" meta={elapsedLabel(run.startedAt, now)} />
        <View style={styles.spacer} />
        <Button testID="ticket-watch-live" variant="secondary" small label="Watch live" onPress={() => router.push(`/runs/${run.id}`)} />
        <Button testID="ticket-stop-run" variant="destructive" small label="Stop run" onPress={() => setConfirmStop(true)} />
      </View>
    )
  } else if (ticket.column === 'done') {
    stateStrip = (
      <View style={styles.row}>
        <RunStatusChip
          status="ok"
          label="done"
          meta={run.status === 'done' && run.finishedAt ? `moved itself ${hhmm(run.finishedAt)}` : 'moved by you'}
        />
        <View style={styles.spacer} />
        {canUndoDone(ticket, now) ? (
          <Button testID="ticket-undo-done" variant="ghost" small label="Undo" onPress={() => move('backlog')} />
        ) : null}
      </View>
    )
  } else if (ticket.column === 'backlog') {
    stateStrip = queueRow(
      run.status === 'cancelled'
        ? 'stopped by you · in backlog'
        : run.status === 'failed'
          ? 'last run failed · in backlog'
          : run.status === 'done'
            ? 'moved back from done · in backlog'
            : 'in backlog',
    )
  }

  const left = (
    <View style={styles.column}>
      {run && stopped ? <StoppedCard run={run} ticketId={ticketId} now={now} /> : null}
      {briefCard}
      {stateStrip}
      <Thread comments={ticket.comments} run={run} now={now} onSend={sendNote} sending={note.isPending} />
    </View>
  )

  const right = run ? (
    <View style={styles.column}>
      <ThisRunCard run={run} now={now} />
      {ticket.runs.length > 1 ? <AttemptsCard runs={ticket.runs} onOpen={(runId) => router.push(`/runs/${runId}`)} /> : null}
      <LinkedCard followUpOf={ticket.followUpOf} followUps={ticket.followUps} onOpen={(tid) => router.push(`/tickets/${tid}`)} />
      {run.status === 'held' && run.hold?.reason === 'permission' ? <IfYouDenyCard /> : null}
    </View>
  ) : (
    <View style={styles.column}>
      <LinkedCard followUpOf={ticket.followUpOf} followUps={ticket.followUps} onOpen={(tid) => router.push(`/tickets/${tid}`)} />
    </View>
  )

  return (
    <Screen>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* The note composer's Send button lives inside this ScrollView: without `handled`, the
            first tap with the keyboard up only dismisses the keyboard and never reaches Send. */}
        <ScrollView contentContainerStyle={[styles.content, wide && styles.contentWide]} keyboardShouldPersistTaps="handled">
          {header}
          {titleBlock}
          {wide ? (
            <View style={styles.columns}>
              <View style={styles.leftWide}>{left}</View>
              <View style={styles.rightWide}>{right}</View>
            </View>
          ) : (
            <>
              {left}
              {right}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      <Dialog
        visible={confirmStop}
        title="Stop this run?"
        onClose={() => setConfirmStop(false)}
        confirm={{
          label: 'Stop run',
          destructive: true,
          loading: cancelRun.isPending,
          testID: 'stop-run-confirm',
          onPress: () => run && cancelRun.mutate(run.id, { onSuccess: () => setConfirmStop(false) }),
        }}
      >
        <Text style={[type.caption, { color: colors.textMuted }]}>The agent stops where it is and the card goes back to backlog. Its transcript stays on the ticket.</Text>
      </Dialog>
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  skeletons: { padding: space.lg, gap: space.md },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xl },
  contentWide: { maxWidth: 1040, alignSelf: 'center', width: '100%' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  spacer: { flex: 1 },
  titleBlock: { gap: space.xs },
  columns: { flexDirection: 'row', gap: space.lg, alignItems: 'flex-start' },
  leftWide: { flex: 1.5 },
  rightWide: { flex: 1 },
  column: { gap: space.md },
  card: { gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  stateBlock: { gap: space.md },
  editForm: { gap: space.md },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm },
})
