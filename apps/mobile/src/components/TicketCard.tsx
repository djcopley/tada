import type { ApiComment, ApiRun, ApiTicket, ApiWorkspaceDetail, ColumnKind } from '@tada/shared'
import * as Haptics from 'expo-haptics'
import { useEffect, useRef } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { useLatestRunEvent } from '../api/useLatestRunEvent'
import {
  agentWellText,
  doneMeta,
  followUpOfLabel,
  isProposalTicket,
  minimalCardMeta,
  nextUpMeta,
  reviewMeta,
  retryMeta,
} from '../board/cardMeta'
import { measureInWindow, useBoardDnD } from '../board/dnd'
import { elapsedLabel } from '../control'
import { useTheme } from '../design/ThemeContext'
import { radius, space, type } from '../design/tokens'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { TadaStar } from './ui/TadaStar'

/** The slice of a ticket's detail (comments + runs) a board card needs — a structural subset of
 * `useTicket`'s `{ ticket, comments, runs, followUps }` response. */
export type TicketDetail = { comments: ApiComment[]; runs: ApiRun[] }

/** Per-card callbacks/state the board screen supplies for whichever actions its column kind
 * exposes. Omitting a handler simply hides that control (e.g. the drag-overlay preview passes
 * no `actions` at all). */
export type BoardCardActions = {
  onWatchLive?: () => void
  onAccept?: () => void
  accepting?: boolean
  celebrate?: boolean
  onSendBack?: () => void
  onKeep?: () => void
  onDismiss?: () => void
  keeping?: boolean
  dismissing?: boolean
}

type BodyProps = {
  ticket: ApiTicket
  workspace: ApiWorkspaceDetail
  columnKind: ColumnKind
  /** Ticking clock for elapsed/age labels — see `useNowTick`. */
  now: number
  detail?: TicketDetail
  /** The first queued ticket in Queued reads "next up" instead of its age. */
  isTopQueued?: boolean
  /** Resolved title of `followUpOfTicketId`, when that parent is on this board. */
  parentTitle?: string
  actions?: BoardCardActions
}

/** A pulsing `▮` — the one glyph that pulses inside running-card mono meta, per the artboard
 * (`ii-pulse`, distinct from the header StatusDot). */
function PulseGlyph({ color }: { color: string }) {
  const reducedMotion = useReducedMotion()
  const opacity = useSharedValue(1)

  useEffect(() => {
    if (reducedMotion) {
      opacity.value = 1
      return
    }
    opacity.value = withRepeat(withSequence(withTiming(0.25, { duration: 800 }), withTiming(1, { duration: 800 })), -1)
    return () => cancelAnimation(opacity)
  }, [reducedMotion, opacity])

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }))
  return <Animated.Text style={[{ color }, style]}>{'▮'}</Animated.Text>
}

/** Recessed one-line agent well on the running card: pulsing glyph + the agent's latest word,
 * ellipsized. */
function AgentWell({ text, testID }: { text: string | undefined; testID?: string }) {
  const { colors } = useTheme()
  return (
    <View testID={testID} style={[styles.well, { backgroundColor: colors.agentSurface, borderColor: colors.agentSurfaceEdge }]}>
      <Text numberOfLines={1} style={[type.monoSmall, { color: colors.liveText }]}>
        <PulseGlyph color={colors.liveText} />
        {' '}
        {text ?? 'working…'}
      </Text>
    </View>
  )
}

function MinimalBody({ title, meta, liveMeta }: { title: string; meta: string; liveMeta?: boolean }) {
  const { colors } = useTheme()
  return (
    <View style={styles.body}>
      <Text numberOfLines={2} style={[type.bodyStrong, styles.title, { color: colors.text }]}>
        {title}
      </Text>
      <Text numberOfLines={1} style={[type.monoSmall, { color: liveMeta ? colors.liveText : colors.textFaintSolid }]}>
        {meta}
      </Text>
    </View>
  )
}

function ProposalBody({
  ticket,
  parentTitle,
  actions,
}: {
  ticket: ApiTicket
  parentTitle?: string
  actions?: BoardCardActions
}) {
  const { colors } = useTheme()
  const followUp = followUpOfLabel(parentTitle)
  return (
    <View style={styles.body}>
      <Text style={[type.monoCaps, styles.upper, { color: colors.liveText }]}>Proposed by agent</Text>
      <Text numberOfLines={2} style={[type.bodyStrong, styles.title, { color: colors.text }]}>
        {ticket.title}
      </Text>
      {followUp ? (
        <Text numberOfLines={1} style={[type.monoSmall, { color: colors.textFaintSolid }]}>
          {followUp}
        </Text>
      ) : null}
      {actions ? (
        <View style={styles.actionRow}>
          <Button
            testID={`proposal-keep-${ticket.id}`}
            variant="secondary"
            small
            label="Keep"
            loading={actions.keeping}
            onPress={actions.onKeep ?? (() => {})}
          />
          <Button
            testID={`proposal-dismiss-${ticket.id}`}
            variant="ghost"
            small
            label="Dismiss"
            loading={actions.dismissing}
            onPress={actions.onDismiss ?? (() => {})}
          />
        </View>
      ) : null}
    </View>
  )
}

