import type { ApiBoard, ApiTicket, ApiWorkspaceDetail } from '@tada/shared'
import { QueryClientProvider } from '@tanstack/react-query'
import { makeTestQueryClient } from './helpers/queryClient'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { DeviceEventEmitter, Dimensions } from 'react-native'
import { State } from 'react-native-gesture-handler'
import { getByGestureTestId } from 'react-native-gesture-handler/jest-utils'
import Board from '../app/workspaces/[id]/board'
import { ConnectionProvider } from '../src/ConnectionContext'

/**
 * Drives a lift-then-drop drag cycle by emitting raw gesture-handler state-change events instead
 * of using `fireGestureHandler` directly: that helper always synthesizes a full BEGAN→ACTIVE→END
 * sequence synchronously in one JS turn (confirmed against its source — the "duplicate a final
 * END" step runs unconditionally), which never gives the card's `lift()` a chance to resolve its
 * `await measureInWindow(...)` before `onEnd` fires and finds no drag in progress. Emitting BEGAN
 * + ACTIVE, awaiting a real tick, then END mirrors an actual finger gesture closely enough to
 * exercise the full lift → resolve → mutate path deterministically.
 */
async function dragAndDrop(
  gestureTestId: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- BaseGesture's handlerTag isn't part of the public jest-utils typings
  const handlerTag = (getByGestureTestId(gestureTestId) as any).handlerTag
  const base = {
    numberOfPointers: 1,
    x: 0,
    y: 0,
    translationX: 0,
    translationY: 0,
    velocityX: 0,
    velocityY: 0,
    stylusData: undefined,
  }
  await act(async () => {
    DeviceEventEmitter.emit('onGestureHandlerStateChange', {
      ...base,
      handlerTag,
      state: State.BEGAN,
      oldState: State.UNDETERMINED,
      absoluteX: from.x,
      absoluteY: from.y,
    })
    DeviceEventEmitter.emit('onGestureHandlerStateChange', {
      ...base,
      handlerTag,
      state: State.ACTIVE,
      oldState: State.BEGAN,
      absoluteX: from.x,
      absoluteY: from.y,
    })
    await new Promise((r) => setTimeout(r, 0))
  })
  await act(async () => {
    DeviceEventEmitter.emit('onGestureHandlerStateChange', {
      ...base,
      handlerTag,
      state: State.END,
      oldState: State.ACTIVE,
      absoluteX: to.x,
      absoluteY: to.y,
      translationX: to.x - from.x,
      translationY: to.y - from.y,
    })
    await new Promise((r) => setTimeout(r, 0))
  })
}

const WIDE_WIDTH = 1280
const NARROW_WIDTH = 500
// Two days after the fixtures' `2026-08-13` createdAt (→ bare age "2d") and exactly one week
// after their `2026-08-08` finishedAt (→ "1w") — see bareAge in src/relativeTime.ts. Real timers
// throughout (matches Control's suite): only Date.now is frozen, so RTL's async waitFor doesn't
// deadlock against a faked interval.
const FROZEN_NOW = new Date('2026-08-15T12:00:00.000Z').getTime()

function setWidth(width: number) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height: 900, scale: 1, fontScale: 1 })
}

const mockPush = jest.fn()
const mockNavigate = jest.fn()
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: '1' }),
  useFocusEffect: (cb: () => void) => { require('react').useEffect(cb, [cb]) },
  useRouter: () => ({ push: mockPush, navigate: mockNavigate }),
  Stack: Object.assign(() => null, { Screen: () => null }),
}))

jest.mock('../src/settings', () => ({
  loadConnection: jest.fn(async () => ({ baseUrl: 'https://example.com', token: 'secret' })),
  saveConnection: jest.fn(async () => undefined),
  clearConnection: jest.fn(async () => undefined),
  loadActiveWorkspaceId: jest.fn(async () => null),
  saveActiveWorkspaceId: jest.fn(async () => undefined),
  loadThemeScheme: jest.fn(async () => 'night'),
  saveThemeScheme: jest.fn(async () => undefined),
}))

jest.mock('../src/api/useWorkspaceSocket', () => ({
  useWorkspaceSocket: jest.fn(),
}))

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}))

