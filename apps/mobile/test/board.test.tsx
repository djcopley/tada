import type { ApiBoard, ApiTicket, ApiWorkspaceDetail } from '@tada/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react-native'
import Board from '../app/workspaces/[id]/board'
import { ConnectionProvider } from '../src/ConnectionContext'

const mockPush = jest.fn()
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: '1' }),
  useRouter: () => ({ push: mockPush }),
  Stack: Object.assign(() => null, { Screen: () => null }),
}))

jest.mock('../src/settings', () => ({
  loadConnection: jest.fn(async () => ({ baseUrl: 'https://example.com', token: 'secret' })),
  saveConnection: jest.fn(async () => undefined),
  clearConnection: jest.fn(async () => undefined),
}))

jest.mock('../src/api/useWorkspaceSocket', () => ({
  useWorkspaceSocket: jest.fn(),
}))

const mockBoard = jest.fn()
const mockGetWorkspace = jest.fn()
const mockCreateTicket = jest.fn()
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
      wsUrl: () => 'wss://example.com/ws',
    })),
  }
})

function workspace(overrides: Partial<ApiWorkspaceDetail> = {}): ApiWorkspaceDetail {
  return {
    id: 1,
    name: 'Alpha',
    defaultAdapter: 'claude',
    defaultModel: 'sonnet',
    defaultEffort: 'default',
    concurrency: 1,
    timeoutMs: 60_000,
    createdAt: '2026-01-01T00:00:00.000Z',
    sources: [],
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
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function board(overrides: Partial<ApiBoard> = {}): ApiBoard {
  return {
    columns: [
      { id: 1, workspaceId: 1, kind: 'backlog', title: 'Backlog', position: 1, tickets: [] },
      { id: 2, workspaceId: 1, kind: 'ready', title: 'Ready', position: 2, tickets: [] },
      { id: 3, workspaceId: 1, kind: 'in_progress', title: 'In Progress', position: 3, tickets: [] },
      { id: 4, workspaceId: 1, kind: 'in_review', title: 'In Review', position: 4, tickets: [] },
      { id: 5, workspaceId: 1, kind: 'done', title: 'Done', position: 5, tickets: [] },
    ],
    ...overrides,
  }
}

async function renderBoard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
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
    mockGetWorkspace.mockResolvedValue(workspace())
  })

  test('renders all 5 columns with titles', async () => {
    mockBoard.mockResolvedValueOnce(board())

    await renderBoard()

    await waitFor(() => {
      expect(screen.getByText('Backlog')).toBeTruthy()
    })
    expect(screen.getByText('Ready')).toBeTruthy()
    expect(screen.getByText('In Progress')).toBeTruthy()
    expect(screen.getByText('In Review')).toBeTruthy()
    expect(screen.getByText('Done')).toBeTruthy()
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

  test('ticket card shows fallback chip text from workspace defaults', async () => {
    mockBoard.mockResolvedValueOnce(
      board({
        columns: [
          {
            id: 1,
            workspaceId: 1,
            kind: 'backlog',
            title: 'Backlog',
            position: 1,
            tickets: [ticket({ id: 20, title: 'Fallback ticket' })],
          },
        ],
      }),
    )

    await renderBoard()

    await waitFor(() => {
      expect(screen.getByText('Fallback ticket')).toBeTruthy()
    })
    expect(screen.getByText('#20 · claude · sonnet')).toBeTruthy()
  })

  test('ticket card shows override chip text when set', async () => {
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
              ticket({ id: 21, title: 'Override ticket', adapterOverride: 'codex', modelOverride: 'gpt-5' }),
            ],
          },
        ],
      }),
    )

    await renderBoard()

    await waitFor(() => {
      expect(screen.getByText('Override ticket')).toBeTruthy()
    })
    expect(screen.getByText('#21 · codex · gpt-5')).toBeTruthy()
  })

  test('shows queued, held, and in-progress glyphs correctly', async () => {
    mockBoard.mockResolvedValueOnce(
      board({
        columns: [
          {
            id: 1,
            workspaceId: 1,
            kind: 'backlog',
            title: 'Backlog',
            position: 1,
            tickets: [ticket({ id: 30, title: 'Queued ticket', queueState: 'queued' })],
          },
          {
            id: 2,
            workspaceId: 1,
            kind: 'ready',
            title: 'Ready',
            position: 2,
            tickets: [ticket({ id: 31, title: 'Held ticket', queueState: 'held' })],
          },
          {
            id: 3,
            workspaceId: 1,
            kind: 'in_progress',
            title: 'In Progress',
            position: 3,
            tickets: [ticket({ id: 32, title: 'Running ticket', queueState: null })],
          },
        ],
      }),
    )

    await renderBoard()

    await waitFor(() => {
      expect(screen.getByText('Queued ticket')).toBeTruthy()
    })
    expect(screen.getByTestId('ticket-glyph-30')).toHaveTextContent('Queued')
    expect(screen.getByTestId('ticket-glyph-31')).toHaveTextContent('Failed')
    expect(screen.getByTestId('ticket-glyph-32')).toHaveTextContent('Live')
  })

  test('add ticket footer only appears on the backlog column', async () => {
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
})
