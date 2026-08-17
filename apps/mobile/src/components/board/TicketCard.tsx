import type { ApiTicket, ColumnKind } from '@tada/shared'
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
import {
  doneMeta,
  followUpOfLabel,
  isProposalTicket,
  minimalMeta,
  nextUpMeta,
  repoLabel,
  stoppedBadge,
  stoppedWell,
} from '../../board/cardMeta'
import { measureInWindow, useBoardDnD } from '../../board/dnd'
import { elapsedLabel } from '../../control'
import { useTheme } from '../../design/ThemeContext'
import { radius, space, type } from '../../design/tokens'
import { HoldActions } from '../gate/HoldActions'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'

/** Per-card callbacks the board supplies for the actions a lane exposes. Omitting a handler
 * hides that control (the drag-overlay preview passes no `actions` at all). */
export type BoardCardActions = {
  onWatchLive?: () => void
  onKeep?: () => void
  onDismiss?: () => void
  keeping?: boolean
  dismissing?: boolean
  /** Render the stopped card's HoldActions (compact). Off for the overlay clone. */
  holdActions?: boolean
}

type BodyProps = {
  ticket: ApiTicket
  lane: ColumnKind
  /** Ticking clock for elapsed/age labels — see `useNowTick`. */
  now: number
  /** The latest narrated event of a running ticket's run (see useLatestRunEvents). */
  liveText?: string
  /** The first queued ticket in Queued reads "next up" instead of its age. */
  isTopQueued?: boolean
  /** Resolved title of `followUpOfTicketId`, when that parent is on this board. */
  parentTitle?: string
  actions?: BoardCardActions
}

/** A pulsing `▮` — the one glyph that pulses inside running-card mono meta (`ii-pulse`). */
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

/** Recessed one-line agent well: mono on agent ink, ellipsized. */
function AgentWell({
  glyph,
  text,
  live,
  testID,
}: {
  glyph?: 'pulse' | string
  text: string
  live: boolean
  testID?: string
}) {
  const { colors } = useTheme()
  const color = live ? colors.liveText : colors.agentText
  return (
    <View testID={testID} style={[styles.well, { backgroundColor: colors.agentSurface, borderColor: colors.agentSurfaceEdge }]}>
      <Text numberOfLines={1} style={[type.monoSmall, { color }]}>
        {glyph === 'pulse' ? <PulseGlyph color={colors.liveText} /> : glyph}
        {glyph ? ' ' : ''}
        {text}
      </Text>
    </View>
  )
}

function Title({ title }: { title: string }) {
  const { colors } = useTheme()
  return (
    <Text numberOfLines={2} style={[type.bodyStrong, styles.title, { color: colors.text }]}>
      {title}
    </Text>
  )
}

function Meta({ children, testID }: { children: string; testID?: string }) {
  const { colors } = useTheme()
  return (
    <Text testID={testID} numberOfLines={1} style={[type.monoSmall, { color: colors.textFaintSolid }]}>
      {children}
    </Text>
  )
}

