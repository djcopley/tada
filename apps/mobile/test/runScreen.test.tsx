import type { ApiRunDetail, ApiRunDiff } from '@tada/shared'
import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import DiffScreen from '../app/runs/[id]/diff'
import RunScreen from '../app/runs/[id]/index'
import { ConnectionProvider } from '../src/ConnectionContext'
import { makeTestQueryClient } from './helpers/queryClient'

const mockSearchParams = { id: '30' }
const mockPush = jest.fn()
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockSearchParams,
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
}))

jest.mock('../src/settings', () => ({
  loadConnection: jest.fn(async () => ({ baseUrl: 'https://example.com', token: 'secret' })),
  saveConnection: jest.fn(async () => undefined),
  clearConnection: jest.fn(async () => undefined),
  loadThemeScheme: jest.fn(async () => 'night'),
  saveThemeScheme: jest.fn(async () => undefined),
}))

jest.mock('../src/api/useAppSocket', () => ({ useAppSocket: jest.fn() }))
jest.mock('../src/toast', () => ({ showToast: jest.fn() }))

const mockRun = jest.fn()
const mockRunEvents = jest.fn()
const mockCancelRun = jest.fn()
const mockTranscript = jest.fn()
const mockNote = jest.fn()
const mockApprove = jest.fn()
const mockRunDiff = jest.fn()
const mockSources = jest.fn()

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
      note: mockNote,
      approve: mockApprove,
      runDiff: mockRunDiff,
      sources: mockSources,
      wsUrl: () => 'wss://example.com/ws',
    })),
  }
})

const heldHold = {
  reason: 'permission' as const,
  tool: 'Bash',
  summary: 'gh pr create --base main --head csv-export',
  ruleId: 3,
  ruleTitle: 'Open a pull request',
  publishes: true,
}