// The board's real drag machinery awaits `View.measureInWindow`, whose native callback never
// fires under the RN test renderer (confirmed experimentally — the promise hangs forever). Every
// column and card ends up with the same generous rect so a drop anywhere lands in the
// first-registered column (Backlog) — enough to exercise the full lift → resolve → mutate path
// for a same-column reorder without needing real layout.
jest.mock('../src/board/dnd', () => ({
  ...jest.requireActual('../src/board/dnd'),
  measureInWindow: jest.fn(async () => ({ x: 0, y: 0, width: 2000, height: 2000 })),
}))

const mockBoard = jest.fn()
const mockGetWorkspace = jest.fn()
const mockCreateTicket = jest.fn()
const mockTicket = jest.fn()
const mockAccept = jest.fn()
const mockSendBack = jest.fn()
const mockProposal = jest.fn()
const mockMoveTicket = jest.fn()
const mockPatchTicket = jest.fn()
const mockRunEvents = jest.fn()
jest.mock('../src/api/client', () => {
  class FakeApiError extends Error {
    status: number
    body: unknown
    constructor(status: number, body: unknown) {
      super(`API error ${status}`)
      this.name = 'ApiError'
      this.status = status
      this.body = body
    }
  }
  return {
    ApiError: FakeApiError,
    TadaClient: jest.fn().mockImplementation(() => ({
      board: mockBoard,
      getWorkspace: mockGetWorkspace,
      createTicket: mockCreateTicket,
      ticket: mockTicket,
      accept: mockAccept,
      sendBack: mockSendBack,
      proposal: mockProposal,
      moveTicket: mockMoveTicket,
      patchTicket: mockPatchTicket,
      runEvents: mockRunEvents,
      wsUrl: () => 'wss://example.com/ws',
    })),
  }
})

function workspace(overrides: Partial<ApiWorkspaceDetail> = {}): ApiWorkspaceDetail {
  return {
    id: 1,
    name: 'parlor',
    defaultAdapter: 'claude',
    defaultModel: 'sonnet',
    defaultEffort: 'default',
    concurrency: 1,
    timeoutMs: 60_000,
    createdAt: '2026-01-01T00:00:00.000Z',
    sources: [{ type: 'repo', name: 'parlor-api' }],
    ...overrides,
  }
}

function ticket(overrides: Partial<ApiTicket>): ApiTicket {
  return {
    id: 1,
    workspaceId: 1,
    columnId: 1,
    title: 'Ticket',
    description: '',
    position: 1,
    queueState: null,
    adapterOverride: null,
    modelOverride: null,
    effortOverride: null,
    origin: 'human',
    proposalState: null,
    followUpOfTicketId: null,
    createdAt: '2026-08-13T12:00:00.000Z',
    ...overrides,
  }
}

function board(overrides: Partial<ApiBoard> = {}): ApiBoard {
  return {
    columns: [
      { id: 1, workspaceId: 1, kind: 'backlog', title: 'Backlog', position: 1, tickets: [] },
      { id: 2, workspaceId: 1, kind: 'ready', title: 'Queued', position: 2, tickets: [] },
      { id: 3, workspaceId: 1, kind: 'in_progress', title: 'Running', position: 3, tickets: [] },
      { id: 4, workspaceId: 1, kind: 'in_review', title: 'In review', position: 4, tickets: [] },
      { id: 5, workspaceId: 1, kind: 'done', title: 'Done', position: 5, tickets: [] },
    ],
    ...overrides,
  }
}

async function renderBoard() {
  const queryClient = makeTestQueryClient()
  await render(
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider>
        <Board />
      </ConnectionProvider>
    </QueryClientProvider>,
  )
}

