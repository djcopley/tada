import type { ApiBoard, ApiRun, ApiTicket } from '@tada/shared'
import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { Dimensions } from 'react-native'
import Board from '../app/(tabs)/board'
import { ConnectionProvider } from '../src/ConnectionContext'
import { makeTestQueryClient } from './helpers/queryClient'

const WIDE_WIDTH = 1280
const NARROW_WIDTH = 500
const FROZEN_NOW = new Date('2026-08-17T12:00:00.000Z').getTime()

function setWidth(width: number) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height: 900, scale: 1, fontScale: 1 })
}

const mockPush = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, navigate: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  Stack: Object.assign(() => null, { Screen: () => null }),
}))

jest.mock('../src/settings', () => ({
  loadConnection: jest.fn(async () => ({ baseUrl: 'https://example.com', token: 'secret' })),
  saveConnection: jest.fn(async () => undefined),
  clearConnection: jest.fn(async () => undefined),
  loadThemeScheme: jest.fn(async () => 'night'),
  saveThemeScheme: jest.fn(async () => undefined),
}))

jest.mock('../src/api/useAppSocket', () => ({ useAppSocket: jest.fn() }))

// The board's drag/measure machinery awaits `View.measureInWindow`, whose native callback never
// fires under the RN test renderer — resolve it with a generous rect instead.
jest.mock('../src/board/dnd', () => ({
  ...jest.requireActual('../src/board/dnd'),
  measureInWindow: jest.fn(async () => ({ x: 0, y: 0, width: 2000, height: 2000 })),
}))

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}))

const mockBoard = jest.fn()
const mockSources = jest.fn()
const mockRunEvents = jest.fn()
const mockApprove = jest.fn()
const mockMoveTicket = jest.fn()
const mockProposal = jest.fn()
const mockCreateTicket = jest.fn()
const mockDuplicate = jest.fn()
const mockDeleteTicket = jest.fn()
const mockCancelRun = jest.fn()
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
      sources: mockSources,
      runEvents: mockRunEvents,
      approve: mockApprove,
      moveTicket: mockMoveTicket,
      proposal: mockProposal,
      createTicket: mockCreateTicket,
      duplicateTicket: mockDuplicate,
      deleteTicket: mockDeleteTicket,
      cancelRun: mockCancelRun,
      wsUrl: () => 'wss://example.com/ws',
    })),
  }
})

function run(overrides: Partial<ApiRun>): ApiRun {
  return {
    id: 4128,
    ticketId: 1,
    adapter: 'claude',
    model: 'sonnet',
    effort: 'medium',
    attemptNumber: 1,
    status: 'queued',
    heldReason: null,
    hold: null,
    heldAt: null,
    budgetMs: 1_800_000,
    summary: null,
    diffAdditions: null,
    diffDeletions: null,
    testsPassed: null,
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-08-17T09:00:00.000Z',
    ...overrides,
  }
}

function ticket(overrides: Partial<ApiTicket>): ApiTicket {
  return {
    id: 1,
    column: 'backlog',
    title: 'Ticket',
    description: '',
    position: 1,
    repoTags: [],
    origin: 'human',
    adapter: null,
    model: null,
    proposalState: null,
    followUpOfTicketId: null,
    createdAt: '2026-08-15T12:00:00.000Z',
    doneAt: null,
    run: null,
    ...overrides,
  }
}

const emptyBoard = (): ApiBoard => ({ backlog: [], queued: [], running: [], stopped: [], done: [] })

