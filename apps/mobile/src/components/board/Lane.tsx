import type { ApiTicket, ColumnKind } from '@tada/shared'
import { Fragment, useEffect, useRef } from 'react'
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
import { LANE_TITLES, laneCount } from '../../board/cardMeta'
import { useBoardDnD } from '../../board/dnd'
import { useTheme } from '../../design/ThemeContext'
import { radius, space, type } from '../../design/tokens'
import { Button } from '../ui/Button'
import { type BoardCardActions, type ContextMenuAnchor, TicketCard } from './TicketCard'

/** 8px status dot in a lane header — pulses while `pulse` is true (Running); Stopped on you's is
 * a static live marker: the run is alive, waiting on you. */
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

export function Lane({
  kind,
  tickets,
  width,
  now,
  liveTextByRun,
  parentTitleById,
  topQueuedId,
  actionsFor,
  onTicketPress,
  onTicketLongPress,
  onTicketContextMenu,
  onAddTicket,
  dropIndex,
}: {
  kind: ColumnKind
  /** Already sorted by position. */
  tickets: ApiTicket[]
  width: number
  /** Ticking clock for elapsed/age labels — see `useNowTick`. */
  now: number
  liveTextByRun: Map<number, string | undefined>
  parentTitleById: Map<number, string>
  /** The first queued ticket in Queued — reads "next up" instead of its age. */
  topQueuedId?: number
  actionsFor: (ticket: ApiTicket, lane: ColumnKind) => BoardCardActions | undefined
  onTicketPress: (ticket: ApiTicket) => void
  onTicketLongPress?: (ticket: ApiTicket) => void
  onTicketContextMenu?: (ticket: ApiTicket, anchor: ContextMenuAnchor) => void
  /** Backlog only: "+ Add a ticket". */
  onAddTicket?: () => void
  /** Insertion slot to highlight while a card is dragged over this lane. */
  dropIndex?: number | null
}) {
  const { colors } = useTheme()
  const dnd = useBoardDnD()
  const laneRef = useRef<View>(null)

  useEffect(() => {
    if (!dnd || !laneRef.current) return
    return dnd.registerLane(kind, laneRef.current)
  }, [dnd, kind])

  const hovering = dropIndex !== null && dropIndex !== undefined
  // Running and Stopped carry the live color in the header: an agent is alive there. Only a
  // working agent's dot pulses.
  const live = kind === 'running' || kind === 'stopped'
  const headerColor = live ? colors.liveText : colors.textFaintSolid
  const indicator = <View style={[styles.indicator, { backgroundColor: colors.live }]} />

  return (
    <View testID={`lane-${kind}`} style={[styles.column, { width }, kind === 'done' && styles.doneOpacity]}>
      <View
        ref={laneRef}
        collapsable={false}
        style={[styles.lane, hovering && { borderColor: colors.borderStrong, borderWidth: 1, borderStyle: 'dashed' }]}
      >
        <View style={styles.header}>
          {live && tickets.length > 0 ? <HeaderDot testID={`header-dot-${kind}`} color={colors.live} pulse={kind === 'running'} /> : null}
          <Text style={[type.monoCaps, styles.upper, { color: headerColor }]}>{LANE_TITLES[kind]}</Text>
          <Text testID={`lane-count-${kind}`} style={[type.monoCaps, { color: colors.textFaintSolid }]}>
            {laneCount(kind, tickets.length)}
          </Text>
        </View>
        <ScrollView
          testID={`lane-tickets-${kind}`}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          {tickets.map((ticket, index) => (
            <Fragment key={ticket.id}>
              {hovering && dropIndex === index ? indicator : null}
              <TicketCard
                ticket={ticket}
                lane={kind}
                now={now}
                liveText={ticket.run ? liveTextByRun.get(ticket.run.id) : undefined}
                isTopQueued={ticket.id === topQueuedId}
                parentTitle={ticket.followUpOfTicketId !== null ? parentTitleById.get(ticket.followUpOfTicketId) : undefined}
                actions={actionsFor(ticket, kind)}
                onPress={() => onTicketPress(ticket)}
                onLongPress={onTicketLongPress ? () => onTicketLongPress(ticket) : undefined}
                onContextMenu={onTicketContextMenu ? (anchor) => onTicketContextMenu(ticket, anchor) : undefined}
              />
            </Fragment>
          ))}
          {hovering && dropIndex === tickets.length ? indicator : null}
        </ScrollView>
        {onAddTicket ? (
          <Button testID="add-ticket-backlog" variant="ghost" icon="plus" label="Add a ticket" onPress={onAddTicket} small style={styles.addButton} />
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  column: { padding: space.sm },
  doneOpacity: { opacity: 0.68 },
  lane: { flex: 1, borderRadius: radius.card, padding: space.sm },
  upper: { textTransform: 'uppercase' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
  },
  headerDot: { width: 8, height: 8, borderRadius: 4 },
  list: { flex: 1 },
  listContent: { paddingBottom: space.sm },
  indicator: { height: 2, borderRadius: 1, marginVertical: 2, marginHorizontal: space.xs },
  addButton: { marginTop: space.sm },
})
