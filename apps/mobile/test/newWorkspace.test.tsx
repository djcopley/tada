import type { ApiKnownRepo, ApiWorkspace } from '@tada/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { ClientProvider } from '../src/api/ClientContext'
import { NewWorkspaceDialog, openNewWorkspaceDialog } from '../src/components/NewWorkspaceDialog'

const mockPush = jest.fn()
const mockNavigate = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, navigate: mockNavigate }),
}))

const mockShowToast = jest.fn()
jest.mock('../src/toast', () => ({ showToast: (m: string) => mockShowToast(m) }))

const mockCheckName = jest.fn()
const mockKnownRepos = jest.fn()
const mockCreateWorkspace = jest.fn()
const mockAddSource = jest.fn()

function makeClient() {
  return {
    checkName: mockCheckName,
    knownRepos: mockKnownRepos,
    createWorkspace: mockCreateWorkspace,
    addSource: mockAddSource,
  } as unknown as import('../src/api/client').TadaClient
}

function repo(overrides: Partial<ApiKnownRepo> = {}): ApiKnownRepo {
  return { url: 'https://github.com/acme/web.git', name: 'acme/web', ...overrides }
}

function workspace(overrides: Partial<ApiWorkspace> = {}): ApiWorkspace {
  return {
    id: 42,
    name: 'Acme web',
    defaultAdapter: 'claude',
    defaultModel: 'sonnet',
    defaultEffort: 'default',
    concurrency: 1,
    timeoutMs: 300_000,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

async function renderDialog() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await render(
    <QueryClientProvider client={queryClient}>
      <ClientProvider client={makeClient()}>
        <NewWorkspaceDialog />
      </ClientProvider>
    </QueryClientProvider>,
  )
}

async function openDialog() {
  await act(async () => {
    openNewWorkspaceDialog()
  })
  await waitFor(() => expect(screen.getByTestId('new-workspace-dialog')).toBeTruthy())
}

describe('NewWorkspaceDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockKnownRepos.mockResolvedValue([
      repo({ url: 'https://github.com/acme/web.git', name: 'acme/web' }),
      repo({ url: 'https://github.com/acme/infra.git', name: 'acme/infra' }),
    ])
    mockCheckName.mockResolvedValue({ id: 'acme-web', available: true })
    mockCreateWorkspace.mockResolvedValue(workspace())
    mockAddSource.mockResolvedValue([])
  })

  test('is closed until openNewWorkspaceDialog() is called', async () => {
    await renderDialog()
    expect(screen.queryByTestId('new-workspace-dialog')).toBeNull()

    await openDialog()

    expect(screen.getByTestId('new-workspace-dialog')).toBeTruthy()
  })

  test('typing a name shows the live availability check (ok)', async () => {
    mockCheckName.mockResolvedValue({ id: 'acme-web', available: true })
    await renderDialog()
    await openDialog()

    await fireEvent.changeText(screen.getByTestId('workspace-name-input'), 'Acme web')

    await waitFor(
      () => {
        expect(mockCheckName).toHaveBeenCalledWith('Acme web')
      },
      { timeout: 2000 },
    )
    await waitFor(() => {
      expect(screen.getByText('✓ id acme-web · available')).toBeTruthy()
    })
  })

  test('a taken name shows the fail-text line and disables create', async () => {
    mockCheckName.mockResolvedValue({ id: 'acme-web', available: false })
    await renderDialog()
    await openDialog()

    await fireEvent.changeText(screen.getByTestId('workspace-name-input'), 'Acme web')

    await waitFor(
      () => {
        expect(screen.getByText('✕ id acme-web · taken')).toBeTruthy()
      },
      { timeout: 2000 },
    )
    expect(screen.getByTestId('workspace-create-button').props.accessibilityState.disabled).toBe(true)
  })

  test('lists known repos as checkboxes', async () => {
    await renderDialog()
    await openDialog()

    await waitFor(() => {
      expect(screen.getByTestId('attach-repo-https://github.com/acme/web.git')).toBeTruthy()
      expect(screen.getByTestId('attach-repo-https://github.com/acme/infra.git')).toBeTruthy()
    })
    expect(screen.getByText('acme/web')).toBeTruthy()
    expect(screen.getByText('acme/infra')).toBeTruthy()
  })

  test('create with checked repos: creates the workspace, adds each checked source, then navigates', async () => {
    await renderDialog()
    await openDialog()

    await fireEvent.changeText(screen.getByTestId('workspace-name-input'), 'Acme web')
    await waitFor(() => {
      expect(screen.getByTestId('attach-repo-https://github.com/acme/web.git')).toBeTruthy()
    })
    await fireEvent.press(screen.getByTestId('attach-repo-https://github.com/acme/web.git'))

    await fireEvent.press(screen.getByTestId('workspace-create-button'))

    await waitFor(() => {
      expect(mockCreateWorkspace).toHaveBeenCalledWith('Acme web')
    })
    await waitFor(() => {
      expect(mockAddSource).toHaveBeenCalledWith(42, { type: 'repo', url: 'https://github.com/acme/web.git' })
    })
    expect(mockAddSource).not.toHaveBeenCalledWith(42, { type: 'repo', url: 'https://github.com/acme/infra.git' })
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/workspaces/42/board')
    })
  })

  test('a failed clone after the workspace exists closes the dialog, toasts, and lands on Settings', async () => {
    const { ApiError } = require('../src/api/client')
    mockAddSource.mockRejectedValueOnce(new ApiError(502, { error: 'clone failed: repository not found' }))
    await renderDialog()
    await openDialog()

    await fireEvent.changeText(screen.getByTestId('workspace-name-input'), 'Acme web')
    await waitFor(() => {
      expect(screen.getByTestId('attach-repo-https://github.com/acme/web.git')).toBeTruthy()
    })
    await fireEvent.press(screen.getByTestId('attach-repo-https://github.com/acme/web.git'))
    await fireEvent.press(screen.getByTestId('workspace-create-button'))

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        'Workspace created, but adding https://github.com/acme/web.git (clone failed: repository not found) failed',
      )
    })
    // Retrying here would only hit "name taken" — sources are managed on Settings instead.
    expect(mockNavigate).toHaveBeenCalledWith('/workspaces/42/settings')
    expect(screen.queryByTestId('new-workspace-dialog')).toBeNull()
  })

  test('create with no repos checked: skips addSource entirely', async () => {
    await renderDialog()
    await openDialog()

    await fireEvent.changeText(screen.getByTestId('workspace-name-input'), 'Acme web')
    await fireEvent.press(screen.getByTestId('workspace-create-button'))

    await waitFor(() => {
      expect(mockCreateWorkspace).toHaveBeenCalledWith('Acme web')
    })
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/workspaces/42/board')
    })
    expect(mockAddSource).not.toHaveBeenCalled()
  })

  test('create button is disabled with an empty name', async () => {
    await renderDialog()
    await openDialog()

    expect(screen.getByTestId('workspace-create-button').props.accessibilityState.disabled).toBe(true)
  })
})
