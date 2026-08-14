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
  const indicator = (
    <View style={[styles.indicator, { backgroundColor: colors.ink }]} />
  )

  return (
    <View testID={`column-${column.id}`} style={[styles.column, { width }]}>
      <View
        ref={laneRef}
        collapsable={false}
        style={[
          styles.lane,
          { backgroundColor: colors.surfaceAlt },
          hovering && { borderColor: colors.ink, borderWidth: 1 },
        ]}
      >
        <View style={styles.header}>
          <Text style={[type.monoSmall, styles.upper, { color: colors.inkMuted }]}>{column.title}</Text>
          <Text style={[type.monoSmall, { color: colors.inkFaint }]}>{tickets.length}</Text>
        </View>
        <ScrollView
          testID={`column-tickets-${column.id}`}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          {tickets.length === 0 && !hovering ? (
            <Text style={[type.caption, styles.emptyHint, { color: colors.inkFaint }]}>
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
            label="Add ticket"
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
    borderRadius: radius.lg,
    padding: space.sm,
  },
  upper: {
    textTransform: 'uppercase',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
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