function run(overrides: Partial<ApiRunDetail> = {}): ApiRunDetail {
  return {
    id: 30,
    ticketId: 1,
    ticketTitle: 'Add CSV export to the reports page',
    repoTags: ['parlor-web'],
    adapter: 'claude',
    model: 'sonnet',
    effort: 'medium',
    attemptNumber: 1,
    status: 'held',
    heldReason: 'permission',
    hold: heldHold,
    heldAt: '2026-01-01T00:10:00.000Z',
    budgetMs: 1_800_000,
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

async function renderWith(Component: () => React.JSX.Element) {
  const queryClient = makeTestQueryClient()
  await render(
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider>
        <Component />
      </ConnectionProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRunEvents.mockResolvedValue([
    { id: 1, runId: 30, type: 'text', payload: { text: 'committed 6 files on csv-export' }, createdAt: '2026-01-01T00:05:00.000Z' },
    { id: 2, runId: 30, type: 'gate', payload: { kind: 'hold', hold: heldHold }, createdAt: '2026-01-01T00:10:00.000Z' },
  ])
  mockTranscript.mockResolvedValue('$ pnpm test\n ✓ 214 passed')
  mockSources.mockResolvedValue([{ type: 'repo', name: 'parlor-web', url: 'x', defaultBranch: 'main' }])
})

describe('Run screen', () => {
  test('held run: badge, narration with the hold line, gate card with actions, note input, stop run', async () => {
    mockRun.mockResolvedValue(run())
    await renderWith(RunScreen)
    await waitFor(() => expect(screen.getByTestId('run-title')).toHaveTextContent('Add CSV export to the reports page'))
    expect(screen.getByTestId('run-meta')).toHaveTextContent('parlor-web · run #30')
    expect(screen.getByTestId('run-status-badge')).toHaveTextContent(/^held · /)
    await waitFor(() => expect(screen.getByTestId('event-gate-2')).toHaveTextContent(/⏸ gh pr create --base main --head csv-export — stopped, waiting on you/))
    expect(screen.getByTestId('gate-title')).toHaveTextContent('The agent wants to: open a pull request')
    expect(screen.getByTestId('hold-approve')).toBeTruthy()
    expect(screen.getByTestId('hold-always-allow')).toBeTruthy()
    expect(screen.getByTestId('hold-view-diff')).toBeTruthy()
    expect(screen.getByTestId('run-held-copy')).toHaveTextContent(/Holding freed its slot/)
    expect(screen.getByTestId('note-input')).toBeTruthy()
    expect(screen.getByTestId('run-cancel')).toBeTruthy()

    mockApprove.mockResolvedValue(undefined)
    await fireEvent.press(screen.getByTestId('hold-approve'))
    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith(30, { alwaysAllow: undefined }))

    await fireEvent.press(screen.getByTestId('hold-view-diff'))
    expect(mockPush).toHaveBeenCalledWith('/runs/30/diff')
  })

  test('sending a note posts to the ticket', async () => {
    mockRun.mockResolvedValue(run({ status: 'running', heldReason: null, hold: null }))
    mockNote.mockResolvedValue({ comment: {}, delivered: true })
    await renderWith(RunScreen)
    await waitFor(() => expect(screen.getByTestId('note-input')).toBeTruthy())
    await fireEvent.changeText(screen.getByTestId('note-input'), 'go faster')
    await fireEvent.press(screen.getByTestId('note-send'))
    await waitFor(() => expect(mockNote).toHaveBeenCalledWith(1, 'go faster'))
    expect(screen.queryByTestId('gate-card')).toBeNull()
  })

  test('a finished run shows the sage terminal line and no live controls', async () => {
    mockRun.mockResolvedValue(run({ status: 'done', heldReason: null, hold: null, summary: 'shipped it', finishedAt: '2026-01-01T01:00:00.000Z' }))
    await renderWith(RunScreen)
    await waitFor(() => expect(screen.getByTestId('run-terminal-line')).toHaveTextContent(/✱ finished and moved itself to done — shipped it/))
    expect(screen.queryByTestId('note-input')).toBeNull()
    expect(screen.queryByTestId('run-cancel')).toBeNull()
    expect(screen.getByTestId('run-status-badge')).toHaveTextContent('done')
  })
})

describe('Diff screen', () => {
  test('at a publish gate: repos, per-file patches, held actions', async () => {
    mockRun.mockResolvedValue(run())
    const diff: ApiRunDiff = {
      runId: 30,
      repos: [
        {
          repo: 'parlor-web',
          defaultBranch: 'main',
          branch: 'ticket/1',
          additions: 2,
          deletions: 1,
          files: [{ path: 'src/reports/export.ts', additions: 2, deletions: 1, patch: '@@ -1,2 +1,3 @@\n+  const range = 1\n-  return db.query(ALL)\n context' }],
        },
      ],
    }
    mockRunDiff.mockResolvedValue(diff)
    await renderWith(DiffScreen)
    await waitFor(() => expect(screen.getByTestId('diff-repo-parlor-web')).toBeTruthy())
    expect(screen.getByTestId('diff-meta')).toHaveTextContent('run #30 · held at gh pr create --base main --head csv-export')
    expect(screen.getByTestId('diff-repo-parlor-web')).toHaveTextContent(/main ← ticket\/1 · 1 file · \+2 −1/)
    expect(screen.getByTestId('diff-file-0')).toHaveTextContent(/\+\s*const range = 1/)
    expect(screen.getByTestId('diff-file-0')).toHaveTextContent(/−\s*return db.query\(ALL\)/)
    expect(screen.getByTestId('hold-approve')).toBeTruthy()
    expect(screen.getByTestId('hold-deny')).toBeTruthy()
  })

  test('not at a publish gate: the diff is not fetched and the screen says so', async () => {
    mockRun.mockResolvedValue(run({ status: 'running', heldReason: null, hold: null }))
    await renderWith(DiffScreen)
    await waitFor(() => expect(screen.getByTestId('diff-not-gated')).toBeTruthy())
    expect(screen.getByText(/only at a publish gate/)).toBeTruthy()
    expect(mockRunDiff).not.toHaveBeenCalled()
  })

  test('a question hold is not a publish gate either', async () => {
    mockRun.mockResolvedValue(run({ heldReason: 'question', hold: { reason: 'question', question: 'which?', options: [] } }))
    await renderWith(DiffScreen)
    await waitFor(() => expect(screen.getByTestId('diff-not-gated')).toBeTruthy())
    expect(mockRunDiff).not.toHaveBeenCalled()
  })
})
