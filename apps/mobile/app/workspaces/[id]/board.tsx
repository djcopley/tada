import { canMoveCard } from '@tada/shared'
import type { ApiBoard, ApiTicket, ColumnKind } from '@tada/shared'
import * as Haptics from 'expo-haptics'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useMemo, useRef, useState } from 'react'
import { FlatList, Platform, StyleSheet, View, useWindowDimensions } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated'
import { ApiError } from '../../../src/api/client'
import { keys, useBoard, useCreateTicket, useMoveTicket, usePatchTicket, useWorkspace } from '../../../src/api/queries'
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
import { TicketActions } from '../../../src/components/TicketActions'
import { TicketCardBody } from '../../../src/components/TicketCard'
import { AppHeader, EmptyState, FlipStrip, Screen, Skeleton } from '../../../src/components/ui'
import { useTheme } from '../../../src/design/ThemeContext'
import { radius, space } from '../../../src/design/tokens'
import { showToast } from '../../../src/toast'
import { useQueryClient } from '@tanstack/react-query'
import type { View as RNView } from 'react-native'

/**
 * At or above this width there's room to show every column side-by-side
 * without paging (roughly a tablet-in-landscape or web breakpoint). Below
 * it, columns page horizontally one-at-a-time like a phone board view.
 */
const WIDE_BREAKPOINT = 900
const COLUMN_MARGIN = 32
/** Finger within this many px of a screen edge pages the board while dragging. */
const EDGE_ZONE = 56
const EDGE_DWELL_MS = 350
const RUN_IN_PROGRESS_TOAST = 'Agent is working on this ticket — wait or cancel the run'

type BoardColumn = ApiBoard['columns'][number]

function sortedTickets(column: BoardColumn): ApiTicket[] {
  return [...column.tickets].sort((a, b) => a.position - b.position)
}

export default function Board() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const wsId = Number(id)
  const router = useRouter()
  const { width } = useWindowDimensions()
  const { colors, shadow } = useTheme()
  const qc = useQueryClient()

  const { data: board, isLoading: boardLoading } = useBoard(wsId)
  const { data: workspace, isLoading: workspaceLoading } = useWorkspace(wsId)
  const createTicket = useCreateTicket()
  const moveTicket = useMoveTicket(wsId)
  const patchTicket = usePatchTicket(wsId)
  const [selectedTicket, setSelectedTicket] = useState<ApiTicket | null>(null)

  useWorkspaceSocket(Number.isNaN(wsId) ? undefined : wsId)

  // ---------------------------------------------------------------- drag state
  const [drag, setDrag] = useState<DragTicket | null>(null)
  const [dropTarget, setDropTarget] = useState<{ columnId: number; index: number } | null>(null)
  const dragRef = useRef<DragTicket | null>(null)
  const dropRef = useRef<{ columnId: number; index: number } | null>(null)
  const dragX = useSharedValue(0)
  const dragY = useSharedValue(0)
  const grabOffset = useRef<{ dx: number; dy: number } | null>(null)
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
  const isWide = width >= WIDE_BREAKPOINT
  const columnWidth = isWide ? (width - COLUMN_MARGIN) / Math.max(columns.length, 1) : width - COLUMN_MARGIN

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
      if (isWide) return
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
    [isWide, width, pageTo],
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
          grabOffset.current = {
            dx: active.width / 2,
            dy: active.height / 2,
          }
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

  // ---------------------------------------------------------------- rendering
  if (Number.isNaN(wsId)) {
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
          <Skeleton height={420} style={{ borderRadius: radius.lg }} />
        </View>
      </Screen>
    )
  }

  const allTickets = columns.flatMap((c) => c.tickets)
  const queuedCount = allTickets.filter((t) => t.queueState === 'queued').length
  const heldCount = allTickets.filter((t) => t.queueState === 'held').length
  const runningCount = columns.filter((c) => c.kind === 'in_progress').flatMap((c) => c.tickets).length
  const reviewCount = columns.filter((c) => c.kind === 'in_review').flatMap((c) => c.tickets).length

  const onTicketPress = (ticket: ApiTicket) => router.push(`/tickets/${ticket.id}`)
  const onTicketLongPress = (ticket: ApiTicket) => setSelectedTicket(ticket)
  const onCreateTicket = (title: string) => {
    void createTicket.mutateAsync({ workspaceId: wsId, title })
  }

  const renderColumn = (column: BoardColumn) => (
    <ColumnView
      key={column.id}
      column={column}
      workspace={workspace}
      width={columnWidth}
      onTicketPress={onTicketPress}
      onTicketLongPress={onTicketLongPress}
      onCreateTicket={column.kind === 'backlog' ? onCreateTicket : undefined}
      creating={createTicket.isPending}
      dropIndex={dropTarget?.columnId === column.id ? dropTarget.index : null}
    />
  )

  return (
    <BoardDnDProvider value={dnd}>
      <Screen>
        <AppHeader
          title={workspace.name}
          back
          actions={[
            {
              icon: 'book-open',
              label: 'Memory',
              onPress: () => router.push(`/workspaces/${wsId}/memory`),
              testID: 'board-memory-button',
            },
            {
              icon: 'settings',
              label: 'Settings',
              onPress: () => router.push(`/workspaces/${wsId}/settings`),
              testID: 'board-settings-button',
            },
          ]}
        >
          <FlipStrip
            testID="board-strip"
            items={[
              { label: 'Queued', count: queuedCount, signal: 'amber' },
              { label: 'Running', count: runningCount, signal: 'green' },
              { label: 'Review', count: reviewCount, signal: 'violet' },
              ...(heldCount > 0 ? [{ label: 'Held', count: heldCount, signal: 'red' as const }] : []),
            ]}
          />
        </AppHeader>

        {isWide ? (
          <View testID="board-wide" style={styles.wideContainer}>
            {columns.map(renderColumn)}
          </View>
        ) : (
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
        )}

        {selectedTicket && (
          <TicketActions
            ticket={selectedTicket}
            columns={board.columns}
            workspace={workspace}
            visible
            onClose={() => setSelectedTicket(null)}
          />
        )}

        {/* Floating drag overlay: a lifted clone of the card follows the finger. */}
        <View ref={overlayRef} collapsable={false} pointerEvents="none" style={StyleSheet.absoluteFill}>
          {drag ? (
            <Animated.View
              style={[
                styles.floatingCard,
                { width: drag.width, backgroundColor: colors.surface },
                shadow.lifted,
                overlayStyle,
              ]}
            >
              <TicketCardBody ticket={drag.ticket} workspace={workspace} columnKind={drag.fromColumnKind} />
            </Animated.View>
          ) : null}
        </View>
      </Screen>
    </BoardDnDProvider>
  )
}

const styles = StyleSheet.create({
  skeletons: {
    padding: space.lg,
    flex: 1,
  },
  wideContainer: {
    flex: 1,
    flexDirection: 'row',
    paddingHorizontal: space.sm,
  },
  floatingCard: {
    position: 'absolute',
    top: 0,
    left: 0,
    borderRadius: radius.md,
    padding: space.md,
  },
})
