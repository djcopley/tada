import type { ApiRun, ApiTicket } from '@tada/shared'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { Alert } from 'react-native'
import RunActivity from '../app/runs/[id]'
import { ConnectionProvider } from '../src/ConnectionContext'

const mockSearchParams = { id: '30', ticketId: '1' }
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockSearchParams,
}))

jest.mock('../src/settings', () => ({
  loadConnection: jest.fn(async () => ({ baseUrl: 'https://example.com', token: 'secret' })),
  saveConnection: jest.fn(async () => undefined),
  clearConnection: jest.fn(async () => undefined),
}))

const mockTicket = jest.fn()
const mockRunEvents = jest.fn()
const mockCancelRun = jest.fn()
const mockTranscript = jest.fn()

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
      runEvents: mockRunEvents,
      cancelRun: mockCancelRun,
      transcript: mockTranscript,
    })),
  }
})

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
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function run(overrides: Partial<ApiRun> = {}): ApiRun {
  return {
    id: 30,
    ticketId: 1,
    adapter: 'claude',
    model: 'sonnet',
    status: 'running',
    branch: 'run-30',
    prUrl: null,
    summary: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: null,
    ...overrides,
  }
}

async function renderScreen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await render(
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider>
        <RunActivity />
      </ConnectionProvider>
    </QueryClientProvider>,
  )
}

describe('Run activity screen', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRunEvents.mockResolvedValue([])
  })

  test('shows the run status and a Cancel button while the run is active', async () => {
    mockTicket.mockResolvedValue({ ticket: ticket(), comments: [], runs: [run({ status: 'running' })] })

    await renderScreen()

    await waitFor(() => {
      expect(screen.getByTestId('run-status')).toHaveTextContent('running')
    })
    expect(screen.getByTestId('run-cancel')).toBeTruthy()
  })

  test('hides the Cancel button once the run is no longer active', async () => {
    mockTicket.mockResolvedValue({ ticket: ticket(), comments: [], runs: [run({ status: 'needs_review' })] })

    await renderScreen()

    await waitFor(() => {
      expect(screen.getByTestId('run-status')).toHaveTextContent('needs_review')
    })
    expect(screen.queryByTestId('run-cancel')).toBeNull()
  })

  test('cancel button confirms via Alert then calls cancelRun', async () => {
    mockTicket.mockResolvedValue({ ticket: ticket(), comments: [], runs: [run({ status: 'running' })] })
    mockCancelRun.mockResolvedValue(undefined)
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const destructive = buttons?.find((b) => b.style === 'destructive')
      destructive?.onPress?.()
    })

    await renderScreen()

    await waitFor(() => {
      expect(screen.getByTestId('run-cancel')).toBeTruthy()
    })
    await fireEvent.press(screen.getByTestId('run-cancel'))

    await waitFor(() => {
      expect(mockCancelRun).toHaveBeenCalledWith(30)
    })
  })

  test('does not cancel when the confirm dialog is dismissed', async () => {
    mockTicket.mockResolvedValue({ ticket: ticket(), comments: [], runs: [run({ status: 'running' })] })
    jest.spyOn(Alert, 'alert').mockImplementation(() => {
      // user dismisses without pressing the destructive action
    })

    await renderScreen()

    await waitFor(() => {
      expect(screen.getByTestId('run-cancel')).toBeTruthy()
    })
    await fireEvent.press(screen.getByTestId('run-cancel'))

    expect(mockCancelRun).not.toHaveBeenCalled()
  })

  test('View transcript fetches and renders the raw transcript', async () => {
    mockTicket.mockResolvedValue({ ticket: ticket(), comments: [], runs: [run({ status: 'needs_review' })] })
    mockTranscript.mockResolvedValue('{"line":1}\n{"line":2}')

    await renderScreen()

    await waitFor(() => {
      expect(screen.getByTestId('transcript-toggle')).toBeTruthy()
    })
    await fireEvent.press(screen.getByTestId('transcript-toggle'))

    await waitFor(() => {
      expect(screen.getByTestId('transcript-text')).toHaveTextContent('{"line":1} {"line":2}')
    })
    expect(mockTranscript).toHaveBeenCalledWith(30)
  })

  test('View transcript shows "No transcript" on a 404', async () => {
    mockTicket.mockResolvedValue({ ticket: ticket(), comments: [], runs: [run({ status: 'needs_review' })] })
    const { ApiError } = jest.requireMock('../src/api/client') as { ApiError: new (s: number, b: unknown) => Error }
    mockTranscript.mockRejectedValue(new ApiError(404, 'not found'))

    await renderScreen()

    await waitFor(() => {
      expect(screen.getByTestId('transcript-toggle')).toBeTruthy()
    })
    await fireEvent.press(screen.getByTestId('transcript-toggle'))

    await waitFor(() => {
      expect(screen.getByTestId('transcript-text')).toHaveTextContent('No transcript')
    })
  })
})
