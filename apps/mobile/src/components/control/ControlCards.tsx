import type { ApiActivity, ApiMemoryNote, ApiRun, ApiTicket } from '@tada/shared'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { activityGlyph, elapsedLabel, hhmm, holdLine, runStatLine, slotPillText, splitOnQuotedTitle, stoppedSince } from '../../control'
import { useTheme } from '../../design/ThemeContext'
import { heldReasonLabel } from '../../design/status'
import { radius, space, type } from '../../design/tokens'
import { HoldActions } from '../gate/HoldActions'
import { AgentLine, AgentPanel, Badge, Button, Card, RunStatusChip, Tag } from '../ui'

/** Small sans title + mono meta header used above card bodies — the shared Card primitive is a
 * bare surface, so Control composes this row itself to match the artboard's `title`/`meta` Cards. */
export function CardHeader({ title, meta }: { title?: string; meta?: string }) {
  const { colors } = useTheme()
  if (!title && !meta) return null
  return (
    <View style={styles.cardHeader}>
      {title ? (
        <Text numberOfLines={2} style={[type.bodyStrong, styles.cardHeaderTitle, { color: colors.text }]}>
          {title}
        </Text>
      ) : null}
      {meta ? <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>{meta}</Text> : null}
    </View>
  )
}

/** The glyph an agent well line leads with, by what the run is stopped on. */
export function holdGlyph(run: ApiRun | null | undefined): string {
  if (run?.status === 'failed') return '✕'
  if (run?.status === 'held') return run.hold?.reason === 'question' ? '?' : '⏸'
  return '▸'
}

/** The trailing hint under a stopped card's actions — what resolving it does. */
export function stoppedHint(run: ApiRun | null | undefined): string {
  if (run?.status === 'failed') return 'a re-run is a fresh attempt — the failed transcript stays'
  switch (run?.hold?.reason) {
    case 'permission':
      return 'resumes at this step · then moves itself to done'
    case 'question':
      return 'your answer can be saved to memory'
    case 'time':
      return 'continuing picks up mid-run — no re-clone'
    default:
      return ''
  }
}

/** The mono meta beside a stopped card's badge: "run #4128 · paused at step · +412 −38 · 214 tests
 * pass" or "run #4125 · crashed · nothing published". */
export function stoppedStatLine(run: ApiRun): string {
  const parts = [runStatLine(run)]
  if (run.status === 'held' && run.hold?.reason === 'time') parts.push('context kept')
  if (run.status === 'failed') parts.push('nothing published')
  return parts.join(' · ')
}

/**
 * Two-line agent well for a stopped card: the agent's last word (comment or summary) above,
 * then the hold line — the held command / question / limit — in the live colour under a rule.
 */
function StoppedWell({ run, agentText, testID }: { run: ApiRun; agentText: string | undefined; testID: string }) {
  const { colors } = useTheme()
  const glyph = holdGlyph(run)
  const failed = run.status === 'failed'
  const line = run.status === 'held' && run.hold ? holdLine(run.hold) : failed ? `run failed — ${run.summary ?? 'see the full log'}` : ''
  return (
    <View
      testID={testID}
      style={[styles.agentWell, { backgroundColor: colors.agentSurface, borderColor: colors.agentSurfaceEdge }]}
    >
      {agentText ? (
        <Text style={[type.mono, { color: colors.agentText }]}>
          <Text style={{ color: colors.agentPrompt }}>{'▸ '}</Text>
          {agentText}
        </Text>
      ) : null}
      {line ? (
        <Text
          style={[
            type.mono,
            agentText ? [styles.wellRule, { borderTopColor: colors.agentSurfaceEdge }] : null,
            { color: failed ? colors.failText : run.hold?.reason === 'question' ? colors.agentText : colors.liveText },
          ]}
        >
          <Text style={{ color: run.hold?.reason === 'question' ? colors.agentPrompt : undefined }}>{`${glyph} `}</Text>
          {line}
        </Text>
      ) : null}
    </View>
  )
}

/** One triage card: a ticket whose run is stopped on you — held (permission / question / out of
 * time) or failed. Wide shows the full inline action row; narrow stretches the buttons. */
