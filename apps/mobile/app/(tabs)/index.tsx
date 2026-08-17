import type { ApiTicket, ApiTicketDetail } from '@tada/shared'
import { useQueries } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useClient } from '../../src/api/ClientContext'
import { keys, useActivity, useBoard, useCreateTicket, useMemory, useNote, useSettings } from '../../src/api/queries'
import { useAppSocket } from '../../src/api/useAppSocket'
import { useLatestRunEvents } from '../../src/api/useLatestRunEvent'
import {
  LiveDigest,
  LiveNowCard,
  MemoryCard,
  SlotPill,
  StoppedCard,
  TodayCard,
  TodayRows,
} from '../../src/components/control/ControlCards'
import { NewTicketDialog } from '../../src/components/control/NewTicketDialog'
import { Button, Dialog, EmptyState, Input, RunStatusChip, Screen, Skeleton, TadaStar } from '../../src/components/ui'
import { elapsedLabel, headlineFor, isSinceLocalMidnight, overnightCounts, overnightSubline, useNowTick } from '../../src/control'
import { useTheme } from '../../src/design/ThemeContext'
import { motion, space, type } from '../../src/design/tokens'
import { useLayout } from '../../src/layout'
import { plainTextLinks } from '../../src/linkify'
import { showToast } from '../../src/toast'

