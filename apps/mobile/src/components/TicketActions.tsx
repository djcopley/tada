import { canMoveCard } from '@tada/shared'
import type { ApiBoard, ApiTicket, ApiWorkspace } from '@tada/shared'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../api/client'
import { keys, useAdapters, useMoveTicket, usePatchTicket } from '../api/queries'
import { positionBetween } from '../board/positions'
import { useTheme } from '../design/ThemeContext'
import { humanize } from '../design/status'
import { space, type } from '../design/tokens'
import { showToast } from '../toast'
import { Button } from './ui/Button'
import { Icon } from './ui/Icon'
import { ListRow } from './ui/ListRow'
import { Sheet } from './ui/Sheet'

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
  const { colors } = useTheme()
  const qc = useQueryClient()
  const moveTicket = useMoveTicket(workspace.id)
  const patchTicket = usePatchTicket(workspace.id)
  const { data: adapters } = useAdapters()
  const modelsForAdapter = (adapterId: string) =>
    adapters?.find((a) => a.id === adapterId)?.models ?? []

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
    // A model belongs to a harness: switching the harness re-points the model override at the
    // new harness's first model (as Settings does), so the pair never becomes claude + fake-1.
    const firstModel = modelsForAdapter(adapter)[0]
    patchTicket.mutate(
      { id: ticket.id, patch: { adapterOverride: adapter, ...(firstModel ? { modelOverride: firstModel } : {}) } },
      { onSuccess: () => setView('main'), onError: handleMutationError },
    )
  }

  const chooseModel = (model: string) => {
    patchTicket.mutate(
      { id: ticket.id, patch: { modelOverride: model } },
      { onSuccess: () => setView('main'), onError: handleMutationError },
    )
  }

  // The Ready column is covered by the dedicated "Send to Ready" row above, and nothing can be
  // moved while an agent holds the ticket (the server would 409 anyway) — the locked agent row
  // below already explains why.
  const moveTargets = runActive
    ? []
    : columns.filter(
        (c) =>
          c.id !== ticket.columnId &&
          c.kind !== 'ready' &&
          currentColumn &&
          canMoveCard('human', currentColumn.kind, c.kind),
      )

  return (
    <Sheet visible={visible} onClose={close} testID="ticket-actions-sheet">
      <View style={styles.titleBlock}>
        <Text numberOfLines={2} style={[type.title, { color: colors.text }]}>
          {ticket.title}
        </Text>
        <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>{`#${ticket.id}`}</Text>
      </View>

      {view === 'main' && (
        <View style={styles.section}>
          {ticket.queueState !== 'queued' && !runActive && readyColumn && (
            <ListRow
              testID="action-send-to-ready"
              icon="send"
              title="Send to Ready"
              subtitle="Queue this ticket for an agent"
              onPress={sendToReady}
            />
          )}

          {moveTargets.map((c) => (
            <ListRow
              key={c.id}
              testID={`action-move-${c.id}`}
              icon="arrow-right"
              title={`Move to ${c.title}`}
              onPress={() => moveTo(c)}
            />
          ))}

          <View style={styles.reorderRow}>
            <Button
              testID="action-reorder-up"
              variant="secondary"
              icon="arrow-up"
              label="Move up"
              onPress={reorderUp}
              disabled={!canReorderUp}
              small
              style={styles.reorderButton}
            />
            <Button
              testID="action-reorder-down"
              variant="secondary"
              icon="arrow-down"
              label="Move down"
              onPress={reorderDown}
              disabled={!canReorderDown}
              small
              style={styles.reorderButton}
            />
          </View>

          {runActive ? (
            <View style={styles.hintBlock}>
              <ListRow
                icon="cpu"
                title={`${humanize(currentAdapter)} · ${humanize(currentModel)}`}
                trailing={<Icon name="lock" size={14} color={colors.textFaintSolid} />}
              />
              <Text testID="action-agent-hint" style={[type.caption, styles.hint, { color: colors.textMuted }]}>
                Run in progress — cancel it to change the agent or model.
              </Text>
            </View>
          ) : (
            <>
              <ListRow
                testID="action-agent"
                icon="cpu"
                title="Agent"
                trailing={
                  <Text style={[type.mono, { color: colors.textMuted }]}>{humanize(currentAdapter)}</Text>
                }
                onPress={() => setView('agent')}
              />
              <ListRow
                testID="action-model"
                icon="layers"
                title="Model"
                trailing={
                  <Text style={[type.mono, { color: colors.textMuted }]}>{humanize(currentModel)}</Text>
                }
                onPress={() => setView('model')}
              />
            </>
          )}

          <Button testID="action-close" variant="ghost" label="Close" onPress={close} small />
        </View>
      )}

      {view === 'agent' && (
        <View style={styles.section}>
          {(adapters ?? []).map((adapter) => (
            <ListRow
              key={adapter.id}
              testID={`action-agent-${adapter.id}`}
              title={adapter.label}
              trailing={
                adapter.id === currentAdapter ? <Icon name="check" size={16} color={colors.text} /> : null
              }
              onPress={() => chooseAdapter(adapter.id)}
            />
          ))}
          <ListRow testID="action-back" icon="chevron-left" title="Back" onPress={() => setView('main')} />
        </View>
      )}

      {view === 'model' && (
        <View style={styles.section}>
          {modelsForAdapter(currentAdapter).map((model) => (
            <ListRow
              key={model}
              testID={`action-model-${model}`}
              title={humanize(model)}
              trailing={model === currentModel ? <Icon name="check" size={16} color={colors.text} /> : null}
              onPress={() => chooseModel(model)}
            />
          ))}
          <ListRow testID="action-back" icon="chevron-left" title="Back" onPress={() => setView('main')} />
        </View>
      )}
    </Sheet>
  )
}

const styles = StyleSheet.create({
  titleBlock: {
    gap: space.xs,
    marginBottom: space.md,
  },
  section: {
    gap: space.xs,
  },
  reorderRow: {
    flexDirection: 'row',
    gap: space.md,
    marginVertical: space.xs,
  },
  reorderButton: {
    flex: 1,
  },
  hintBlock: {
    gap: 0,
  },
  hint: {
    paddingHorizontal: space.xs,
    paddingBottom: space.sm,
  },
})
