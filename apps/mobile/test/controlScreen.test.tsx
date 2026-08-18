import type { ApiActivity, ApiBoard, ApiMemoryNote, ApiRun, ApiSettings, ApiTicket, ApiTicketDetail } from '@tada/shared'
import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { Dimensions } from 'react-native'
import Control from '../app/(tabs)/index'
import { ConnectionProvider } from '../src/ConnectionContext'
import { ToastHost } from '../src/toast'
import { makeTestQueryClient } from './helpers/queryClient'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  url: string
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }
  close() {}
}

const mockPush = jest.fn()
const mockNavigate = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, navigate: mockNavigate }),
}))

jest.mock('../src/settings', () => ({
  loadConnection: jest.fn(async () => ({ baseUrl: 'https://example.com', token: 'secret' })),
  saveConnection: jest.fn(async () => undefined),
  clearConnection: jest.fn(async () => undefined),
  loadThemeScheme: jest.fn(async () => 'night'),
  saveThemeScheme: jest.fn(async () => undefined),
}))

const mockBoard = jest.fn()
const mockTicket = jest.fn()
const mockMemory = jest.fn()
const mockActivity = jest.fn()
const mockSettings = jest.fn()
const mockRunEvents = jest.fn()
const mockApprove = jest.fn()
const mockContinueRun = jest.fn()
const mockNote = jest.fn()
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
      ticket: mockTicket,
      memory: mockMemory,
      activity: mockActivity,
      settings: mockSettings,
      runEvents: mockRunEvents,
      approve: mockApprove,
      continueRun: mockContinueRun,
      note: mockNote,
      createTicket: mockCreateTicket,
      wsUrl: () => 'wss://example.com/ws',
    })),
  }
})

let dimensionsSpy: jest.SpyInstance | undefined
let nowSpy: jest.SpyInstance | undefined
function setWindowWidth(width: number) {
  dimensionsSpy?.mockRestore()
  dimensionsSpy = jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height: 900, scale: 1, fontScale: 1 })
}

/** Local wall-clock ISO on the fixture day so hhmm()/isSinceLocalMidnight() read the intended
 * digits regardless of the runner's timezone. */
function localTime(hour: number, minute = 0): string {
  return new Date(2026, 7, 17, hour, minute, 0).toISOString()
}
const FROZEN_NOW = new Date(2026, 7, 17, 10, 0, 0).getTime()

function run(overrides: Partial<ApiRun>): ApiRun {
  return {
    id: 1,
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
    createdAt: localTime(7),
    ...overrides,
  }
}

function ticket(overrides: Partial<ApiTicket>): ApiTicket {
  return {
    id: 1,
    column: 'backlog',
    title: 'Untitled',
    description: '',
    position: 1,
    repoTags: [],
    origin: 'human',
    proposalState: null,
    followUpOfTicketId: null,
    createdAt: localTime(6),
    doneAt: null,
    run: null,
    ...overrides,
  }
}

