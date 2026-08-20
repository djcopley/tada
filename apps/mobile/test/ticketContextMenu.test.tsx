import type { ApiTicket } from '@tada/shared'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { Platform } from 'react-native'
import { TicketContextMenu } from '../src/components/board/TicketContextMenu'

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}))

jest.mock('../src/api/queries', () => ({
  useApprove: () => ({ mutate: jest.fn(), isPending: false }),
  useCancelRun: () => ({ mutate: jest.fn(), isPending: false }),
  useDeleteTicket: () => ({ mutate: jest.fn(), isPending: false }),
  useDeny: () => ({ mutate: jest.fn(), isPending: false }),
  useDuplicateTicket: () => ({ mutate: jest.fn(), isPending: false }),
  useMoveTicket: () => ({ mutate: jest.fn(), isPending: false }),
}))
const ticket = {
  id: 7,
  title: 'Paginate the reports endpoint',
  column: 'backlog',
  position: 1,
  origin: 'human',
  repoTags: [],
  createdAt: '2026-08-17T10:00:00.000Z',
  updatedAt: '2026-08-17T10:00:00.000Z',
} as unknown as ApiTicket

// RNTL 14's `render` and `fireEvent` are both awaitable (React 19 concurrent root): without the
// awaits the tree hasn't mounted (`screen` reports "render function has not been called") and
// handlers may not have run by the time the assertions read the tree.
const renderMenu = () =>
  render(<TicketContextMenu ticket={ticket} visible onClose={jest.fn()} anchor={{ x: 200, y: 120 }} />)

describe('TicketContextMenu on web', () => {
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'web')
  })

  test('hovering "Move to" flies the targets out; leaving both closes them', async () => {
    await renderMenu()
    expect(screen.queryByTestId('ctx-move-submenu')).toBeNull()

    await fireEvent(screen.getByTestId('ctx-move'), 'pointerEnter')
    await waitFor(() => expect(screen.getByTestId('ctx-move-submenu')).toBeTruthy())
    expect(screen.getByTestId('ctx-move-queued')).toBeTruthy()

    // The trip from the row to the panel is forgiving: leaving the row and landing on the panel
    // before the grace period is up keeps the flyout open.
    await fireEvent(screen.getByTestId('ctx-move'), 'pointerLeave')
    await fireEvent(screen.getByTestId('ctx-move-submenu'), 'pointerEnter')
    await new Promise((r) => setTimeout(r, 300))
    expect(screen.getByTestId('ctx-move-submenu')).toBeTruthy()

    await fireEvent(screen.getByTestId('ctx-move-submenu'), 'pointerLeave')
    await waitFor(() => expect(screen.queryByTestId('ctx-move-submenu')).toBeNull())
  })

  test('the flyout still opens on press, for touch and click', async () => {
    await renderMenu()
    await fireEvent.press(screen.getByTestId('ctx-move'))
    await waitFor(() => expect(screen.getByTestId('ctx-move-submenu')).toBeTruthy())
    await fireEvent.press(screen.getByTestId('ctx-move'))
    await waitFor(() => expect(screen.queryByTestId('ctx-move-submenu')).toBeNull())
  })
})
