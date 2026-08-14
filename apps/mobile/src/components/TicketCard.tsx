import type { ApiTicket, ApiWorkspace, ColumnKind } from '@tada/shared'
import * as Haptics from 'expo-haptics'
import { useEffect, useRef } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { runOnJS } from 'react-native-reanimated'
import { measureInWindow, useBoardDnD } from '../board/dnd'
import { useTheme } from '../design/ThemeContext'
import { queueStateVisual, humanize, type StatusVisual } from '../design/status'
import { space, type } from '../design/tokens'
import { Card } from './ui/Card'
import { StatusTag } from './ui/StatusTag'

/**
 * Status precedence: an explicit queueState (queued/held) always wins over
 * the column-derived hint, since it reflects the ticket's own state rather
 * than a guess based on where it currently sits.
 */
function ticketStatus(ticket: ApiTicket, columnKind: ColumnKind): StatusVisual | null {
  const fromQueue = queueStateVisual(ticket.queueState)
  if (fromQueue) return fromQueue
  if (columnKind === 'in_progress') return { label: 'Live', signal: 'live', live: true }
  if (columnKind === 'in_review') return { label: 'Your turn', signal: 'ok' }
  return null
}

export function TicketCardBody({
  ticket,
  workspace,
  columnKind,
}: {
  ticket: ApiTicket
  workspace: ApiWorkspace
  columnKind: ColumnKind
}) {
  const { colors } = useTheme()
  const adapter = ticket.adapterOverride ?? workspace.defaultAdapter
  const model = ticket.modelOverride ?? workspace.defaultModel
  const status = ticketStatus(ticket, columnKind)

  return (
    <View style={styles.body}>
      <Text numberOfLines={2} style={[type.bodyStrong, styles.title, { color: colors.text }]}>
        {ticket.title}
      </Text>
      <View style={styles.metaRow}>
        <Text numberOfLines={1} style={[type.monoSmall, styles.agent, { color: colors.textFaintSolid }]}>
          {`#${ticket.id} · ${humanize(adapter).toLowerCase()} · ${humanize(model).toLowerCase()}`}
        </Text>
        {status ? (
          <View testID={`ticket-glyph-${ticket.id}`}>
            <StatusTag status={status} />
          </View>
        ) : null}
      </View>
    </View>
  )
}

/** Drag activates after a short hold; a plain tap still opens the ticket. */
const DRAG_HOLD_MS = 220

export function TicketCard({
  ticket,
  workspace,
  columnKind,
  onPress,
  onLongPress,
}: {
  ticket: ApiTicket
  workspace: ApiWorkspace
  columnKind: ColumnKind
  onPress: () => void
  onLongPress?: () => void
}) {
  const dnd = useBoardDnD()
  const cardRef = useRef<View>(null)

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

  const card = (
    <View ref={cardRef} collapsable={false} style={dragging && styles.liftedSource}>
      <Card
        testID={`ticket-card-${ticket.id}`}
        onPress={onPress}
        onLongPress={onLongPress}
        style={styles.card}
      >
        <TicketCardBody ticket={ticket} workspace={workspace} columnKind={columnKind} />
      </Card>
    </View>
  )

  if (!dnd) return card

  const pan = Gesture.Pan()
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
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  agent: {
    flexShrink: 1,
  },
})
