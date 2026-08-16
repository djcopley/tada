import type { ApiComment, ApiRun, ApiTicket, ApiWorkspaceDetail, ColumnKind } from '@tada/shared'
import * as Haptics from 'expo-haptics'
import { type MutableRefObject, useEffect, useRef } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import { Gesture, GestureDetector, type GestureStateManager, PointerType } from 'react-native-gesture-handler'
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

/** Native: drag activates after a short hold; a plain tap still opens the ticket. */
const DRAG_HOLD_MS = 220
/** Web: a mouse "click and drag" moves immediately, so the pan activates on distance instead of
 * a hold (RNGH's web pan fails if the pointer moves before a long-press timer fires). */
const DRAG_MIN_DISTANCE = 6
/** A held-then-released card (no real movement) reads as a long-press, not a drag. */
const DRAG_TAP_SLOP = 8
/** How long after a drag the underlying Pressable's trailing press/click is ignored — on web
 * the browser still fires `click` on the source card after the pointer is released. */
const POST_DRAG_PRESS_GUARD_MS = 400
/** See `drop`: how long a web touch waits after release before its actions sheet opens. */
const WEB_TOUCH_SHEET_DELAY_MS = 80

type DragHandlers = {
  lift: (absX: number, absY: number) => void
  move: (absX: number, absY: number) => void
  drop: (absX: number, absY: number, travelled: number) => void
  cancel: () => void
}

/** Native: the pan activates after a short hold (RNGH cancels the underlying press responder on
 * activation), with worklet callbacks hopping to JS for the board's drag state. */
function nativePan(ticketId: number, h: DragHandlers) {
  return (
    Gesture.Pan()
      .withTestId(`ticket-drag-${ticketId}`)
      .activateAfterLongPress(DRAG_HOLD_MS)
      .onStart((e) => {
        'worklet'
        runOnJS(h.lift)(e.absoluteX, e.absoluteY)
      })
      .onUpdate((e) => {
        'worklet'
        runOnJS(h.move)(e.absoluteX, e.absoluteY)
      })
      .onEnd((e) => {
        'worklet'
        runOnJS(h.drop)(e.absoluteX, e.absoluteY, Math.hypot(e.translationX, e.translationY))
      })
      .onFinalize((_e, success) => {
        'worklet'
        if (!success) runOnJS(h.cancel)()
      })
  )
}

type WebDragState = { x: number; y: number; holdTimer: ReturnType<typeof setTimeout> | null }

/** Web: activation depends on the pointer. A mouse "click and drag" moves at once, so it
 * activates on distance (a long-press timer would fail the gesture the moment the pointer moved);
 * a finger on a touchscreen has to hold first, exactly like native, or the columns' own touch
 * scrolling wins — that's what the manual activation below reproduces. Everything runs on the JS
 * thread here (there is no UI thread on web), hence `.runOnJS(true)` and plain callbacks. */