export function StoppedCard({
  ticket,
  run,
  agentText,
  wide,
  now,
  onOpen,
  testID,
}: {
  ticket: ApiTicket
  run: ApiRun
  agentText: string | undefined
  wide: boolean
  now: number
  onOpen: () => void
  testID: string
}) {
  const { colors } = useTheme()
  const failed = run.status === 'failed'
  const badgeLabel = failed ? 'failed' : run.heldReason ? heldReasonLabel(run.heldReason) : 'held'
  const meta = [ticket.repoTags.length ? ticket.repoTags.join(', ') : 'no repo', stoppedSince(run, now)].join(' · ')

  return (
    <Card testID={testID} style={styles.triageCard} onPress={onOpen} nestedInteractive>
      <CardHeader title={ticket.title} meta={wide ? meta : undefined} />
      <View style={styles.triageMetaRow}>
        <Badge status={failed ? 'failed' : 'live'} label={badgeLabel} testID={`${testID}-badge`} />
        <Text style={[type.monoSmall, styles.flexShrink, { color: colors.textFaintSolid }]}>
          {wide ? stoppedStatLine(run) : meta}
        </Text>
      </View>
      <StoppedWell run={run} agentText={wide ? agentText : undefined} testID={`${testID}-well`} />
      <HoldActions run={run} ticketId={ticket.id} stretch={!wide} testID={`${testID}-actions`} />
      {wide ? (
        <Text style={[type.monoCaps, styles.hint, { color: colors.textFaintSolid }]}>{stoppedHint(run)}</Text>
      ) : null}
    </Card>
  )
}

/** Live-run card: title, repo tags, live chip + elapsed, the agent's latest lines, Full log /
 * Send a note actions. */
export function LiveNowCard({
  ticket,
  run,
  now,
  agentText,
  onFullLog,
  onNote,
  testID,
}: {
  ticket: ApiTicket
  run: ApiRun
  /** Current time, re-passed on a tick so the elapsed label advances (see `useNowTick`). */
  now: number
  agentText: string | undefined
  onFullLog: () => void
  onNote: () => void
  testID: string
}) {
  const { colors } = useTheme()
  return (
    <Card testID={testID} style={styles.triageCard}>
      <View style={styles.liveHeaderRow}>
        <Text numberOfLines={1} style={[type.bodyStrong, styles.flexShrink, { color: colors.text }]}>
          {ticket.title}
        </Text>
        {ticket.repoTags.length ? ticket.repoTags.map((tag) => <Tag key={tag} label={tag} />) : <Tag label="no repo" />}
        <View style={styles.spacer} />
        <RunStatusChip status="live" label="live" meta={elapsedLabel(run.startedAt, now)} testID={`${testID}-status`} />
      </View>
      <AgentPanel testID={`${testID}-panel`}>
        <AgentLine color={colors.liveText}>{agentText ?? 'working…'}</AgentLine>
      </AgentPanel>
      <View style={styles.actionRow}>
        <Button testID={`${testID}-full-log`} variant="ghost" small label="Full log" onPress={onFullLog} />
        <Button testID={`${testID}-note`} variant="ghost" small label="Send a note" onPress={onNote} />
      </View>
    </Card>
  )
}

/** Narrow Control's live well: one mono line per running agent; each line opens its run. */
export function LiveDigest({
  lines,
  testID,
}: {
  lines: { key: string; text: string; onPress?: () => void }[]
  testID: string
}) {
  return (
    <AgentPanel testID={testID} header="live now" meta={`${lines.length} ${lines.length === 1 ? 'agent' : 'agents'}`}>
      {lines.map((line) =>
        line.onPress ? (
          <Pressable
            key={line.key}
            testID={`${testID}-line-${line.key}`}
            accessibilityRole="button"
            onPress={line.onPress}
            style={({ pressed }) => (pressed ? styles.pressed : null)}
          >
            <AgentLine>{line.text}</AgentLine>
          </Pressable>
        ) : (
          <AgentLine key={line.key}>{line.text}</AgentLine>
        ),
      )}
    </AgentPanel>
  )
}

/** "0 slots free · next: <title>" with a Queue order button — the queue keeps moving on its own;
 * this only shows what is up next. */
export function SlotPill({
  free,
  nextTitle,
  onQueueOrder,
  testID,
}: {
  free: number
  nextTitle: string
  onQueueOrder: () => void
  testID: string
}) {
  const { colors } = useTheme()
  return (
    <View testID={testID} style={[styles.slotPill, { borderColor: colors.borderStrong }]}>
      <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>{slotPillText(free)}</Text>
      <Text numberOfLines={1} style={[type.caption, styles.flexShrink, { color: colors.text }]}>
        {nextTitle}
      </Text>
      <View style={styles.spacer} />
      <Button testID={`${testID}-order`} variant="ghost" small label="Queue order" onPress={onQueueOrder} />
    </View>
  )
}

