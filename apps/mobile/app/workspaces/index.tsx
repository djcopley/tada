import type { ApiComment, ApiRun, ApiTicket, ApiWorkspaceListItem } from '@tada/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Linking, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { ApiError } from '../../src/api/client'
import { useClient } from '../../src/api/ClientContext'
import { useLatestRunEvents } from '../../src/api/useLatestRunEvent'
import {
  keys,
  useAccept,
  useActiveWorkspace,
  useActivity,
  useBoards,
  useCreateTicket,
  useMemory,
  useSendBack,
  useTicketDetails,
  useWorkspaces,
} from '../../src/api/queries'
import { positionBetween } from '../../src/board/positions'
import {
  LiveDigest,
  LiveNowCard,
  MemoryCard,
  NeedsYouCard,
  SlotPill,
  TodayCard,
  WorkspaceStrip,
} from '../../src/components/control/ControlCards'
import {
  AppHeader,
  Button,
  Dialog,
  EmptyState,
  IconButton,
  Input,
  RunStatusChip,
  Screen,
  Skeleton,
} from '../../src/components/ui'
import { NewTicketDialog } from '../../src/components/NewTicketDialog'
import { openNewWorkspaceDialog } from '../../src/components/NewWorkspaceDialog'
import { WorkspaceSocket } from '../../src/components/WorkspaceSocket'
import { useTheme } from '../../src/design/ThemeContext'
import {
  elapsedLabel,
  headlineFor,
  hhmm,
  isSinceLocalMidnight,
  narrowNeedsYouMeta,
  narrowOvernightSubline,
  overnightSubline,
  useNowTick,
} from '../../src/control'
import { motion, space, type } from '../../src/design/tokens'
import { useLayout } from '../../src/layout'
import { relativeTime } from '../../src/relativeTime'
import { showToast } from '../../src/toast'

const TODAY_PAGE_SIZE = 5
const TADA_LIFETIME_MS = motion.tada + 400
const RUN_IN_PROGRESS_TOAST = 'Agent is working on this ticket — wait or cancel the run'

type TriageTicket = { ticket: ApiTicket; workspace: ApiWorkspaceListItem; failed: boolean }
type LiveTicket = { ticket: ApiTicket; workspace: ApiWorkspaceListItem }
type StartNowTarget = { ticket: ApiTicket; workspace: ApiWorkspaceListItem; columnId: number; position: number }
type TicketDetail = { ticket: ApiTicket; comments: ApiComment[]; runs: ApiRun[] }

/**
 * Control — the home screen. Cross-workspace triage: what needs you first,
 * which agents are live right now, memory + today's activity, then every
 * workspace. Wide (>=1000px) gets the Rail + two-column grid from the web
 * artboard; narrow gets the single-column mobile artboard with BottomStrip.
 */
