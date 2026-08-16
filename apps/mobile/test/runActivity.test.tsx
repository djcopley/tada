import type { ApiRunDetail, ApiWorkspaceDetail } from '@tada/shared'
import { QueryClientProvider } from '@tanstack/react-query'
import { makeTestQueryClient } from './helpers/queryClient'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import RunActivity from '../app/runs/[id]'
import { ConnectionProvider } from '../src/ConnectionContext'
import { useWorkspaceSocket as mockUseWorkspaceSocket } from '../src/api/useWorkspaceSocket'
import { runHeaderBadge, runMetaLine } from '../src/runActivity'
import { showToast } from '../src/toast'

const mockSearchParams = { id: '30' }
const mockBack = jest.fn()
const mockCanGoBack = jest.fn(() => true)
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockSearchParams,
  useRouter: () => ({ push: jest.fn(), back: mockBack, canGoBack: mockCanGoBack }),
}))

jest.mock('../src/settings', () => ({
  loadConnection: jest.fn(async () => ({ baseUrl: 'https://example.com', token: 'secret' })),
  saveConnection: jest.fn(async () => undefined),
  clearConnection: jest.fn(async () => undefined),
}))

jest.mock('../src/api/useWorkspaceSocket', () => ({
  useWorkspaceSocket: jest.fn(),
}))

jest.mock('../src/toast', () => ({ showToast: jest.fn() }))

const mockRun = jest.fn()
const mockRunEvents = jest.fn()
const mockCancelRun = jest.fn()
const mockTranscript = jest.fn()
const mockNudge = jest.fn()
const mockGetWorkspace = jest.fn()

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
      run: mockRun,
      runEvents: mockRunEvents,
      cancelRun: mockCancelRun,
      transcript: mockTranscript,
      nudge: mockNudge,
      getWorkspace: mockGetWorkspace,
      wsUrl: () => 'wss://example.com/ws',
    })),
  }
})

/** The HH:MM narration stamp is rendered in the machine's local time (matching the component),
 * so tests compute the expected string the same way rather than hardcoding a UTC-derived value. */
function localStamp(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function run(overrides: Partial<ApiRunDetail> = {}): ApiRunDetail {
  return {
    id: 30,
    ticketId: 1,
    ticketTitle: 'Fix flaky session-refresh test',
    workspaceId: 1,
    adapter: 'claude',
    model: 'sonnet',
    effort: 'default',
    attemptNumber: 1,
    status: 'running',
    branch: 'run-30',
    prUrl: null,
    summary: null,
    diffAdditions: null,
    diffDeletions: null,
    testsPassed: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: null,
    ...overrides,
  }
}

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
    sources: [{ type: 'repo', name: 'parlor-api', url: 'https://github.com/x/parlor-api' }],
    ...overrides,
  }
}

async function renderScreen() {
  const queryClient = makeTestQueryClient()
  await render(
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider>
        <RunActivity />
      </ConnectionProvider>
    </QueryClientProvider>,
  )
}

describe('runActivity pure logic', () => {
  test('runHeaderBadge shows a ticking live label while active', () => {
    const started = '2026-01-01T00:00:00.000Z'
    const now = new Date('2026-01-01T00:12:00.000Z').getTime()
    expect(runHeaderBadge({ status: 'running', startedAt: started }, true, now)).toEqual({
      status: 'live',
      label: 'live · 12m',
    })
  })

  test('runHeaderBadge falls back to the terminal status label once no longer live', () => {
    expect(runHeaderBadge({ status: 'needs_review', startedAt: null }, false, Date.now())).toEqual({
      status: 'accepted',
      label: 'your turn',
    })
    expect(runHeaderBadge({ status: 'failed', startedAt: null }, false, Date.now())).toEqual({
      status: 'failed',
      label: 'failed',
    })
  })

  test('runMetaLine composes workspace, first repo source, and attempt number', () => {
    expect(runMetaLine('parlor', 'parlor-api', 1)).toBe('parlor · parlor-api · attempt 1')
    expect(runMetaLine('parlor', undefined, 2)).toBe('parlor · attempt 2')
  })
})

