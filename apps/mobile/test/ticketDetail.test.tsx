import type { ApiRun, ApiTicketDetail } from '@tada/shared'
import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import TicketDetail from '../app/tickets/[id]'
import { ConnectionProvider } from '../src/ConnectionContext'
import {
  attemptRows,
  canUndoDone,
  holdThreadLine,
  runCardLines,
  stoppedCopy,
  stoppedWellLines,
  ticketMetaLine,
} from '../src/ticketDetail'
import { makeTestQueryClient } from './helpers/queryClient'

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockBack = jest.fn()
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: '1' }),
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack, canGoBack: () => true }),
}))

jest.mock('../src/settings', () => ({
  loadConnection: jest.fn(async () => ({ baseUrl: 'https://example.com', token: 'secret' })),
  saveConnection: jest.fn(async () => undefined),
  clearConnection: jest.fn(async () => undefined),
}))

jest.mock('../src/api/useAppSocket', () => ({ useAppSocket: jest.fn() }))

const mockTicket = jest.fn()
const mockNote = jest.fn()
const mockMoveTicket = jest.fn()
const mockPatchTicket = jest.fn()
const mockApprove = jest.fn()

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
      note: mockNote,
      moveTicket: mockMoveTicket,
      patchTicket: mockPatchTicket,
      approve: mockApprove,
      wsUrl: () => 'wss://example.com/ws',
    })),
  }
})

const NOW = new Date('2026-08-17T10:00:00.000Z')

function run(overrides: Partial<ApiRun> = {}): ApiRun {
  return {
    id: 4128,
    ticketId: 1,
    adapter: 'claude',
    model: 'sonnet',
    effort: 'medium',
    attemptNumber: 1,
    status: 'held',
    heldReason: 'permission',
    hold: {
      reason: 'permission',
      tool: 'Bash',
      summary: 'gh pr create --base main --head csv-export',
      ruleId: 3,
      ruleTitle: 'Open a pull request',
      publishes: true,
    },
    heldAt: '2026-08-17T07:46:00.000Z',
    budgetMs: 30 * 60 * 1000,
    summary: null,
    diffAdditions: 412,
    diffDeletions: 38,
    testsPassed: 214,
    startedAt: '2026-08-17T07:05:00.000Z',
    finishedAt: null,
    createdAt: '2026-08-17T07:00:00.000Z',
    ...overrides,
  }
}

function ticket(overrides: Partial<ApiTicketDetail> = {}): ApiTicketDetail {
  return {
    id: 1,
    column: 'stopped',
    title: 'Add CSV export to the reports page',
    description: 'Add an "Export CSV" button to /reports.',
    position: 1,
    repoTags: ['parlor-web'],
    origin: 'human',
    proposalState: null,
    followUpOfTicketId: null,
    createdAt: '2026-08-14T10:00:00.000Z',
    doneAt: null,
    run: run(),
    comments: [
      { id: 1, ticketId: 1, runId: 4128, author: 'agent', body: 'started run #4128 — read the brief', createdAt: '2026-08-17T07:05:00.000Z' },
      { id: 2, ticketId: 1, runId: 4128, author: 'human', body: 'split the export helper out', createdAt: '2026-08-17T07:20:00.000Z' },
    ],
    runs: [run()],
    followUps: [{ id: 9, title: 'Paginate the legacy /reports/all endpoint', proposalState: 'pending' }],
    followUpOf: null,
    ...overrides,
  }
}