function ProposalBody({ ticket, parentTitle, actions }: { ticket: ApiTicket; parentTitle?: string; actions?: BoardCardActions }) {
  const { colors } = useTheme()
  const followUp = followUpOfLabel(parentTitle)
  return (
    <View style={styles.body}>
      <Text style={[type.monoCaps, styles.upper, { color: colors.liveText }]}>Proposed by agent</Text>
      <Title title={ticket.title} />
      <Meta>{followUp ? `${repoLabel(ticket)} · ${followUp}` : repoLabel(ticket)}</Meta>
      {actions?.onKeep ? (
        <View style={styles.actionRow}>
          <Button testID={`proposal-keep-${ticket.id}`} variant="secondary" small label="Keep" loading={actions.keeping} onPress={actions.onKeep} />
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

function RunningBody({ ticket, now, liveText, actions }: BodyProps) {
  const { colors } = useTheme()
  const run = ticket.run
  return (
    <View style={styles.body}>
      <Title title={ticket.title} />
      <Text numberOfLines={1} style={[type.monoSmall, { color: colors.textFaintSolid }]}>
        {`${repoLabel(ticket)} · `}
        <Text style={{ color: colors.liveText }}>{elapsedLabel(run?.startedAt, now)}</Text>
      </Text>
      <AgentWell glyph="pulse" text={liveText ?? 'working…'} live testID={`ticket-agent-well-${ticket.id}`} />
      {actions?.onWatchLive ? (
        <Button testID={`watch-live-${ticket.id}`} variant="ghost" small label="Watch live" onPress={actions.onWatchLive} style={styles.selfStart} />
      ) : null}
    </View>
  )
}

function StoppedBody({ ticket, now, actions }: BodyProps) {
  const run = ticket.run
  const badge = stoppedBadge(run)
  const well = stoppedWell(run, now)
  return (
    <View style={styles.body}>
      {badge ? (
        <View style={styles.metaRow}>
          <Badge status={badge.failed ? 'failed' : 'live'} label={badge.label} testID={`stopped-badge-${ticket.id}`} />
        </View>
      ) : null}
      <Title title={ticket.title} />
      {well ? <AgentWell glyph={well.glyph} text={well.text} live={well.live} testID={`ticket-agent-well-${ticket.id}`} /> : null}
      {actions?.holdActions && run ? <HoldActions run={run} ticketId={ticket.id} compact testID={`hold-actions-${ticket.id}`} /> : null}
    </View>
  )
}

/** Dispatches to the right card body for a ticket's origin/lane — used both by the live
 * `TicketCard` and, unadorned (no `actions`), as the floating drag-overlay clone. */
export function TicketCardBody(props: BodyProps) {
  const { ticket, lane, now, isTopQueued, parentTitle, actions } = props
  if (isProposalTicket(ticket)) return <ProposalBody ticket={ticket} parentTitle={parentTitle} actions={actions} />
  if (lane === 'running') return <RunningBody {...props} />
  if (lane === 'stopped') return <StoppedBody {...props} />
  const meta = lane === 'done' ? doneMeta(ticket, now) : isTopQueued ? nextUpMeta(ticket) : minimalMeta(ticket, now)
  return (
    <View style={styles.body}>
      <Title title={ticket.title} />
      <Meta testID={`ticket-meta-${ticket.id}`}>{meta}</Meta>
    </View>
  )
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
  return Gesture.Pan()
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
}

/** Web: while a card is lifted, swallow touchmove's default so the browser can't turn the drag
 * into a page/column scroll (the detector allows panning so that ordinary swipes on cards still
 * scroll — see the GestureDetector's touchAction). Non-passive by necessity. */
const preventTouchScroll = (e: Event) => e.preventDefault()
let webScrollBlocked = false
function blockWebScroll(on: boolean): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined' || on === webScrollBlocked) return
  webScrollBlocked = on
  if (on) document.addEventListener('touchmove', preventTouchScroll, { passive: false })
  else document.removeEventListener('touchmove', preventTouchScroll)
}

type WebDragState = { x: number; y: number; holdTimer: ReturnType<typeof setTimeout> | null }

/** Web: activation depends on the pointer. A mouse "click and drag" moves at once, so it
 * activates on distance (a long-press timer would fail the gesture the moment the pointer moved);
 * a finger on a touchscreen has to hold first, exactly like native, or the lanes' own touch
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

export type ContextMenuAnchor = { x: number; y: number }

export function TicketCard({
  ticket,
  lane,
  now,
  liveText,
  isTopQueued,
  parentTitle,
  actions,
  onPress,
  onLongPress,
  onContextMenu,
}: BodyProps & {
  onPress: () => void
  /** Mobile long press → the actions sheet. */
  onLongPress?: () => void
  /** Web right-click → the context menu, anchored at the pointer. */
  onContextMenu?: (anchor: ContextMenuAnchor) => void
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
    return dnd.registerCard(lane, ticket.id, cardRef.current)
  }, [dnd, lane, ticket.id])

  const lift = async (absX: number, absY: number) => {
    if (!dnd || !cardRef.current) return
    dragActive.current = true
    blockWebScroll(true)
    // eslint-disable-next-line react-hooks/purity -- gesture handler, not render
    lastDragAt.current = Date.now()
    const rect = await measureInWindow(cardRef.current)
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    dnd.beginDrag({ ticket, from: lane, width: rect.width, height: rect.height }, rect)
    dnd.moveDrag(absX, absY)
  }

  const move = (absX: number, absY: number) => dnd?.moveDrag(absX, absY)
  const drop = (absX: number, absY: number, travelled: number) => {
    dragActive.current = false
    blockWebScroll(false)
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
    blockWebScroll(false)
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

  // Proposal cards render Keep/Dismiss, running cards Watch live, stopped cards their hold
  // actions — in every other case the body has no interactive children, so the card itself can
  // safely be a real `<button>`.
  const hasNestedButtons =
    Boolean(actions) &&
    (proposal || (lane === 'running' && Boolean(actions?.onWatchLive)) || (lane === 'stopped' && Boolean(actions?.holdActions)))

  // Right-click on web: RN-web forwards unknown DOM handlers, so `onContextMenu` reaches the
  // element even though RN's types don't know it.
  const webProps =
    Platform.OS === 'web' && onContextMenu
      ? {
          onContextMenu: (e: { preventDefault: () => void; clientX: number; clientY: number }) => {
            e.preventDefault()
            onContextMenu({ x: e.clientX, y: e.clientY })
          },
        }
      : {}

  const card = (
    <View ref={cardRef} collapsable={false} style={dragging && styles.liftedSource} {...webProps}>
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
          lane={lane}
          now={now}
          liveText={liveText}
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

  // Web: RNGH's default `touch-action: none` on the detector would stop the browser scrolling
  // when a finger lands on a card — i.e. on mobile web you could not swipe the board or scroll a
  // lane from most of its area. Let the browser pan; while a drag is actually lifted, `lift`
  // blocks touchmove's default so the drag isn't hijacked into a scroll (see blockWebScroll).
  return (
    <GestureDetector gesture={pan} touchAction="manipulation">
      {card}
    </GestureDetector>
  )
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
