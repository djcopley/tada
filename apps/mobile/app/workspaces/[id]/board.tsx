import { canMoveCard } from '@tada/shared'
import type { ApiBoard, ApiTicket, ColumnKind } from '@tada/shared'
import * as Haptics from 'expo-haptics'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useMemo, useRef, useState } from 'react'
import { FlatList, Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../../../src/api/client'
import {
  keys,
  useAccept,
  useBoard,
  useCreateTicket,
  useMoveTicket,
  usePatchTicket,
  useProposal,
  useSendBack,
  useTicketDetails,
  useWorkspace,
} from '../../../src/api/queries'
import { useWorkspaceSocket } from '../../../src/api/useWorkspaceSocket'
import {
  BoardDnDProvider,
  measureInWindow,
  type BoardDnD,
  type DragTicket,
  type Rect,
} from '../../../src/board/dnd'
import { positionBetween } from '../../../src/board/positions'
import { ColumnView } from '../../../src/components/ColumnView'
import { NewTicketDialog } from '../../../src/components/NewTicketDialog'
import { TicketActions } from '../../../src/components/TicketActions'
import type { BoardCardActions, TicketDetail } from '../../../src/components/TicketCard'
import { TicketCardBody } from '../../../src/components/TicketCard'
import { AppHeader, Button, Dialog, EmptyState, IconButton, Input, Screen, Skeleton } from '../../../src/components/ui'
import { openWorkspaceSwitcher } from '../../../src/components/WorkspaceSwitcher'
import { useNowTick } from '../../../src/control'
import { useTheme } from '../../../src/design/ThemeContext'
import { motion, radius, space, type } from '../../../src/design/tokens'
import { useLayout } from '../../../src/layout'
import { showToast } from '../../../src/toast'
import { useClaimActiveWorkspace } from '../../../src/useClaimActiveWorkspace'
import type { View as RNView } from 'react-native'

/** Fixed width of the web Rail (see src/components/ui/Rail.tsx) — subtracted from the window
 * width so the wide 5-column grid sizes against the actual content area, not the whole screen. */
const RAIL_WIDTH = 188
const COLUMN_MARGIN = 32
/** Finger within this many px of a screen edge pages the board while dragging. */
const EDGE_ZONE = 56
const EDGE_DWELL_MS = 350
const RUN_IN_PROGRESS_TOAST = 'Agent is working on this ticket — wait or cancel the run'
/** How long the accept-run TadaStar plays before the celebration flag clears. */
const TADA_LIFETIME_MS = motion.tada + 400

type BoardColumn = ApiBoard['columns'][number]

function sortedTickets(column: BoardColumn): ApiTicket[] {
  return [...column.tickets].sort((a, b) => a.position - b.position)
}

export default function Board() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const wsId = Number(id)
  const router = useRouter()
  const { width } = useWindowDimensions()
  const { wide } = useLayout()
  const { colors, shadow } = useTheme()
  const qc = useQueryClient()
  const now = useNowTick()

  const { data: board, isLoading: boardLoading, isError: boardError } = useBoard(wsId)
  const { data: workspace, isLoading: workspaceLoading, isError: workspaceError } = useWorkspace(wsId)
  const createTicket = useCreateTicket()
  const moveTicket = useMoveTicket(wsId)
  const patchTicket = usePatchTicket(wsId)
  const accept = useAccept()
  const sendBack = useSendBack()
  const proposal = useProposal()
  const [selectedTicket, setSelectedTicket] = useState<ApiTicket | null>(null)
  const [celebratingIds, setCelebratingIds] = useState<Set<number>>(new Set())

  useWorkspaceSocket(Number.isNaN(wsId) ? undefined : wsId)
  useClaimActiveWorkspace(wsId)

  // ---------------------------------------------------------------- drag state
  const [drag, setDrag] = useState<DragTicket | null>(null)
  const [dropTarget, setDropTarget] = useState<{ columnId: number; index: number } | null>(null)
  const dragRef = useRef<DragTicket | null>(null)
  const dropRef = useRef<{ columnId: number; index: number } | null>(null)
  const dragX = useSharedValue(0)
  const dragY = useSharedValue(0)
  const grabOffset = useRef<{ dx: number; dy: number } | null>(null)
  const grabRect = useRef<Rect | null>(null)
  const overlayOrigin = useRef({ x: 0, y: 0 })
  const overlayRef = useRef<RNView>(null)

  const columnViews = useRef(new Map<number, { kind: ColumnKind; view: RNView }>())
  const cardViews = useRef(new Map<number, Map<number, RNView>>())
  const columnRects = useRef(new Map<number, Rect>())
  const cardMids = useRef(new Map<number, { id: number; mid: number }[]>())
  const lastResolve = useRef(0)
  const edgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pageRef = useRef(0)
  const pagerRef = useRef<FlatList<BoardColumn> | null>(null)

  const columns = useMemo(
    () => (board ? [...board.columns].sort((a, b) => a.position - b.position) : []),
    [board],
  )
  const contentWidth = wide ? width - RAIL_WIDTH : width
  const columnWidth = wide ? (contentWidth - COLUMN_MARGIN) / Math.max(columns.length, 1) : width - COLUMN_MARGIN

  // ---------------------------------------------------------------- card context
  const allTickets = columns.flatMap((c) => c.tickets)
  const parentTitleById = new Map<number, string>()
  for (const t of allTickets) parentTitleById.set(t.id, t.title)

  const readyColumn = columns.find((c) => c.kind === 'ready')
  const topQueuedId = readyColumn
    ? [...readyColumn.tickets]
        .filter((t) => t.queueState === 'queued')
        .sort((a, b) => a.position - b.position)[0]?.id
    : undefined

  const detailIds = Array.from(
    new Set(
      allTickets
        .filter((t) => {
          const kind = columns.find((c) => c.id === t.columnId)?.kind
          return t.queueState === 'held' || kind === 'in_progress' || kind === 'in_review' || kind === 'done'
        })
        .map((t) => t.id),
    ),
  )
  const details = useTicketDetails(detailIds)
  const detailById = new Map<number, TicketDetail | undefined>()
  detailIds.forEach((id, i) => detailById.set(id, details[i]?.data))

  const invalidateRects = useCallback(() => {
    columnRects.current.clear()
    cardMids.current.clear()
  }, [])

  const measureColumns = useCallback(async () => {
    if (columnRects.current.size > 0) return
    await Promise.all(
      [...columnViews.current.entries()].map(async ([columnId, { view }]) => {
        columnRects.current.set(columnId, await measureInWindow(view))
      }),
    )
  }, [])

  const measureCardMids = useCallback(
    async (columnId: number) => {
      const cached = cardMids.current.get(columnId)
      if (cached) return cached
      const cards = cardViews.current.get(columnId)
      const draggedId = dragRef.current?.ticket.id
      const mids: { id: number; mid: number }[] = []
      if (cards) {
        await Promise.all(
          [...cards.entries()].map(async ([ticketId, view]) => {
            if (ticketId === draggedId) return
            const rect = await measureInWindow(view)
            if (rect.height > 0) mids.push({ id: ticketId, mid: rect.y + rect.height / 2 })
          }),
        )
      }
      mids.sort((a, b) => a.mid - b.mid)
      cardMids.current.set(columnId, mids)
      return mids
    },
    [],
  )

  const pageTo = useCallback(
    (page: number) => {
      const clamped = Math.max(0, Math.min(columns.length - 1, page))
      if (clamped === pageRef.current) return
      pageRef.current = clamped
      pagerRef.current?.scrollToOffset({ offset: clamped * columnWidth, animated: true })
      // Re-measure once the page animation settles.
      setTimeout(invalidateRects, 320)
    },
    [columns.length, columnWidth, invalidateRects],
  )

  const maybePageAtEdge = useCallback(
    (absX: number) => {
      if (wide) return
      const dir = absX < EDGE_ZONE ? -1 : absX > width - EDGE_ZONE ? 1 : 0
      if (dir === 0) {
        if (edgeTimer.current) clearTimeout(edgeTimer.current)
        edgeTimer.current = null
        return
      }
      if (edgeTimer.current) return
      edgeTimer.current = setTimeout(() => {
        edgeTimer.current = null
        pageTo(pageRef.current + dir)
      }, EDGE_DWELL_MS)
    },
    [wide, width, pageTo],
  )

  const resolveTarget = useCallback(
    async (absX: number, absY: number) => {
      await measureColumns()
      let hit: { columnId: number; index: number } | null = null
      for (const [columnId, rect] of columnRects.current) {
        if (absX >= rect.x && absX < rect.x + rect.width && absY >= rect.y && absY < rect.y + rect.height) {
          const mids = await measureCardMids(columnId)
          const index = mids.filter((m) => m.mid < absY).length
          hit = { columnId, index }
          break
        }
      }
      dropRef.current = hit
      setDropTarget((prev) =>
        prev?.columnId === hit?.columnId && prev?.index === hit?.index ? prev : hit,
      )
    },
    [measureCardMids, measureColumns],
  )

  const cleanupDrag = useCallback(() => {
    if (edgeTimer.current) clearTimeout(edgeTimer.current)
    edgeTimer.current = null
    grabOffset.current = null
    dragRef.current = null
    dropRef.current = null
    invalidateRects()
    setDrag(null)
    setDropTarget(null)
  }, [invalidateRects])

  const handle409 = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 409) {
        showToast(RUN_IN_PROGRESS_TOAST)
        void qc.invalidateQueries({ queryKey: keys.board(wsId) })
      }
    },
    [qc, wsId],
  )

  const dnd = useMemo<BoardDnD>(
    () => ({
      beginDrag: (dragTicket, rect) => {
        dragRef.current = dragTicket
        grabOffset.current = null
        grabRect.current = rect
        void measureInWindow(overlayRef.current as RNView).then((o) => {
          overlayOrigin.current = { x: o.x, y: o.y }
        })
        // eslint-disable-next-line react-hooks/immutability -- Reanimated shared values are mutated via .value by design
        dragX.value = rect.x - overlayOrigin.current.x
        // eslint-disable-next-line react-hooks/immutability -- see above
        dragY.value = rect.y - overlayOrigin.current.y
        setDrag(dragTicket)
      },
      moveDrag: (absX, absY) => {
        const active = dragRef.current
        if (!active) return
        if (!grabOffset.current) {
          // Keep the card under the finger where it was grabbed, rather than snapping its centre
          // to the pointer (which made a card grabbed by its edge jump on lift).
          const rect = grabRect.current
          grabOffset.current = rect
            ? {
                dx: Math.min(Math.max(absX - rect.x, 0), active.width),
                dy: Math.min(Math.max(absY - rect.y, 0), active.height),
              }
            : { dx: active.width / 2, dy: active.height / 2 }
        }
        // eslint-disable-next-line react-hooks/immutability -- Reanimated shared values are mutated via .value by design
        dragX.value = absX - grabOffset.current.dx - overlayOrigin.current.x
        // eslint-disable-next-line react-hooks/immutability -- see above
        dragY.value = absY - grabOffset.current.dy - overlayOrigin.current.y
        maybePageAtEdge(absX)
        const now = Date.now()
        if (now - lastResolve.current > 90) {
          lastResolve.current = now
          void resolveTarget(absX, absY)
        }
      },
      endDrag: (absX, absY) => {
        const active = dragRef.current
        if (!active || !board) {
          cleanupDrag()
          return
        }
        void (async () => {
          await resolveTarget(absX, absY)
          const target = dropRef.current
          if (!target) {
            cleanupDrag()
            return
          }
          const targetColumn = columns.find((c) => c.id === target.columnId)
          if (!targetColumn) {
            cleanupDrag()
            return
          }
          const siblings = sortedTickets(targetColumn).filter((t) => t.id !== active.ticket.id)
          const before = siblings[target.index - 1]
          const after = siblings[target.index]
          const position = positionBetween(before?.position, after?.position)

          if (target.columnId === active.fromColumnId) {
            const current = active.ticket.position
            const unchanged =
              (before === undefined || before.position < current) &&
              (after === undefined || current < after.position)
            if (!unchanged) {
              patchTicket.mutate({ id: active.ticket.id, patch: { position } }, { onError: handle409 })
            }
          } else if (canMoveCard('human', active.fromColumnKind, targetColumn.kind)) {
            moveTicket.mutate(
              { id: active.ticket.id, to: { columnId: target.columnId, position } },
              { onError: handle409 },
            )
          } else {
            showToast(`Tickets can't move from ${active.fromColumnKind === 'in_progress' ? 'In progress' : 'here'} to ${targetColumn.title}`)
          }
          if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
          cleanupDrag()
        })()
      },
      cancelDrag: cleanupDrag,
      draggingId: drag?.ticket.id ?? null,
      registerColumn: (columnId, kind, view) => {
        columnViews.current.set(columnId, { kind, view })
        return () => {
          columnViews.current.delete(columnId)
        }
      },
      registerCard: (columnId, ticketId, view) => {
        let column = cardViews.current.get(columnId)
        if (!column) {
          column = new Map()
          cardViews.current.set(columnId, column)
        }
        column.set(ticketId, view)
        return () => {
          cardViews.current.get(columnId)?.delete(ticketId)
        }
      },
    }),
    [board, cleanupDrag, columns, drag, dragX, dragY, handle409, maybePageAtEdge, moveTicket, patchTicket, resolveTarget],
  )

  const overlayStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: dragX.value },
      { translateY: dragY.value },
      { rotate: '1.5deg' },
      { scale: 1.03 },
    ],
  }))

  // ---------------------------------------------------------------- review-action wiring
  const celebrate = (ticketId: number) => {
    setCelebratingIds((prev) => new Set(prev).add(ticketId))
    setTimeout(() => {
      setCelebratingIds((prev) => {
        const next = new Set(prev)
        next.delete(ticketId)
        return next
      })
    }, TADA_LIFETIME_MS)
  }

  const [sendBackTicket, setSendBackTicket] = useState<ApiTicket | null>(null)
  const [sendBackFeedback, setSendBackFeedback] = useState('')
  const closeSendBack = () => {
    setSendBackTicket(null)
    setSendBackFeedback('')
  }
  const confirmSendBack = () => {
    if (!sendBackTicket || !sendBackFeedback.trim()) return
    sendBack.mutate(
      { ticketId: sendBackTicket.id, feedback: sendBackFeedback.trim() },
      { onSuccess: closeSendBack, onError: handle409 },
    )
  }

  const [newTicketVisible, setNewTicketVisible] = useState(false)
  const closeNewTicket = () => setNewTicketVisible(false)
  const confirmNewTicket = (fields: { title: string; description: string }) => {
    createTicket.mutate({ workspaceId: wsId, ...fields }, { onSuccess: closeNewTicket })
  }

  const actionsFor = (ticket: ApiTicket, columnKind: ColumnKind): BoardCardActions | undefined => {
    if (ticket.origin === 'agent' && ticket.proposalState === 'pending') {
      return {
        onKeep: () => proposal.mutate({ ticketId: ticket.id, action: 'keep' }),
        onDismiss: () => proposal.mutate({ ticketId: ticket.id, action: 'dismiss' }),
        keeping:
          proposal.isPending && proposal.variables?.ticketId === ticket.id && proposal.variables.action === 'keep',
        dismissing:
          proposal.isPending && proposal.variables?.ticketId === ticket.id && proposal.variables.action === 'dismiss',
      }
    }
    if (columnKind === 'in_progress') {
      const detail = detailById.get(ticket.id)
      const runningRun = detail?.runs.find((r) => r.status === 'running') ?? detail?.runs[detail.runs.length - 1]
      return { onWatchLive: runningRun ? () => router.push(`/runs/${runningRun.id}`) : undefined }
    }
    if (columnKind === 'in_review') {
      return {
        onAccept: () => accept.mutate(ticket.id, { onSuccess: () => celebrate(ticket.id), onError: handle409 }),
        accepting: accept.isPending && accept.variables === ticket.id,
        celebrate: celebratingIds.has(ticket.id),
        onSendBack: () => setSendBackTicket(ticket),
      }
    }
    return undefined
  }

  // ---------------------------------------------------------------- rendering
  if (Number.isNaN(wsId) || boardError || workspaceError) {
    return (
      <Screen>
        <AppHeader title="Board" back />
        <EmptyState icon="alert-circle" message="This workspace doesn't exist." />
      </Screen>
    )
  }

  if (boardLoading || workspaceLoading || !board || !workspace) {
    return (
      <Screen>
        <AppHeader title="…" back />
        <View style={styles.skeletons}>
          <Skeleton height={420} style={{ borderRadius: radius.panel }} />
        </View>
      </Screen>
    )
  }

  const onTicketPress = (ticket: ApiTicket) => router.push(`/tickets/${ticket.id}`)
  const onTicketLongPress = (ticket: ApiTicket) => setSelectedTicket(ticket)
  const onCreateTicket = (fields: { title: string; description: string }) => {
    void createTicket.mutateAsync({ workspaceId: wsId, ...fields })
  }

  const renderColumn = (column: BoardColumn) => (
    <ColumnView
      key={column.id}
      column={column}
      workspace={workspace}
      width={columnWidth}
      now={now}
      detailById={detailById}
      parentTitleById={parentTitleById}
      topQueuedId={topQueuedId}
      actionsFor={actionsFor}
      onTicketPress={onTicketPress}
      onTicketLongPress={onTicketLongPress}
      onCreateTicket={column.kind === 'backlog' ? onCreateTicket : undefined}
      creating={createTicket.isPending}
      dropIndex={dropTarget?.columnId === column.id ? dropTarget.index : null}
    />
  )

  const dialogs = (
    <>
      <Dialog
        visible={sendBackTicket !== null}
        title="Send back"
        onClose={closeSendBack}
        testID="send-back-dialog"
        confirm={{
          label: 'Send back',
          onPress: confirmSendBack,
          disabled: sendBack.isPending || sendBackFeedback.trim().length === 0,
          loading: sendBack.isPending,
          testID: 'send-back-confirm',
        }}
      >
        <Text style={[type.caption, { color: colors.textMuted }]}>
          What should the agent change before its next attempt?
        </Text>
        <Input
          testID="send-back-feedback-input"
          label="Feedback"
          placeholder="What needs to change?"
          multiline
          autoFocus
          value={sendBackFeedback}
          onChangeText={setSendBackFeedback}
        />
      </Dialog>

      <NewTicketDialog
        visible={newTicketVisible}
        onClose={closeNewTicket}
        onCreate={confirmNewTicket}
        pending={createTicket.isPending}
      />
    </>
  )

  const actionsSheet = selectedTicket && (
    <TicketActions
      ticket={selectedTicket}
      columns={board.columns}
      workspace={workspace}
      visible
      onClose={() => setSelectedTicket(null)}
    />
  )

  const overlay = (
    <View ref={overlayRef} collapsable={false} style={[StyleSheet.absoluteFill, styles.overlayPassthrough]}>
      {drag ? (
        <Animated.View
          style={[
            styles.floatingCard,
            { width: drag.width, backgroundColor: colors.raised, borderColor: colors.borderStrong },
            shadow.lifted,
            overlayStyle,
          ]}
        >
          <TicketCardBody
            ticket={drag.ticket}
            workspace={workspace}
            columnKind={drag.fromColumnKind}
            now={now}
            detail={detailById.get(drag.ticket.id)}
            isTopQueued={drag.ticket.id === topQueuedId}
            parentTitle={
              drag.ticket.followUpOfTicketId !== null
                ? parentTitleById.get(drag.ticket.followUpOfTicketId)
                : undefined
            }
          />
        </Animated.View>
      ) : null}
    </View>
  )

  const workspaceSwitcherTrigger = (
    <Button
      testID="board-workspace-switcher"
      variant="secondary"
      small
      style={styles.shrinkTrigger}
      label={`${workspace.name} ▾`}
      onPress={() => openWorkspaceSwitcher('nav')}
    />
  )

  if (wide) {
    return (
      <BoardDnDProvider value={dnd}>
        <View style={[styles.wideRoot, { backgroundColor: colors.ground }]} testID="board-wide">
          <View style={styles.wideContent}>
            <View style={styles.headerRow}>
              <Text style={[type.display, { color: colors.text }]}>Board</Text>
              {workspaceSwitcherTrigger}
              <View style={styles.spacer} />
              <Button testID="board-new-ticket" variant="primary" label="New ticket" onPress={() => setNewTicketVisible(true)} />
            </View>
            <View style={styles.columnsRow}>{columns.map(renderColumn)}</View>
          </View>
          {actionsSheet}
          {overlay}
          {dialogs}
        </View>
      </BoardDnDProvider>
    )
  }

  return (
    <BoardDnDProvider value={dnd}>
      <Screen testID="board-narrow">
        <View style={styles.narrowHeader}>
          <Text style={[type.title, { color: colors.text }]}>Board</Text>
          {workspaceSwitcherTrigger}
          <View style={styles.spacer} />
          <Button testID="board-new-ticket" variant="primary" small label="New ticket" onPress={() => setNewTicketVisible(true)} />
          <IconButton
            testID="board-settings-button"
            icon="settings"
            label="Settings"
            size="sm"
            onPress={() => router.navigate(`/workspaces/${wsId}/settings`)}
          />
        </View>

        <FlatList
          ref={pagerRef}
          testID="board-paged"
          horizontal
          snapToInterval={columnWidth}
          decelerationRate="fast"
          scrollEnabled={!drag}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => {
            pageRef.current = Math.round(e.nativeEvent.contentOffset.x / columnWidth)
          }}
          data={columns}
          keyExtractor={(c) => String(c.id)}
          renderItem={({ item }) => renderColumn(item)}
        />

        {actionsSheet}
        {overlay}
        {dialogs}
      </Screen>
    </BoardDnDProvider>
  )
}

const styles = StyleSheet.create({
  overlayPassthrough: {
    pointerEvents: 'none',
  },
  skeletons: {
    padding: space.lg,
    flex: 1,
  },
  wideRoot: {
    flex: 1,
    flexDirection: 'row',
  },
  wideContent: {
    flex: 1,
    padding: space.xl,
    gap: space.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  spacer: {
    flex: 1,
  },
  columnsRow: {
    flex: 1,
    flexDirection: 'row',
  },
  narrowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.sm,
  },
  // Long workspace names shrink (ellipsis) rather than pushing the header's buttons off-screen.
  shrinkTrigger: {
    flexShrink: 1,
  },
  floatingCard: {
    position: 'absolute',
    top: 0,
    left: 0,
    borderRadius: radius.card,
    borderWidth: 1,
    padding: space.md,
  },
})
