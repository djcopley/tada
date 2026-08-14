import type { ApiTicket } from '@tada/shared'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useBoard, useCreateTicket, useWorkspace } from '../../../src/api/queries'
import { useWorkspaceSocket } from '../../../src/api/useWorkspaceSocket'
import { ColumnView } from '../../../src/components/ColumnView'
import { TicketActions } from '../../../src/components/TicketActions'

/**
 * At or above this width there's room to show every column side-by-side
 * without paging (roughly a tablet-in-landscape or web breakpoint). Below
 * it, columns page horizontally one-at-a-time like a phone board view.
 */
const WIDE_BREAKPOINT = 900
const COLUMN_MARGIN = 32

export default function Board() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const wsId = Number(id)
  const router = useRouter()
  const { width } = useWindowDimensions()

  const { data: board, isLoading: boardLoading } = useBoard(wsId)
  const { data: workspace, isLoading: workspaceLoading } = useWorkspace(wsId)
  const createTicket = useCreateTicket()
  const [selectedTicket, setSelectedTicket] = useState<ApiTicket | null>(null)

  useWorkspaceSocket(Number.isNaN(wsId) ? undefined : wsId)

  if (Number.isNaN(wsId)) {
    return (
      <View style={styles.center}>
        <Text>Invalid workspace</Text>
      </View>
    )
  }

  if (boardLoading || workspaceLoading || !board || !workspace) {
    return (
      <View style={styles.center}>
        <Text>Loading…</Text>
      </View>
    )
  }

  const columns = [...board.columns].sort((a, b) => a.position - b.position)
  const isWide = width >= WIDE_BREAKPOINT

  const onTicketPress = (ticket: ApiTicket) => router.push(`/tickets/${ticket.id}`)
  const onTicketLongPress = (ticket: ApiTicket) => setSelectedTicket(ticket)
  const onCreateTicket = (title: string) => {
    void createTicket.mutateAsync({ workspaceId: wsId, title })
  }

  const actionsSheet = selectedTicket && (
    <TicketActions
      ticket={selectedTicket}
      columns={board.columns}
      workspace={workspace}
      visible
      onClose={() => setSelectedTicket(null)}
    />
  )

  const handleMemoryPress = () => router.push(`/workspaces/${wsId}/memory`)
  const handleSettingsPress = () => router.push(`/workspaces/${wsId}/settings`)

  // Replaces the layout's placeholder title now that the name is loaded.
  const screenTitle = <Stack.Screen options={{ title: workspace.name }} />

  if (isWide) {
    const columnWidth = (width - COLUMN_MARGIN) / columns.length
    return (
      <>
        {screenTitle}
        <View style={styles.header}>
          <View style={styles.headerButtons}>
            <Pressable
              testID="board-memory-button"
              onPress={handleMemoryPress}
              style={styles.headerButton}
            >
              <Text style={styles.headerButtonText}>Memory</Text>
            </Pressable>
            <Pressable
              testID="board-settings-button"
              onPress={handleSettingsPress}
              style={styles.headerButton}
            >
              <Text style={styles.headerButtonText}>Settings</Text>
            </Pressable>
          </View>
        </View>
        <View testID="board-wide" style={styles.wideContainer}>
          {columns.map((column) => (
            <ColumnView
              key={column.id}
              column={column}
              workspace={workspace}
              width={columnWidth}
              onTicketPress={onTicketPress}
              onTicketLongPress={onTicketLongPress}
              onCreateTicket={column.kind === 'backlog' ? onCreateTicket : undefined}
              creating={createTicket.isPending}
            />
          ))}
          {actionsSheet}
        </View>
      </>
    )
  }

  const columnWidth = width - COLUMN_MARGIN
  return (
    <>
      {screenTitle}
      <View style={styles.header}>
        <View style={styles.headerButtons}>
          <Pressable
            testID="board-memory-button"
            onPress={handleMemoryPress}
            style={styles.headerButton}
          >
            <Text style={styles.headerButtonText}>Memory</Text>
          </Pressable>
          <Pressable
            testID="board-settings-button"
            onPress={handleSettingsPress}
            style={styles.headerButton}
          >
            <Text style={styles.headerButtonText}>Settings</Text>
          </Pressable>
        </View>
      </View>
      <FlatList
        testID="board-paged"
        horizontal
        pagingEnabled
        data={columns}
        keyExtractor={(c) => String(c.id)}
        renderItem={({ item }) => (
          <ColumnView
            column={item}
            workspace={workspace}
            width={columnWidth}
            onTicketPress={onTicketPress}
            onTicketLongPress={onTicketLongPress}
            onCreateTicket={item.kind === 'backlog' ? onCreateTicket : undefined}
            creating={createTicket.isPending}
          />
        )}
      />
      {actionsSheet}
    </>
  )
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e5e5',
  },
  headerButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  headerButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#f0f0f0',
  },
  headerButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#007AFF',
  },
  wideContainer: {
    flex: 1,
    flexDirection: 'row',
  },
})
