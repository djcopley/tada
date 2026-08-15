import type { ApiWorkspaceListItem } from '@tada/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { ClientProvider } from '../src/api/ClientContext'
import { openWorkspaceSwitcher, WorkspaceSwitcher } from '../src/components/WorkspaceSwitcher'

const mockPush = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}))

jest.mock('../src/settings', () => ({
  loadActiveWorkspaceId: jest.fn(async () => null),
  saveActiveWorkspaceId: jest.fn(async () => undefined),
}))

const mockListWorkspaces = jest.fn()
const mockGlobalMemory = jest.fn()

function makeClient() {
  return {
    listWorkspaces: mockListWorkspaces,
    globalMemory: mockGlobalMemory,
  } as unknown as import('../src/api/client').TadaClient
}

function workspace(overrides: Partial<ApiWorkspaceListItem>): ApiWorkspaceListItem {
  return {
    id: 1,
    name: 'parlor',
    defaultAdapter: 'claude',
    defaultModel: 'sonnet',
    defaultEffort: 'default',
    concurrency: 1,
    timeoutMs: 60_000,
    createdAt: '2026-01-01T00:00:00.000Z',
    runningCount: 0,
    needsReviewCount: 0,
    queuedCount: 0,
    sourceCount: 2,
    ...overrides,
  }
}

async function renderSwitcher() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await render(
    <QueryClientProvider client={queryClient}>
      <ClientProvider client={makeClient()}>
        <WorkspaceSwitcher />
      </ClientProvider>
    </QueryClientProvider>,
  )
}

describe('WorkspaceSwitcher', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGlobalMemory.mockResolvedValue({ agentsMd: '', notes: [] })
  })

  test('is closed until openWorkspaceSwitcher() is called', async () => {
    mockListWorkspaces.mockResolvedValue([workspace({ id: 1, name: 'parlor' })])

    await renderSwitcher()

    expect(screen.queryByTestId('workspace-switcher')).toBeNull()

    await act(async () => {
      openWorkspaceSwitcher()
    })

    expect(screen.getByTestId('workspace-switcher')).toBeTruthy()
  })

  test('renders the Global scope row and every workspace with its source/live meta', async () => {
    mockListWorkspaces.mockResolvedValue([
      workspace({ id: 1, name: 'parlor', sourceCount: 2, runningCount: 1 }),
      workspace({ id: 2, name: 'ops', sourceCount: 0, runningCount: 0 }),
    ])

    await renderSwitcher()
    await act(async () => {
      openWorkspaceSwitcher()
    })

    await waitFor(() => {
      expect(screen.getByTestId('switcher-scope-global')).toBeTruthy()
    })
    expect(screen.getByTestId('switcher-workspace-1')).toBeTruthy()
    expect(screen.getByTestId('switcher-workspace-2')).toBeTruthy()
    expect(screen.getByText('parlor')).toBeTruthy()
    expect(screen.getByText('ops')).toBeTruthy()
    expect(screen.getByTestId('switcher-new-workspace')).toBeTruthy()
  })

  test('selecting a workspace closes the menu and navigates to its board', async () => {
    mockListWorkspaces.mockResolvedValue([workspace({ id: 5, name: 'ops' })])

    await renderSwitcher()
    await act(async () => {
      openWorkspaceSwitcher()
    })

    await waitFor(() => {
      expect(screen.getByTestId('switcher-workspace-5')).toBeTruthy()
    })

    await fireEvent.press(screen.getByTestId('switcher-workspace-5'))

    expect(mockPush).toHaveBeenCalledWith('/workspaces/5/board')
    await waitFor(() => {
      expect(screen.queryByTestId('workspace-switcher')).toBeNull()
    })
  })

  test('tapping the scrim closes the menu', async () => {
    mockListWorkspaces.mockResolvedValue([workspace({ id: 1, name: 'parlor' })])

    await renderSwitcher()
    await act(async () => {
      openWorkspaceSwitcher()
    })

    expect(screen.getByTestId('workspace-switcher')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('workspace-switcher-scrim'))

    await waitFor(() => {
      expect(screen.queryByTestId('workspace-switcher')).toBeNull()
    })
  })
})
