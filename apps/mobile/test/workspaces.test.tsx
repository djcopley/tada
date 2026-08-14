import type { ApiWorkspaceListItem } from '@tada/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import Workspaces from '../app/workspaces/index'
import { ConnectionProvider } from '../src/ConnectionContext'

const mockPush = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}))

jest.mock('../src/settings', () => ({
  loadConnection: jest.fn(async () => ({ baseUrl: 'https://example.com', token: 'secret' })),
  saveConnection: jest.fn(async () => undefined),
  clearConnection: jest.fn(async () => undefined),
}))

const mockListWorkspaces = jest.fn()
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
      createWorkspace: mockCreateWorkspace,
    })),
  }
})

function workspace(overrides: Partial<ApiWorkspaceListItem>): ApiWorkspaceListItem {
  return {
    id: 1,
    name: 'Alpha',
    path: '/repos/alpha',
    defaultAdapter: 'claude',
    defaultModel: 'sonnet',
    concurrency: 1,
    timeoutMs: 60_000,
    createdAt: '2026-01-01T00:00:00.000Z',
    runningCount: 0,
    needsReviewCount: 0,
    ...overrides,
  }
}

async function renderWorkspaces() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await render(
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider>
        <Workspaces />
      </ConnectionProvider>
    </QueryClientProvider>,
  )
}

describe('Workspaces screen', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('renders workspace names and status badges, hiding zero counts', async () => {
    mockListWorkspaces.mockResolvedValueOnce([
      workspace({ id: 1, name: 'Alpha', runningCount: 2, needsReviewCount: 1 }),
      workspace({ id: 2, name: 'Beta', runningCount: 0, needsReviewCount: 0 }),
    ])

    await renderWorkspaces()

    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeTruthy()
    })
    expect(screen.getByText('Beta')).toBeTruthy()
    expect(screen.getByTestId('workspace-running-1')).toHaveTextContent(/live/)
    expect(screen.getByTestId('workspace-running-1')).toHaveTextContent(/2/)
    expect(screen.getByTestId('workspace-review-1')).toHaveTextContent(/1/)
    expect(screen.queryByTestId('workspace-running-2')).toBeNull()
    expect(screen.queryByTestId('workspace-review-2')).toBeNull()
  })

  test('tapping a workspace navigates to its board', async () => {
    mockListWorkspaces.mockResolvedValueOnce([workspace({ id: 7, name: 'Gamma' })])

    await renderWorkspaces()

    await waitFor(() => {
      expect(screen.getByText('Gamma')).toBeTruthy()
    })
    await fireEvent.press(screen.getByTestId('workspace-card-7'))

    expect(mockPush).toHaveBeenCalledWith('/workspaces/7/board')
  })

  test('shows empty state when there are no workspaces', async () => {
    mockListWorkspaces.mockResolvedValueOnce([])

    await renderWorkspaces()

    await waitFor(() => {
      expect(screen.getByText('No workspaces yet — create one to start dispatching work.')).toBeTruthy()
    })
  })

  test('create flow creates a workspace and navigates to its board', async () => {
    mockListWorkspaces.mockResolvedValueOnce([])
    mockCreateWorkspace.mockResolvedValueOnce(
      workspace({ id: 42, name: 'New One', runningCount: 0, needsReviewCount: 0 }),
    )

    await renderWorkspaces()

    await waitFor(() => {
      expect(screen.getByText('No workspaces yet — create one to start dispatching work.')).toBeTruthy()
    })

    await fireEvent.press(screen.getByTestId('create-workspace-button'))
    await fireEvent.changeText(screen.getByTestId('workspace-name-input'), 'New One')
    await fireEvent.press(screen.getByTestId('workspace-create-button'))

    await waitFor(() => {
      expect(mockCreateWorkspace).toHaveBeenCalledWith('New One')
    })
    expect(mockPush).toHaveBeenCalledWith('/workspaces/42/board')
  })

  test('a failing createWorkspace does not crash and leaves the modal open to retry', async () => {
    mockListWorkspaces.mockResolvedValueOnce([])
    mockCreateWorkspace.mockRejectedValueOnce(new Error('network down'))

    await renderWorkspaces()

    await waitFor(() => {
      expect(screen.getByText('No workspaces yet — create one to start dispatching work.')).toBeTruthy()
    })

    await fireEvent.press(screen.getByTestId('create-workspace-button'))
    await fireEvent.changeText(screen.getByTestId('workspace-name-input'), 'New One')
    await fireEvent.press(screen.getByTestId('workspace-create-button'))

    await waitFor(() => {
      expect(mockCreateWorkspace).toHaveBeenCalledWith('New One')
    })
    // No navigation and the modal stays open — an unhandled rejection here
    // would fail the test via jest's global handler even without a
    // navigation assertion, so the absence of a crash is itself coverage.
    expect(mockPush).not.toHaveBeenCalled()
    expect(screen.getByTestId('workspace-name-input')).toBeTruthy()
  })

  test('pull-to-refresh refetches the workspace list', async () => {
    mockListWorkspaces.mockResolvedValue([workspace({ id: 1, name: 'Alpha' })])

    await renderWorkspaces()

    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeTruthy()
    })
    expect(mockListWorkspaces).toHaveBeenCalledTimes(1)

    await fireEvent(screen.getByTestId('workspaces-list'), 'refresh')

    await waitFor(() => {
      expect(mockListWorkspaces).toHaveBeenCalledTimes(2)
    })
  })
})
