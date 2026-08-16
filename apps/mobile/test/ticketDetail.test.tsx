import type { ApiBoard, ApiComment, ApiMemory, ApiRun, ApiTicket, ApiWorkspaceDetail } from '@tada/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { Linking } from 'react-native'
import TicketDetail from '../app/tickets/[id]'
import { ConnectionProvider } from '../src/ConnectionContext'
import { attemptRows, memorySummary, sendItBackCopy, ticketMetaLine, ticketStatusBadge } from '../src/ticketDetail'

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockBack = jest.fn()
const mockCanGoBack = jest.fn(() => true)
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: '1' }),
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack, canGoBack: mockCanGoBack }),
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
const mockMemory = jest.fn()
const mockComment = jest.fn()
const mockPatchTicket = jest.fn()
const mockAccept = jest.fn()
const mockSendBack = jest.fn()

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
      memory: mockMemory,
      comment: mockComment,
      patchTicket: mockPatchTicket,
      accept: mockAccept,
      sendBack: mockSendBack,
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
    sources: [{ type: 'repo', name: 'parlor-web', url: 'https://github.com/x/parlor-web' }],
    ...overrides,
  }
}

function ticket(overrides: Partial<ApiTicket> = {}): ApiTicket {
  return {
    id: 1,
    workspaceId: 1,
    columnId: 1,
    title: 'Add CSV export to the reports page',
    description: 'Add an export button to /reports.',
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

function run(overrides: Partial<ApiRun> = {}): ApiRun {
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

function memory(overrides: Partial<ApiMemory> = {}): ApiMemory {
  return { agentsMd: '', notes: [], ...overrides }
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

describe('ticketDetail pure logic', () => {
  test('attemptRows computes "ran 34m" from started/finished on the current attempt', () => {
    const rows = attemptRows(
      [
        run({
          id: 10,
          attemptNumber: 2,
          status: 'needs_review',
          prUrl: 'https://example.com/pull/481',
          startedAt: '2026-01-01T00:00:00.000Z',
          finishedAt: '2026-01-01T00:34:00.000Z',
        }),
      ],
      [],
    )
    expect(rows[0]).toMatchObject({ current: true, primary: '#2 in review now' })
    expect(rows[0]!.detail).toBe('pr #481 · ran 34m')
  })

  test('attemptRows pairs an earlier sent-back attempt with its feedback comment, latest first', () => {
    const rows = attemptRows(
      [
        run({ id: 1, attemptNumber: 1, status: 'needs_review', finishedAt: '2026-01-01T00:00:00.000Z' }),
        run({ id: 2, attemptNumber: 2, status: 'needs_review', finishedAt: '2026-01-02T00:00:00.000Z' }),
      ],
      [comment({ id: 5, kind: 'feedback', body: 'ignored the active filters', createdAt: '2026-01-01T12:00:00.000Z' })],
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]!.current).toBe(true)
    expect(rows[1]!.current).toBe(false)
    expect(rows[1]!.primary).toMatch(/^#1 sent back/)
    expect(rows[1]!.quote).toBe('"ignored the active filters"')
  })

  test('ticketMetaLine composes workspace, first source, relative created, and who', () => {
    expect(ticketMetaLine('parlor', 'parlor-web', new Date().toISOString(), 'human')).toMatch(
      /^parlor · parlor-web · created .+ by you$/,
    )
    expect(ticketMetaLine('parlor', undefined, new Date().toISOString(), 'agent')).toMatch(/by agent$/)
  })

  test('ticketStatusBadge maps column kind to the three-signal badge, held overrides all', () => {
    expect(ticketStatusBadge('in_review', null)).toEqual({ status: 'accepted', label: 'your turn' })
    expect(ticketStatusBadge('in_progress', null)).toEqual({ status: 'live', label: 'live' })
    expect(ticketStatusBadge('backlog', 'held')).toEqual({ status: 'failed', label: 'failed' })
    expect(ticketStatusBadge('backlog', null)).toBeNull()
  })

  test('memorySummary lowercases kept titles and pulls out the newest agent note, highlighted', () => {
    const summary = memorySummary([
      { id: 1, scope: 'workspace', workspaceId: 1, file: 'conventions.md', title: 'Conventions', author: 'human', runId: null, state: 'kept', body: '', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 2, scope: 'workspace', workspaceId: 1, file: 'testing.md', title: 'Testing', author: 'human', runId: null, state: 'kept', body: '', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 3, scope: 'workspace', workspaceId: 1, file: 'note.md', title: 'Reports queries', author: 'agent', runId: 1, state: 'kept', body: 'reports queries paginate past 50k rows', updatedAt: '2026-01-02T00:00:00.000Z' },
    ])
    expect(summary.keptTitles).toEqual(['conventions', 'testing'])
    expect(summary.highlighted).toBe('reports queries paginate past 50k rows')
  })

  test('sendItBackCopy names the next attempt number, not a hardcoded one', () => {
    expect(sendItBackCopy(3)).toBe(
      "Your feedback becomes attempt 3's first instruction, verbatim. Be as specific as the brief.",
    )
    expect(sendItBackCopy(5)).toContain("attempt 5's")
  })
})

describe('Ticket detail screen', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCanGoBack.mockReturnValue(true)
    mockTicket.mockResolvedValue({ ticket: ticket(), comments: [], runs: [], followUps: [] })
    mockGetWorkspace.mockResolvedValue(workspace())
    mockBoard.mockResolvedValue(board())
    mockMemory.mockResolvedValue(memory())
    mockComment.mockResolvedValue(comment({ id: 99, body: 'new comment' }))
    mockPatchTicket.mockResolvedValue(ticket({}))
    mockAccept.mockResolvedValue(ticket({ columnId: 5 }))
    mockSendBack.mockResolvedValue(ticket({ columnId: 2 }))
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true)
  })

  test('the "← Control" back button goes back when there is history, else falls back to /workspaces', async () => {
    await renderScreen()
    await waitFor(() => expect(screen.getByTestId('ticket-back')).toBeTruthy())

    await fireEvent.press(screen.getByTestId('ticket-back'))
    expect(mockBack).toHaveBeenCalled()

    mockCanGoBack.mockReturnValue(false)
    await fireEvent.press(screen.getByTestId('ticket-back'))
    expect(mockReplace).toHaveBeenCalledWith('/workspaces')
  })

  test('review card renders only when the ticket sits in the in_review column', async () => {
    mockTicket.mockResolvedValueOnce({
      ticket: ticket({ columnId: 1 }),
      comments: [],
      runs: [run({ id: 20, status: 'needs_review' })],
      followUps: [],
    })
    await renderScreen()
    await waitFor(() => expect(screen.getByTestId('ticket-title')).toBeTruthy())
    expect(screen.queryByTestId('review-card')).toBeNull()
  })

  test('review card shows the agent summary, pr/diff/tests sub-line, and the accept-closes helper copy', async () => {
    mockTicket.mockResolvedValueOnce({
      ticket: ticket({ columnId: 4 }),
      comments: [],
      runs: [
        run({
          id: 20,
          attemptNumber: 2,
          status: 'needs_review',
          summary: 'filters and date range now forwarded into the export query',
          prUrl: 'https://example.com/pull/481',
          diffAdditions: 412,
          diffDeletions: 38,
          testsPassed: 214,
        }),
      ],
      followUps: [],
    })
    await renderScreen()

    await waitFor(() => expect(screen.getByTestId('review-card')).toBeTruthy())
    expect(screen.getByTestId('review-card')).toHaveTextContent(/filters and date range now forwarded/)
    expect(screen.getByTestId('review-card')).toHaveTextContent('pr #481 · +412 −38 · 214 tests pass', { exact: false })
    expect(screen.getByTestId('review-card')).toHaveTextContent('On accept the ticket is closed.', { exact: false })
    expect(screen.getByTestId('review-card-open-pr')).toBeTruthy()
  })

  test('accept run calls the accept mutation and plays the tada star', async () => {
    // Persistent (not `Once`): accept's onSuccess invalidates the ticket query, which refetches —
    // this keeps that refetch resolving the same in-review ticket, so the celebration is
    // observed in isolation from the (real, separate) fact that a real server response would
    // also move the ticket out of review.
    mockTicket.mockResolvedValue({
      ticket: ticket({ columnId: 4 }),
      comments: [],
      runs: [run({ id: 20, attemptNumber: 2, status: 'needs_review' })],
      followUps: [],
    })
    await renderScreen()
    await waitFor(() => expect(screen.getByTestId('review-card-accept')).toBeTruthy())

    await fireEvent.press(screen.getByTestId('review-card-accept'))

    await waitFor(() => expect(mockAccept).toHaveBeenCalledWith(1))
    await waitFor(() => expect(screen.getByTestId('review-card-tada')).toBeTruthy())
  })

  test('send back opens a dialog and calls the send-back mutation with the feedback', async () => {
    mockTicket.mockResolvedValueOnce({
      ticket: ticket({ columnId: 4 }),
      comments: [],
      runs: [run({ id: 20, attemptNumber: 2, status: 'needs_review' })],
      followUps: [],
    })
    await renderScreen()
    await waitFor(() => expect(screen.getByTestId('review-card-send-back')).toBeTruthy())

    await fireEvent.press(screen.getByTestId('review-card-send-back'))
    await fireEvent.changeText(screen.getByTestId('send-back-feedback-input'), 'still missing the date filter')
    await fireEvent.press(screen.getByTestId('send-back-confirm'))

    await waitFor(() => expect(mockSendBack).toHaveBeenCalledWith(1, 'still missing the date filter'))
  })

  test('open pr opens the run pr url', async () => {
    mockTicket.mockResolvedValueOnce({
      ticket: ticket({ columnId: 4 }),
      comments: [],
      runs: [run({ id: 20, attemptNumber: 2, status: 'needs_review', prUrl: 'https://example.com/pull/481' })],
      followUps: [],
    })
    await renderScreen()
    await waitFor(() => expect(screen.getByTestId('review-card-open-pr')).toBeTruthy())

    await fireEvent.press(screen.getByTestId('review-card-open-pr'))
    expect(Linking.openURL).toHaveBeenCalledWith('https://example.com/pull/481')
  })

  test('memory card joins kept titles and the highlighted newest agent note with no dangling separator', async () => {
    mockMemory.mockResolvedValueOnce(
      memory({
        notes: [
          { id: 1, scope: 'workspace', workspaceId: 1, file: 'conventions.md', title: 'Conventions', author: 'human', runId: null, state: 'kept', body: '', updatedAt: '2026-01-01T00:00:00.000Z' },
          { id: 2, scope: 'workspace', workspaceId: 1, file: 'testing.md', title: 'Testing', author: 'human', runId: null, state: 'kept', body: '', updatedAt: '2026-01-01T00:00:00.000Z' },
          { id: 3, scope: 'workspace', workspaceId: 1, file: 'note.md', title: 'Reports queries', author: 'agent', runId: 1, state: 'kept', body: 'reports queries paginate past 50k rows', updatedAt: '2026-01-02T00:00:00.000Z' },
        ],
      }),
    )
    await renderScreen()

    await waitFor(() => expect(screen.getByTestId('memory-card')).toBeTruthy())
    expect(screen.getByTestId('memory-card')).toHaveTextContent(
      'conventions · testing · reports queries paginate past 50k rows',
      { exact: false },
    )
    expect(screen.getByTestId('memory-card')).not.toHaveTextContent('testing · ·', { exact: false })
  })

  test('memory card has no trailing separator when there is no kept agent note', async () => {
    mockMemory.mockResolvedValueOnce(
      memory({
        notes: [
          { id: 1, scope: 'workspace', workspaceId: 1, file: 'conventions.md', title: 'Conventions', author: 'human', runId: null, state: 'kept', body: '', updatedAt: '2026-01-01T00:00:00.000Z' },
          { id: 2, scope: 'workspace', workspaceId: 1, file: 'testing.md', title: 'Testing', author: 'human', runId: null, state: 'kept', body: '', updatedAt: '2026-01-01T00:00:00.000Z' },
        ],
      }),
    )
    await renderScreen()

    await waitFor(() => expect(screen.getByTestId('memory-card')).toBeTruthy())
    expect(screen.getByTestId('memory-card')).toHaveTextContent('conventions · testing', { exact: false })
    expect(screen.getByTestId('memory-card')).not.toHaveTextContent('testing ·', { exact: false })
  })

  test('thread: feedback comments get a "sent back:" prefix in the user bubble', async () => {
    mockTicket.mockResolvedValueOnce({
      ticket: ticket(),
      comments: [comment({ id: 1, kind: 'feedback', body: 'ignored the active filters' })],
      runs: [],
      followUps: [],
    })
    await renderScreen()

    await waitFor(() => expect(screen.getByTestId('comment-1')).toBeTruthy())
    expect(screen.getByTestId('comment-1')).toHaveTextContent('sent back: ignored the active filters', { exact: false })
  })

  test('thread: nudge comments get a mono "(nudge)" suffix', async () => {
    mockTicket.mockResolvedValueOnce({
      ticket: ticket(),
      comments: [comment({ id: 1, kind: 'nudge', body: 'also update the docs' })],
      runs: [],
      followUps: [],
    })
    await renderScreen()

    await waitFor(() => expect(screen.getByTestId('comment-1')).toBeTruthy())
    expect(screen.getByTestId('comment-1')).toHaveTextContent('also update the docs (nudge)', { exact: false })
  })

  test('thread: agent comments stay in the mono ▸ voice, unaffected by kind prefixing', async () => {
    mockTicket.mockResolvedValueOnce({
      ticket: ticket(),
      comments: [comment({ id: 1, author: 'agent', kind: 'note', body: 'opened pr #481' })],
      runs: [],
      followUps: [],
    })
    await renderScreen()

    await waitFor(() => expect(screen.getByTestId('comment-1')).toBeTruthy())
    expect(screen.getByTestId('comment-1')).toHaveTextContent('▸ opened pr #481', { exact: false })
  })

  test('attempts card renders the current attempt duration and an earlier sent-back attempt with its quote', async () => {
    mockTicket.mockResolvedValueOnce({
      ticket: ticket({ columnId: 4 }),
      comments: [comment({ id: 5, kind: 'feedback', body: 'ignored the active filters', createdAt: '2026-01-01T12:00:00.000Z' })],
      runs: [
        run({ id: 1, attemptNumber: 1, status: 'needs_review', finishedAt: '2026-01-01T00:00:00.000Z' }),
        run({
          id: 2,
          attemptNumber: 2,
          status: 'needs_review',
          prUrl: 'https://example.com/pull/481',
          startedAt: '2026-01-02T00:00:00.000Z',
          finishedAt: '2026-01-02T00:34:00.000Z',
        }),
      ],
      followUps: [],
    })
    await renderScreen()

    await waitFor(() => expect(screen.getByTestId('attempts-card')).toBeTruthy())
    expect(screen.getByTestId('attempts-card-row-2')).toHaveTextContent('#2 in review now', { exact: false })
    expect(screen.getByTestId('attempts-card-row-2')).toHaveTextContent('pr #481 · ran 34m', { exact: false })
    expect(screen.getByTestId('attempts-card-row-1')).toHaveTextContent(/^#1 sent back/)
    expect(screen.getByTestId('attempts-card-row-1')).toHaveTextContent('"ignored the active filters"', { exact: false })
  })

  test('linked card renders follow-ups and is absent when there are none', async () => {
    mockTicket.mockResolvedValueOnce({
      ticket: ticket(),
      comments: [],
      runs: [],
      followUps: [{ id: 7, title: 'Paginate the legacy /reports/all endpoint', proposalState: null }],
    })
    await renderScreen()

    await waitFor(() => expect(screen.getByTestId('linked-card')).toBeTruthy())
    expect(screen.getByTestId('linked-card')).toHaveTextContent('Paginate the legacy /reports/all endpoint', { exact: false })
    expect(screen.getByTestId('linked-card')).toHaveTextContent('proposed by agent · in backlog', { exact: false })
  })

  test('linked card is hidden when the ticket has no follow-ups', async () => {
    mockTicket.mockResolvedValueOnce({ ticket: ticket(), comments: [], runs: [], followUps: [] })
    await renderScreen()

    await waitFor(() => expect(screen.getByTestId('ticket-title')).toBeTruthy())
    expect(screen.queryByTestId('linked-card')).toBeNull()
  })

  test('sending a comment calls the client and clears the input', async () => {
    mockTicket.mockResolvedValueOnce({ ticket: ticket(), comments: [], runs: [], followUps: [] })
    await renderScreen()

    await waitFor(() => expect(screen.getByTestId('comment-input')).toBeTruthy())
    await fireEvent.changeText(screen.getByTestId('comment-input'), 'new comment')
    await fireEvent.press(screen.getByTestId('comment-send'))

    await waitFor(() => expect(mockComment).toHaveBeenCalledWith(1, 'new comment'))
    expect(screen.getByTestId('comment-input').props.value).toBe('')
  })

  test('a failed comment send keeps the draft text instead of clearing it', async () => {
    mockTicket.mockResolvedValueOnce({ ticket: ticket(), comments: [], runs: [], followUps: [] })
    mockComment.mockRejectedValueOnce(new Error('network down'))
    await renderScreen()

    await waitFor(() => expect(screen.getByTestId('comment-input')).toBeTruthy())
    await fireEvent.changeText(screen.getByTestId('comment-input'), 'will fail')
    await fireEvent.press(screen.getByTestId('comment-send'))

    await waitFor(() => expect(mockComment).toHaveBeenCalledWith(1, 'will fail'))
    expect(screen.getByTestId('comment-input').props.value).toBe('will fail')
  })

  test('editing the brief is blocked while a run is queued or running', async () => {
    mockTicket.mockResolvedValueOnce({
      ticket: ticket(),
      comments: [],
      runs: [run({ id: 40, status: 'running' })],
      followUps: [],
    })
    await renderScreen()

    await waitFor(() => expect(screen.getByTestId('brief-edit-trigger')).toBeTruthy())
    await fireEvent.press(screen.getByTestId('brief-edit-trigger'))

    expect(screen.queryByTestId('brief-title-input')).toBeNull()
  })

  test('editing the brief is allowed with no active run and saves via patchTicket', async () => {
    mockTicket.mockResolvedValueOnce({ ticket: ticket(), comments: [], runs: [], followUps: [] })
    await renderScreen()

    await waitFor(() => expect(screen.getByTestId('brief-edit-trigger')).toBeTruthy())
    await fireEvent.press(screen.getByTestId('brief-edit-trigger'))
    expect(screen.getByTestId('brief-title-input')).toBeTruthy()

    await fireEvent.changeText(screen.getByTestId('brief-title-input'), 'Updated title')
    await fireEvent.press(screen.getByTestId('brief-edit-save'))

    await waitFor(() =>
      expect(mockPatchTicket).toHaveBeenCalledWith(1, {
        title: 'Updated title',
        description: 'Add an export button to /reports.',
      }),
    )
  })
})