async function renderScreen() {
  await render(
    <QueryClientProvider client={makeTestQueryClient()}>
      <ConnectionProvider>
        <TicketDetail />
      </ConnectionProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('ticketDetail pure logic', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW.getTime())
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('ticketMetaLine: who filed it, and the no-tags hint only before any run', () => {
    expect(ticketMetaLine({ createdAt: NOW.toISOString(), origin: 'human', repoTags: [], run: null })).toMatch(
      /^created .+ by you · no repo tags yet — the run tags what it touches$/,
    )
    expect(ticketMetaLine({ createdAt: NOW.toISOString(), origin: 'agent', repoTags: ['x'], run: null })).toMatch(/by agent$/)
    expect(ticketMetaLine({ createdAt: NOW.toISOString(), origin: 'human', repoTags: [], run: run() })).not.toContain('no repo tags')
  })

  test('stoppedCopy titles by reason and names the rule for a permission hold', () => {
    expect(stoppedCopy(run())?.title).toBe('Waiting for permission')
    expect(stoppedCopy(run())?.helper).toContain('Open a pull request → ask')
    expect(stoppedCopy(run({ heldReason: 'question', hold: { reason: 'question', question: 'which?', options: [] } }))?.title).toBe('Waiting for your answer')
    expect(stoppedCopy(run({ heldReason: 'time', hold: { reason: 'time', budgetMs: 1_800_000 } }))?.title).toBe('Out of time')
    expect(stoppedCopy(run({ status: 'failed', heldReason: null, hold: null }))?.title).toBe('Failed')
    expect(stoppedCopy(run({ status: 'running', heldReason: null, hold: null }))).toBeNull()
    expect(stoppedCopy(null)).toBeNull()
  })

  test('stoppedWellLines: permission = context line then the held call in live', () => {
    const lines = stoppedWellLines(run(), 1)
    expect(lines).toEqual([
      { prefix: '▸', text: 'all work is committed on ticket/1 · +412 −38 · 214 tests pass', accent: null },
      { prefix: '⏸', text: 'gh pr create --base main --head csv-export', accent: 'live' },
    ])
    expect(stoppedWellLines(run({ status: 'failed', hold: null, heldReason: null, summary: 'playwright missing' }), 1)).toEqual([
      { prefix: '▸', text: 'playwright missing', accent: null },
      { prefix: '✕', text: 'run failed — see the last 40 lines in the full log', accent: 'fail' },
    ])
    expect(stoppedWellLines(run({ heldReason: 'time', hold: { reason: 'time', budgetMs: 1_800_000 } }), 1)[0]?.text).toBe('stopped at the 30m limit · context kept')
  })

  test('holdThreadLine names the held call', () => {
    expect(holdThreadLine(run())).toBe('holding at gh pr create --base main --head csv-export — your rule asks first')
    expect(holdThreadLine(run({ status: 'running', hold: null }))).toBeNull()
  })

  test('runCardLines are data-driven', () => {
    const lines = runCardLines(run(), NOW.getTime()).map((l) => l.text)
    expect(lines[0]).toBe('attempt 1 · claude · sonnet')
    expect(lines).toContain('held · 2h 14m')
    expect(lines).toContain('+412 −38 · 214 tests pass')
    expect(lines).toContain('budget 30m')
  })

  test('attemptRows: latest first, summary or time as detail', () => {
    const rows = attemptRows([run({ id: 1, attemptNumber: 1, status: 'failed', summary: 'crashed' }), run({ id: 2, attemptNumber: 2 })])
    expect(rows[0]).toMatchObject({ runId: 2, primary: 'attempt 2 · held' })
    expect(rows[1]).toMatchObject({ runId: 1, primary: 'attempt 1 · failed', detail: 'crashed' })
  })

  test('canUndoDone: within 24h of doneAt only', () => {
    expect(canUndoDone({ column: 'done', doneAt: new Date(NOW.getTime() - 3_600_000).toISOString() }, NOW.getTime())).toBe(true)
    expect(canUndoDone({ column: 'done', doneAt: new Date(NOW.getTime() - 25 * 3_600_000).toISOString() }, NOW.getTime())).toBe(false)
    expect(canUndoDone({ column: 'backlog', doneAt: NOW.toISOString() }, NOW.getTime())).toBe(false)
  })
})

