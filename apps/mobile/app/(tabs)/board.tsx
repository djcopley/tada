import type { ApiTicket, ColumnKind } from '@tada/shared'
import * as Haptics from 'expo-haptics'
import { useRouter } from 'expo-router'
import { useCallback, useMemo, useRef, useState } from 'react'
import { FlatList, Platform, StyleSheet, Text, View, type View as RNView, type ViewStyle, useWindowDimensions } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../../src/api/client'
import { keys, useBoard, useCreateTicket, useMoveTicket, useProposal, useSources } from '../../src/api/queries'
import { useLatestRunEvents } from '../../src/api/useLatestRunEvent'
import { canDropInto, LANES } from '../../src/board/cardMeta'
import { BoardDnDProvider, measureInWindow, type BoardDnD, type DragTicket, type Rect } from '../../src/board/dnd'
import { positionBetween } from '../../src/board/positions'
import { FirstRunBoard } from '../../src/components/board/FirstRunBoard'
import { Lane } from '../../src/components/board/Lane'
import { type BoardCardActions, type ContextMenuAnchor, TicketCardBody } from '../../src/components/board/TicketCard'
import { TicketContextMenu } from '../../src/components/board/TicketContextMenu'
import { NewTicketDialog } from '../../src/components/control/NewTicketDialog'
import { AppHeader, Button, EmptyState, Menu, Screen, Skeleton } from '../../src/components/ui'
import { useNowTick } from '../../src/control'
import { useTheme } from '../../src/design/ThemeContext'
import { radius, space, type } from '../../src/design/tokens'
import { useLayout } from '../../src/layout'
import { showToast } from '../../src/toast'

/** Fixed width of the web Rail (see src/components/ui/Rail.tsx) — subtracted from the window
 * width so the wide 5-lane grid sizes against the actual content area, not the whole screen. */
const RAIL_WIDTH = 188
const COLUMN_MARGIN = 32
// Web-only CSS (RN-web passes unknown style keys through to the DOM) — typed loosely on purpose.
const WEB_SNAP_CONTAINER = { scrollSnapType: 'x mandatory' } as unknown as ViewStyle
const WEB_SNAP_ITEM = { scrollSnapAlign: 'start' } as unknown as ViewStyle
/** Finger within this many px of a screen edge pages the board while dragging. */
const EDGE_ZONE = 56
const EDGE_DWELL_MS = 350
const LIVE_RUN_TOAST = 'The agent owns this card — stop the run first, or move it to backlog'

const byPosition = (a: ApiTicket, b: ApiTicket) => a.position - b.position