const permissionTicket = ticket({
  id: 101,
  column: 'stopped',
  title: 'Add CSV export to the reports page',
  repoTags: ['parlor-web'],
  run: run({
    id: 4128,
    ticketId: 101,
    status: 'held',
    heldReason: 'permission',
    hold: { reason: 'permission', tool: 'Bash', summary: 'gh pr create --base main --head csv-export', ruleId: 3, ruleTitle: 'Open a pull request', publishes: true },
    heldAt: localTime(7, 46),
    startedAt: localTime(7),
    diffAdditions: 412,
    diffDeletions: 38,
    testsPassed: 214,
  }),
})
const questionTicket = ticket({
  id: 102,
  column: 'stopped',
  title: 'Wire up webhook retries with backoff',
  repoTags: ['parlor-api'],
  run: run({
    id: 4130,
    ticketId: 102,
    status: 'held',
    heldReason: 'question',
    hold: { reason: 'question', question: 'which backoff ceiling — 30s or 5m?', options: ['30s', '5m'] },
    heldAt: localTime(9, 20),
    startedAt: localTime(9),
  }),
})
const timeTicket = ticket({
  id: 103,
  column: 'stopped',
  title: 'Nightly dependency bump',
  repoTags: ['parlor-web'],
  run: run({
    id: 4127,
    ticketId: 103,
    status: 'held',
    heldReason: 'time',
    hold: { reason: 'time', budgetMs: 1_800_000 },
    heldAt: localTime(3),
    startedAt: localTime(2, 30),
  }),
})
const liveTicket = ticket({
  id: 104,
  column: 'running',
  title: 'Fix flaky session-refresh test',
  repoTags: ['parlor-api'],
  run: run({ id: 4131, ticketId: 104, status: 'running', startedAt: localTime(9, 48) }),
})
const queuedTicket = ticket({ id: 105, column: 'queued', title: 'Migrate icon set to Lucide', run: run({ id: 4140, ticketId: 105 }) })
const doneTicket = ticket({
  id: 106,
  column: 'done',
  title: 'Prune CI artifacts',
  doneAt: localTime(8, 20),
  run: run({ id: 4120, ticketId: 106, status: 'done', startedAt: localTime(7), finishedAt: localTime(8, 20), summary: 'freed 41 GB' }),
})

function defaultBoard(): ApiBoard {
  return {
    backlog: [],
    queued: [queuedTicket],
    running: [liveTicket],
    stopped: [permissionTicket, questionTicket, timeTicket],
    done: [doneTicket],
  }
}

function detail(t: ApiTicket, agentComment?: string): ApiTicketDetail {
  return {
    ...t,
    comments: agentComment
      ? [{ id: 1, ticketId: t.id, runId: t.run?.id ?? null, author: 'agent', body: agentComment, createdAt: localTime(7, 30) }]
      : [],
    runs: t.run ? [t.run] : [],
    followUps: [],
    followUpOf: null,
  }
}

function defaultDetails(): Record<number, ApiTicketDetail> {
  return {
    101: detail(permissionTicket, 'filters and date range now forwarded — work is finished, holding here'),
    102: detail(questionTicket),
    103: detail(timeTicket, 'vite 6 migration is bigger than a bump'),
    104: detail(liveTicket, 'stale comment from an earlier run'),
  }
}

const settings: ApiSettings = { adapter: 'claude', model: 'sonnet', effort: 'medium', concurrency: 1, timeoutMs: 1_800_000, pingChannel: 'push', repingMs: 0 }

function defaultMemory(): ApiMemoryNote[] {
  return [
    { id: 1, title: 'Conventions', body: 'conventional commits; prs under ~600 lines', tags: [], author: 'human', runId: null, state: 'kept', createdAt: '', updatedAt: '' },
    { id: 2, title: 'Testing', body: 'pnpm test before every pr; e2e only for checkout', tags: [], author: 'human', runId: null, state: 'kept', createdAt: '', updatedAt: '' },
    { id: 3, title: 'Reports', body: 'reports queries paginate past 50k rows', tags: [], author: 'agent', runId: 9, state: 'pending', createdAt: '', updatedAt: '' },
  ]
}

function activity(overrides: Partial<ApiActivity>): ApiActivity {
  return { id: 1, ticketId: null, runId: null, type: 'ticket_created', ticketTitle: null, message: '', createdAt: localTime(9), ...overrides }
}

function defaultActivity(): ApiActivity[] {
  return [
    activity({ id: 5, type: 'run_started', ticketId: 104, ticketTitle: 'Fix flaky session-refresh test', message: 'Agent started "Fix flaky session-refresh test"', createdAt: localTime(9, 49) }),
    activity({ id: 4, type: 'run_done', ticketId: 106, ticketTitle: 'Prune CI artifacts', message: '"Prune CI artifacts" finished and moved itself to done — freed 41 GB', createdAt: localTime(8, 20) }),
    activity({ id: 3, type: 'always_allowed', ticketId: 99, ticketTitle: 'x', message: 'You approved pnpm db:migrate and made it always allow — rule "Run a database migration" updated', createdAt: localTime(8, 4) }),
    activity({ id: 2, type: 'run_held', ticketId: 103, ticketTitle: 'Nightly dependency bump', message: '"Nightly dependency bump" hit the 30m limit — stopped on you', createdAt: localTime(3, 12) }),
    activity({ id: 1, type: 'ticket_created', ticketId: 1, ticketTitle: 'Old', message: 'You created "Old"', createdAt: new Date(2026, 7, 10, 9).toISOString() }),
  ]
}