describe('TicketDetail screen', () => {
  test('held for permission: stopped card with the held call, hold actions, thread, and side cards', async () => {
    mockTicket.mockResolvedValue(ticket())
    await renderScreen()
    await screen.findByTestId('stopped-card')
    expect(screen.getByText('Waiting for permission')).toBeTruthy()
    expect(screen.getAllByText(/gh pr create --base main --head csv-export/).length).toBeGreaterThan(0)
    expect(screen.getByTestId('hold-approve')).toBeTruthy()
    expect(screen.getByTestId('hold-always-allow')).toBeTruthy()
    expect(screen.getByTestId('hold-view-diff')).toBeTruthy()
    expect(screen.getByTestId('thread-hold-line')).toBeTruthy()
    expect(screen.getByTestId('thread-agent-1')).toBeTruthy()
    expect(screen.getByTestId('thread-note-2')).toBeTruthy()
    expect(screen.getByTestId('this-run-card')).toBeTruthy()
    expect(screen.getByTestId('if-you-deny-card')).toBeTruthy()
    expect(screen.getByTestId('linked-followup-9')).toBeTruthy()
    expect(screen.getByTestId('ticket-repo-tag-parlor-web')).toBeTruthy()
    expect(screen.getByTestId('ticket-run-tag')).toBeTruthy()

    mockApprove.mockResolvedValue(undefined)
    fireEvent.press(screen.getByTestId('hold-approve'))
    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith(4128, { alwaysAllow: undefined }))
  })

  test('never run: no-runs well, Queue moves the card to queued', async () => {
    mockTicket.mockResolvedValue(ticket({ column: 'backlog', repoTags: [], run: null, runs: [], comments: [], followUps: [] }))
    mockMoveTicket.mockResolvedValue({})
    await renderScreen()
    await screen.findByTestId('no-runs-well')
    expect(screen.getByText(/no repo tags yet/)).toBeTruthy()
    expect(screen.queryByTestId('stopped-card')).toBeNull()
    fireEvent.press(screen.getByTestId('ticket-queue'))
    await waitFor(() => expect(mockMoveTicket).toHaveBeenCalledWith(1, { column: 'queued' }))
  })

  test('a failed run dragged back to backlog is no longer stopped-on-you: no red card, Queue offered', async () => {
    const failed = run({ status: 'failed', heldReason: null, hold: null, summary: 'agent did not report an outcome' })
    mockTicket.mockResolvedValue(ticket({ column: 'backlog', run: failed, runs: [failed] }))
    await renderScreen()
    await screen.findByTestId('ticket-queue')
    expect(screen.queryByTestId('stopped-card')).toBeNull()
    expect(screen.getByText(/last run failed/)).toBeTruthy()
  })

  test('a done ticket undone to backlog offers Queue instead of the done chip', async () => {
    const done = run({ status: 'done', heldReason: null, hold: null, finishedAt: NOW.toISOString() })
    mockTicket.mockResolvedValue(ticket({ column: 'backlog', run: done, runs: [done] }))
    await renderScreen()
    await screen.findByTestId('ticket-queue')
    expect(screen.queryByTestId('ticket-undo-done')).toBeNull()
    expect(screen.getByText(/moved back from done/)).toBeTruthy()
  })

  test('sending a note posts it and reports delivery', async () => {
    mockTicket.mockResolvedValue(ticket())
    mockNote.mockResolvedValue({ comment: { id: 3 }, delivered: true })
    await renderScreen()
    await screen.findByTestId('note-input')
    fireEvent.changeText(screen.getByTestId('note-input'), 'go faster')
    await waitFor(() => expect(screen.getByTestId('note-send').props.accessibilityState.disabled).toBe(false))
    fireEvent.press(screen.getByTestId('note-send'))
    await waitFor(() => expect(mockNote).toHaveBeenCalledWith(1, 'go faster'))
  })

  test('edit brief saves title and description', async () => {
    mockTicket.mockResolvedValue(ticket())
    mockPatchTicket.mockResolvedValue({})
    await renderScreen()
    fireEvent.press(await screen.findByTestId('brief-edit-trigger'))
    fireEvent.changeText(await screen.findByTestId('brief-description-input'), 'new brief')
    await waitFor(() => expect(screen.getByTestId('brief-description-input').props.value).toBe('new brief'))
    fireEvent.press(screen.getByTestId('brief-edit-save'))
    await waitFor(() =>
      expect(mockPatchTicket).toHaveBeenCalledWith(1, { title: 'Add CSV export to the reports page', description: 'new brief' }),
    )
  })

  test('404 shows the not-found state', async () => {
    const { ApiError } = jest.requireMock('../src/api/client')
    mockTicket.mockRejectedValue(new ApiError(404, { error: 'ticket not found' }))
    await renderScreen()
    expect(await screen.findByText("This ticket doesn't exist.")).toBeTruthy()
  })

  test('a non-404 load error is not reported as a missing ticket', async () => {
    mockTicket.mockRejectedValue(new Error('network down'))
    await renderScreen()
    expect(await screen.findByText(/Couldn't reach the server/)).toBeTruthy()
    expect(screen.queryByText("This ticket doesn't exist.")).toBeNull()
  })
})
