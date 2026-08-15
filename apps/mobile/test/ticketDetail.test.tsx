import type { ApiBoard, ApiComment, ApiRun, ApiTicket, ApiWorkspaceDetail } from '@tada/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { Linking } from 'react-native'
import TicketDetail from '../app/tickets/[id]'
import { ConnectionProvider } from '../src/ConnectionContext'

const mockPush = jest.fn()
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: '1' }),
  useRouter: () => ({ push: mockPush }),
}))

jest.mock('../src/settings', () => ({
  loadConnection: jest.fn(async () => ({ baseUrl: 'https://example.com', token: 'secret' })),
  saveConnection: jest.fn(async () => undefined),
  clearConnection: jest.fn(async () => undefined),
}))

jest.mock('../src/api/useWorkspaceSocket', () => ({
  useWorkspaceSocket: jest.fn(),
}))

const mockTicket = jest.fn()
const mockBoard = jest.fn()
const mockGetWorkspace = jest.fn()
const mockComment = jest.fn()
const mockPatchTicket = jest.fn()
const mockMoveTicket = jest.fn()

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
      ticket: mockTicket,
      board: mockBoard,
      getWorkspace: mockGetWorkspace,
      comment: mockComment,
      patchTicket: mockPatchTicket,
      moveTicket: mockMoveTicket,
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