function setupMocks({
  board = defaultBoard(),
  details = defaultDetails(),
  memory = defaultMemory(),
  activities = defaultActivity(),
  runEvents = {} as Record<number, { id: number; runId: number; type: string; payload: unknown; createdAt: string }[]>,
} = {}) {
  mockBoard.mockResolvedValue(board)
  mockTicket.mockImplementation(async (id: number) => details[id])
  mockMemory.mockResolvedValue(memory)
  mockActivity.mockResolvedValue(activities)
  mockSettings.mockResolvedValue(settings)
  mockRunEvents.mockImplementation(async (runId: number) => runEvents[runId] ?? [])
  mockApprove.mockResolvedValue(undefined)
  mockContinueRun.mockResolvedValue(undefined)
  mockNote.mockResolvedValue({ comment: {}, delivered: true })
  mockCreateTicket.mockImplementation(async (t: { title: string; column?: string }) => ticket({ id: 900, title: t.title, column: (t.column as 'backlog') ?? 'backlog' }))
}

/** RTL's fireEvent is async here (it wraps the handler in act) — an unawaited press leaves React
 * mid-update, and the *next* test's render then never commits. Always await it. */
async function press(node: ReturnType<typeof screen.getByTestId>) {
  await fireEvent.press(node)
}

async function renderControl() {
  const queryClient = makeTestQueryClient()
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
  const realWebSocket = global.WebSocket

  beforeEach(() => {
    jest.clearAllMocks()
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW)
    setWindowWidth(1400)
    FakeWebSocket.instances = []
    global.WebSocket = FakeWebSocket as unknown as typeof WebSocket
  })

  afterEach(() => {
    // Only the spies are restored: `jest.restoreAllMocks()` would also wipe the module-mock
    // implementations (loadConnection, TadaClient) that every test relies on.
    nowSpy?.mockRestore()
    dimensionsSpy?.mockRestore()
    dimensionsSpy = undefined
    global.WebSocket = realWebSocket
  })

  test('headline counts the stopped lane; overnight subline counts finished + self-filed runs', async () => {
    setupMocks()
    await renderControl()
    await waitFor(() => expect(screen.getByTestId('control-headline')).toHaveTextContent('Three runs are stopped on you'))
    expect(screen.getByTestId('control-subline')).toHaveTextContent('1 ran overnight · 1 moved itself to done')
    expect(screen.getByTestId('control-live-chip')).toHaveTextContent('1 agent live')
  })

  test('one card per stopped ticket, with the reason badge, the hold line and the right actions', async () => {
    setupMocks()
    await renderControl()
    await waitFor(() => expect(screen.getByTestId('stopped-101')).toBeTruthy())

    expect(screen.getByTestId('stopped-101-badge')).toHaveTextContent('permission')
    expect(screen.getByTestId('stopped-101-well')).toHaveTextContent('gh pr create --base main --head csv-export', { exact: false })
    expect(screen.getByTestId('stopped-101-well')).toHaveTextContent('work is finished, holding here', { exact: false })
    expect(screen.getByTestId('stopped-101')).toHaveTextContent('run #4128 · +412 −38 · 214 tests pass', { exact: false })
    expect(screen.getByTestId('stopped-101')).toHaveTextContent('parlor-web · held 2h 14m', { exact: false })
    // permission → Approve / Always allow / Deny / View diff (a publish gate)
    const permissionActions = screen.getByTestId('stopped-101-actions')
    expect(permissionActions).toHaveTextContent('Approve', { exact: false })
    expect(permissionActions).toHaveTextContent('Always allow', { exact: false })
    expect(permissionActions).toHaveTextContent('Deny with a note', { exact: false })
    expect(permissionActions).toHaveTextContent('View diff', { exact: false })

    expect(screen.getByTestId('stopped-102-badge')).toHaveTextContent('question')
    expect(screen.getByTestId('stopped-102-well')).toHaveTextContent('? which backoff ceiling — 30s or 5m?', { exact: false })
    expect(screen.getByTestId('hold-option-30s')).toBeTruthy()
    expect(screen.getByTestId('hold-option-5m')).toBeTruthy()

    expect(screen.getByTestId('stopped-103-badge')).toHaveTextContent('out of time')
    expect(screen.getByTestId('stopped-103-well')).toHaveTextContent('30m limit · context kept', { exact: false })
    expect(screen.getByTestId('hold-continue')).toBeTruthy()

    // the queued and done tickets are in neither triage list
    expect(screen.queryByTestId('stopped-105')).toBeNull()
    expect(screen.queryByTestId('live-now-105')).toBeNull()
  })

  test('approving a permission gate calls the run endpoint; continuing an out-of-time run grants +30m', async () => {
    setupMocks()
    await renderControl()
    await waitFor(() => expect(screen.getByTestId('stopped-101')).toBeTruthy())
    const approveButtons = screen.getAllByTestId('hold-approve')
    await press(approveButtons[0]!)
    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith(4128, { alwaysAllow: undefined }))
    await press(screen.getByTestId('hold-continue'))
    await waitFor(() => expect(mockContinueRun).toHaveBeenCalledWith(4127, 30 * 60 * 1000))
  })

  test('live-now card shows the running run\'s latest journaled event and elapsed time; the slot pill names what is next', async () => {
    setupMocks({
      runEvents: {
        4131: [{ id: 1, runId: 4131, type: 'text', payload: { text: 'running suite ×20 — all green so far' }, createdAt: localTime(9, 51) }],
      },
    })
    await renderControl()
    await waitFor(() => expect(screen.getByTestId('live-now-104')).toBeTruthy())
    await waitFor(() =>
      expect(screen.getByTestId('live-now-104-panel')).toHaveTextContent('running suite ×20 — all green so far', { exact: false }),
    )
    expect(screen.getByTestId('live-now-104-panel')).not.toHaveTextContent('stale comment', { exact: false })
    expect(screen.getByTestId('live-now-104-status')).toHaveTextContent('12m', { exact: false })
    expect(screen.getByTestId('slot-pill')).toHaveTextContent('0 slots free · next:', { exact: false })
    expect(screen.getByTestId('slot-pill')).toHaveTextContent('Migrate icon set to Lucide', { exact: false })
    await press(screen.getByTestId('slot-pill-order'))
    expect(mockNavigate).toHaveBeenCalledWith('/board')
    await press(screen.getByTestId('live-now-104-full-log'))
    expect(mockPush).toHaveBeenCalledWith('/runs/4131')
  })

  test('send a note delivers to the live run and toasts', async () => {
    setupMocks()
    await renderControl()
    await waitFor(() => expect(screen.getByTestId('live-now-104')).toBeTruthy())
    await press(screen.getByTestId('live-now-104-note'))
    await waitFor(() => expect(screen.getByTestId('note-input')).toBeTruthy())
    await fireEvent.changeText(screen.getByTestId('note-input'), 'also update the docs')
    await press(screen.getByTestId('note-confirm'))
    await waitFor(() => expect(mockNote).toHaveBeenCalledWith(104, 'also update the docs'))
    await waitFor(() => expect(screen.getByText(/note delivered/)).toBeTruthy())
  })

  test('memory and today cards on the right: kept digests, the pending proposal, today\'s rows only', async () => {
    setupMocks()
    await renderControl()
    await waitFor(() => expect(screen.getByTestId('memory-card')).toBeTruthy())
    expect(screen.getByTestId('memory-card')).toHaveTextContent('3 notes', { exact: false })
    expect(screen.getByTestId('memory-card')).toHaveTextContent('· conventional commits', { exact: false })
    expect(screen.getByTestId('memory-card-pending')).toHaveTextContent('reports queries paginate past 50k rows · proposed by agent')
    await press(screen.getByTestId('memory-card-edit'))
    expect(mockNavigate).toHaveBeenCalledWith('/memory')

    const today = screen.getByTestId('today-card')
    expect(today).toHaveTextContent('aug 17', { exact: false })
    expect(today).toHaveTextContent('09:49', { exact: false })
    expect(today).toHaveTextContent('✱', { exact: false })
    expect(today).toHaveTextContent('made it always allow', { exact: false })
    expect(today).toHaveTextContent('⏸', { exact: false })
    // the six-day-old row is not today's
    expect(today).not.toHaveTextContent('You created "Old"', { exact: false })
    await press(screen.getByTestId('today-card-full-history'))
    await waitFor(() => expect(screen.getByTestId('today-card')).toHaveTextContent('Old', { exact: false }))
  })

  test('new ticket dialog creates a ticket (queued on request) and opens it', async () => {
    setupMocks()
    await renderControl()
    await waitFor(() => expect(screen.getByTestId('new-ticket-button')).toBeTruthy())
    await press(screen.getByTestId('new-ticket-button'))
    await waitFor(() => expect(screen.getByTestId('new-ticket-title-input')).toBeTruthy())
    await fireEvent.changeText(screen.getByTestId('new-ticket-title-input'), 'Add retry metrics')
    await fireEvent.changeText(screen.getByTestId('new-ticket-description-input'), 'Chart webhook retries')
    await press(screen.getByTestId('new-ticket-lands-queued'))
    await press(screen.getByTestId('new-ticket-confirm'))
    await waitFor(() =>
      expect(mockCreateTicket).toHaveBeenCalledWith({
        title: 'Add retry metrics',
        description: 'Chart webhook retries',
        column: 'queued',
        repoTags: [],
      }),
    )
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/tickets/900'))
  })

  test('all quiet: the star, "Nothing is stopped on you", and today rows', async () => {
    setupMocks({ board: { backlog: [], queued: [], running: [], stopped: [], done: [doneTicket] } })
    await renderControl()
    await waitFor(() => expect(screen.getByTestId('control-headline')).toHaveTextContent('Nothing is stopped on you'))
    expect(screen.getByTestId('control-tada')).toBeTruthy()
    expect(screen.getByTestId('control-subline')).toHaveTextContent('1 ran overnight · 1 moved itself to done')
    expect(screen.getByText(/you slept, it shipped/)).toBeTruthy()
  })

  test('narrow: single column, stretched actions, live digest and no section labels', async () => {
    setWindowWidth(500)
    setupMocks({
      runEvents: {
        4131: [{ id: 1, runId: 4131, type: 'text', payload: { text: 'suite ×20 green' }, createdAt: localTime(9, 51) }],
      },
    })
    await renderControl()
    await waitFor(() => expect(screen.getByTestId('control-narrow')).toBeTruthy())
    await waitFor(() => expect(screen.getByTestId('stopped-101')).toBeTruthy())
    expect(screen.getByTestId('stopped-101')).toHaveTextContent('parlor-web · held 2h 14m', { exact: false })
    // narrow permission card: Approve + Deny…, no Always allow
    expect(screen.getByTestId('stopped-101-actions')).toHaveTextContent('Deny with a note', { exact: false })
    await waitFor(() =>
      expect(screen.getByTestId('live-digest')).toHaveTextContent('fix flaky session-refresh test · 12m · suite ×20 green', { exact: false }),
    )
    await press(screen.getByTestId('live-digest-line-104'))
    expect(mockPush).toHaveBeenCalledWith('/runs/4131')
    expect(screen.queryByTestId('memory-card')).toBeNull()
  })

  test('a board error shows the retry empty state', async () => {
    setupMocks()
    mockBoard.mockRejectedValue(new Error('down'))
    await renderControl()
    await waitFor(() => expect(screen.getByText('Could not reach the server.')).toBeTruthy(), { timeout: 4000 })
  })
})
