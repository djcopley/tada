import type { ApiTicket } from '@tada/shared'
import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import {
  useApprove,
  useCancelRun,
  useDeleteTicket,
  useDeny,
  useDuplicateTicket,
  useMoveTicket,
} from '../../api/queries'
import { allowedMoveTargets, hasLiveRun, heldGroupTitle, type HumanTarget, LANE_TITLES } from '../../board/cardMeta'
import { useTheme } from '../../design/ThemeContext'
import { radius, space, type } from '../../design/tokens'
import { showToast } from '../../toast'
import { DenyDialog, HoldActions } from '../gate/HoldActions'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Menu } from '../ui/Menu'
import { Sheet } from '../ui/Sheet'
import type { ContextMenuAnchor } from './TicketCard'

type Palette = ReturnType<typeof useTheme>['colors']

/** A menu row (web): sans label, optional mono shortcut hint on the right. */
function Row({
  label,
  hint,
  onPress,
  destructive,
  strong,
  colors,
  testID,
}: {
  label: string
  hint?: string
  onPress: () => void
  destructive?: boolean
  strong?: boolean
  colors: Palette
  testID?: string
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="menuitem"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.controlBgHover }]}
    >
      <Text style={[type.body, strong && type.bodyStrong, styles.rowLabel, { color: destructive ? colors.failText : colors.text }]}>
        {label}
      </Text>
      {hint ? <Text style={[type.monoSmall, { color: destructive ? colors.failText : colors.textFaintSolid }]}>{hint}</Text> : null}
    </Pressable>
  )
}

function Divider({ colors }: { colors: Palette }) {
  return <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />
}

function Caption({ text, colors }: { text: string; colors: Palette }) {
  return <Text style={[type.monoCaps, styles.caption, { color: colors.textFaintSolid }]}>{text}</Text>
}

/** A sheet row (mobile): 50px tall, hairline separators. */
function SheetRow({
  label,
  onPress,
  destructive,
  strong,
  last,
  colors,
  testID,
}: {
  label: string
  onPress: () => void
  destructive?: boolean
  strong?: boolean
  last?: boolean
  colors: Palette
  testID?: string
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.sheetRow,
        !last && { borderBottomColor: colors.borderSubtle, borderBottomWidth: StyleSheet.hairlineWidth },
        pressed && { backgroundColor: colors.controlBgHover },
      ]}
    >
      <Text style={[type.body, strong && type.bodyStrong, { color: destructive ? colors.failText : colors.text }]}>{label}</Text>
    </Pressable>
  )
}

/** Window-coordinate frame of the row a flyout hangs off. */
type MenuFrame = { x: number; y: number; width: number; height: number }

/** Width of the menu card itself (`styles.menu`), used to place the flyout before the trigger
 * row has been measured. */
const MENU_WIDTH = 250
const MOVE_FLYOUT_WIDTH = 230
/** How long the flyout survives after the pointer leaves the row or the panel. */
const MOVE_CLOSE_DELAY = 160
/** A flyout row's height (label + padding), used to keep the panel on screen. */
const FLYOUT_ROW_HEIGHT = 39

/**
 * Where the "Move to" flyout sits: just outside the menu card, top-aligned with the trigger row
 * flipping to the card's left edge when there's no room on the right. Falls back to the
 * right-click point when the row hasn't reported a frame yet.
 */
function flyoutPosition(
  frame: MenuFrame | null,
  anchor: ContextMenuAnchor | null,
  rows: number,
  window: { width: number; height: number },
) {
  const gap = space.xs
  const rowLeft = frame ? frame.x : (anchor?.x ?? 0) + space.sm
  const rowRight = frame ? frame.x + frame.width : (anchor?.x ?? 0) + MENU_WIDTH
  const right = rowRight + gap
  const fitsRight = right + MOVE_FLYOUT_WIDTH <= window.width - space.sm
  const left = fitsRight ? right : Math.max(space.sm, rowLeft - gap - MOVE_FLYOUT_WIDTH)
  // Top-aligned with the trigger row, minus the card's padding so the first flyout row lines up
  // with it; lifted when the panel would otherwise run off the bottom.
  const height = rows * FLYOUT_ROW_HEIGHT + 12
  const wanted = (frame ? frame.y : (anchor?.y ?? 0)) - 6
  const top = Math.max(space.sm, Math.min(wanted, window.height - space.sm - height))
  return { top, left }
}