const TODAY_PAGE_SIZE = 6
const TADA_LIFETIME_MS = motion.tada + 400
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** "aug 17" — the Today card's meta. */
export function todayMeta(now: number): string {
  const d = new Date(now)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

/** The agent's last word on a ticket: its latest comment on the thread. */
function lastAgentText(detail: ApiTicketDetail | undefined): string | undefined {
  if (!detail) return undefined
  const agent = detail.comments.filter((c) => c.author === 'agent')
  const last = agent[agent.length - 1]
  return last ? plainTextLinks(last.body) : undefined
}

/**
 * Control — the home screen. Triage: everything stopped on you, then everything live. Out-of-time
 * runs hold here like permissions do; nothing auto-retries. Wide (>=1000px) gets the two-column
 * grid from the web artboard; narrow gets the single-column mobile artboard.
 */
export default function Control() {
  const router = useRouter()
  const { colors } = useTheme()
  const client = useClient()
  const { wide } = useLayout()
  const now = useNowTick()

  useAppSocket()
  const { data: board, isLoading, isError, isRefetching, refetch } = useBoard()
  const { data: settings } = useSettings()
  const { data: memory } = useMemory()
  const { data: activityData } = useActivity()
  const activities = activityData ?? []
  const createTicket = useCreateTicket()

  const stopped: ApiTicket[] = (board?.stopped ?? []).filter((t) => t.run)
  const liveNow: ApiTicket[] = (board?.running ?? []).filter((t) => t.run)
  const queued = [...(board?.queued ?? [])].filter((t) => t.proposalState !== 'pending').sort((a, b) => a.position - b.position)

  // Detail (the thread) for every triage ticket, off one useQueries call — Rules of Hooks forbids
  // a hook per array item.
  const detailIds = [...stopped, ...liveNow].map((t) => t.id)
  const details = useQueries({
    queries: detailIds.map((id) => ({ queryKey: keys.ticket(id), queryFn: () => client.ticket(id) })),
  })
  const detailById = new Map<number, ApiTicketDetail | undefined>()
  detailIds.forEach((id, i) => detailById.set(id, details[i]?.data))

  // The live cards' well text prefers the running run's latest journaled event over the ticket's
  // last agent comment, which lags behind by comment boundaries rather than tracking play-by-play.
  const liveEventByRunId = useLatestRunEvents(liveNow.map((t) => t.run?.id))
  const liveText = (t: ApiTicket) =>
    (t.run ? liveEventByRunId.get(t.run.id) : undefined) ?? lastAgentText(detailById.get(t.id))

  const { ran, selfFiled } = overnightCounts(board, new Date(now))
  const headline = headlineFor(stopped.length)
  const subline = overnightSubline(ran, selfFiled)
  const running = liveNow.length
  const free = Math.max(0, (settings?.concurrency ?? 0) - running)
  const todayRows = activities.filter((a) => isSinceLocalMidnight(a.createdAt, new Date(now)))

  // ---------------------------------------------------------------- celebration
  // The tada★ plays once, when the last stopped run clears — never per ticket, never on load.
  const [celebrate, setCelebrate] = useState(false)
  const prevStopped = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!board) return
    const prev = prevStopped.current
    prevStopped.current = stopped.length
    if (prev !== undefined && prev > 0 && stopped.length === 0) {
      setCelebrate(true)
      const timer = setTimeout(() => setCelebrate(false), TADA_LIFETIME_MS)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [board, stopped.length])

  // ---------------------------------------------------------------- dialogs
  const [newTicketVisible, setNewTicketVisible] = useState(false)
  const [noteTarget, setNoteTarget] = useState<ApiTicket | null>(null)
  const [historyAll, setHistoryAll] = useState(false)

  const confirmNewTicket = (fields: { title: string; description: string; column: 'backlog' | 'queued' }) => {
    createTicket.mutate(fields, {
      onSuccess: (ticket) => {
        setNewTicketVisible(false)
        router.push(`/tickets/${ticket.id}`)
      },
    })
  }

  // ================================================================== loading / empty
  if (isLoading) {
    return (
      <Screen>
        <View style={styles.skeletons}>
          <Skeleton height={84} />
          <Skeleton height={84} />
          <Skeleton height={84} />
        </View>
      </Screen>
    )
  }

  if (isError || !board) {
    return (
      <Screen>
        <EmptyState
          icon="wifi-off"
          message="Could not reach the server."
          action={{ label: 'Retry', onPress: () => void refetch() }}
        />
      </Screen>
    )
  }

  const dialogs = (
    <>
      <NewTicketDialog
        visible={newTicketVisible}
        onClose={() => setNewTicketVisible(false)}
        onCreate={confirmNewTicket}
        pending={createTicket.isPending}
      />
      {noteTarget ? <NoteDialog ticket={noteTarget} onClose={() => setNoteTarget(null)} /> : null}
    </>
  )

  const shownActivities = historyAll ? activities : todayRows.slice(0, TODAY_PAGE_SIZE)
  const moreHistory = !historyAll && (activities.length > todayRows.length || todayRows.length > TODAY_PAGE_SIZE)

  const headlineBlock = (
    <View style={styles.headlineRow}>
      {stopped.length === 0 ? (
        celebrate ? (
          <TadaStar play testID="control-tada-play" />
        ) : (
          <Text testID="control-tada" style={[styles.quietStar, { color: colors.live }]}>
            ✱
          </Text>
        )
      ) : null}
      <View style={styles.flexShrink}>
        <Text testID="control-headline" style={[type.display, { color: colors.text }]}>
          {headline}
        </Text>
        <Text testID="control-subline" style={[type.monoSmall, styles.subline, { color: colors.textFaintSolid }]}>
          {subline}
        </Text>
      </View>
    </View>
  )

  const stoppedSection = (
    <>
      {stopped.length > 0 && wide ? sectionLabel(colors.textFaintSolid, `Stopped on you · ${stopped.length}`) : null}
      {stopped.map((ticket) => (
        <StoppedCard
          key={ticket.id}
          testID={`stopped-${ticket.id}`}
          ticket={ticket}
          run={ticket.run!}
          agentText={lastAgentText(detailById.get(ticket.id))}
          wide={wide}
          now={now}
          onOpen={() => router.push(`/tickets/${ticket.id}`)}
        />
      ))}
    </>
  )

  const slotPill =
    queued[0] && running >= (settings?.concurrency ?? 0) ? (
      <SlotPill testID="slot-pill" free={free} nextTitle={queued[0].title} onQueueOrder={() => router.navigate('/board')} />
    ) : null

  // ================================================================== wide
  if (wide) {
    return (
      <View style={[styles.wideRoot, { backgroundColor: colors.ground }]} testID="control-wide">
        <ScrollView
          contentContainerStyle={styles.wideContent}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
        >
          <View style={styles.wideHeaderRow}>
            {headlineBlock}
            <View style={styles.spacer} />
            <RunStatusChip
              status={running > 0 ? 'live' : 'neutral'}
              label={`${running} agent${running === 1 ? '' : 's'} live`}
              testID="control-live-chip"
            />
            <Button testID="new-ticket-button" variant="primary" label="New ticket" onPress={() => setNewTicketVisible(true)} />
          </View>

          <View style={styles.twoColumn}>
            <View style={styles.leftColumn}>
              {stoppedSection}

              {liveNow.length > 0 && sectionLabel(colors.textFaintSolid, `Live now · ${liveNow.length}`)}
              {liveNow.map((ticket) => (
                <LiveNowCard
                  key={ticket.id}
                  testID={`live-now-${ticket.id}`}
                  ticket={ticket}
                  run={ticket.run!}
                  now={now}
                  agentText={liveText(ticket)}
                  onFullLog={() => router.push(`/runs/${ticket.run!.id}`)}
                  onNote={() => setNoteTarget(ticket)}
                />
              ))}
              {slotPill}
              {stopped.length === 0 && liveNow.length === 0 ? (
                <Text style={[type.caption, { color: colors.textFaintSolid }]}>
                  This screen is the product working: you slept, it shipped.
                </Text>
              ) : null}
            </View>

            <View style={styles.rightColumn}>
              <MemoryCard testID="memory-card" notes={memory ?? []} onEditMemory={() => router.navigate('/memory')} />
              <TodayCard
                testID="today-card"
                meta={todayMeta(now)}
                activities={shownActivities}
                showFullHistory={moreHistory}
                onFullHistory={() => setHistoryAll(true)}
              />
            </View>
          </View>
        </ScrollView>
        {dialogs}
      </View>
    )
  }

  // ================================================================== narrow
  const digestLines = liveNow.map((ticket) => ({
    key: String(ticket.id),
    text: `${ticket.title.toLowerCase()} · ${elapsedLabel(ticket.run?.startedAt, now)} · ${liveText(ticket) ?? 'working…'}`,
    onPress: () => router.push(`/runs/${ticket.run!.id}`),
  }))

  return (
    <Screen testID="control-narrow">
      <View style={styles.narrowHeader}>
        <Text style={[type.title, { color: colors.text }]}>
          {'tada'}
          <Text style={{ color: colors.live }}>✱</Text>
        </Text>
        <View style={styles.spacer} />
        <RunStatusChip status={running > 0 ? 'live' : 'neutral'} label={`${running} live`} testID="control-live-chip" />
      </View>

      <ScrollView
        testID="control-narrow-scroll"
        contentContainerStyle={styles.narrowContent}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
      >
        {headlineBlock}
        {stoppedSection}
        {liveNow.length > 0 ? <LiveDigest testID="live-digest" lines={digestLines} /> : null}
        {slotPill}
        {stopped.length === 0 ? <TodayRows activities={shownActivities} /> : null}
        <View style={styles.narrowActions}>
          <Button testID="new-ticket-button" variant="primary" small label="New ticket" onPress={() => setNewTicketVisible(true)} />
        </View>
      </ScrollView>
      {dialogs}
    </Screen>
  )
}