function ticket(overrides: Partial<ApiTicket> = {}): ApiTicket {
  return {
    id: 1,
    workspaceId: 1,
    columnId: 1,
    title: 'Fix the bug',
    description: 'It is broken',
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

function comment(overrides: Partial<ApiComment>): ApiComment {
  return {
    id: 1,
    ticketId: 1,
    author: 'human',
    kind: 'note',
    body: 'hello',
    createdAt: '2026-01-01T00:00:00.000Z',
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
    branch: 'run-1',
    prUrl: null,
    summary: null,
    diffAdditions: null,
    diffDeletions: null,
    testsPassed: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:01:00.000Z',
    ...overrides,
  }
}

async function renderScreen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await render(
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider>
        <TicketDetail />
      </ConnectionProvider>
    </QueryClientProvider>,
  )
}

describe('Ticket detail screen', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Baseline so a background refetch after a mutation (e.g. comment send
    // invalidating the ticket query) has something to resolve with instead
    // of falling through to an unconfigured mock.
    mockTicket.mockResolvedValue({ ticket: ticket(), comments: [], runs: [] })
    mockGetWorkspace.mockResolvedValue(workspace())
    mockBoard.mockResolvedValue(board())
    mockComment.mockResolvedValue(comment({ id: 99, body: 'new comment' }))
    mockPatchTicket.mockResolvedValue(ticket({}))
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true)
  })

  test('renders the comment thread in chronological order with per-voice materials', async () => {
    mockTicket.mockResolvedValueOnce({
      ticket: ticket(),
      comments: [
        comment({ id: 1, author: 'agent', body: 'first, from agent', createdAt: '2026-01-01T00:00:00.000Z' }),
        comment({ id: 2, author: 'human', body: 'second, from you', createdAt: '2026-01-01T00:05:00.000Z' }),
      ],
      runs: [],
    })

    await renderScreen()

    await waitFor(() => {
      expect(screen.getByTestId('comment-1')).toBeTruthy()
    })

    const bubbles = screen.getAllByTestId(/^comment-\d+$/)
    expect(bubbles.map((b) => b.props.testID)).toEqual(['comment-1', 'comment-2'])

    // The two voices are told apart by their material, not alignment: the
    // agent speaks from recessed dark ink (theme-invariant #100D0B), the
    // human from a raised surface.
    const flattenStyle = (style: unknown) => (Array.isArray(style) ? Object.assign({}, ...style) : style)
    const agentBg = flattenStyle(screen.getByTestId('comment-1').props.style).backgroundColor
    const humanBg = flattenStyle(screen.getByTestId('comment-2').props.style).backgroundColor
    expect(agentBg).toBe('#100D0B')
    expect(humanBg).not.toBe(agentBg)
  })

  test('comment link strips a trailing period from the URL', async () => {
    mockTicket.mockResolvedValueOnce({
      ticket: ticket(),
      comments: [
        comment({
          id: 1,
          author: 'agent',
          body: 'Check this out https://example.com/foo. Thanks',
        }),
      ],
      runs: [],
    })

    await renderScreen()

    await waitFor(() => {
      expect(screen.getByTestId('comment-link-1-0')).toBeTruthy()
    })
    const link = screen.getByTestId('comment-link-1-0')
    expect(link).toHaveTextContent('https://example.com/foo')

    await fireEvent.press(link)
    expect(Linking.openURL).toHaveBeenCalledWith('https://example.com/foo')
  })

  test('comment link strips a trailing comma from the URL', async () => {
    mockTicket.mockResolvedValueOnce({
      ticket: ticket(),
      comments: [
        comment({ id: 1, author: 'agent', body: 'See https://example.com/foo, thanks' }),
      ],
      runs: [],
    })

    await renderScreen()

    await waitFor(() => {
      expect(screen.getByTestId('comment-link-1-0')).toBeTruthy()
    })
    const link = screen.getByTestId('comment-link-1-0')
    expect(link).toHaveTextContent('https://example.com/foo')

    await fireEvent.press(link)
    expect(Linking.openURL).toHaveBeenCalledWith('https://example.com/foo')
  })

  test('comment link strips the closing paren when the URL is wrapped in parentheses', async () => {
    mockTicket.mockResolvedValueOnce({
      ticket: ticket(),
      comments: [
        comment({
          id: 1,
          author: 'agent',
          body: 'Docs are here (https://example.com/foo) for reference',
        }),
      ],
      runs: [],
    })

    await renderScreen()

    await waitFor(() => {
      expect(screen.getByTestId('comment-link-1-0')).toBeTruthy()
    })
    const link = screen.getByTestId('comment-link-1-0')
    expect(link).toHaveTextContent('https://example.com/foo')

    await fireEvent.press(link)
    expect(Linking.openURL).toHaveBeenCalledWith('https://example.com/foo')
  })

  test('renders both run statuses', async () => {
    mockTicket.mockResolvedValueOnce({
      ticket: ticket(),
      comments: [],
      runs: [
        run({ id: 10, status: 'running' }),
        run({ id: 11, status: 'needs_review', prUrl: 'https://example.com/pr/1' }),
      ],
    })

    await renderScreen()

    await waitFor(() => {
      expect(screen.getByTestId('run-row-10')).toBeTruthy()
    })
    expect(screen.getByText(/Live/)).toBeTruthy()
    expect(screen.getByText(/Your turn/)).toBeTruthy()
  })

  test('sending a comment calls the client and clears the input', async () => {
    mockTicket.mockResolvedValueOnce({ ticket: ticket(), comments: [], runs: [] })

    await renderScreen()

    await waitFor(() => {
      expect(screen.getByTestId('comment-input')).toBeTruthy()
    })

    await fireEvent.changeText(screen.getByTestId('comment-input'), 'new comment')
    await fireEvent.press(screen.getByTestId('comment-send'))

    await waitFor(() => {
      expect(mockComment).toHaveBeenCalledWith(1, 'new comment')
    })
    expect(screen.getByTestId('comment-input').props.value).toBe('')
  })

  test('a failed comment send keeps the draft text instead of clearing it', async () => {
    mockTicket.mockResolvedValueOnce({ ticket: ticket(), comments: [], runs: [] })
    mockComment.mockRejectedValueOnce(new Error('network down'))

    await renderScreen()

    await waitFor(() => {
      expect(screen.getByTestId('comment-input')).toBeTruthy()
    })

    await fireEvent.changeText(screen.getByTestId('comment-input'), 'will fail')
    await fireEvent.press(screen.getByTestId('comment-send'))

    await waitFor(() => {
      expect(mockComment).toHaveBeenCalledWith(1, 'will fail')
    })
    // The send rejected — the draft should still hold what the user typed
    // rather than being cleared as if it had gone through.
    expect(screen.getByTestId('comment-input').props.value).toBe('will fail')
  })

  test('View PR button opens Linking with the run prUrl', async () => {
    mockTicket.mockResolvedValueOnce({
      ticket: ticket(),
      comments: [],
      runs: [run({ id: 20, status: 'needs_review', prUrl: 'https://example.com/pr/42' })],
    })

    await renderScreen()

    await waitFor(() => {
      expect(screen.getByTestId('run-pr-20')).toBeTruthy()
    })

    await fireEvent.press(screen.getByTestId('run-pr-20'))

    expect(Linking.openURL).toHaveBeenCalledWith('https://example.com/pr/42')
  })

  test('tapping a run row navigates to the run screen', async () => {
    mockTicket.mockResolvedValueOnce({
      ticket: ticket(),
      comments: [],
      runs: [run({ id: 30, status: 'failed' })],
    })

    await renderScreen()

    await waitFor(() => {
      expect(screen.getByTestId('run-row-30')).toBeTruthy()
    })

    await fireEvent.press(screen.getByTestId('run-row-30'))

    expect(mockPush).toHaveBeenCalledWith('/runs/30')
  })

  test('editing is blocked while a run is queued or running', async () => {
    mockTicket.mockResolvedValueOnce({
      ticket: ticket(),
      comments: [],
      runs: [run({ id: 40, status: 'running' })],
    })

    await renderScreen()

    await waitFor(() => {
      expect(screen.getByTestId('ticket-edit-trigger')).toBeTruthy()
    })

    await fireEvent.press(screen.getByTestId('ticket-edit-trigger'))

    expect(screen.queryByTestId('ticket-title-input')).toBeNull()
  })

  test('editing is allowed with no active run and saves via patchTicket', async () => {
    mockTicket.mockResolvedValueOnce({ ticket: ticket(), comments: [], runs: [] })

    await renderScreen()

    await waitFor(() => {
      expect(screen.getByTestId('ticket-edit-trigger')).toBeTruthy()
    })

    await fireEvent.press(screen.getByTestId('ticket-edit-trigger'))
    expect(screen.getByTestId('ticket-title-input')).toBeTruthy()

    await fireEvent.changeText(screen.getByTestId('ticket-title-input'), 'Updated title')
    await fireEvent.press(screen.getByTestId('ticket-edit-save'))

    await waitFor(() => {
      expect(mockPatchTicket).toHaveBeenCalledWith(1, { title: 'Updated title', description: 'It is broken' })
    })
  })
})