describe('Board screen', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockBoard.mockReset()
    jest.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW)
    mockGetWorkspace.mockResolvedValue(workspace())
    mockTicket.mockResolvedValue({ ticket: ticket({}), comments: [], runs: [], followUps: [] })
    mockRunEvents.mockResolvedValue([])
    setWidth(WIDE_WIDTH)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('renders all five column headers with counts', async () => {
    mockBoard.mockResolvedValueOnce(
      board({
        columns: [
          { id: 1, workspaceId: 1, kind: 'backlog', title: 'Backlog', position: 1, tickets: [ticket({ id: 10 })] },
          { id: 2, workspaceId: 1, kind: 'ready', title: 'Queued', position: 2, tickets: [] },
          { id: 3, workspaceId: 1, kind: 'in_progress', title: 'Running', position: 3, tickets: [] },
          { id: 4, workspaceId: 1, kind: 'in_review', title: 'In review', position: 4, tickets: [] },
          { id: 5, workspaceId: 1, kind: 'done', title: 'Done', position: 5, tickets: [] },
        ],
      }),
    )

    await renderBoard()

    await waitFor(() => {
      expect(screen.getByText('Backlog')).toBeTruthy()
    })
    expect(screen.getByText('Queued')).toBeTruthy()
    expect(screen.getByText('Running')).toBeTruthy()
    expect(screen.getByText('In review')).toBeTruthy()
    expect(screen.getByText('Done')).toBeTruthy()
    // Backlog has one ticket, every other seeded column is empty.
    expect(screen.getByTestId('column-count-1')).toHaveTextContent('1')
    expect(screen.getByTestId('column-count-2')).toHaveTextContent('0')
  })

  test('the Done column renders at reduced opacity', async () => {
    mockBoard.mockResolvedValueOnce(board())

    await renderBoard()

    await waitFor(() => {
      expect(screen.getByText('Done')).toBeTruthy()
    })
    const flat = screen.getByTestId('column-5').props.style
    const opacity = Array.isArray(flat) ? flat.find((s) => s && 'opacity' in s)?.opacity : flat.opacity
    expect(opacity).toBeCloseTo(0.68)
  })

  test('renders tickets within a column in position order', async () => {
    mockBoard.mockResolvedValueOnce(
      board({
        columns: [
          {
            id: 1,
            workspaceId: 1,
            kind: 'backlog',
            title: 'Backlog',
            position: 1,
            tickets: [
              ticket({ id: 10, title: 'Second', position: 2 }),
              ticket({ id: 11, title: 'First', position: 1 }),
              ticket({ id: 12, title: 'Third', position: 3 }),
            ],
          },
        ],
      }),
    )

    await renderBoard()

    await waitFor(() => {
      expect(screen.getByText('First')).toBeTruthy()
    })

    const cards = screen.getAllByTestId(/^ticket-card-/)
    expect(cards.map((c) => c.props.testID)).toEqual(['ticket-card-11', 'ticket-card-10', 'ticket-card-12'])
  })

  test('backlog card shows source · age meta', async () => {
    mockBoard.mockResolvedValueOnce(
      board({
        columns: [
          {
            id: 1,
            workspaceId: 1,
            kind: 'backlog',
            title: 'Backlog',
            position: 1,
            tickets: [ticket({ id: 20, title: 'Migrate icons', createdAt: '2026-08-13T12:00:00.000Z' })],
          },
        ],
      }),
    )

    await renderBoard()

    await waitFor(() => {
      expect(screen.getByText('Migrate icons')).toBeTruthy()
    })
    expect(screen.getByText('parlor-api · 2d')).toBeTruthy()
  })

  test('top queued ticket reads "next up"; a held ticket reads its retry attempt', async () => {
    mockBoard.mockResolvedValueOnce(
      board({
        columns: [
          {
            id: 2,
            workspaceId: 1,
            kind: 'ready',
            title: 'Queued',
            position: 2,
            tickets: [
              ticket({ id: 30, columnId: 2, title: 'Wire up retries', position: 1, queueState: 'queued' }),
              ticket({ id: 31, columnId: 2, title: 'Nightly bump', position: 2, queueState: 'held' }),
            ],
          },
        ],
      }),
    )
    mockTicket.mockImplementation(async (id: number) => {
      if (id === 31) {
        return {
          ticket: ticket({ id: 31, columnId: 2, queueState: 'held' }),
          comments: [],
          runs: [{ id: 1, ticketId: 31, adapter: 'claude', model: 'sonnet', effort: 'default', attemptNumber: 1, status: 'failed', branch: null, prUrl: null, summary: null, diffAdditions: null, diffDeletions: null, testsPassed: null, startedAt: null, finishedAt: null, createdAt: '2026-08-13T12:00:00.000Z' }],
          followUps: [],
        }
      }
      return { ticket: ticket({ id }), comments: [], runs: [], followUps: [] }
    })

    await renderBoard()

    await waitFor(() => {
      expect(screen.getByText('Wire up retries')).toBeTruthy()
    })
    expect(screen.getByText('parlor-api · next up')).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByText('retry · attempt 2')).toBeTruthy()
    })
  })

  test('a running card shows the agent well and routes Watch live to the run screen', async () => {
    mockBoard.mockResolvedValueOnce(
      board({
        columns: [
          {
            id: 3,
            workspaceId: 1,
            kind: 'in_progress',
            title: 'Running',
            position: 3,
            tickets: [ticket({ id: 40, columnId: 3, title: 'Fix flaky test' })],
          },
        ],
      }),
    )
    mockTicket.mockResolvedValue({
      ticket: ticket({ id: 40, columnId: 3 }),
      // A stale agent comment from *before* this run — the well must prefer the run's own
      // journaled events over it while the run is live (see useLatestRunEvent).
      comments: [{ id: 1, ticketId: 40, author: 'agent', kind: 'note', body: 'stale comment from an earlier run', createdAt: '2026-08-13T12:00:00.000Z' }],
      runs: [{ id: 77, ticketId: 40, adapter: 'claude', model: 'sonnet', effort: 'default', attemptNumber: 1, status: 'running', branch: null, prUrl: null, summary: null, diffAdditions: null, diffDeletions: null, testsPassed: null, startedAt: '2026-08-15T11:48:00.000Z', finishedAt: null, createdAt: '2026-08-13T12:00:00.000Z' }],
      followUps: [],
    })
    mockRunEvents.mockResolvedValue([
      { id: 1, runId: 77, type: 'status', payload: { status: 'running suite ×20' }, createdAt: '2026-08-15T11:49:00.000Z' },
      { id: 2, runId: 77, type: 'text', payload: { text: 'suite ×20 — all green so far' }, createdAt: '2026-08-15T11:50:00.000Z' },
    ])

    await renderBoard()

    await waitFor(() => {
      expect(screen.getByText('Fix flaky test')).toBeTruthy()
    })
    await waitFor(() => {
      expect(screen.getByTestId('ticket-agent-well-40')).toHaveTextContent(
        'suite ×20 — all green so far',
        { exact: false },
      )
    })
    // Never the earlier run's stale comment.
    expect(screen.getByTestId('ticket-agent-well-40')).not.toHaveTextContent('stale comment', { exact: false })

    await fireEvent.press(screen.getByTestId('watch-live-40'))
    expect(mockPush).toHaveBeenCalledWith('/runs/77')
  })

  test('a running card with no journaled events yet falls back to "working…"', async () => {
    mockBoard.mockResolvedValueOnce(
      board({
        columns: [
          {
            id: 3,
            workspaceId: 1,
            kind: 'in_progress',
            title: 'Running',
            position: 3,
            tickets: [ticket({ id: 41, columnId: 3, title: 'Rotate the staging cert' })],
          },
        ],
      }),
    )
    mockTicket.mockResolvedValue({
      ticket: ticket({ id: 41, columnId: 3 }),
      comments: [],
      runs: [{ id: 78, ticketId: 41, adapter: 'claude', model: 'sonnet', effort: 'default', attemptNumber: 1, status: 'running', branch: null, prUrl: null, summary: null, diffAdditions: null, diffDeletions: null, testsPassed: null, startedAt: '2026-08-15T11:48:00.000Z', finishedAt: null, createdAt: '2026-08-13T12:00:00.000Z' }],
      followUps: [],
    })
    mockRunEvents.mockResolvedValue([])

    await renderBoard()

    await waitFor(() => {
      expect(screen.getByTestId('ticket-agent-well-41')).toHaveTextContent('working…', { exact: false })
    })
  })

  test('an in-review card shows your-turn, attempt/pr/tests meta, and wires accept + send back', async () => {
    mockBoard.mockResolvedValue(
      board({
        columns: [
          {
            id: 4,
            workspaceId: 1,
            kind: 'in_review',
            title: 'In review',
            position: 4,
            tickets: [ticket({ id: 50, columnId: 4, title: 'Add CSV export' })],
          },
        ],
      }),
    )
    mockTicket.mockResolvedValue({
      ticket: ticket({ id: 50, columnId: 4 }),
      comments: [],
      runs: [{ id: 88, ticketId: 50, adapter: 'claude', model: 'sonnet', effort: 'default', attemptNumber: 2, status: 'needs_review', branch: null, prUrl: 'https://github.com/x/y/pull/481', summary: null, diffAdditions: null, diffDeletions: null, testsPassed: 12, startedAt: null, finishedAt: null, createdAt: '2026-08-13T12:00:00.000Z' }],
      followUps: [],
    })
    mockAccept.mockResolvedValue(ticket({ id: 50, columnId: 5 }))
    mockSendBack.mockResolvedValue(ticket({ id: 50 }))

    await renderBoard()

    await waitFor(() => {
      expect(screen.getByText('Add CSV export')).toBeTruthy()
    })
    expect(screen.getByText('your turn')).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByText('attempt 2 · pr #481 · tests pass')).toBeTruthy()
    })

    await fireEvent.press(screen.getByTestId('accept-50'))
    await waitFor(() => {
      expect(mockAccept).toHaveBeenCalledWith(50)
    })

    await fireEvent.press(screen.getByTestId('send-back-50'))
    await waitFor(() => {
      expect(screen.getByTestId('send-back-dialog')).toBeTruthy()
    })
    await fireEvent.changeText(screen.getByTestId('send-back-feedback-input'), 'please add a test')
    await fireEvent.press(screen.getByTestId('send-back-confirm'))
    await waitFor(() => {
      expect(mockSendBack).toHaveBeenCalledWith(50, 'please add a test')
    })
  })

  test('a done card shows the merged pr and age', async () => {
    mockBoard.mockResolvedValueOnce(
      board({
        columns: [
          {
            id: 5,
            workspaceId: 1,
            kind: 'done',
            title: 'Done',
            position: 5,
            tickets: [ticket({ id: 60, columnId: 5, title: 'Add rate limiting' })],
          },
        ],
      }),
    )
    mockTicket.mockResolvedValue({
      ticket: ticket({ id: 60, columnId: 5 }),
      comments: [],
      runs: [{ id: 99, ticketId: 60, adapter: 'claude', model: 'sonnet', effort: 'default', attemptNumber: 1, status: 'needs_review', branch: null, prUrl: 'https://github.com/x/y/pull/468', summary: null, diffAdditions: null, diffDeletions: null, testsPassed: null, startedAt: null, finishedAt: '2026-08-08T12:00:00.000Z', createdAt: '2026-08-13T12:00:00.000Z' }],
      followUps: [],
    })

    await renderBoard()

    await waitFor(() => {
      expect(screen.getByText('Add rate limiting')).toBeTruthy()
    })
    await waitFor(() => {
      expect(screen.getByText('pr #468 merged · 1w')).toBeTruthy()
    })
  })

  test('a pending proposal card shows the agent banner and follow-up line, and is not draggable', async () => {
    mockBoard.mockResolvedValueOnce(
      board({
        columns: [
          {
            id: 1,
            workspaceId: 1,
            kind: 'backlog',
            title: 'Backlog',
            position: 1,
            tickets: [
              ticket({ id: 5, title: 'Add CSV export to the reports page' }),
              ticket({
                id: 70,
                title: 'Paginate the legacy /reports/all endpoint',
                origin: 'agent',
                proposalState: 'pending',
                followUpOfTicketId: 5,
              }),
            ],
          },
        ],
      }),
    )

    await renderBoard()

    await waitFor(() => {
      expect(screen.getByText('Paginate the legacy /reports/all endpoint')).toBeTruthy()
    })
    expect(screen.getByText('Proposed by agent')).toBeTruthy()
    expect(screen.getByText('follow-up of add csv export to the reports page')).toBeTruthy()

    expect(() => getByGestureTestId('ticket-drag-70')).toThrow()
    // The plain (non-proposal) sibling card is still draggable.
    expect(() => getByGestureTestId('ticket-drag-5')).not.toThrow()
  })

  test('proposal Keep and Dismiss call useProposal with the right action', async () => {
    mockBoard.mockResolvedValue(
      board({
        columns: [
          {
            id: 1,
            workspaceId: 1,
            kind: 'backlog',
            title: 'Backlog',
            position: 1,
            tickets: [
              ticket({ id: 71, title: 'Proposal one', origin: 'agent', proposalState: 'pending' }),
            ],
          },
        ],
      }),
    )
    mockProposal.mockResolvedValue(ticket({ id: 71 }))

    await renderBoard()

    await waitFor(() => {
      expect(screen.getByText('Proposal one')).toBeTruthy()
    })

    await fireEvent.press(screen.getByTestId('proposal-keep-71'))
    await waitFor(() => {
      expect(mockProposal).toHaveBeenCalledWith(71, 'keep')
    })

    await fireEvent.press(screen.getByTestId('proposal-dismiss-71'))
    await waitFor(() => {
      expect(mockProposal).toHaveBeenCalledWith(71, 'dismiss')
    })
  })

  test('+ Add a ticket only appears under the Backlog column', async () => {
    mockBoard.mockResolvedValueOnce(board())

    await renderBoard()

    await waitFor(() => {
      expect(screen.getByText('Backlog')).toBeTruthy()
    })

    expect(screen.getByTestId('add-ticket-1')).toBeTruthy()
    expect(screen.queryByTestId('add-ticket-2')).toBeNull()
    expect(screen.queryByTestId('add-ticket-3')).toBeNull()
    expect(screen.queryByTestId('add-ticket-4')).toBeNull()
    expect(screen.queryByTestId('add-ticket-5')).toBeNull()
  })

  test('wide: header row shows Board title, workspace switcher trigger, and New ticket', async () => {
    mockBoard.mockResolvedValueOnce(board())

    await renderBoard()

    await waitFor(() => {
      expect(screen.getByTestId('board-wide')).toBeTruthy()
    })
    // The Rail is drawn by the tabs frame, not the screen (see SectionTabBar).
    expect(screen.queryByTestId('board-rail')).toBeNull()
    expect(screen.getByText('parlor ▾')).toBeTruthy()
    expect(screen.getByTestId('board-new-ticket')).toBeTruthy()
  })

  test('narrow: renders the paged board (the frame draws the BottomStrip, not the screen)', async () => {
    setWidth(NARROW_WIDTH)
    mockBoard.mockResolvedValueOnce(board())

    await renderBoard()

    await waitFor(() => {
      expect(screen.getByTestId('board-paged')).toBeTruthy()
    })
    expect(screen.queryByTestId('board-rail')).toBeNull()
    expect(screen.queryByTestId('board-bottom-strip')).toBeNull()
  })

  test('narrow: header gear navigates to the workspace\'s settings', async () => {
    setWidth(NARROW_WIDTH)
    mockBoard.mockResolvedValueOnce(board())

    await renderBoard()

    await waitFor(() => {
      expect(screen.getByTestId('board-settings-button')).toBeTruthy()
    })
    await fireEvent.press(screen.getByTestId('board-settings-button'))

    expect(mockNavigate).toHaveBeenCalledWith('/workspaces/1/settings')
  })

  test('dragging a backlog card and dropping it still fires a move', async () => {
    mockBoard.mockResolvedValue(
      board({
        columns: [
          {
            id: 1,
            workspaceId: 1,
            kind: 'backlog',
            title: 'Backlog',
            position: 1,
            tickets: [
              ticket({ id: 80, title: 'Alpha', position: 1 }),
              ticket({ id: 81, title: 'Beta', position: 2 }),
            ],
          },
        ],
      }),
    )
    mockPatchTicket.mockResolvedValue(ticket({ id: 80, position: 3 }))

    await renderBoard()

    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeTruthy()
    })

    await dragAndDrop('ticket-drag-80', { x: 40, y: 40 }, { x: 40, y: 1900 })

    await waitFor(() => {
      expect(mockPatchTicket).toHaveBeenCalledWith(80, { position: 3 })
    })
  })

  test('a held card released without moving opens its actions instead of dropping', async () => {
    mockBoard.mockResolvedValueOnce(
      board({
        columns: [
          {
            id: 1,
            workspaceId: 1,
            kind: 'backlog',
            title: 'Backlog',
            position: 1,
            tickets: [ticket({ id: 80, title: 'Alpha', position: 1 })],
          },
        ],
      }),
    )

    await renderBoard()
    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeTruthy()
    })

    // Native: the pan's long-press activation swallows the Pressable long-press, so a hold that
    // never travels is what opens the actions sheet.
    await dragAndDrop('ticket-drag-80', { x: 40, y: 40 }, { x: 42, y: 41 })

    await waitFor(() => {
      expect(screen.getByTestId('ticket-actions-sheet')).toBeTruthy()
    })
    expect(mockPatchTicket).not.toHaveBeenCalled()
    expect(mockMoveTicket).not.toHaveBeenCalled()
  })
})