export default function Control() {
  const router = useRouter()
  const { colors } = useTheme()
  const client = useClient()
  const qc = useQueryClient()
  const { wide } = useLayout()
  const now = useNowTick()

  const { data: workspacesData, isLoading, isRefetching, refetch } = useWorkspaces()
  const workspaces = workspacesData ?? []
  const boards = useBoards(workspaces.map((w) => w.id))
  // Control is the live-monitoring home, so it keeps one socket per workspace open — mounted
  // via a renderless component per id (see WorkspaceSocket) rather than looping the hook
  // itself, since Rules of Hooks forbids a variable number of hook calls per render.
  const sockets = workspaces.map((w) => <WorkspaceSocket key={w.id} workspaceId={w.id} />)
  const { activeWorkspaceId } = useActiveWorkspace()
  const memoryWorkspaceId = activeWorkspaceId ?? workspaces[0]?.id
  const memoryWorkspace = workspaces.find((w) => w.id === memoryWorkspaceId)
  const { data: memory } = useMemory(memoryWorkspaceId)
  const { data: activityData } = useActivity()
  const activities = activityData ?? []

  const createTicket = useCreateTicket()
  const accept = useAccept()
  const sendBack = useSendBack()

  const moveTicketMutation = useMutation({
    mutationFn: (vars: { ticket: ApiTicket; columnId: number; position: number }) =>
      client.moveTicket(vars.ticket.id, { columnId: vars.columnId, position: vars.position }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: keys.board(vars.ticket.workspaceId) })
      void qc.invalidateQueries({ queryKey: keys.workspaces })
    },
    // Re-run / Move to backlog / Start now all funnel through here. A 409 means the ticket's
    // run state moved under us (e.g. an agent picked it up) — same convention as the board
    // screen's handle409: a specific toast plus a refresh of the now-stale board/ticket so the
    // card reflects reality instead of silently no-opping. Non-409 errors already hit the
    // global mutation-error toast (see app/_layout.tsx).
    onError: (error, vars) => {
      if (error instanceof ApiError && error.status === 409) {
        showToast(RUN_IN_PROGRESS_TOAST)
        void qc.invalidateQueries({ queryKey: keys.board(vars.ticket.workspaceId) })
        void qc.invalidateQueries({ queryKey: keys.ticket(vars.ticket.id) })
      }
    },
  })

  const nudgeMutation = useMutation({
    mutationFn: (vars: { runId: number; note: string }) => client.nudge(vars.runId, vars.note),
    onSuccess: (data, vars) => {
      void qc.invalidateQueries({ queryKey: keys.run(vars.runId) })
      if (!data.delivered) showToast('note saved for the next attempt')
    },
  })

  // ---------------------------------------------------------------- triage
  const needsYou: TriageTicket[] = []
  const liveNow: LiveTicket[] = []
  let startNowTarget: StartNowTarget | undefined

  boards.forEach((query, index) => {
    const workspace = workspaces[index]
    const board = query.data
    if (!board || !workspace) return

    for (const column of board.columns) {
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

    if (!startNowTarget && workspace.runningCount < workspace.concurrency) {
      const readyColumn = board.columns.find((c) => c.kind === 'ready')
      const queued = (readyColumn?.tickets ?? [])
        .filter((t) => t.queueState === 'queued')
        .sort((a, b) => a.position - b.position)
      if (readyColumn && queued.length > 0) {
        const minPosition = Math.min(...readyColumn.tickets.map((t) => t.position))
        startNowTarget = {
          ticket: queued[0]!,
          workspace,
          columnId: readyColumn.id,
          position: positionBetween(undefined, minPosition),
        }
      }
    }
  })

  const detailIds = Array.from(new Set([...needsYou.map((t) => t.ticket.id), ...liveNow.map((t) => t.ticket.id)]))
  const details = useTicketDetails(detailIds)
  const detailById = new Map<number, TicketDetail | undefined>()
  detailIds.forEach((id, i) => detailById.set(id, details[i]?.data))

  const latestRunFor = (id: number): ApiRun | undefined => {
    const runs = detailById.get(id)?.runs ?? []
    return runs[runs.length - 1]
  }
  const latestFailedRunFor = (id: number): ApiRun | undefined => {
    const runs = detailById.get(id)?.runs ?? []
    for (let i = runs.length - 1; i >= 0; i -= 1) {
      if (runs[i]!.status === 'failed') return runs[i]
    }
    return undefined
  }
  const agentTextFor = (id: number): string | undefined => {
    const detail = detailById.get(id)
    if (!detail) return undefined
    const agentComments = detail.comments.filter((c) => c.author === 'agent')
    const lastComment = agentComments[agentComments.length - 1]
    if (lastComment) return lastComment.body
    return detail.runs[detail.runs.length - 1]?.summary ?? undefined
  }

  const runningRunIdFor = (id: number): number | undefined =>
    detailById.get(id)?.runs.find((r) => r.status === 'running')?.id

  // The live cards' well text prefers the running run's latest journaled event over the ticket's
  // last agent comment/summary, which lag behind by comment/run boundaries rather than tracking
  // play-by-play (see useLatestRunEvent). `working…` is the true no-events-yet fallback: while a
  // run is live, its agent-well never falls back to a stale comment from an earlier run.
  const liveEventByRunId = useLatestRunEvents(liveNow.map(({ ticket }) => runningRunIdFor(ticket.id)))
  const liveAgentTextFor = (id: number, runningRunId: number | undefined): string | undefined =>
    runningRunId !== undefined ? liveEventByRunId.get(runningRunId) : agentTextFor(id)

  // ---------------------------------------------------------------- headline
  // Both filters pass the same ticking `now` (from useNowTick) explicitly, rather than relying
  // on isSinceLocalMidnight's internal default, so every "current time" read in this render is
  // consistent with the elapsed labels and re-evaluates as `now` ticks forward.
  const nowDate = new Date(now)
  const overnightCount = activities.filter(
    (a) => (a.type === 'needs_review' || a.type === 'run_failed') && isSinceLocalMidnight(a.createdAt, nowDate),
  ).length
  const overnightFailures = activities.filter(
    (a) => a.type === 'run_failed' && isSinceLocalMidnight(a.createdAt, nowDate),
  )
  const firstOvernightFailureAt = overnightFailures.length
    ? hhmm(
        overnightFailures.reduce((earliest, a) => (a.createdAt < earliest.createdAt ? a : earliest)).createdAt,
      )
    : null
  const pendingNotes = (memory?.notes ?? []).filter((n) => n.state === 'pending' && n.author === 'agent')
  const keptNotes = (memory?.notes ?? []).filter((n) => n.state === 'kept')
  const headline = headlineFor(needsYou.length)
  // Wide's subline leans on memory (matches the desktop artboard); narrow's mentions the first
  // overnight failure's time instead, per the mobile artboard (docs/design/tada-build.dc.html:189).
  const subline = overnightSubline(overnightCount, pendingNotes.length)
  const narrowSubline = narrowOvernightSubline(overnightCount, firstOvernightFailureAt, overnightFailures.length)

  // ---------------------------------------------------------------- celebration
  const [celebratingIds, setCelebratingIds] = useState<Set<number>>(new Set())
  const celebrate = (ticketId: number) => {
    setCelebratingIds((prev) => new Set(prev).add(ticketId))
    setTimeout(() => {
      setCelebratingIds((prev) => {
        const next = new Set(prev)
        next.delete(ticketId)
        return next
      })
    }, TADA_LIFETIME_MS)
  }

  // ---------------------------------------------------------------- dialogs
  const [sendBackTicket, setSendBackTicket] = useState<ApiTicket | null>(null)
  const [sendBackFeedback, setSendBackFeedback] = useState('')
  const [nudgeTarget, setNudgeTarget] = useState<{ ticket: ApiTicket; runId: number } | null>(null)
  const [nudgeNote, setNudgeNote] = useState('')
  const [newTicketVisible, setNewTicketVisible] = useState(false)

  const closeSendBack = () => {
    setSendBackTicket(null)
    setSendBackFeedback('')
  }
  const confirmSendBack = () => {
    if (!sendBackTicket || !sendBackFeedback.trim()) return
    sendBack.mutate(
      { ticketId: sendBackTicket.id, feedback: sendBackFeedback.trim() },
      { onSuccess: closeSendBack },
    )
  }

  const closeNudge = () => {
    setNudgeTarget(null)
    setNudgeNote('')
  }
  const confirmNudge = () => {
    if (!nudgeTarget || !nudgeNote.trim()) return
    nudgeMutation.mutate({ runId: nudgeTarget.runId, note: nudgeNote.trim() }, { onSuccess: closeNudge })
  }

  const closeNewTicket = () => setNewTicketVisible(false)
  const confirmNewTicket = (fields: { title: string; description: string }) => {
    if (memoryWorkspaceId === undefined) return
    createTicket.mutate(
      { workspaceId: memoryWorkspaceId, ...fields },
      { onSuccess: (ticket) => { closeNewTicket(); router.push(`/tickets/${ticket.id}`) } },
    )
  }

  // ---------------------------------------------------------------- needs-you actions
  const moveToBacklog = (ticket: ApiTicket) => {
    const board = boards.find((_q, i) => workspaces[i]?.id === ticket.workspaceId)?.data
    const backlog = board?.columns.find((c) => c.kind === 'backlog')
    if (!backlog) return
    const positions = backlog.tickets.map((t) => t.position)
    const position = positionBetween(positions.length ? Math.max(...positions) : undefined, undefined)
    moveTicketMutation.mutate({ ticket, columnId: backlog.id, position })
  }

  const rerun = (ticket: ApiTicket) => {
    moveTicketMutation.mutate({ ticket, columnId: ticket.columnId, position: ticket.position })
  }

  const [historyLimit, setHistoryLimit] = useState(TODAY_PAGE_SIZE)

  // ---------------------------------------------------------------- render helpers
  const needsYouSection = (narrow: boolean) => (
    <>
      {needsYou.map(({ ticket, workspace, failed }) => {
        const latestRun = failed ? latestFailedRunFor(ticket.id) : latestRunFor(ticket.id)
        return (
          <NeedsYouCard
            key={ticket.id}
            testID={`needs-you-${ticket.id}`}
            ticket={ticket}
            meta={`${workspace.name} · ${relativeTime(ticket.createdAt)}`}
            narrowMeta={narrowNeedsYouMeta(workspace.name, ticket.createdAt, now, failed, latestRun)}
            failed={failed}
            latestRun={latestRun}
            agentText={agentTextFor(ticket.id)}
            wide={!narrow}
            accepting={accept.isPending && accept.variables === ticket.id}
            celebrate={celebratingIds.has(ticket.id)}
            actions={{
              onAccept: () => accept.mutate(ticket.id, { onSuccess: () => celebrate(ticket.id) }),
              onSendBack: () => setSendBackTicket(ticket),
              onOpenDiff: () => {
                if (latestRun?.prUrl) void Linking.openURL(latestRun.prUrl)
              },
              onRerun: () => rerun(ticket),
              onEditAndRerun: () => router.push(`/tickets/${ticket.id}`),
              onMoveToBacklog: () => moveToBacklog(ticket),
            }}
          />
        )
      })}
    </>
  )

  // ================================================================== loading / empty
  if (isLoading) {
    return (
      <Screen>
        <AppHeader title="" wordmark />
        <View style={styles.skeletons}>
          <Skeleton height={84} />
          <Skeleton height={84} />
          <Skeleton height={84} />
        </View>
      </Screen>
    )
  }

  if (workspaces.length === 0) {
    return (
      <Screen>
        <AppHeader title="" wordmark />
        <EmptyState
          icon="inbox"
          message="No workspaces yet — create one to start dispatching work."
          action={{ label: 'New workspace', onPress: () => openNewWorkspaceDialog() }}
        />
      </Screen>
    )
  }

  const dialogs = (
    <>
      <Dialog
        visible={sendBackTicket !== null}
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

      <Dialog
        visible={nudgeTarget !== null}
        title="Nudge with a note"
        onClose={closeNudge}
        testID="nudge-dialog"
        confirm={{
          label: 'Send nudge',
          onPress: confirmNudge,
          disabled: nudgeMutation.isPending || nudgeNote.trim().length === 0,
          loading: nudgeMutation.isPending,
          testID: 'nudge-confirm',
        }}
      >
        <Text style={[type.caption, { color: colors.textMuted }]}>
          A short note the agent reads at its next checkpoint.
        </Text>
        <Input
          testID="nudge-note-input"
          label="Note"
          placeholder="e.g. also update the docs"
          multiline
          autoFocus
          value={nudgeNote}
          onChangeText={setNudgeNote}
        />
      </Dialog>

      <NewTicketDialog
        visible={newTicketVisible}
        onClose={closeNewTicket}
        onCreate={confirmNewTicket}
        pending={createTicket.isPending}
        hint={memoryWorkspace ? `Goes to ${memoryWorkspace.name}.` : 'Pick a workspace from the switcher first.'}
      />
    </>
  )

  // ================================================================== wide
  if (wide) {
    return (
      <View style={[styles.wideRoot, { backgroundColor: colors.ground }]} testID="control-wide">
        {sockets}
        <ScrollView
          contentContainerStyle={styles.wideContent}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
        >
          <View style={styles.wideHeaderRow}>
            <View style={styles.flexShrink}>
              <Text style={[type.display, { color: colors.text }]}>{headline}</Text>
              <Text style={[type.monoSmall, styles.subline, { color: colors.textFaintSolid }]}>{subline}</Text>
            </View>
            <View style={styles.spacer} />
            <RunStatusChip
              status="live"
              label={`${liveNow.length} agent${liveNow.length === 1 ? '' : 's'} live`}
              testID="control-live-chip"
            />
            <Button testID="new-ticket-button" variant="primary" label="New ticket" onPress={() => setNewTicketVisible(true)} />
          </View>

          <View style={styles.twoColumn}>
            <View style={styles.leftColumn}>
              {needsYou.length > 0 && sectionLabel(colors.textFaintSolid, `Needs you · ${needsYou.length}`)}
              {needsYouSection(false)}

              {liveNow.length > 0 && sectionLabel(colors.liveText, `Live now · ${liveNow.length}`)}
              {liveNow.map(({ ticket, workspace }) => {
                const latestRun = latestRunFor(ticket.id)
                const runningRun = detailById.get(ticket.id)?.runs.find((r) => r.status === 'running') ?? latestRun
                return (
                  <LiveNowCard
                    key={ticket.id}
                    testID={`live-now-${ticket.id}`}
                    ticket={ticket}
                    workspace={workspace}
                    startedAt={runningRun?.startedAt}
                    now={now}
                    agentText={liveAgentTextFor(ticket.id, runningRunIdFor(ticket.id))}
                    onFullLog={() => runningRun && router.push(`/runs/${runningRun.id}`)}
                    onNudge={() => runningRun && setNudgeTarget({ ticket, runId: runningRun.id })}
                  />
                )
              })}

              {startNowTarget ? (
                <SlotPill
                  testID="slot-pill"
                  slots={startNowTarget.workspace.concurrency - startNowTarget.workspace.runningCount}
                  nextTitle={startNowTarget.ticket.title}
                  onStartNow={() =>
                    moveTicketMutation.mutate({
                      ticket: startNowTarget!.ticket,
                      columnId: startNowTarget!.columnId,
                      position: startNowTarget!.position,
                    })
                  }
                />
              ) : null}
            </View>

            <View style={styles.rightColumn}>
              {memoryWorkspace ? (
                <MemoryCard
                  testID="memory-card"
                  workspaceName={memoryWorkspace.name}
                  keptNotes={keptNotes}
                  pendingNote={pendingNotes[pendingNotes.length - 1]}
                  onEditMemory={() => router.navigate(`/workspaces/${memoryWorkspace.id}/memory`)}
                />
              ) : null}

              <TodayCard
                testID="today-card"
                activities={activities.slice(0, historyLimit)}
                showFullHistory={activities.length > historyLimit}
                onFullHistory={() => setHistoryLimit((n) => n + 10)}
              />

              {workspaces.map((w) => (
                <WorkspaceStrip
                  key={w.id}
                  testID={`workspace-strip-${w.id}`}
                  workspace={w}
                  onBoard={() => router.navigate(`/workspaces/${w.id}/board`)}
                />
              ))}

              <Button
                testID="rail-new-workspace"
                variant="ghost"
                small
                label="New workspace"
                onPress={() => openNewWorkspaceDialog()}
                style={styles.selfStart}
              />
            </View>
          </View>
        </ScrollView>

        {dialogs}
      </View>
    )
  }

  // ================================================================== narrow
  const liveDigestLines = liveNow.map(({ ticket }) => {
    const latestRun = latestRunFor(ticket.id)
    const running = detailById.get(ticket.id)?.runs.find((r) => r.status === 'running') ?? latestRun
    const digestText = liveAgentTextFor(ticket.id, runningRunIdFor(ticket.id)) ?? 'working…'
    return {
      key: String(ticket.id),
      text: `${ticket.title.toLowerCase()} · ${elapsedLabel(running?.startedAt, now)} · ${digestText}`,
    }
  })

  return (
    <Screen testID="control-narrow">
      {sockets}
      <View style={styles.narrowHeader}>
        <Text style={[type.title, { color: colors.text }]}>
          {'tada'}
          <Text style={{ color: colors.live }}>✱</Text>
        </Text>
        <View style={styles.spacer} />
        <RunStatusChip status="live" label={`${liveNow.length} live`} testID="control-live-chip" />
        {memoryWorkspaceId !== undefined ? (
          <IconButton
            testID="control-settings-button"
            icon="settings"
            label="Settings"
            size="sm"
            onPress={() => router.navigate(`/workspaces/${memoryWorkspaceId}/settings`)}
          />
        ) : null}
      </View>

      <ScrollView
        testID="control-narrow-scroll"
        contentContainerStyle={styles.narrowContent}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
      >
        <View>
          <Text style={[type.display, { color: colors.text }]}>{headline}</Text>
          <Text style={[type.monoSmall, styles.subline, { color: colors.textFaintSolid }]}>{narrowSubline}</Text>
        </View>

        {needsYouSection(true)}

        {liveNow.length > 0 ? <LiveDigest testID="live-digest" lines={liveDigestLines} /> : null}

        {/* Narrow used to stop here, which made Control a dead end: no way to reach a workspace
            other than the strip's scoped one, and no New ticket / New workspace at all. */}
        {sectionLabel(colors.textFaintSolid, 'Workspaces')}
        {workspaces.map((w) => (
          <WorkspaceStrip
            key={w.id}
            testID={`workspace-strip-${w.id}`}
            workspace={w}
            onBoard={() => router.navigate(`/workspaces/${w.id}/board`)}
          />
        ))}
        <View style={styles.narrowActions}>
          <Button
            testID="new-ticket-button"
            variant="primary"
            small
            label="New ticket"
            onPress={() => setNewTicketVisible(true)}
          />
          <Button
            testID="rail-new-workspace"
            variant="ghost"
            small
            label="New workspace"
            onPress={() => openNewWorkspaceDialog()}
          />
        </View>
      </ScrollView>

      {dialogs}
    </Screen>
  )
}

function sectionLabel(color: string, label: string) {
  return <Text style={[type.monoCaps, styles.sectionLabel, { color }]}>{label}</Text>
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
    padding: space.xxl,
    gap: space.lg,
  },
  wideHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
  },
  flexShrink: {
    flexShrink: 1,
  },
  spacer: {
    flex: 1,
  },
  subline: {
    marginTop: space.xs,
  },
  twoColumn: {
    flexDirection: 'row',
    gap: space.xl,
    alignItems: 'flex-start',
  },
  leftColumn: {
    flex: 1.45,
    gap: space.md,
  },
  rightColumn: {
    flex: 1,
    gap: space.md,
  },
  sectionLabel: {
    textTransform: 'uppercase',
    marginTop: space.sm,
  },
  selfStart: {
    alignSelf: 'flex-start',
  },
  narrowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
  },
  narrowContent: {
    padding: space.lg,
    paddingTop: space.md,
    gap: space.md,
  },
  narrowActions: {
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.xs,
  },
})
