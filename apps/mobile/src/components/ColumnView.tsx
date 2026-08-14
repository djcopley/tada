import type { ApiColumn, ApiTicket, ApiWorkspace } from '@tada/shared'
import { Fragment, useEffect, useRef, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useBoardDnD } from '../board/dnd'
import { useTheme } from '../design/ThemeContext'
import { radius, space, type } from '../design/tokens'
import { TicketCard } from './TicketCard'
import { Button } from './ui/Button'
import { Dialog } from './ui/Dialog'
import { Input } from './ui/Input'

export function ColumnView({
  column,
  workspace,
  width,
  onTicketPress,
  onTicketLongPress,
  onCreateTicket,
  creating,
  /** Insertion slot to highlight while a card is dragged over this column. */
  dropIndex,
}: {
  column: ApiColumn & { tickets: ApiTicket[] }
  workspace: ApiWorkspace
  width: number
  onTicketPress: (ticket: ApiTicket) => void
  onTicketLongPress?: (ticket: ApiTicket) => void
  onCreateTicket?: (title: string) => void
  creating?: boolean
  dropIndex?: number | null
}) {
  const { colors } = useTheme()
  const dnd = useBoardDnD()
  const laneRef = useRef<View>(null)

  const [modalVisible, setModalVisible] = useState(false)
  const [title, setTitle] = useState('')

  useEffect(() => {
    if (!dnd || !laneRef.current) return
    return dnd.registerColumn(column.id, column.kind, laneRef.current)
  }, [dnd, column.id, column.kind])

  const tickets = [...column.tickets].sort((a, b) => a.position - b.position)

  const openModal = () => {
    setTitle('')
    setModalVisible(true)
  }
  const closeModal = () => setModalVisible(false)
  const submit = () => {
    const trimmed = title.trim()
    if (!trimmed) return
    onCreateTicket?.(trimmed)
    setModalVisible(false)
  }

  const hovering = dropIndex !== null && dropIndex !== undefined

  // Running and in-review columns carry their signal color in the header.
  const headerColor =
    column.kind === 'in_progress'
      ? colors.liveText
      : column.kind === 'in_review'
        ? colors.okText
        : colors.textFaintSolid
  const indicator = <View style={[styles.indicator, { backgroundColor: colors.live }]} />

  return (
    <View testID={`column-${column.id}`} style={[styles.column, { width }]}>
      <View
        ref={laneRef}
        collapsable={false}
        style={[
          styles.lane,
          hovering && { borderColor: colors.borderStrong, borderWidth: 1, borderStyle: 'dashed' },
        ]}
      >
        <View style={styles.header}>
          {column.kind === 'in_progress' || column.kind === 'in_review' ? (
            <View style={[styles.headerDot, { backgroundColor: headerColor }]} />
          ) : null}
          <Text style={[type.monoCaps, styles.upper, { color: headerColor }]}>{column.title}</Text>
          <Text style={[type.monoCaps, { color: colors.textFaintSolid }]}>{tickets.length}</Text>
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
        <Dialog
          visible={modalVisible}
          title="New ticket"
          onClose={closeModal}
          confirm={{
            label: 'Create',
            onPress: submit,
            disabled: creating || title.trim().length === 0,
            testID: 'ticket-create-button',
          }}
        >
          <Input
            testID="ticket-title-input"
            placeholder="What should the agent do?"
            autoFocus
            value={title}
            onChangeText={setTitle}
          />
        </Dialog>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  column: {
    padding: space.sm,
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
    width: 7,
    height: 7,
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