function RunningBody({ ticket, workspace, now, detail, actions }: BodyProps) {
  const { colors } = useTheme()
  const source = workspace.sources[0]?.name
  const runningRun = detail?.runs.find((r) => r.status === 'running') ?? detail?.runs[detail.runs.length - 1]
  const elapsed = elapsedLabel(runningRun?.startedAt, now)
  const isLive = runningRun?.status === 'running'
  // Prefer the run's latest journaled event over the ticket's last agent comment/summary, which
  // lag behind by comment/run boundaries — while the run is live, `working…` (AgentWell's
  // fallback) is the true no-events-yet state, not a stale comment from an earlier run.
  const liveText = useLatestRunEvent(runningRun?.id, isLive)
  const agentText = isLive ? liveText : agentWellText(detail)

  return (
    <View style={styles.body}>
      <Text numberOfLines={2} style={[type.bodyStrong, styles.title, { color: colors.text }]}>
        {ticket.title}
      </Text>
      <Text numberOfLines={1} style={[type.monoSmall, { color: colors.textFaintSolid }]}>
        {source ? `${source} · ` : ''}
        <Text style={{ color: colors.liveText }}>{elapsed}</Text>
      </Text>
      <AgentWell text={agentText} testID={`ticket-agent-well-${ticket.id}`} />
      {actions?.onWatchLive ? (
        <Button
          testID={`watch-live-${ticket.id}`}
          variant="ghost"
          small
          label="Watch live"
          onPress={actions.onWatchLive}
          style={styles.selfStart}
        />
      ) : null}
    </View>
  )
}

function ReviewBody({ ticket, detail, actions }: BodyProps) {
  const { colors } = useTheme()
  const latestRun = detail?.runs[detail.runs.length - 1]
  const meta = reviewMeta(latestRun)

  return (
    <View style={styles.body}>
      <View style={styles.metaRow}>
        <Badge status="accepted" label="your turn" />
        {actions?.celebrate ? <TadaStar play testID={`ticket-tada-${ticket.id}`} /> : null}
      </View>
      <Text numberOfLines={2} style={[type.bodyStrong, styles.title, { color: colors.text }]}>
        {ticket.title}
      </Text>
      {meta ? (
        <Text numberOfLines={1} style={[type.monoSmall, { color: colors.textFaintSolid }]}>
          {meta}
        </Text>
      ) : null}
      {actions ? (
        <View style={styles.actionRow}>
          <Button
            testID={`accept-${ticket.id}`}
            variant="primary"
            small
            label="Accept"
            loading={actions.accepting}
            onPress={actions.onAccept ?? (() => {})}
          />
          <Button
            testID={`send-back-${ticket.id}`}
            variant="ghost"
            small
            label="Send back"
            onPress={actions.onSendBack ?? (() => {})}
          />
        </View>
      ) : null}
    </View>
  )
}

function DoneBody({ ticket, workspace, detail, now }: BodyProps) {
  const { colors } = useTheme()
  const latestRun = detail?.runs[detail.runs.length - 1]
  const meta = doneMeta(workspace, latestRun, ticket, now)
  return (
    <View style={styles.body}>
      <Text numberOfLines={2} style={[type.bodyStrong, styles.title, { color: colors.text }]}>
        {ticket.title}
      </Text>
      <Text numberOfLines={1} style={[type.monoSmall, { color: colors.textFaintSolid }]}>
        {meta}
      </Text>
    </View>
  )
}

/** Dispatches to the right card body for a ticket's origin/column-kind — used both by the live
 * `TicketCard` and, unadorned (no `actions`), as the floating drag-overlay clone. */
export function TicketCardBody(props: BodyProps) {
  const { ticket, workspace, columnKind, now, detail, isTopQueued, parentTitle, actions } = props

  if (isProposalTicket(ticket)) {
    return <ProposalBody ticket={ticket} parentTitle={parentTitle} actions={actions} />
  }
  if (columnKind === 'in_progress') {
    return <RunningBody {...props} />
  }
  if (columnKind === 'in_review') {
    return <ReviewBody {...props} />
  }
  if (columnKind === 'done') {
    return <DoneBody {...props} />
  }

  const latestRun = detail?.runs[detail.runs.length - 1]
  const heldRetry = ticket.queueState === 'held' ? retryMeta(latestRun) : null
  const meta = heldRetry ?? (isTopQueued ? nextUpMeta(workspace) : minimalCardMeta(workspace, ticket, now))
  return <MinimalBody title={ticket.title} meta={meta} liveMeta={Boolean(heldRetry)} />
}