function webPan(ticketId: number, state: MutableRefObject<WebDragState>, h: DragHandlers) {
  const clearHold = () => {
    if (state.current.holdTimer) clearTimeout(state.current.holdTimer)
    state.current.holdTimer = null
  }
  return Gesture.Pan()
    .withTestId(`ticket-drag-${ticketId}`)
    .runOnJS(true)
    .manualActivation(true)
    .onTouchesDown((e, sm: GestureStateManager) => {
      const t = e.allTouches[0]
      if (!t) return
      state.current.x = t.absoluteX
      state.current.y = t.absoluteY
      clearHold()
      if (e.pointerType !== PointerType.MOUSE) {
        state.current.holdTimer = setTimeout(() => {
          state.current.holdTimer = null
          sm.activate()
        }, DRAG_HOLD_MS)
      }
    })
    .onTouchesMove((e, sm: GestureStateManager) => {
      const t = e.allTouches[0]
      if (!t) return
      const travelled = Math.hypot(t.absoluteX - state.current.x, t.absoluteY - state.current.y)
      if (e.pointerType === PointerType.MOUSE) {
        if (travelled > DRAG_MIN_DISTANCE) sm.activate()
      } else if (state.current.holdTimer && travelled > DRAG_TAP_SLOP) {
        // Moved before the hold elapsed: this is a scroll, not a drag.
        clearHold()
        sm.fail()
      }
    })
    .onTouchesUp(clearHold)
    .onTouchesCancelled(clearHold)
    .onStart((e) => h.lift(e.absoluteX, e.absoluteY))
    .onUpdate((e) => h.move(e.absoluteX, e.absoluteY))
    .onEnd((e) => h.drop(e.absoluteX, e.absoluteY, Math.hypot(e.translationX, e.translationY)))
    .onFinalize((_e, success) => {
      clearHold()
      if (!success) h.cancel()
    })
}

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
  // Timestamp of the last drag activation, so the card's own press handler can tell a real tap
  // from the click that trails a drop (see POST_DRAG_PRESS_GUARD_MS). Only a drag that actually
  // lifted arms it: a plain click/tap also starts (and then fails) the pan, and stamping there
  // swallowed every ordinary press on web.
  const lastDragAt = useRef(0)
  const dragActive = useRef(false)
  const webDragRef = useRef<WebDragState>({ x: 0, y: 0, holdTimer: null })

  useEffect(() => {
    if (!dnd || !cardRef.current) return
    return dnd.registerCard(ticket.columnId, ticket.id, cardRef.current)
  }, [dnd, ticket.columnId, ticket.id])

  const lift = async (absX: number, absY: number) => {
    if (!dnd || !cardRef.current) return
    dragActive.current = true
    // eslint-disable-next-line react-hooks/purity -- gesture handler, not render
    lastDragAt.current = Date.now()
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
  const drop = (absX: number, absY: number, travelled: number) => {
    dragActive.current = false
    // eslint-disable-next-line react-hooks/purity -- gesture handler, not render
    lastDragAt.current = Date.now()
    // The pan's hold activation (native, and a finger on web) swallows the Pressable's own
    // long-press, so a hold that never really moved is the long-press: put the card back and open
    // its actions. A mouse never reaches here without travelling — its pan activates on distance.
    if (travelled < DRAG_TAP_SLOP && onLongPress) {
      dnd?.cancelDrag()
      if (Platform.OS === 'web') {
        // The browser dispatches compat mousedown/mouseup/click right after `touchend`, hit-
        // tested at dispatch time: a sheet mounted synchronously here would receive them on
        // whatever row sits under the finger (and act on it). Open it a beat later instead, so
        // those land on the card, where the post-drag guard swallows them.
        setTimeout(onLongPress, WEB_TOUCH_SHEET_DELAY_MS)
      } else {
        onLongPress()
      }
      return
    }
    dnd?.endDrag(absX, absY)
  }
  const cancel = () => {
    if (dragActive.current) {
      dragActive.current = false
      // eslint-disable-next-line react-hooks/purity -- gesture handler, not render
      lastDragAt.current = Date.now()
    }
    dnd?.cancelDrag()
  }
  const guardedPress = () => {
    if (Date.now() - lastDragAt.current < POST_DRAG_PRESS_GUARD_MS) return
    onPress()
  }
  // Web keeps the Pressable's own long-press for the mouse (a held mouse never moves far enough
  // to start the distance pan) — but a finger's hold has already lifted the card by the time RN's
  // 500ms long-press fires, and that one is delivered through `drop` instead.
  const guardedLongPress = onLongPress
    ? () => {
        if (dragActive.current) return
        onLongPress()
      }
    : undefined

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
        onPress={dnd && !proposal ? guardedPress : onPress}
        // Native long-press is delivered through the pan (see `drop`); web keeps the Pressable's
        // own long-press for the mouse (see guardedLongPress).
        onLongPress={dnd && !proposal && Platform.OS !== 'web' ? undefined : guardedLongPress}
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

  const handlers: DragHandlers = { lift, move, drop, cancel }
  // eslint-disable-next-line react-hooks/refs -- the handlers only touch lastDragAt/webDragRef inside gesture callbacks, not during render
  const pan = Platform.OS === 'web' ? webPan(ticket.id, webDragRef, handlers) : nativePan(ticket.id, handlers)

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
