import type { ApiActivity, ApiBoard, ApiComment, ApiMemory, ApiRun, ApiTicket, ApiWorkspaceListItem } from '@tada/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { Dimensions, Linking } from 'react-native'
import Control from '../app/workspaces/index'
import { ConnectionProvider } from '../src/ConnectionContext'
import { ToastHost } from '../src/toast'

const mockPush = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}))

jest.mock('../src/settings', () => ({
  loadConnection: jest.fn(async () => ({ baseUrl: 'https://example.com', token: 'secret' })),
  saveConnection: jest.fn(async () => undefined),
  clearConnection: jest.fn(async () => undefined),
  loadThemeScheme: jest.fn(async () => 'night'),
  saveThemeScheme: jest.fn(async () => undefined),
  loadActiveWorkspaceId: jest.fn(async () => null),
  saveActiveWorkspaceId: jest.fn(async () => undefined),
}))

const mockListWorkspaces = jest.fn()
const mockBoard = jest.fn()
const mockTicket = jest.fn()
const mockMemory = jest.fn()
const mockActivity = jest.fn()
const mockAccept = jest.fn()
const mockSendBack = jest.fn()
const mockNudge = jest.fn()
const mockMoveTicket = jest.fn()
const mockCreateTicket = jest.fn()
const mockCreateWorkspace = jest.fn()

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
      listWorkspaces: mockListWorkspaces,
      board: mockBoard,
      ticket: mockTicket,
      memory: mockMemory,
      activity: mockActivity,
      accept: mockAccept,
      sendBack: mockSendBack,
      nudge: mockNudge,
      moveTicket: mockMoveTicket,
      createTicket: mockCreateTicket,
      createWorkspace: mockCreateWorkspace,
      wsUrl: () => 'wss://example.com/ws',
    })),
  }
})

function setWindowWidth(width: number) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height: 900, scale: 1, fontScale: 1 })
}

function workspace(overrides: Partial<ApiWorkspaceListItem> = {}): ApiWorkspaceListItem {
  return {
    id: 1,
    name: 'parlor',
    defaultAdapter: 'claude',
    defaultModel: 'sonnet',
    defaultEffort: 'default',
    concurrency: 2,
    timeoutMs: 60_000,
    createdAt: '2026-01-01T00:00:00.000Z',
    runningCount: 1,
    needsReviewCount: 1,
    queuedCount: 1,
    sourceCount: 2,
    ...overrides,
  }
}

function ticket(overrides: Partial<ApiTicket>): ApiTicket {
  return {
    id: 1,
    workspaceId: 1,
    columnId: 13,
    title: 'Untitled',
    description: '',
    position: 1,
    queueState: null,
    adapterOverride: null,
    modelOverride: null,
    effortOverride: null,
    origin: 'human',
    proposalState: null,
    followUpOfTicketId: null,
    createdAt: '2026-08-14T09:00:00.000Z',
    ...overrides,
  }
}

function run(overrides: Partial<ApiRun>): ApiRun {
  return {
    id: 1,
    ticketId: 1,
    adapter: 'claude',
    model: 'sonnet',
    effort: 'default',
    attemptNumber: 1,
    status: 'needs_review',
    branch: null,
    prUrl: null,
    summary: null,
    diffAdditions: null,
    diffDeletions: null,
    testsPassed: null,
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-08-14T09:00:00.000Z',
    ...overrides,
  }
}

function comment(overrides: Partial<ApiComment>): ApiComment {
  return {
    id: 1,
    ticketId: 1,
    author: 'agent',
    kind: 'note',
    body: '',
    createdAt: '2026-08-14T09:00:00.000Z',
    ...overrides,
  }
}

function activityEntry(overrides: Partial<ApiActivity>): ApiActivity {
  return {
    id: 1,
    workspaceId: 1,
    ticketId: null,
    runId: null,
    type: 'ticket_created',
    ticketTitle: null,
    message: '',
    createdAt: '2026-08-14T09:00:00.000Z',
    ...overrides,
  }
}

const reviewTicket = ticket({
  id: 101,
  columnId: 13,
  title: 'Add CSV export to the reports page',
  createdAt: '2026-08-14T07:00:00.000Z',
})
const failedTicket = ticket({
  id: 102,
  columnId: 11,
  title: 'Nightly dependency bump',
  queueState: 'held',
  createdAt: '2026-08-14T02:00:00.000Z',
})
const liveTicket = ticket({
  id: 103,
  columnId: 12,
  title: 'Fix flaky session-refresh test',
  createdAt: '2026-08-14T08:00:00.000Z',
})
const queuedTicket = ticket({
  id: 104,
  columnId: 11,
  title: 'Wire up webhook retries with backoff',
  queueState: 'queued',
  position: 5,
  createdAt: '2026-08-14T06:00:00.000Z',
})