describe('Run activity screen', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCanGoBack.mockReturnValue(true)
    mockRunEvents.mockResolvedValue([])
    mockTranscript.mockResolvedValue('')
    mockGetWorkspace.mockResolvedValue(workspace())
  })

  test('shows a ticking live badge and a Stop run button while the run is active', async () => {
    mockRun.mockResolvedValue(run({ status: 'running' }))

    await renderScreen()

    await waitFor(() => expect(screen.getByTestId('run-status-badge')).toHaveTextContent(/live/))
    expect(screen.getByTestId('run-meta')).toHaveTextContent('parlor · parlor-api · attempt 1')
    expect(screen.getByTestId('run-cancel')).toBeTruthy()
  })

  test('hides Stop run and shows the terminal status once the run is no longer active', async () => {
    mockRun.mockResolvedValue(run({ status: 'needs_review' }))

    await renderScreen()

    await waitFor(() => expect(screen.getByTestId('run-status-badge')).toHaveTextContent(/your turn/))
    expect(screen.queryByTestId('run-cancel')).toBeNull()
  })

  test('Stop run confirms via dialog then calls cancelRun', async () => {
    mockRun.mockResolvedValue(run({ status: 'running' }))
    mockCancelRun.mockResolvedValue(undefined)

    await renderScreen()

    await waitFor(() => expect(screen.getByTestId('run-cancel')).toBeTruthy())
    await fireEvent.press(screen.getByTestId('run-cancel'))
    await fireEvent.press(screen.getByTestId('run-cancel-confirm'))

    await waitFor(() => expect(mockCancelRun).toHaveBeenCalledWith(30))
  })

  test('dismissing the confirm dialog does not cancel the run', async () => {
    mockRun.mockResolvedValue(run({ status: 'running' }))

    await renderScreen()

    await waitFor(() => expect(screen.getByTestId('run-cancel')).toBeTruthy())
    await fireEvent.press(screen.getByTestId('run-cancel'))
    await fireEvent.press(screen.getByText('Keep running'))

    expect(mockCancelRun).not.toHaveBeenCalled()
  })

  test('the agent panel narrates run events with HH:MM stamps', async () => {
    mockRun.mockResolvedValue(run({ status: 'running' }))
    const secondEventCreatedAt = '2026-01-01T09:42:00.000Z'
    mockRunEvents.mockResolvedValue([
      { id: 1, runId: 30, type: 'status', payload: { status: 'running' }, createdAt: '2026-01-01T09:41:00.000Z' },
      { id: 2, runId: 30, type: 'text', payload: { text: 'reproduced the flake' }, createdAt: secondEventCreatedAt },
    ])

    await renderScreen()

    await waitFor(() => expect(screen.getByTestId('event-text-2')).toBeTruthy())
    expect(screen.getByTestId('event-text-2')).toHaveTextContent(localStamp(secondEventCreatedAt), { exact: false })
    expect(screen.getByTestId('event-text-2')).toHaveTextContent('reproduced the flake', { exact: false })
    // The most recent narration line pulses while the run is live.
    expect(screen.getByTestId('event-text-2')).toHaveTextContent('▮', { exact: false })
  })

  test('raw output is collapsible inside the agent panel and shows the transcript', async () => {
    mockRun.mockResolvedValue(run({ status: 'needs_review' }))
    mockTranscript.mockResolvedValue('$ pnpm vitest run\n ✓ passed')

    await renderScreen()

    await waitFor(() => expect(screen.getByTestId('run-panel-raw-content')).toHaveTextContent('pnpm vitest run', { exact: false }))

    await fireEvent.press(screen.getByTestId('run-panel-raw-toggle'))
    expect(screen.queryByTestId('run-panel-raw-content')).toBeNull()

    await fireEvent.press(screen.getByTestId('run-panel-raw-toggle'))
    expect(screen.getByTestId('run-panel-raw-content')).toHaveTextContent('pnpm vitest run', { exact: false })
  })

  test('a WS run_event triggers a refetch instead of ingesting the event directly, so it renders exactly once', async () => {
    mockRun.mockResolvedValue(run({ status: 'running' }))
    const wsEvent = {
      id: 5,
      runId: 30,
      type: 'text' as const,
      payload: { text: 'hello from ws' },
      createdAt: '2026-01-01T00:00:00.000Z',
    }
    mockRunEvents.mockResolvedValueOnce([]).mockResolvedValueOnce([wsEvent])

    await renderScreen()

    await waitFor(() => expect(screen.getByTestId('run-status-badge')).toHaveTextContent(/live/))
    await waitFor(() => expect(mockRunEvents).toHaveBeenCalledTimes(1))

    const socketMock = mockUseWorkspaceSocket as unknown as jest.Mock
    const lastCall = socketMock.mock.calls[socketMock.mock.calls.length - 1] as [unknown, { onRunEvent?: (msg: unknown) => void }]
    const onRunEvent = lastCall[1].onRunEvent
    expect(onRunEvent).toBeDefined()

    await act(async () => {
      onRunEvent?.({ type: 'run_event', runId: 30, event: { type: 'text', payload: { text: 'hello from ws' } } })
      await Promise.resolve()
    })

    await waitFor(() => expect(mockRunEvents).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByTestId('event-text-5')).toHaveTextContent(/hello from ws/))
    expect(screen.queryAllByTestId(/^event-text-/)).toHaveLength(1)
  })

  test('nudge composer sends a note and toasts when the server could not deliver it live', async () => {
    mockRun.mockResolvedValue(run({ status: 'running' }))
    mockNudge.mockResolvedValue({ delivered: false })

    await renderScreen()

    await waitFor(() => expect(screen.getByTestId('nudge-input')).toBeTruthy())
    await fireEvent.changeText(screen.getByTestId('nudge-input'), 'also check the retry path')
    await fireEvent.press(screen.getByTestId('nudge-send'))

    await waitFor(() => expect(mockNudge).toHaveBeenCalledWith(30, 'also check the retry path'))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('note saved for the next attempt'))
    expect(screen.getByTestId('nudge-input').props.value).toBe('')
  })

  test('nudge composer does not toast when the note was delivered live', async () => {
    mockRun.mockResolvedValue(run({ status: 'running' }))
    mockNudge.mockResolvedValue({ delivered: true })

    await renderScreen()

    await waitFor(() => expect(screen.getByTestId('nudge-input')).toBeTruthy())
    await fireEvent.changeText(screen.getByTestId('nudge-input'), 'also check the retry path')
    await fireEvent.press(screen.getByTestId('nudge-send'))

    await waitFor(() => expect(mockNudge).toHaveBeenCalled())
    expect(showToast).not.toHaveBeenCalled()
  })

  test('the nudge composer and safe-to-close footnote are hidden once the run is no longer live', async () => {
    mockRun.mockResolvedValue(run({ status: 'needs_review' }))

    await renderScreen()

    await waitFor(() => expect(screen.getByTestId('run-status-badge')).toBeTruthy())
    expect(screen.queryByTestId('nudge-input')).toBeNull()
    expect(screen.queryByText(/Safe to close/)).toBeNull()
  })
})