type Props = {
  ticket: ApiTicket
  visible: boolean
  onClose: () => void
  /** Web: where the right-click landed. Absent on mobile (a Sheet). */
  anchor?: ContextMenuAnchor | null
  testID?: string
}

/** Copies a ticket's link. Web has the clipboard; native gets a toast with the path so the
 * action never silently does nothing. */
async function copyLink(ticketId: number): Promise<void> {
  const path = `/tickets/${ticketId}`
  const href = typeof window !== 'undefined' && window.location ? `${window.location.origin}${path}` : path
  const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
  if (clip?.writeText) {
    try {
      await clip.writeText(href)
      showToast('Link copied')
      return
    } catch {
      // fall through to the toast
    }
  }
  showToast(href)
}

/**
 * Context actions for a ticket card: right-click on web (a Menu at the pointer, with keyboard
 * shortcuts while open), long press on mobile (a Sheet). Same action set, different vessel; the
 * menu is user chrome — sans on a raised surface, never mono. The held group only appears for a
 * stopped card, and View diff only inside a publish gate's held group.
 */
export function TicketContextMenu({ ticket, visible, onClose, anchor, testID = 'ticket-context-menu' }: Props) {
  const router = useRouter()
  const { colors, shadow } = useTheme()
  const windowSize = useWindowDimensions()
  const move = useMoveTicket()
  const duplicate = useDuplicateTicket()
  const del = useDeleteTicket()
  const cancel = useCancelRun()
  const approve = useApprove()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [denying, setDenying] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  // Web: the "Move to" flyout follows the pointer's dwell, so it needs the trigger row's frame in
  // window coordinates (the panel floats outside the menu card, clear of its scroller).
  const moveRowRef = useRef<View>(null)
  const [moveFrame, setMoveFrame] = useState<MenuFrame | null>(null)
  const moveCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const run = ticket.run
  const held = run?.status === 'held' ? run : null
  const permission = held?.hold?.reason === 'permission' ? held.hold : null
  const targets = allowedMoveTargets(ticket)
  const live = hasLiveRun(ticket)

  const cancelMoveClose = () => {
    if (moveCloseTimer.current) clearTimeout(moveCloseTimer.current)
    moveCloseTimer.current = null
  }
  // A grace period so the diagonal trip from the row to the panel doesn't drop the flyout.
  const scheduleMoveClose = () => {
    cancelMoveClose()
    moveCloseTimer.current = setTimeout(() => setMoveOpen(false), MOVE_CLOSE_DELAY)
  }
  const measureMoveRow = () => {
    moveRowRef.current?.measureInWindow?.((x, y, width, height) => setMoveFrame({ x, y, width, height }))
  }
  const openMove = () => {
    cancelMoveClose()
    setMoveOpen(true)
    measureMoveRow()
  }
  useEffect(() => cancelMoveClose, [])

  const close = () => {
    cancelMoveClose()
    setMoveOpen(false)
    onClose()
  }
  const open = () => {
    close()
    router.push(`/tickets/${ticket.id}`)
  }
  const moveTo = (column: HumanTarget) => {
    // Moving a live card to backlog is "stop the run": the server cancels it and parks the card.
    move.mutate({ id: ticket.id, to: { column } }, { onError: () => showToast("That move isn't allowed right now") })
    close()
  }
  const doDuplicate = () => {
    duplicate.mutate(ticket.id, { onSuccess: () => showToast('Duplicated into backlog') })
    close()
  }
  const doCopy = () => {
    void copyLink(ticket.id)
    close()
  }
  const doStop = () => {
    if (run) cancel.mutate(run.id)
    close()
  }
  const doApprove = (alwaysAllow = false) => {
    if (held) approve.mutate({ runId: held.id, alwaysAllow })
    close()
  }
  const doDeny = () => setDenying(true)
  const doDiff = () => {
    if (held) router.push(`/runs/${held.id}/diff`)
    close()
  }

  // Web keyboard shortcuts while the menu is open: ⏎ open · A approve · D deny · ⌘⏎ diff ·
  // ⌘C copy · ⌫ delete.
  useEffect(() => {
    if (!visible || Platform.OS !== 'web' || typeof document === 'undefined') return
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (e.key === 'Enter' && meta && permission?.publishes) doDiff()
      else if (e.key === 'Enter') open()
      else if (e.key.toLowerCase() === 'a' && permission) doApprove()
      else if (e.key.toLowerCase() === 'd' && permission) doDeny()
      else if (e.key.toLowerCase() === 'c' && meta) doCopy()
      else if (e.key === 'Backspace' || e.key === 'Delete') setConfirmingDelete(true)
      else if (e.key === 'Escape') close()
      else return
      e.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  const heldTitle = heldGroupTitle(run)

  const dialogs = (
    <>
      <Dialog
        visible={confirmingDelete}
        title="Delete ticket"
        onClose={() => setConfirmingDelete(false)}
        testID="delete-ticket-dialog"
        confirm={{
          label: 'Delete',
          destructive: true,
          loading: del.isPending,
          testID: 'delete-ticket-confirm',
          onPress: () =>
            del.mutate(ticket.id, {
              onSuccess: () => {
                setConfirmingDelete(false)
                close()
              },
              onError: () => showToast('Stop the run first'),
            }),
        }}
      >
        <Text style={[type.body, { color: colors.textMuted }]}>
          {`"${ticket.title}" and its thread and runs are removed. This can't be undone.`}
        </Text>
      </Dialog>
      {held ? (
        <DenyDialogFor runId={held.id} visible={denying} onClose={() => setDenying(false)} onDone={close} />
      ) : null}
    </>
  )

  // ---------------------------------------------------------------- web menu
  if (Platform.OS === 'web') {
    const moveFlyout =
      moveOpen && targets.length > 0 ? (
        <View
          testID="ctx-move-submenu"
          accessibilityRole="menu"
          onPointerEnter={cancelMoveClose}
          onPointerLeave={scheduleMoveClose}
          style={[
            styles.flyout,
            flyoutPosition(moveFrame, anchor ?? null, targets.length, windowSize),
            { backgroundColor: colors.overlay, borderColor: colors.borderStrong },
            shadow.lifted,
          ]}
        >
          {targets.map((t) => (
            <Row
              colors={colors}
              key={t}
              label={LANE_TITLES[t]}
              hint={t === 'queued' ? 'next' : t === 'backlog' && live ? 'stops the run' : undefined}
              onPress={() => moveTo(t)}
              testID={`ctx-move-${t}`}
            />
          ))}
        </View>
      ) : null

    return (
      <>
        <Menu
          visible={visible}
          onClose={close}
          anchor={anchor ? { x: anchor.x, y: anchor.y, width: 0, height: 0 } : null}
          style={styles.menu}
          flyout={moveFlyout}
          testID={testID}
        >
          <Row colors={colors} label="Open ticket" hint="⏎" onPress={open} testID="ctx-open" />
          {heldTitle && run ? (
            <>
              <Divider colors={colors} />
              <Caption colors={colors} text={heldTitle} />
              {permission ? (
                <>
                  <Row colors={colors} label="Approve" hint="A" strong onPress={() => doApprove()} testID="ctx-approve" />
                  <Row colors={colors} label="Always allow" onPress={() => doApprove(true)} testID="ctx-always-allow" />
                  <Row colors={colors} label="Deny with a note" hint="D" onPress={doDeny} testID="ctx-deny" />
                  {permission.publishes ? <Row colors={colors} label="View diff" hint="⌘⏎" onPress={doDiff} testID="ctx-diff" /> : null}
                </>
              ) : (
                <View style={styles.inlineActions}>
                  <HoldActions run={run} ticketId={ticket.id} compact />
                </View>
              )}
            </>
          ) : null}
          <Divider colors={colors} />
          {targets.length > 0 ? (
            <Pressable
              ref={moveRowRef}
              testID="ctx-move"
              accessibilityRole="menuitem"
              onLayout={measureMoveRow}
              onPointerEnter={openMove}
              onPointerLeave={scheduleMoveClose}
              onPress={() => (moveOpen ? setMoveOpen(false) : openMove())}
              style={[styles.row, moveOpen && { backgroundColor: colors.controlBgHover }]}
            >
              <Text style={[type.body, styles.rowLabel, { color: colors.text }]}>Move to</Text>
              <Text style={[type.monoSmall, { color: colors.textMuted }]}>▸</Text>
            </Pressable>
          ) : null}
          <Row colors={colors} label="Duplicate as new ticket" onPress={doDuplicate} testID="ctx-duplicate" />
          <Row colors={colors} label="Copy link" hint="⌘C" onPress={doCopy} testID="ctx-copy" />
          <Divider colors={colors} />
          {live ? <Row colors={colors} label="Stop run" destructive onPress={doStop} testID="ctx-stop" /> : null}
          <Row colors={colors} label="Delete ticket" hint="⌫" destructive onPress={() => setConfirmingDelete(true)} testID="ctx-delete" />
        </Menu>
        {dialogs}
      </>
    )
  }

  // ---------------------------------------------------------------- mobile sheet
  return (
    <>
      <Sheet visible={visible} onClose={close} testID={testID}>
        <View style={styles.sheetHead}>
          <Text style={[type.bodyStrong, { color: colors.text }]}>{ticket.title}</Text>
          {heldTitle ? <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>{heldTitle.toLowerCase()}</Text> : null}
        </View>
        {run && heldTitle ? (
          <View style={[styles.group, { backgroundColor: colors.raised, borderColor: colors.borderSubtle }]}>
            {permission ? (
              <>
                <SheetRow colors={colors} label="Approve" strong onPress={() => doApprove()} testID="ctx-approve" />
                <SheetRow colors={colors} label="Always allow" onPress={() => doApprove(true)} testID="ctx-always-allow" />
                <SheetRow colors={colors} label="Deny with a note" onPress={doDeny} testID="ctx-deny" />
                {permission.publishes ? <SheetRow colors={colors} label="View diff" onPress={doDiff} testID="ctx-diff" /> : null}
              </>
            ) : (
              <View style={styles.inlineActions}>
                <HoldActions run={run} ticketId={ticket.id} stretch />
              </View>
            )}
            {live ? <SheetRow colors={colors} label="Stop run" destructive last onPress={doStop} testID="ctx-stop" /> : null}
          </View>
        ) : null}
        <View style={[styles.group, { backgroundColor: colors.raised, borderColor: colors.borderSubtle }]}>
          <SheetRow colors={colors} label="Open ticket" onPress={open} testID="ctx-open" />
          {targets.map((t) => (
            <SheetRow
              colors={colors}
              key={t}
              label={`Move to ${LANE_TITLES[t].toLowerCase()}${t === 'backlog' && live ? ' (stops the run)' : ''}`}
              onPress={() => moveTo(t)}
              testID={`ctx-move-${t}`}
            />
          ))}
          <SheetRow colors={colors} label="Duplicate as new ticket" onPress={doDuplicate} testID="ctx-duplicate" />
          <SheetRow colors={colors} label="Copy link" onPress={doCopy} testID="ctx-copy" />
          {live && !heldTitle ? <SheetRow colors={colors} label="Stop run" destructive onPress={doStop} testID="ctx-stop" /> : null}
          <SheetRow colors={colors} label="Delete ticket" destructive last onPress={() => setConfirmingDelete(true)} testID="ctx-delete" />
        </View>
        <Button testID="ctx-cancel" label="Cancel" variant="secondary" onPress={close} />
      </Sheet>
      {dialogs}
    </>
  )
}

/** The deny dialog wired to its run's mutation; closes the menu once the deny lands. */
function DenyDialogFor({
  runId,
  visible,
  onClose,
  onDone,
}: {
  runId: number
  visible: boolean
  onClose: () => void
  onDone: () => void
}) {
  const deny = useDeny()
  return (
    <DenyDialog
      visible={visible}
      onClose={onClose}
      pending={deny.isPending}
      onDeny={(note, saveToMemory) =>
        deny.mutate(
          { runId, note, saveToMemory },
          {
            onSuccess: () => {
              onClose()
              onDone()
            },
          },
        )
      }
    />
  )
}

const styles = StyleSheet.create({
  menu: { width: 250, padding: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm + 2,
    borderRadius: radius.control,
  },
  rowLabel: { flex: 1 },
  divider: { height: 1, marginVertical: 6, marginHorizontal: 4 },
  caption: { textTransform: 'uppercase', paddingHorizontal: space.sm + 2, paddingVertical: space.xs },
  flyout: {
    position: 'absolute',
    width: MOVE_FLYOUT_WIDTH,
    maxWidth: '92%',
    borderWidth: 1,
    borderRadius: radius.card,
    padding: 6,
  },
  inlineActions: { paddingHorizontal: space.sm + 2, paddingVertical: space.sm },
  sheetHead: { gap: 3, paddingHorizontal: space.sm, paddingBottom: space.sm },
  group: {
    borderWidth: 1,
    borderRadius: radius.card,
    marginBottom: space.md,
    overflow: 'hidden',
  },
  sheetRow: { minHeight: 50, justifyContent: 'center', paddingHorizontal: space.lg },
})