function defaultBoard(): ApiBoard {
  return {
    columns: [
      { id: 10, workspaceId: 1, kind: 'backlog', title: 'Backlog', position: 0, tickets: [] },
      { id: 11, workspaceId: 1, kind: 'ready', title: 'Ready', position: 1, tickets: [failedTicket, queuedTicket] },
      { id: 12, workspaceId: 1, kind: 'in_progress', title: 'In progress', position: 2, tickets: [liveTicket] },
      { id: 13, workspaceId: 1, kind: 'in_review', title: 'In review', position: 3, tickets: [reviewTicket] },
      { id: 14, workspaceId: 1, kind: 'done', title: 'Done', position: 4, tickets: [] },
    ],
  }
}

function defaultTicketDetails(): Record<number, { ticket: ApiTicket; comments: ApiComment[]; runs: ApiRun[] }> {
  return {
    101: {
      ticket: reviewTicket,
      comments: [comment({ id: 1, ticketId: 101, body: 'filters and date range now forwarded into the export query' })],
      runs: [
        run({
          id: 501,
          ticketId: 101,
          attemptNumber: 2,
          status: 'needs_review',
          prUrl: 'https://github.com/acme/parlor/pull/481',
          diffAdditions: 412,
          diffDeletions: 38,
          testsPassed: 214,
        }),
      ],
    },
    102: {
      ticket: failedTicket,
      comments: [comment({ id: 2, ticketId: 102, body: 'vite 6 migration is bigger than a bump' })],
      runs: [run({ id: 502, ticketId: 102, attemptNumber: 1, status: 'failed', summary: 'timed out at 30m' })],
    },
    103: {
      ticket: liveTicket,
      comments: [comment({ id: 3, ticketId: 103, body: 'running suite ×20 — all green so far' })],
      runs: [
        run({
          id: 503,
          ticketId: 103,
          attemptNumber: 1,
          status: 'running',
          startedAt: '2026-08-14T09:48:00.000Z',
        }),
      ],
    },
  }
}

function defaultMemory(): ApiMemory {
  return {
    agentsMd: '',
    notes: [
      { id: 1, scope: 'workspace', workspaceId: 1, file: 'a.md', title: 'a', author: 'human', runId: null, state: 'kept', body: 'conventional commits; prs under ~600 lines', updatedAt: '2026-08-14T00:00:00.000Z' },
      { id: 2, scope: 'workspace', workspaceId: 1, file: 'b.md', title: 'b', author: 'human', runId: null, state: 'kept', body: 'pnpm test before every pr', updatedAt: '2026-08-14T00:00:00.000Z' },
      { id: 3, scope: 'workspace', workspaceId: 1, file: 'c.md', title: 'c', author: 'agent', runId: 9, state: 'pending', body: 'reports queries paginate past 50k rows', updatedAt: '2026-08-14T09:50:00.000Z' },
    ],
  }
}

function defaultActivity(): ApiActivity[] {
  return [
    activityEntry({ id: 5, type: 'run_started', ticketId: 103, ticketTitle: 'Rotate the staging TLS cert', message: 'Started "Rotate the staging TLS cert"', createdAt: '2026-08-14T09:49:00.000Z' }),
    activityEntry({ id: 4, type: 'accepted', ticketId: 99, ticketTitle: 'Prune CI artifacts', message: 'You accepted "Prune CI artifacts" — freed 41 GB', createdAt: '2026-08-14T08:20:00.000Z' }),
    activityEntry({ id: 3, type: 'follow_up_filed', ticketId: 98, ticketTitle: 'Paginate legacy /reports/all', message: 'Filed a follow-up ticket: "Paginate legacy /reports/all"', createdAt: '2026-08-14T07:59:00.000Z' }),
    activityEntry({ id: 2, type: 'memory_written', ticketId: null, ticketTitle: null, message: 'Wrote memory note: parlor memory', createdAt: '2026-08-14T07:58:00.000Z' }),
    activityEntry({ id: 1, type: 'run_failed', ticketId: 102, ticketTitle: 'Nightly dependency bump', message: '"Nightly dependency bump" failed: timed out at 30m', createdAt: '2026-08-14T03:12:00.000Z' }),
  ]
}