export default function Board() {
  const router = useRouter()
  const { width } = useWindowDimensions()
  const { wide } = useLayout()
  const { colors, shadow } = useTheme()
  const qc = useQueryClient()
  const now = useNowTick()

  const { data: board, isLoading, isError } = useBoard()
  const { data: sources } = useSources()
  const moveTicket = useMoveTicket()
  const proposal = useProposal()
  const createTicket = useCreateTicket()
  const [repoFilter, setRepoFilter] = useState<string | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const filterRef = useRef<RNView>(null)
  const [filterAnchor, setFilterAnchor] = useState<Rect | null>(null)
  const [newTicketVisible, setNewTicketVisible] = useState(false)
  // The menu is keyed by id and reads the ticket fresh from the board on every render, so a
  // hold it just resolved is what it shows next.
  const [menu, setMenu] = useState<{ ticketId: number; anchor: ContextMenuAnchor | null } | null>(null)

  // ---------------------------------------------------------------- drag state
  const [drag, setDrag] = useState<DragTicket | null>(null)
  const [dropTarget, setDropTarget] = useState<{ lane: ColumnKind; index: number } | null>(null)
  const dragRef = useRef<DragTicket | null>(null)
  const dropRef = useRef<{ lane: ColumnKind; index: number } | null>(null)
  const dragX = useSharedValue(0)
  const dragY = useSharedValue(0)
  const grabOffset = useRef<{ dx: number; dy: number } | null>(null)
  const grabRect = useRef<Rect | null>(null)
  const overlayOrigin = useRef({ x: 0, y: 0 })
  const overlayRef = useRef<RNView>(null)

  const laneViews = useRef(new Map<ColumnKind, RNView>())
  const cardViews = useRef(new Map<ColumnKind, Map<number, RNView>>())
  const laneRects = useRef(new Map<ColumnKind, Rect>())
  const cardMids = useRef(new Map<ColumnKind, { id: number; mid: number }[]>())
  const lastResolve = useRef(0)
  const edgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pageRef = useRef(0)
  // Which lane the narrow pager is showing (drives the page dots).
  const [page, setPage] = useState(0)
  const pagerRef = useRef<FlatList<ColumnKind> | null>(null)

  const lanes = useMemo(() => {
    const out = {} as Record<ColumnKind, ApiTicket[]>
    for (const kind of LANES) {
      const list = board ? [...board[kind]].sort(byPosition) : []
      out[kind] = repoFilter ? list.filter((t) => t.repoTags.includes(repoFilter)) : list
    }
    return out
  }, [board, repoFilter])

  const contentWidth = wide ? width - RAIL_WIDTH : width
  const columnWidth = wide ? (contentWidth - COLUMN_MARGIN) / LANES.length : width - COLUMN_MARGIN

  const allTickets = useMemo(() => LANES.flatMap((k) => (board ? board[k] : [])), [board])
  const parentTitleById = new Map<number, string>()
  for (const t of allTickets) parentTitleById.set(t.id, t.title)
  const topQueuedId = lanes.queued.find((t) => t.proposalState !== 'pending')?.id
  const liveTextByRun = useLatestRunEvents(lanes.running.map((t) => t.run?.id))
  const repoNames = (sources ?? []).filter((s) => s.type === 'repo').map((s) => s.name)

  const invalidateRects = useCallback(() => {
    laneRects.current.clear()
    cardMids.current.clear()
  }, [])

  const measureLanes = useCallback(async () => {
    if (laneRects.current.size > 0) return
    await Promise.all(
      [...laneViews.current.entries()].map(async ([kind, view]) => {
        laneRects.current.set(kind, await measureInWindow(view))
      }),
    )
  }, [])

  const measureCardMids = useCallback(async (kind: ColumnKind) => {
    const cached = cardMids.current.get(kind)
    if (cached) return cached
    const cards = cardViews.current.get(kind)
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
    cardMids.current.set(kind, mids)
    return mids
  }, [])

  const pageTo = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(LANES.length - 1, next))
      if (clamped === pageRef.current) return
      pageRef.current = clamped
      pagerRef.current?.scrollToOffset({ offset: clamped * columnWidth, animated: true })
      // Re-measure once the page animation settles.
      setTimeout(invalidateRects, 320)
    },
    [columnWidth, invalidateRects],
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
      await measureLanes()
      let hit: { lane: ColumnKind; index: number } | null = null
      for (const [kind, rect] of laneRects.current) {
        if (absX >= rect.x && absX < rect.x + rect.width && absY >= rect.y && absY < rect.y + rect.height) {
          const mids = await measureCardMids(kind)
          hit = { lane: kind, index: mids.filter((m) => m.mid < absY).length }
          break
        }
      }
      dropRef.current = hit
      setDropTarget((prev) => (prev?.lane === hit?.lane && prev?.index === hit?.index ? prev : hit))
    },
    [measureCardMids, measureLanes],
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

  const handleMoveError = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && (error.status === 409 || error.status === 403)) {
        showToast(LIVE_RUN_TOAST)
        void qc.invalidateQueries({ queryKey: keys.board })
      }
    },
    [qc],
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
        const t = Date.now()
        if (t - lastResolve.current > 90) {
          lastResolve.current = t
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
          const siblings = lanes[target.lane].filter((t) => t.id !== active.ticket.id)
          const before = siblings[target.index - 1]
          const after = siblings[target.index]
          const position = positionBetween(before?.position, after?.position)

          if (!canDropInto(active.ticket, target.lane)) {
            showToast(target.lane === 'running' || target.lane === 'stopped' ? 'Only the agent moves cards there' : LIVE_RUN_TOAST)
          } else if (target.lane === active.from) {
            const current = active.ticket.position
            const unchanged =
              (before === undefined || before.position < current) && (after === undefined || current < after.position)
            if (!unchanged && (target.lane === 'backlog' || target.lane === 'queued' || target.lane === 'done')) {
              moveTicket.mutate({ id: active.ticket.id, to: { column: target.lane, position } }, { onError: handleMoveError })
            }
          } else if (target.lane === 'backlog' || target.lane === 'queued' || target.lane === 'done') {
            moveTicket.mutate({ id: active.ticket.id, to: { column: target.lane, position } }, { onError: handleMoveError })
          }
          if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
          cleanupDrag()
        })()
      },
      cancelDrag: cleanupDrag,
      draggingId: drag?.ticket.id ?? null,
      registerLane: (kind, view) => {
        laneViews.current.set(kind, view)
        return () => {
          laneViews.current.delete(kind)
        }
      },
      registerCard: (kind, ticketId, view) => {
        let lane = cardViews.current.get(kind)
        if (!lane) {
          lane = new Map()
          cardViews.current.set(kind, lane)
        }
        lane.set(ticketId, view)
        return () => {
          cardViews.current.get(kind)?.delete(ticketId)
        }
      },
    }),
    [board, cleanupDrag, drag, dragX, dragY, handleMoveError, lanes, maybePageAtEdge, moveTicket, resolveTarget],
  )

  const overlayStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.value }, { translateY: dragY.value }, { rotate: '1.5deg' }, { scale: 1.03 }],
  }))

  // ---------------------------------------------------------------- card actions
  const actionsFor = (ticket: ApiTicket, lane: ColumnKind): BoardCardActions | undefined => {
    if (ticket.origin === 'agent' && ticket.proposalState === 'pending') {
      return {
        onKeep: () => proposal.mutate({ ticketId: ticket.id, action: 'keep' }),
        onDismiss: () => proposal.mutate({ ticketId: ticket.id, action: 'dismiss' }),
        keeping: proposal.isPending && proposal.variables?.ticketId === ticket.id && proposal.variables.action === 'keep',
        dismissing: proposal.isPending && proposal.variables?.ticketId === ticket.id && proposal.variables.action === 'dismiss',
      }
    }
    if (lane === 'running') {
      const run = ticket.run
      return { onWatchLive: run ? () => router.push(`/runs/${run.id}`) : undefined }
    }
    if (lane === 'stopped') return { holdActions: true }
    return undefined
  }

  // ---------------------------------------------------------------- rendering
  if (isError) {
    return (
      <Screen>
        <AppHeader title="Board" />
        <EmptyState icon="alert-circle" message="Couldn't load the board." />
      </Screen>
    )
  }

  if (isLoading || !board) {
    return (
      <Screen>
        <AppHeader title="Board" />
        <View style={styles.skeletons}>
          <Skeleton height={420} style={{ borderRadius: radius.panel }} />
        </View>
      </Screen>
    )
  }

  const onTicketPress = (ticket: ApiTicket) => router.push(`/tickets/${ticket.id}`)
  const onTicketLongPress = (ticket: ApiTicket) => setMenu({ ticketId: ticket.id, anchor: null })
  const onTicketContextMenu = (ticket: ApiTicket, anchor: ContextMenuAnchor) => setMenu({ ticketId: ticket.id, anchor })

  const renderLane = (kind: ColumnKind) => (
    <Lane
      key={kind}
      kind={kind}
      tickets={lanes[kind]}
      width={columnWidth}
      now={now}
      liveTextByRun={liveTextByRun}
      parentTitleById={parentTitleById}
      topQueuedId={topQueuedId}
      actionsFor={actionsFor}
      onTicketPress={onTicketPress}
      onTicketLongPress={onTicketLongPress}
      onTicketContextMenu={onTicketContextMenu}
      onAddTicket={kind === 'backlog' ? () => setNewTicketVisible(true) : undefined}
      dropIndex={dropTarget?.lane === kind ? dropTarget.index : null}
    />
  )
  // Narrow pages: one lane per page, each a CSS snap point on web.
  const renderPage = (kind: ColumnKind) => (
    <View key={kind} style={Platform.OS === 'web' ? [styles.page, WEB_SNAP_ITEM] : styles.page}>
      {renderLane(kind)}
    </View>
  )

  const menuTicket = menu ? allTickets.find((t) => t.id === menu.ticketId) : undefined
  const overlays = (
    <>
      {menuTicket ? (
        <TicketContextMenu ticket={menuTicket} visible anchor={menu?.anchor} onClose={() => setMenu(null)} />
      ) : null}
      <NewTicketDialog
        visible={newTicketVisible}
        onClose={() => setNewTicketVisible(false)}
        pending={createTicket.isPending}
        repo={repoFilter}
        onCreate={(fields) => createTicket.mutate(fields, { onSuccess: () => setNewTicketVisible(false) })}
      />
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
              lane={drag.from}
              now={now}
              liveText={drag.ticket.run ? liveTextByRun.get(drag.ticket.run.id) : undefined}
              isTopQueued={drag.ticket.id === topQueuedId}
              parentTitle={drag.ticket.followUpOfTicketId !== null ? parentTitleById.get(drag.ticket.followUpOfTicketId) : undefined}
            />
          </Animated.View>
        ) : null}
      </View>
    </>
  )

  const filterTrigger = repoNames.length > 0 && (
    <View ref={filterRef} collapsable={false}>
      <Button
        testID="board-repo-filter"
        variant="ghost"
        small
        label={`${repoFilter ?? 'All repos'} ▾`}
        onPress={() => {
          if (filterRef.current) {
            void measureInWindow(filterRef.current).then((rect) => {
              setFilterAnchor(rect)
              setFilterOpen(true)
            })
          } else {
            setFilterOpen(true)
          }
        }}
      />
      <Menu visible={filterOpen} onClose={() => setFilterOpen(false)} anchor={filterAnchor} testID="board-repo-menu">
        {[null, ...repoNames].map((name) => (
          <Button
            key={name ?? '__all'}
            testID={`board-repo-${name ?? 'all'}`}
            variant={name === repoFilter ? 'secondary' : 'ghost'}
            small
            label={name ?? 'All repos'}
            onPress={() => {
              setRepoFilter(name)
              setFilterOpen(false)
            }}
          />
        ))}
      </Menu>
    </View>
  )

  const newTicketButton = (
    <Button testID="board-new-ticket" variant="primary" small={!wide} label="New ticket" onPress={() => setNewTicketVisible(true)} />
  )

  const empty = allTickets.length === 0

  if (wide) {
    return (
      <BoardDnDProvider value={dnd}>
        <View style={[styles.wideRoot, { backgroundColor: colors.ground }]} testID="board-wide">
          <View style={styles.wideContent}>
            <View style={styles.headerRow}>
              <Text style={[type.display, { color: colors.text }]}>Board</Text>
              {filterTrigger}
              <View style={styles.spacer} />
              {newTicketButton}
            </View>
            {empty ? (
              <FirstRunBoard onWrite={() => setNewTicketVisible(true)} />
            ) : (
              <View style={styles.columnsRow}>{LANES.map(renderLane)}</View>
            )}
          </View>
          {overlays}
        </View>
      </BoardDnDProvider>
    )
  }

  return (
    <BoardDnDProvider value={dnd}>
      <Screen testID="board-narrow">
        <View style={styles.narrowHeader}>
          <Text style={[type.title, { color: colors.text }]}>Board</Text>
          {filterTrigger}
          <View style={styles.spacer} />
          {newTicketButton}
        </View>

        {empty ? (
          <View style={styles.narrowEmpty}>
            <FirstRunBoard onWrite={() => setNewTicketVisible(true)} />
          </View>
        ) : (
          <>
            <View style={styles.pageDots} testID="board-page-dots">
              {LANES.map((kind, i) => (
                <View
                  key={kind}
                  testID={`board-page-dot-${i}`}
                  style={[styles.pageDot, { backgroundColor: i === page ? colors.text : colors.borderStrong }]}
                />
              ))}
            </View>
            <FlatList
              ref={pagerRef}
              testID="board-paged"
              horizontal
              snapToInterval={columnWidth}
              decelerationRate="fast"
              scrollEnabled={!drag}
              showsHorizontalScrollIndicator={false}
              // RN-web's ScrollView ignores snapToInterval; CSS scroll snapping does the same job
              // there (each lane wrapper is a snap point, see renderPage).
              style={Platform.OS === 'web' ? WEB_SNAP_CONTAINER : undefined}
              scrollEventThrottle={64}
              onScroll={(e) => {
                const p = Math.max(0, Math.min(LANES.length - 1, Math.round(e.nativeEvent.contentOffset.x / columnWidth)))
                if (p !== page) setPage(p)
              }}
              onMomentumScrollEnd={(e) => {
                pageRef.current = Math.round(e.nativeEvent.contentOffset.x / columnWidth)
              }}
              data={[...LANES]}
              keyExtractor={(k) => k}
              renderItem={({ item }) => renderPage(item)}
            />
          </>
        )}
        {overlays}
      </Screen>
    </BoardDnDProvider>
  )
}

const styles = StyleSheet.create({
  overlayPassthrough: { pointerEvents: 'none' },
  skeletons: { padding: space.lg, flex: 1 },
  wideRoot: { flex: 1, flexDirection: 'row' },
  wideContent: { flex: 1, padding: space.xl, gap: space.lg },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  spacer: { flex: 1 },
  columnsRow: { flex: 1, flexDirection: 'row' },
  narrowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.sm,
  },
  narrowEmpty: { padding: space.lg },
  // A row, so the lane inside stretches to the pager's full height as it did as a direct item —
  // otherwise the lane is only as tall as its cards and a drop below the last card misses it.
  page: { flexDirection: 'row' },
  pageDots: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingBottom: space.xs },
  pageDot: { width: 6, height: 6, borderRadius: 3 },
  floatingCard: {
    position: 'absolute',
    top: 0,
    left: 0,
    borderRadius: radius.card,
    borderWidth: 1,
    padding: space.md,
  },
})