/** First line of a note body, without a leading markdown heading — the one-line memory digest. */
export function noteDigest(note: ApiMemoryNote): string {
  const firstLine = note.body
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('#'))
  return firstLine ?? note.title
}

export function MemoryCard({
  notes,
  onEditMemory,
  testID,
}: {
  notes: ApiMemoryNote[]
  onEditMemory: () => void
  testID: string
}) {
  const { colors } = useTheme()
  const kept = notes.filter((n) => n.state === 'kept')
  const pending = notes.filter((n) => n.state === 'pending')
  const pendingNote = pending[pending.length - 1]
  return (
    <Card testID={testID} style={styles.railCard}>
      <CardHeader title="Memory" meta={`${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`} />
      {kept.slice(0, 2).map((note) => (
        <Text key={note.id} numberOfLines={1} style={[type.mono, { color: colors.textMuted }]}>
          {`· ${noteDigest(note)}`}
        </Text>
      ))}
      {pendingNote ? (
        <View
          testID={`${testID}-pending`}
          style={[styles.agentWell, { backgroundColor: colors.agentSurface, borderColor: colors.agentSurfaceEdge }]}
        >
          <Text numberOfLines={2} style={[type.mono, { color: colors.agentText }]}>
            {noteDigest(pendingNote)}
            <Text style={{ color: colors.liveText }}>{' · proposed by agent'}</Text>
          </Text>
        </View>
      ) : null}
      <Button testID={`${testID}-edit`} variant="ghost" small label="Edit memory" onPress={onEditMemory} style={styles.selfStart} />
    </Card>
  )
}

export function TodayCard({
  activities,
  meta,
  onFullHistory,
  showFullHistory,
  testID,
}: {
  activities: ApiActivity[]
  /** Mono meta beside the title, e.g. "aug 17". */
  meta?: string
  onFullHistory: () => void
  showFullHistory: boolean
  testID: string
}) {
  return (
    <Card testID={testID} style={styles.railCard}>
      <CardHeader title="Today" meta={meta} />
      <TodayRows activities={activities} />
      {showFullHistory ? (
        <Button testID={`${testID}-full-history`} variant="ghost" small label="Full history" onPress={onFullHistory} style={styles.selfStart} />
      ) : null}
    </Card>
  )
}

/** The bare Today rows (stamp + glyph + message), for the card and the all-quiet screen. */
export function TodayRows({ activities }: { activities: ApiActivity[] }) {
  const { colors } = useTheme()
  if (activities.length === 0) {
    return <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>nothing yet today</Text>
  }
  return (
    <View>
      {activities.map((entry, index) => (
        <View
          key={entry.id}
          style={[
            styles.activityRow,
            index < activities.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle },
          ]}
        >
          <Text style={[type.monoCaps, styles.activityStamp, { color: colors.textFaintSolid }]}>{hhmm(entry.createdAt)}</Text>
          <ActivityMessage entry={entry} />
        </View>
      ))}
    </View>
  )
}

function ActivityMessage({ entry }: { entry: ApiActivity }) {
  const { colors } = useTheme()
  const glyph = activityGlyph(entry.type)
  const split = splitOnQuotedTitle(entry.message, entry.ticketTitle)

  return (
    <Text style={[type.caption, styles.activityMessage, { color: colors.textMuted }]}>
      {glyph ? <Text style={[type.mono, { color: colors[glyph.colorKey] }]}>{`${glyph.glyph} `}</Text> : null}
      {split ? (
        <>
          {split.before}
          <Text style={{ color: colors.text, fontWeight: '500' }}>{split.title}</Text>
          {split.after}
        </>
      ) : (
        entry.message
      )}
    </Text>
  )
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.7,
  },
  cardHeader: {
    gap: 2,
  },
  cardHeaderTitle: {
    flexShrink: 1,
  },
  agentWell: {
    borderRadius: radius.control,
    borderWidth: 1,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
    gap: space.xs,
  },
  wellRule: {
    borderTopWidth: 1,
    paddingTop: space.xs + 2,
  },
  triageCard: {
    gap: space.sm + 2,
  },
  triageMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  flexShrink: {
    flexShrink: 1,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  hint: {
    textTransform: 'none',
  },
  spacer: {
    flex: 1,
  },
  liveHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  slotPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radius.full,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm + 1,
  },
  railCard: {
    gap: space.sm,
  },
  selfStart: {
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  activityRow: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'baseline',
    paddingVertical: space.xs + 1,
  },
  activityStamp: {
    width: 36,
  },
  activityMessage: {
    flex: 1,
  },
})