/** Drag activates after a short hold; a plain tap still opens the ticket. */
const DRAG_HOLD_MS = 220

export function TicketCard({
  ticket,
  workspace,
  columnKind,
  now,
  detail,
  isTopQueued,
  parentTitle,
  actions,
  onPress,
  onLongPress,
}: BodyProps & {
  onPress: () => void
  onLongPress?: () => void
}) {
  const dnd = useBoardDnD()
  const { colors } = useTheme()
  const cardRef = useRef<View>(null)
  const proposal = isProposalTicket(ticket)

  useEffect(() => {
    if (!dnd || !cardRef.current) return
    return dnd.registerCard(ticket.columnId, ticket.id, cardRef.current)
  }, [dnd, ticket.columnId, ticket.id])

  const lift = async (absX: number, absY: number) => {
    if (!dnd || !cardRef.current) return
    const rect = await measureInWindow(cardRef.current)
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    dnd.beginDrag(
      {
        ticket,
        fromColumnId: ticket.columnId,
        fromColumnKind: columnKind,
        width: rect.width,
        height: rect.height,
      },
      rect,
    )
    dnd.moveDrag(absX, absY)
  }

  const move = (absX: number, absY: number) => dnd?.moveDrag(absX, absY)
  const drop = (absX: number, absY: number) => dnd?.endDrag(absX, absY)
  const cancel = () => dnd?.cancelDrag()

  const dragging = dnd?.draggingId === ticket.id

  // Proposal cards always render Keep/Dismiss, running cards render Watch live only once a run
  // is live, and in-review cards always render Accept/Send back — in every other case the body
  // has no interactive children, so the card itself can safely be a real `<button>`.
  const hasNestedButtons =
    Boolean(actions) &&
    (proposal || columnKind === 'in_review' || (columnKind === 'in_progress' && Boolean(actions?.onWatchLive)))

  const card = (
    <View ref={cardRef} collapsable={false} style={dragging && styles.liftedSource}>
      <Card
        testID={`ticket-card-${ticket.id}`}
        onPress={onPress}
        onLongPress={onLongPress}
        nestedInteractive={hasNestedButtons}
        style={proposal ? [styles.card, { borderStyle: 'dashed', borderColor: colors.borderStrong }] : styles.card}
      >
        <TicketCardBody
          ticket={ticket}
          workspace={workspace}
          columnKind={columnKind}
          now={now}
          detail={detail}
          isTopQueued={isTopQueued}
          parentTitle={parentTitle}
          actions={actions}
        />
      </Card>
    </View>
  )

  // Not draggable: a pending proposal isn't part of the normal move flow (Keep/Dismiss decide
  // its fate instead), so it never gets the pan gesture attached.
  if (!dnd || proposal) return card

  const pan = Gesture.Pan()
    .withTestId(`ticket-drag-${ticket.id}`)
    .activateAfterLongPress(DRAG_HOLD_MS)
    // eslint-disable-next-line react-hooks/refs -- `lift` reads cardRef inside a gesture handler, not during render
    .onStart((e) => {
      runOnJS(lift)(e.absoluteX, e.absoluteY)
    })
    .onUpdate((e) => {
      runOnJS(move)(e.absoluteX, e.absoluteY)
    })
    .onEnd((e) => {
      runOnJS(drop)(e.absoluteX, e.absoluteY)
    })
    .onFinalize((_e, success) => {
      if (!success) runOnJS(cancel)()
    })

  return <GestureDetector gesture={pan}>{card}</GestureDetector>
}

const styles = StyleSheet.create({
  card: {
    marginVertical: space.xs,
    padding: space.md,
  },
  liftedSource: {
    opacity: 0.3,
  },
  body: {
    gap: space.sm,
  },
  title: {
    fontSize: 13.5,
    lineHeight: 18,
  },
  upper: {
    textTransform: 'uppercase',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  actionRow: {
    flexDirection: 'row',
    gap: space.xs + 2,
  },
  selfStart: {
    alignSelf: 'flex-start',
  },
  well: {
    borderRadius: radius.control,
    borderWidth: 1,
    paddingHorizontal: space.sm + 2,
    paddingVertical: space.xs + 3,
  },
})
