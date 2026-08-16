import type { ApiColumn, ApiTicket, ApiWorkspaceDetail, ColumnKind } from '@tada/shared'
import { Fragment, useEffect, useRef, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { useBoardDnD } from '../board/dnd'
import { useTheme } from '../design/ThemeContext'
import { radius, space, type } from '../design/tokens'
import type { BoardCardActions, TicketDetail } from './TicketCard'
import { TicketCard } from './TicketCard'
import { Button } from './ui/Button'
import { NewTicketDialog } from './NewTicketDialog'

/** 8px status dot in a column header — pulses while `pulse` is true (Running only; In review's
 * dot is a static "ok" marker per the artboard). */
function HeaderDot({ color, pulse, testID }: { color: string; pulse: boolean; testID?: string }) {
  const reducedMotion = useReducedMotion()
  const opacity = useSharedValue(1)
  const live = pulse && !reducedMotion

  useEffect(() => {
    if (live) {
      opacity.value = withRepeat(withSequence(withTiming(0.25, { duration: 700 }), withTiming(1, { duration: 700 })), -1)
    } else {
      cancelAnimation(opacity)
      opacity.value = 1
    }
    return () => cancelAnimation(opacity)
  }, [live, opacity])

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }))
  return <Animated.View testID={testID} style={[styles.headerDot, { backgroundColor: color }, style]} />
}

export function ColumnView({
  column,
  workspace,
  width,
  now,
  detailById,
  parentTitleById,
  topQueuedId,
  actionsFor,
  onTicketPress,
  onTicketLongPress,
  onCreateTicket,
  creating,
  /** Insertion slot to highlight while a card is dragged over this column. */
  dropIndex,
}: {
  column: ApiColumn & { tickets: ApiTicket[] }
  workspace: ApiWorkspaceDetail
  width: number
  /** Ticking clock for elapsed/age labels — see `useNowTick`. */
  now: number
  detailById: Map<number, TicketDetail | undefined>
  parentTitleById: Map<number, string>
  /** The first queued ticket in Queued — reads "next up" instead of its age. */
  topQueuedId?: number
  actionsFor: (ticket: ApiTicket, columnKind: ColumnKind) => BoardCardActions | undefined
  onTicketPress: (ticket: ApiTicket) => void
  onTicketLongPress?: (ticket: ApiTicket) => void
  onCreateTicket?: (fields: { title: string; description: string }) => void
  creating?: boolean
  dropIndex?: number | null
}) {
  const { colors } = useTheme()
  const dnd = useBoardDnD()
  const laneRef = useRef<View>(null)

  const [modalVisible, setModalVisible] = useState(false)

  useEffect(() => {
    if (!dnd || !laneRef.current) return
    return dnd.registerColumn(column.id, column.kind, laneRef.current)
  }, [dnd, column.id, column.kind])

  const tickets = [...column.tickets].sort((a, b) => a.position - b.position)

  const openModal = () => setModalVisible(true)
  const closeModal = () => setModalVisible(false)
  const submit = (fields: { title: string; description: string }) => {
    onCreateTicket?.(fields)
    setModalVisible(false)
  }

  const hovering = dropIndex !== null && dropIndex !== undefined

  // Running and in-review columns carry their signal color in the header; Running's dot pulses,
  // In review's is a static "ok" marker — only a live run gets the animation.
  const headerColor =
    column.kind === 'in_progress'
      ? colors.liveText
      : column.kind === 'in_review'
        ? colors.okText
        : colors.textFaintSolid
  const indicator = <View style={[styles.indicator, { backgroundColor: colors.live }]} />

  return (
    <View
      testID={`column-${column.id}`}
      style={[styles.column, { width }, column.kind === 'done' && styles.doneOpacity]}
    >
      <View
        ref={laneRef}
        collapsable={false}
        style={[
          styles.lane,
          hovering && { borderColor: colors.borderStrong, borderWidth: 1, borderStyle: 'dashed' },
        ]}
      >
        <View style={styles.header}>
          {/* Orange means live: the dot only shows (and pulses) while something is actually here. */}
          {column.kind === 'in_progress' && tickets.length > 0 ? (
            <HeaderDot testID={`header-dot-${column.id}`} color={headerColor} pulse />
          ) : column.kind === 'in_review' && tickets.length > 0 ? (
            <HeaderDot testID={`header-dot-${column.id}`} color={headerColor} pulse={false} />
          ) : null}
          <Text style={[type.monoCaps, styles.upper, { color: headerColor }]}>{column.title}</Text>
          <Text testID={`column-count-${column.id}`} style={[type.monoCaps, { color: colors.textFaintSolid }]}>
            {tickets.length}
          </Text>
        </View>
        <ScrollView
          testID={`column-tickets-${column.id}`}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          {tickets.length === 0 && !hovering ? (
            <Text style={[type.caption, styles.emptyHint, { color: colors.textFaintSolid }]}>
              {column.kind === 'backlog' ? 'Add a ticket to get started' : 'Nothing here'}
            </Text>
          ) : null}
          {tickets.map((ticket, index) => (
            <Fragment key={ticket.id}>
              {hovering && dropIndex === index ? indicator : null}
              <TicketCard
                ticket={ticket}
                workspace={workspace}
                columnKind={column.kind}
                now={now}
                detail={detailById.get(ticket.id)}
                isTopQueued={ticket.id === topQueuedId}
                parentTitle={
                  ticket.followUpOfTicketId !== null ? parentTitleById.get(ticket.followUpOfTicketId) : undefined
                }
                actions={actionsFor(ticket, column.kind)}
                onPress={() => onTicketPress(ticket)}
                onLongPress={onTicketLongPress ? () => onTicketLongPress(ticket) : undefined}
              />
            </Fragment>
          ))}
          {hovering && dropIndex === tickets.length ? indicator : null}
        </ScrollView>
        {column.kind === 'backlog' && (
          <Button
            testID={`add-ticket-${column.id}`}
            variant="ghost"
            icon="plus"
            label="Add a ticket"
            onPress={openModal}
            small
            style={styles.addButton}
          />
        )}
      </View>

      {column.kind === 'backlog' && (
        <NewTicketDialog visible={modalVisible} onClose={closeModal} onCreate={submit} pending={creating} />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  column: {
    padding: space.sm,
  },
  doneOpacity: {
    opacity: 0.68,
  },
  lane: {
    flex: 1,
    borderRadius: radius.card,
    padding: space.sm,
  },
  upper: {
    textTransform: 'uppercase',
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
  },
  headerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: space.sm,
  },
  emptyHint: {
    textAlign: 'center',
    paddingVertical: space.xxl,
  },
  indicator: {
    height: 2,
    borderRadius: 1,
    marginVertical: 2,
    marginHorizontal: space.xs,
  },
  addButton: {
    marginTop: space.sm,
  },
})