/** "Send a note" — free text to a live agent; it reads it at its next step. */
function NoteDialog({ ticket, onClose }: { ticket: ApiTicket; onClose: () => void }) {
  const { colors } = useTheme()
  const note = useNote(ticket.id)
  const [text, setText] = useState('')
  const submit = () => {
    const body = text.trim()
    if (!body) return
    note.mutate(body, {
      onSuccess: ({ delivered }) => {
        showToast(delivered ? 'note delivered — the agent reads it at its next step' : 'note queued for the next run')
        onClose()
      },
    })
  }
  return (
    <Dialog
      visible
      title="Send a note"
      onClose={onClose}
      testID="note-dialog"
      confirm={{
        label: 'Send',
        onPress: submit,
        disabled: note.isPending || text.trim().length === 0,
        loading: note.isPending,
        testID: 'note-confirm',
      }}
    >
      <Text style={[type.caption, { color: colors.textMuted }]}>{ticket.title}</Text>
      <Input
        testID="note-input"
        label="Note"
        placeholder="Add a note — the agent reads it at its next step"
        multiline
        autoFocus
        value={text}
        onChangeText={setText}
      />
    </Dialog>
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
  quietStar: {
    fontSize: 26,
    fontWeight: '600',
  },
  headlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    flexShrink: 1,
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