function setupMocks({
  workspaces = [workspace()],
  board = defaultBoard(),
  ticketDetails = defaultTicketDetails(),
  memory = defaultMemory(),
  activity = defaultActivity(),
}: {
  workspaces?: ApiWorkspaceListItem[]
  board?: ApiBoard
  ticketDetails?: Record<number, { ticket: ApiTicket; comments: ApiComment[]; runs: ApiRun[] }>
  memory?: ApiMemory
  activity?: ApiActivity[]
} = {}) {
  mockListWorkspaces.mockResolvedValue(workspaces)
  mockBoard.mockResolvedValue(board)
  mockTicket.mockImplementation(async (id: number) => ticketDetails[id])
  mockMemory.mockResolvedValue(memory)
  mockActivity.mockResolvedValue(activity)
}

async function renderControl() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await render(
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider>
        <Control />
        <ToastHost />
      </ConnectionProvider>
    </QueryClientProvider>,
  )
}

describe('Control screen', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Real timers throughout (fake timers deadlock RTL's async waitFor here) — instead we
    // freeze Date.now so elapsed-time math against the fixtures' ISO timestamps is deterministic.
    // The interval-driven ticking itself is covered at the unit level (see useNowTick in
    // control.test.ts), which exercises jest fake timers directly against the hook.
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-08-14T10:00:00.000Z').getTime())
    setWindowWidth(1400)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('groups review + held tickets into needs-you and in-progress tickets into live-now', async () => {
    setupMocks()
    await renderControl()

    await waitFor(() => {
      expect(screen.getByTestId('needs-you-101')).toBeTruthy()
    })
    expect(screen.getByTestId('needs-you-102')).toBeTruthy()
    expect(screen.getByTestId('live-now-103')).toBeTruthy()
    // The queued (not yet running) ticket belongs to neither triage list.
    expect(screen.queryByTestId('needs-you-104')).toBeNull()
    expect(screen.queryByTestId('live-now-104')).toBeNull()
  })

  test('renders the needs-you stat line, badges and agent well from the latest run/comment', async () => {
    setupMocks()
    await renderControl()

    await waitFor(() => {
      expect(screen.getByText('attempt 2 · pr #481 · +412 −38 · 214 tests pass')).toBeTruthy()
    })
    expect(screen.getByText('your turn')).toBeTruthy()
    expect(screen.getByText('failed')).toBeTruthy()
    expect(screen.getByText('attempt 1 · timed out at 30m')).toBeTruthy()
    expect(screen.getByTestId('needs-you-101-agent')).toHaveTextContent(
      /filters and date range now forwarded into the export query/,
    )
  })

  test('accept fires the accept POST and plays the tada moment on success', async () => {
    setupMocks()
    mockAccept.mockResolvedValueOnce(reviewTicket)
    await renderControl()

    await waitFor(() => {
      expect(screen.getByTestId('needs-you-101-accept')).toBeTruthy()
    })
    expect(screen.queryByTestId('needs-you-101-tada')).toBeNull()

    await fireEvent.press(screen.getByTestId('needs-you-101-accept'))

    await waitFor(() => {
      expect(mockAccept).toHaveBeenCalledWith(101)
    })
    await waitFor(() => {
      expect(screen.getByTestId('needs-you-101-tada')).toBeTruthy()
    })
  })

  test('send-back dialog posts the typed feedback', async () => {
    setupMocks()
    mockSendBack.mockResolvedValueOnce(reviewTicket)
    await renderControl()

    await waitFor(() => {
      expect(screen.getByTestId('needs-you-101-send-back')).toBeTruthy()
    })
    await fireEvent.press(screen.getByTestId('needs-you-101-send-back'))

    expect(screen.getByTestId('send-back-dialog')).toBeTruthy()
    await fireEvent.changeText(screen.getByTestId('send-back-feedback-input'), 'please add a loading state')
    await fireEvent.press(screen.getByTestId('send-back-confirm'))

    await waitFor(() => {
      expect(mockSendBack).toHaveBeenCalledWith(101, 'please add a loading state')
    })
  })

  test('open diff opens the run PR url via Linking', async () => {
    setupMocks()
    const openSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true)
    await renderControl()

    await waitFor(() => {
      expect(screen.getByTestId('needs-you-101-open-diff')).toBeTruthy()
    })
    await fireEvent.press(screen.getByTestId('needs-you-101-open-diff'))

    expect(openSpy).toHaveBeenCalledWith('https://github.com/acme/parlor/pull/481')
  })

  test('nudge dialog delivers a note and shows the undelivered toast when the run missed it', async () => {
    setupMocks()
    mockNudge.mockResolvedValueOnce({ delivered: false })
    await renderControl()

    await waitFor(() => {
      expect(screen.getByTestId('live-now-103-nudge')).toBeTruthy()
    })
    await fireEvent.press(screen.getByTestId('live-now-103-nudge'))

    expect(screen.getByTestId('nudge-dialog')).toBeTruthy()
    await fireEvent.changeText(screen.getByTestId('nudge-note-input'), 'also update the docs')
    await fireEvent.press(screen.getByTestId('nudge-confirm'))

    await waitFor(() => {
      expect(mockNudge).toHaveBeenCalledWith(503, 'also update the docs')
    })
    await waitFor(() => {
      expect(screen.getByTestId('toast-message')).toHaveTextContent('note saved for the next attempt')
    })
  })

  test('slot pill appears when a workspace has spare capacity and a queued ticket', async () => {
    setupMocks()
    await renderControl()

    await waitFor(() => {
      expect(screen.getByTestId('slot-pill')).toBeTruthy()
    })
    expect(screen.getByText('1 slot free — next: Wire up webhook retries with backoff')).toBeTruthy()

    await fireEvent.press(screen.getByTestId('slot-pill-start'))
    await waitFor(() => {
      expect(mockMoveTicket).toHaveBeenCalledWith(104, { columnId: 11, position: expect.any(Number) })
    })
  })

  test('slot pill is hidden when the workspace has no spare concurrency', async () => {
    setupMocks({ workspaces: [workspace({ runningCount: 2, concurrency: 2 })] })
    await renderControl()

    await waitFor(() => {
      expect(screen.getByTestId('needs-you-101')).toBeTruthy()
    })
    expect(screen.queryByTestId('slot-pill')).toBeNull()
  })

  test('slot pill is hidden when there is no queued ticket', async () => {
    const board = defaultBoard()
    const readyColumn = board.columns.find((c) => c.id === 11)!
    readyColumn.tickets = [failedTicket]
    setupMocks({ board })
    await renderControl()

    await waitFor(() => {
      expect(screen.getByTestId('needs-you-101')).toBeTruthy()
    })
    expect(screen.queryByTestId('slot-pill')).toBeNull()
  })

  test('today card maps activity types to their glyphs', async () => {
    setupMocks()
    await renderControl()

    await waitFor(() => {
      expect(screen.getByTestId('today-card')).toBeTruthy()
    })
    expect(screen.getByTestId('today-card')).toHaveTextContent(/✱/)
    expect(screen.getByTestId('today-card')).toHaveTextContent(/\+ Filed a follow-up/)
    expect(screen.getByTestId('today-card')).toHaveTextContent(/✎/)
    expect(screen.getByTestId('today-card')).toHaveTextContent(/✕/)
  })

  test('wide layout renders the Rail and two-column grid', async () => {
    setupMocks()
    setWindowWidth(1400)
    await renderControl()

    await waitFor(() => {
      expect(screen.getByTestId('control-wide')).toBeTruthy()
    })
    expect(screen.getByTestId('control-rail')).toBeTruthy()
    expect(screen.queryByTestId('control-narrow')).toBeNull()
  })

  test('narrow layout renders the mobile artboard with BottomStrip', async () => {
    setupMocks()
    setWindowWidth(500)
    await renderControl()

    await waitFor(() => {
      expect(screen.getByTestId('control-narrow')).toBeTruthy()
    })
    expect(screen.getByTestId('control-bottom-strip')).toBeTruthy()
    expect(screen.getByTestId('live-digest')).toBeTruthy()
    expect(screen.queryByTestId('control-rail')).toBeNull()
  })

  test('live-now elapsed label reflects the run\'s startedAt against the current time', async () => {
    setupMocks()
    await renderControl()

    await waitFor(() => {
      expect(screen.getByTestId('live-now-103-status')).toHaveTextContent(/12m/)
    })
  })

  test('shows the empty state and creates a workspace when there are none', async () => {
    setupMocks({ workspaces: [] })
    mockCreateWorkspace.mockResolvedValueOnce(workspace({ id: 42, name: 'New One' }))
    await renderControl()

    await waitFor(() => {
      expect(screen.getByText('No workspaces yet — create one to start dispatching work.')).toBeTruthy()
    })

    await fireEvent.press(screen.getByText('New workspace'))
    await fireEvent.changeText(screen.getByTestId('workspace-name-input'), 'New One')
    await fireEvent.press(screen.getByTestId('workspace-create-button'))

    await waitFor(() => {
      expect(mockCreateWorkspace).toHaveBeenCalledWith('New One')
    })
    expect(mockPush).toHaveBeenCalledWith('/workspaces/42/board')
  })
})
