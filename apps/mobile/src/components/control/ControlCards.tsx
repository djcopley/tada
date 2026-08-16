import type { ApiActivity, ApiMemoryNote, ApiRun, ApiTicket, ApiWorkspaceListItem } from '@tada/shared'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import {
  activityGlyph,
  elapsedLabel,
  failureLine,
  heldWord,
  hhmm,
  prNumberFromUrl,
  runStatLine,
  slotPillText,
  splitOnQuotedTitle,
} from '../../control'
import { useTheme } from '../../design/ThemeContext'
import { radius, space, type } from '../../design/tokens'
import { stripLeadingHeading } from '../memory/MemoryListScreen'
import { AgentLine, AgentPanel, Badge, Button, Card, RunStatusChip, Tag, TadaStar } from '../ui'

/** Small sans title + mono meta header used above card bodies — the shared Card primitive is a
 * bare surface, so Control composes this row itself to match the artboard's `title`/`meta` Cards. */
function CardHeader({ title, meta }: { title?: string; meta?: string }) {
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

/** Recessed mono well for the agent's latest word — the one place proportional type never
 * appears. Falls back to a faint placeholder when there's genuinely nothing to show yet. */
function AgentWell({ text, testID }: { text: string | undefined; testID?: string }) {
  const { colors } = useTheme()
  return (
    <View
      testID={testID}
      style={[styles.agentWell, { backgroundColor: colors.agentSurface, borderColor: colors.agentSurfaceEdge }]}
    >
      <Text style={[type.mono, { color: text ? colors.agentText : colors.agentTextMuted }]}>
        <Text style={{ color: colors.agentPrompt }}>{'▸ '}</Text>
        {text ?? 'no output yet'}
      </Text>
    </View>
  )
}

export type NeedsYouActions = {
  onAccept: () => void
  onSendBack: () => void
  onOpenDiff: () => void
  onRerun: () => void
  onEditAndRerun: () => void
  onMoveToBacklog: () => void
  /** Tapping the card body (title, meta, agent well) opens the ticket itself. */
  onOpen: () => void
}

/** One triage card: a ticket in review ("your turn") or held after a failed run ("failed").
 * Wide shows the full inline action row; narrow pairs two 46px buttons per the mobile artboard. */
export function NeedsYouCard({
  ticket,
  meta,
  narrowMeta,
  failed,
  latestRun,
  agentText,
  wide,
  accepting,
  celebrate,
  actions,
  testID,
}: {
  ticket: ApiTicket
  /** Wide header meta, e.g. "parlor · 2h ago". */
  meta: string
  /** Narrow (mobile artboard) meta, e.g. "parlor · 2h · pr #481" — see `narrowNeedsYouMeta`. */
  narrowMeta: string
  failed: boolean
  latestRun: ApiRun | undefined
  agentText: string | undefined
  wide: boolean
  accepting: boolean
  celebrate: boolean
  actions: NeedsYouActions
  testID: string
}) {
  const { colors } = useTheme()
  const statLine = failed ? failureLine(latestRun) : runStatLine(latestRun)
  const prNumber = !failed ? prNumberFromUrl(latestRun?.prUrl) : null

  return (
    <Card testID={testID} style={styles.triageCard} onPress={actions.onOpen} nestedInteractive>
      <CardHeader title={ticket.title} meta={wide ? meta : undefined} />
      <View style={styles.triageMetaRow}>
        <Badge
          status={failed ? (heldWord(latestRun) === 'stopped' ? 'neutral' : 'failed') : 'accepted'}
          label={failed ? heldWord(latestRun) : 'your turn'}
        />
        {wide && statLine ? (
          <Text style={[type.monoSmall, styles.flexShrink, { color: colors.textFaintSolid }]}>{statLine}</Text>
        ) : null}
        {celebrate ? <TadaStar play testID={`${testID}-tada`} /> : null}
      </View>

      {!wide && (
        <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>{narrowMeta}</Text>
      )}

      {wide ? <AgentWell text={agentText} testID={`${testID}-agent`} /> : null}

      {wide ? (
        <View style={styles.actionRow}>
          {failed ? (
            <>
              <Button testID={`${testID}-rerun`} variant="secondary" label="Re-run" small onPress={actions.onRerun} />
              <Button testID={`${testID}-edit-rerun`} variant="ghost" label="Edit brief and re-run" small onPress={actions.onEditAndRerun} />
              <Button testID={`${testID}-backlog`} variant="ghost" label="Move to backlog" small onPress={actions.onMoveToBacklog} />
            </>
          ) : (
            <>
              <Button
                testID={`${testID}-accept`}
                variant="primary"
                small
                label="Accept run"
                loading={accepting}
                onPress={actions.onAccept}
              />
              <Button testID={`${testID}-send-back`} variant="ghost" small label="Send back" onPress={actions.onSendBack} />
              {latestRun?.prUrl ? (
                <Button testID={`${testID}-open-diff`} variant="ghost" small label="Open diff" onPress={actions.onOpenDiff} />
              ) : null}
              <View style={styles.spacer} />
              {prNumber ? (
                <Text style={[type.monoCaps, { color: colors.textFaintSolid }]}>
                  {`accept merges pr #${prNumber}`}
                </Text>
              ) : null}
            </>
          )}
        </View>
      ) : (
        <View style={styles.pairedRow}>
          {failed ? (
            <>
              <Button testID={`${testID}-rerun`} variant="secondary" label="Re-run" style={styles.pairedButton} onPress={actions.onRerun} />
              <Button testID={`${testID}-edit-rerun`} variant="ghost" label="Edit brief" style={styles.pairedButton} onPress={actions.onEditAndRerun} />
            </>
          ) : (
            <>
              <Button
                testID={`${testID}-accept`}
                variant="primary"
                label="Accept run"
                loading={accepting}
                style={styles.pairedButton}
                onPress={actions.onAccept}
              />
              <Button testID={`${testID}-send-back`} variant="secondary" label="Send back" style={styles.pairedButton} onPress={actions.onSendBack} />
            </>
          )}
        </View>
      )}
    </Card>
  )
}

/** Wide-only live-run card: title, source tag, live chip + elapsed, one line of the agent's
 * latest word, Full log / Nudge actions. */
export function LiveNowCard({
  ticket,
  workspace,
  startedAt,
  now,
  agentText,
  onFullLog,
  onNudge,
  testID,
}: {
  ticket: ApiTicket
  workspace: ApiWorkspaceListItem
  startedAt: string | null | undefined
  /** Current time, re-passed on a tick so the elapsed label advances (see `useNowTick`). */
  now: number
  agentText: string | undefined
  onFullLog: () => void
  onNudge: () => void
  testID: string
}) {
  return (
    <Card testID={testID} style={styles.triageCard}>
      <View style={styles.liveHeaderRow}>
        <Text numberOfLines={1} style={[type.bodyStrong, styles.flexShrink]}>
          {ticket.title}
        </Text>
        <Tag label={workspace.name} />
        <View style={styles.spacer} />
        <RunStatusChip status="live" label="live" meta={elapsedLabel(startedAt, now)} testID={`${testID}-status`} />
      </View>
      <AgentPanel testID={`${testID}-panel`}>
        <AgentLine>{agentText ?? 'working…'}</AgentLine>
      </AgentPanel>
      <View style={styles.actionRow}>
        <Button testID={`${testID}-full-log`} variant="ghost" small label="Full log" onPress={onFullLog} />
        <Button testID={`${testID}-nudge`} variant="ghost" small label="Nudge with a note" onPress={onNudge} />
      </View>
    </Card>
  )
}

/** Narrow-only: every live run collapsed into one AgentPanel digest, matching the mobile
 * artboard's `▸ session test · 12m · suite ×20 green` lines instead of per-card panels. */
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

export function SlotPill({
  slots,
  nextTitle,
  onStartNow,
  testID,
}: {
  slots: number
  nextTitle: string
  onStartNow: () => void
  testID: string
}) {
  const { colors } = useTheme()
  return (
    <View testID={testID} style={[styles.slotPill, { borderColor: colors.borderStrong }]}>
      <Text style={[type.monoSmall, styles.flexShrink, { color: colors.textFaintSolid }]}>
        {slotPillText(slots, nextTitle)}
      </Text>
      <View style={styles.spacer} />
      <Button testID={`${testID}-start`} variant="secondary" small label="Start now" onPress={onStartNow} />
    </View>
  )
}

export function MemoryCard({
  workspaceName,
  keptNotes,
  pendingNote,
  onEditMemory,
  testID,
}: {
  workspaceName: string
  keptNotes: ApiMemoryNote[]
  pendingNote: ApiMemoryNote | undefined
  onEditMemory: () => void
  testID: string
}) {
  const { colors } = useTheme()
  return (
    <Card testID={testID} style={styles.railCard}>
      <CardHeader title="Memory" meta={workspaceName} />
      {keptNotes.slice(0, 2).map((note) => (
        <Text key={note.id} numberOfLines={1} style={[type.mono, { color: colors.textMuted }]}>
          {`· ${stripLeadingHeading(note.body)}`}
        </Text>
      ))}
      {pendingNote ? (
        <View
          testID={`${testID}-pending`}
          style={[styles.agentWell, { backgroundColor: colors.agentSurface, borderColor: colors.agentSurfaceEdge }]}
        >
          <Text style={[type.mono, { color: colors.agentText }]}>
            {stripLeadingHeading(pendingNote.body)}
            <Text style={{ color: colors.liveText }}>{' · new, by agent'}</Text>
          </Text>
        </View>
      ) : null}
      <Button testID={`${testID}-edit`} variant="ghost" small label="Edit memory" onPress={onEditMemory} style={styles.selfStart} />
    </Card>
  )
}

export function TodayCard({
  activities,
  onFullHistory,
  showFullHistory,
  testID,
}: {
  activities: ApiActivity[]
  onFullHistory: () => void
  showFullHistory: boolean
  testID: string
}) {
  const { colors } = useTheme()
  return (
    <Card testID={testID} style={styles.railCard}>
      <CardHeader title="Today" />
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
      {showFullHistory ? (
        <Button testID={`${testID}-full-history`} variant="ghost" small label="Full history" onPress={onFullHistory} style={styles.selfStart} />
      ) : null}
    </Card>
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

export function WorkspaceStrip({
  workspace,
  onBoard,
  testID,
}: {
  workspace: ApiWorkspaceListItem
  onBoard: () => void
  testID: string
}) {
  const { colors } = useTheme()
  const parts: { text: string; color?: string }[] = [{ text: `${workspace.queuedCount} queued` }]
  if (workspace.runningCount > 0) parts.push({ text: `${workspace.runningCount} live`, color: colors.liveText })
  if (workspace.needsReviewCount > 0) parts.push({ text: `${workspace.needsReviewCount} yours`, color: colors.okText })

  return (
    <View
      testID={testID}
      style={[styles.workspaceStrip, { backgroundColor: colors.raised, borderColor: colors.borderSubtle }]}
    >
      <Text style={[type.caption, { color: colors.text, fontWeight: '600' }]}>{workspace.name}</Text>
      <Text style={[type.monoCaps, { color: colors.textFaintSolid }]}>
        {parts.map((p, i) => (
          <Text key={i} style={p.color ? { color: p.color } : undefined}>
            {i > 0 ? ' · ' : ''}
            {p.text}
          </Text>
        ))}
      </Text>
      <View style={styles.spacer} />
      <Button testID={`${testID}-board`} variant="ghost" small label="Board" onPress={onBoard} />
    </View>
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
  pairedRow: {
    flexDirection: 'row',
    gap: space.sm,
  },
  pairedButton: {
    flex: 1,
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
  workspaceStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderRadius: radius.card,
    paddingHorizontal: space.md + 2,
    paddingVertical: space.sm + 1,
  },
})
