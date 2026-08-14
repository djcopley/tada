import type { ApiColumn, ApiTicket, ApiWorkspace } from '@tada/shared'
import { useState } from 'react'
import { Button, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { TicketCard } from './TicketCard'

export function ColumnView({
  column,
  workspace,
  width,
  onTicketPress,
  onTicketLongPress,
  onCreateTicket,
  creating,
}: {
  column: ApiColumn & { tickets: ApiTicket[] }
  workspace: ApiWorkspace
  width: number
  onTicketPress: (ticket: ApiTicket) => void
  onTicketLongPress?: (ticket: ApiTicket) => void
  onCreateTicket?: (title: string) => void
  creating?: boolean
}) {
  const [modalVisible, setModalVisible] = useState(false)
  const [title, setTitle] = useState('')

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

  return (
    <View testID={`column-${column.id}`} style={[styles.column, { width }]}>
      <View style={styles.header}>
        <Text style={styles.title}>{column.title}</Text>
        <Text style={styles.count}>{tickets.length}</Text>
      </View>
      <FlatList
        testID={`column-tickets-${column.id}`}
        data={tickets}
        keyExtractor={(t) => String(t.id)}
        renderItem={({ item }) => (
          <TicketCard
            ticket={item}
            workspace={workspace}
            columnKind={column.kind}
            onPress={() => onTicketPress(item)}
            onLongPress={onTicketLongPress ? () => onTicketLongPress(item) : undefined}
          />
        )}
      />
      {column.kind === 'backlog' && (
        <>
          <Pressable testID={`add-ticket-${column.id}`} style={styles.addButton} onPress={openModal}>
            <Text style={styles.addButtonText}>+ Add ticket</Text>
          </Pressable>
          <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={closeModal}>
            <View style={styles.modalOverlay}>
              <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>New ticket</Text>
                <TextInput
                  testID="ticket-title-input"
                  style={styles.input}
                  placeholder="Title"
                  autoFocus
                  value={title}
                  onChangeText={setTitle}
                />
                <View style={styles.modalActions}>
                  <Button testID="ticket-cancel-button" title="Cancel" onPress={closeModal} />
                  <Button
                    testID="ticket-create-button"
                    title="Create"
                    onPress={submit}
                    disabled={creating || title.trim().length === 0}
                  />
                </View>
              </View>
            </View>
          </Modal>
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  column: {
    paddingHorizontal: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
  },
  count: {
    fontSize: 13,
    color: '#666',
  },
  addButton: {
    marginHorizontal: 8,
    marginVertical: 8,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
    backgroundColor: '#e0f0ff',
  },
  addButtonText: {
    color: '#1565c0',
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCard: {
    width: '85%',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 20,
    gap: 12,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#888',
    borderRadius: 6,
    padding: 10,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
})
