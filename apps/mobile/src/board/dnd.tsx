import type { ApiTicket, ColumnKind } from '@tada/shared'
import { createContext, useContext } from 'react'
import type { View } from 'react-native'

/**
 * Board drag-and-drop plumbing. The board screen owns the drag state and a
 * floating card overlay; columns and cards register refs here so drop
 * targets can be resolved from absolute (window) finger coordinates.
 */

export type Rect = { x: number; y: number; width: number; height: number }

export function measureInWindow(view: View): Promise<Rect> {
  return new Promise((resolve) => {
    view.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }))
  })
}

export type DragTicket = {
  ticket: ApiTicket
  fromColumnId: number
  fromColumnKind: ColumnKind
  width: number
  height: number
}

export type BoardDnD = {
  /** Card long-press-drag lifecycle, driven from TicketCard's pan gesture. */
  beginDrag: (drag: DragTicket, cardRect: Rect) => void
  moveDrag: (absX: number, absY: number) => void
  endDrag: (absX: number, absY: number) => void
  cancelDrag: () => void
  /** Ticket id currently lifted (source card dims itself). */
  draggingId: number | null
  registerColumn: (columnId: number, kind: ColumnKind, view: View) => () => void
  registerCard: (columnId: number, ticketId: number, view: View) => () => void
}

const BoardDnDContext = createContext<BoardDnD | null>(null)

export const BoardDnDProvider = BoardDnDContext.Provider

/** Null outside a board (cards render on other screens too, without drag). */
export function useBoardDnD(): BoardDnD | null {
  return useContext(BoardDnDContext)
}
