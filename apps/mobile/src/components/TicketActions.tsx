import { canMoveCard } from '@tada/shared'
import type { ApiBoard, ApiTicket, ApiWorkspace } from '@tada/shared'
import { useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { ADAPTERS } from '../adapters'
import { ApiError } from '../api/client'
import { keys, useMoveTicket, usePatchTicket } from '../api/queries'
import { useQueryClient } from '@tanstack/react-query'
import { positionBetween } from '../board/positions'
import { showToast } from '../toast'

const RUN_IN_PROGRESS_TOAST = 'Agent is working on this ticket — wait or cancel the run'

type BoardColumn = ApiBoard['columns'][number]

function sortByPosition(tickets: ApiTicket[]): ApiTicket[] {
  return [...tickets].sort((a, b) => a.position - b.position)
}

function endPosition(column: BoardColumn): number {
  const sorted = sortByPosition(column.tickets)
  const last = sorted[sorted.length - 1]
  return positionBetween(last?.position, undefined)
}

type PickerView = 'main' | 'agent' | 'model'

export function TicketActions({
  ticket,
  columns,
  workspace,
  visible,
  onClose,
}: {
  ticket: ApiTicket
  columns: BoardColumn[]
  workspace: ApiWorkspace
  visible: boolean
  onClose: () => void
}) {
  const [view, setView] = useState<PickerView>('main')
  const qc = useQueryClient()
  const moveTicket = useMoveTicket(workspace.id)
  const patchTicket = usePatchTicket(workspace.id)

  const currentColumn = columns.find((c) => c.id === ticket.columnId)
  const readyColumn = columns.find((c) => c.kind === 'ready')
  const runActive = currentColumn?.kind === 'in_progress'

  const sortedSiblings = currentColumn ? sortByPosition(currentColumn.tickets) : []
  const index = sortedSiblings.findIndex((t) => t.id === ticket.id)
  const canReorderUp = index > 0
  const canReorderDown = index >= 0 && index < sortedSiblings.length - 1

  const currentAdapter = ticket.adapterOverride ?? workspace.defaultAdapter
  const currentModel = ticket.modelOverride ?? workspace.defaultModel

  const close = () => {
    setView('main')
    onClose()
  }

  const handleMutationError = (error: unknown) => {
    if (error instanceof ApiError && error.status === 409) {
      showToast(RUN_IN_PROGRESS_TOAST)
      void qc.invalidateQueries({ queryKey: keys.board(workspace.id) })
    }
  }

  const sendToReady = () => {
    if (!readyColumn) return
    moveTicket.mutate(
      { id: ticket.id, to: { columnId: readyColumn.id, position: endPosition(readyColumn) } },
      { onSuccess: close, onError: handleMutationError },
    )
  }

  const moveTo = (column: BoardColumn) => {
    moveTicket.mutate(
      { id: ticket.id, to: { columnId: column.id, position: endPosition(column) } },
      { onSuccess: close, onError: handleMutationError },
    )
  }

  const reorderUp = () => {
    if (!canReorderUp) return
    const prev = sortedSiblings[index - 1]
    if (!prev) return
    const prevPrev = sortedSiblings[index - 2]
    const position = positionBetween(prevPrev?.position, prev.position)
    patchTicket.mutate(
      { id: ticket.id, patch: { position } },
      { onSuccess: close, onError: handleMutationError },
    )
  }

  const reorderDown = () => {
    if (!canReorderDown) return
    const next = sortedSiblings[index + 1]
    if (!next) return
    const nextNext = sortedSiblings[index + 2]
    const position = positionBetween(next.position, nextNext?.position)
    patchTicket.mutate(
      { id: ticket.id, patch: { position } },
      { onSuccess: close, onError: handleMutationError },
    )
  }

  const chooseAdapter = (adapter: string) => {
    patchTicket.mutate(
      { id: ticket.id, patch: { adapterOverride: adapter } },
      { onSuccess: () => setView('main'), onError: handleMutationError },
    )
  }

  const chooseModel = (model: string) => {
    patchTicket.mutate(
      { id: ticket.id, patch: { modelOverride: model } },
      { onSuccess: () => setView('main'), onError: handleMutationError },
    )
  }

  const moveTargets = columns.filter(
    (c) => c.id !== ticket.columnId && currentColumn && canMoveCard('human', currentColumn.kind, c.kind),
  )

  return (
    <Modal
      testID="ticket-actions-sheet"
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={close}
    >
      <Pressable style={styles.overlay} onPress={close}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Text style={styles.title}>{ticket.title}</Text>

          {view === 'main' && (
            <View style={styles.section}>
              {ticket.queueState !== 'queued' && readyColumn && (
                <Pressable testID="action-send-to-ready" style={styles.row} onPress={sendToReady}>
                  <Text style={styles.rowText}>Send to Ready</Text>
                </Pressable>
              )}

              {moveTargets.map((c) => (
                <Pressable
                  key={c.id}
                  testID={`action-move-${c.id}`}
                  style={styles.row}
                  onPress={() => moveTo(c)}
                >
                  <Text style={styles.rowText}>{`Move to ${c.title}`}</Text>
                </Pressable>
              ))}

              <View style={styles.reorderRow}>
                <Pressable
                  testID="action-reorder-up"
                  style={[styles.reorderButton, !canReorderUp && styles.disabled]}
                  disabled={!canReorderUp}
                  onPress={reorderUp}
                >
                  <Text style={styles.rowText}>▲ Move up</Text>
                </Pressable>
                <Pressable
                  testID="action-reorder-down"
                  style={[styles.reorderButton, !canReorderDown && styles.disabled]}
                  disabled={!canReorderDown}
                  onPress={reorderDown}
                >
                  <Text style={styles.rowText}>▼ Move down</Text>
                </Pressable>
              </View>

              {runActive ? (
                <View style={styles.row}>
                  <Text style={styles.rowText}>{`Agent: ${currentAdapter} · ${currentModel}`}</Text>
                  <Text testID="action-agent-hint" style={styles.hint}>
                    Run in progress — cancel it to change the agent or model.
                  </Text>
                </View>
              ) : (
                <>
                  <Pressable testID="action-agent" style={styles.row} onPress={() => setView('agent')}>
                    <Text style={styles.rowText}>{`Agent: ${currentAdapter}`}</Text>
                  </Pressable>
                  <Pressable testID="action-model" style={styles.row} onPress={() => setView('model')}>
                    <Text style={styles.rowText}>{`Model: ${currentModel}`}</Text>
                  </Pressable>
                </>
              )}

              <Pressable testID="action-close" style={styles.row} onPress={close}>
                <Text style={styles.rowText}>Close</Text>
              </Pressable>
            </View>
          )}

          {view === 'agent' && (
            <View style={styles.section}>
              {Object.keys(ADAPTERS).map((adapter) => (
                <Pressable
                  key={adapter}
                  testID={`action-agent-${adapter}`}
                  style={styles.row}
                  onPress={() => chooseAdapter(adapter)}
                >
                  <Text style={styles.rowText}>{adapter}</Text>
                </Pressable>
              ))}
              <Pressable testID="action-back" style={styles.row} onPress={() => setView('main')}>
                <Text style={styles.rowText}>Back</Text>
              </Pressable>
            </View>
          )}

          {view === 'model' && (
            <View style={styles.section}>
              {(ADAPTERS[currentAdapter] ?? []).map((model) => (
                <Pressable
                  key={model}
                  testID={`action-model-${model}`}
                  style={styles.row}
                  onPress={() => chooseModel(model)}
                >
                  <Text style={styles.rowText}>{model}</Text>
                </Pressable>
              ))}
              <Pressable testID="action-back" style={styles.row} onPress={() => setView('main')}>
                <Text style={styles.rowText}>Back</Text>
              </Pressable>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    padding: 20,
    gap: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 8,
  },
  section: {
    gap: 4,
  },
  row: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  rowText: {
    fontSize: 15,
  },
  hint: {
    fontSize: 12,
    color: '#888',
    marginTop: 4,
  },
  reorderRow: {
    flexDirection: 'row',
    gap: 12,
  },
  reorderButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    borderRadius: 6,
  },
  disabled: {
    opacity: 0.4,
  },
})