const heldTicket = ticket({
  id: 7,
  column: 'stopped',
  title: 'Add CSV export to the reports page',
  repoTags: ['parlor-web'],
  run: run({
    id: 4128,
    ticketId: 7,
    status: 'held',
    heldReason: 'permission',
    heldAt: '2026-08-17T09:46:00.000Z',
    startedAt: '2026-08-17T09:00:00.000Z',
    hold: {
      reason: 'permission',
      tool: 'Bash',
      summary: 'gh pr create --base main --head csv-export',
      ruleId: 3,
      ruleTitle: 'Open a pull request',
      publishes: true,
    },
  }),
})

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
    mockSources.mockResolvedValue([{ type: 'repo', name: 'parlor-web' }, { type: 'repo', name: 'parlor-api' }])
    mockRunEvents.mockResolvedValue([])
    setWidth(WIDE_WIDTH)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('renders the five lanes with counts; done spells out its promises', async () => {
    mockBoard.mockResolvedValue({
      ...emptyBoard(),
      backlog: [ticket({ id: 10, title: 'Migrate icon set to Lucide', repoTags: ['parlor-web'] })],
      done: [ticket({ id: 11, column: 'done', title: 'Prune CI artifacts', doneAt: '2026-08-10T12:00:00.000Z' })],
    })
    await renderBoard()
    await waitFor(() => expect(screen.getByText('Backlog')).toBeTruthy())
    expect(screen.getByText('Queued')).toBeTruthy()
    expect(screen.getByText('Running')).toBeTruthy()
    expect(screen.getByText('Stopped on you')).toBeTruthy()
    expect(screen.getByText('Done')).toBeTruthy()
    expect(screen.getByTestId('lane-count-backlog')).toHaveTextContent('1')
    expect(screen.getByTestId('lane-count-done')).toHaveTextContent('1 · self-filed · undo for 24h')
    // repo tag prefix and bare age; a done card carries its age
    expect(screen.getByTestId('ticket-meta-10')).toHaveTextContent('parlor-web · 2d')
    expect(screen.getByTestId('ticket-meta-11')).toHaveTextContent('no repo · 1w')
    // "+ Add a ticket" lives at the bottom of Backlog only
    expect(screen.getByTestId('add-ticket-backlog')).toBeTruthy()
  })

  test('first run: no lanes, just the words', async () => {
    mockBoard.mockResolvedValue(emptyBoard())
    await renderBoard()
    await waitFor(() => expect(screen.getByTestId('board-first-run')).toBeTruthy())
    expect(screen.getByText('No tickets yet')).toBeTruthy()
    expect(screen.queryByText('Backlog')).toBeNull()
    fireEvent.press(screen.getByTestId('board-write-first'))
    await waitFor(() => expect(screen.getByTestId('new-ticket-dialog')).toBeTruthy())
  })

  test('a stopped card shows the reason badge, the held line and compact gate actions; Approve resumes', async () => {
    mockBoard.mockResolvedValue({ ...emptyBoard(), stopped: [heldTicket] })
    mockApprove.mockResolvedValue(undefined)
    await renderBoard()
    await waitFor(() => expect(screen.getByTestId('ticket-card-7')).toBeTruthy())
    expect(screen.getByTestId('stopped-badge-7')).toHaveTextContent('permission')
    expect(screen.getByTestId('ticket-agent-well-7')).toHaveTextContent('⏸ gh pr create --base main --head csv-export · held 2h 14m')
    fireEvent.press(screen.getByTestId('hold-approve'))
    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith(4128, expect.anything()))
    // compact: no Always allow / View diff on the card itself
    expect(screen.queryByTestId('hold-always-allow')).toBeNull()
  })

  test('running card: live elapsed, agent well, Watch live opens the run', async () => {
    mockBoard.mockResolvedValue({
      ...emptyBoard(),
      running: [
        ticket({
          id: 3,
          column: 'running',
          title: 'Fix flaky session-refresh test',
          repoTags: ['parlor-api'],
          run: run({ id: 4131, ticketId: 3, status: 'running', startedAt: '2026-08-17T11:48:00.000Z' }),
        }),
      ],
    })
    mockRunEvents.mockResolvedValue([{ id: 1, runId: 4131, type: 'text', payload: { text: 'suite ×20 — all green so far' }, createdAt: '' }])
    await renderBoard()
    await waitFor(() => expect(screen.getByTestId('ticket-agent-well-3')).toHaveTextContent(/suite ×20 — all green so far/))
    expect(screen.getByText('12m')).toBeTruthy()
    fireEvent.press(screen.getByTestId('watch-live-3'))
    expect(mockPush).toHaveBeenCalledWith('/runs/4131')
  })

  test('proposal card: dashed, keep/dismiss', async () => {
    mockBoard.mockResolvedValue({
      ...emptyBoard(),
      backlog: [
        ticket({ id: 1, title: 'Add CSV export' }),
        ticket({ id: 2, title: 'Paginate the legacy /reports/all endpoint', origin: 'agent', proposalState: 'pending', followUpOfTicketId: 1, position: 2 }),
      ],
    })
    mockProposal.mockResolvedValue(undefined)
    await renderBoard()
    await waitFor(() => expect(screen.getByText('Proposed by agent')).toBeTruthy())
    expect(screen.getByText('no repo · follow-up of add csv export')).toBeTruthy()
    fireEvent.press(screen.getByTestId('proposal-keep-2'))
    await waitFor(() => expect(mockProposal).toHaveBeenCalledWith(2, 'keep'))
  })

  test('long press opens the context sheet; the held group and move targets follow the rules', async () => {
    setWidth(NARROW_WIDTH)
    mockBoard.mockResolvedValue({ ...emptyBoard(), stopped: [heldTicket] })
    mockMoveTicket.mockResolvedValue(heldTicket)
    await renderBoard()
    await waitFor(() => expect(screen.getByTestId('ticket-card-7')).toBeTruthy())
    fireEvent(screen.getByTestId('ticket-card-7'), 'longPress')
    await waitFor(() => expect(screen.getByTestId('ticket-context-menu')).toBeTruthy())
    // held at gh pr create → the publish gate group, incl. View diff
    expect(screen.getByTestId('ctx-approve')).toBeTruthy()
    expect(screen.getByTestId('ctx-always-allow')).toBeTruthy()
    expect(screen.getByTestId('ctx-diff')).toBeTruthy()
    // a live card may only move to backlog (which stops the run)
    expect(screen.getByTestId('ctx-move-backlog')).toBeTruthy()
    expect(screen.queryByTestId('ctx-move-queued')).toBeNull()
    expect(screen.queryByTestId('ctx-move-done')).toBeNull()
    fireEvent.press(screen.getByTestId('ctx-diff'))
    expect(mockPush).toHaveBeenCalledWith('/runs/4128/diff')
  })

  test('the repo filter narrows lanes by tag', async () => {
    mockBoard.mockResolvedValue({
      ...emptyBoard(),
      backlog: [ticket({ id: 1, title: 'Web thing', repoTags: ['parlor-web'] }), ticket({ id: 2, title: 'Api thing', repoTags: ['parlor-api'], position: 2 })],
    })
    await renderBoard()
    await waitFor(() => expect(screen.getByText('Web thing')).toBeTruthy())
    fireEvent.press(screen.getByTestId('board-repo-filter'))
    await waitFor(() => expect(screen.getByTestId('board-repo-parlor-api')).toBeTruthy())
    fireEvent.press(screen.getByTestId('board-repo-parlor-api'))
    await waitFor(() => expect(screen.queryByText('Web thing')).toBeNull())
    expect(screen.getByText('Api thing')).toBeTruthy()
  })
})
