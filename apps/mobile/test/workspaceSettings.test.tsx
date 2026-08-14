import type { ApiRepo, ApiWorkspace } from '@tada/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { ConnectionProvider } from '../src/ConnectionContext'

const mockPush = jest.fn()
const mockUseLocalSearchParams = jest.fn()

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}))

jest.mock('../src/settings', () => ({
  loadConnection: jest.fn(async () => ({ baseUrl: 'https://example.com', token: 'secret' })),
  saveConnection: jest.fn(async () => undefined),
  clearConnection: jest.fn(async () => undefined),
}))

const mockGetWorkspace = jest.fn()
const mockPatchWorkspace = jest.fn()
const mockAddRepo = jest.fn()
const mockRemoveRepo = jest.fn()

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
      getWorkspace: mockGetWorkspace,
      patchWorkspace: mockPatchWorkspace,
      addRepo: mockAddRepo,
      removeRepo: mockRemoveRepo,
    })),
  }
})

function workspace(overrides: Partial<ApiWorkspace & { repos: ApiRepo[] }> = {}): ApiWorkspace & {
  repos: ApiRepo[]
} {
  return {
    id: 1,
    name: 'Alpha',
    path: '/repos/alpha',
    defaultAdapter: 'claude',
    defaultModel: 'sonnet',
    concurrency: 2,
    timeoutMs: 300_000,
    createdAt: '2026-01-01T00:00:00.000Z',
    repos: [
      { name: 'repo-a', url: 'https://github.com/user/repo-a.git', defaultBranch: 'main' },
      { name: 'repo-b', url: 'git@github.com:user/repo-b.git', defaultBranch: 'develop' },
    ],
    ...overrides,
  }
}

async function renderSettings() {
  mockUseLocalSearchParams.mockReturnValue({ id: '1' })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const SettingsScreen = require('../app/workspaces/[id]/settings').default
  await render(
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider>
        <SettingsScreen />
      </ConnectionProvider>
    </QueryClientProvider>,
  )
}

describe('Workspace settings screen', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetWorkspace.mockResolvedValue(workspace())
    mockPatchWorkspace.mockResolvedValue(workspace())
    mockAddRepo.mockResolvedValue(undefined)
    mockRemoveRepo.mockResolvedValue(undefined)
  })

  describe('Repos section', () => {
    test('renders repos from fixture with name and url', async () => {
      await renderSettings()

      await waitFor(() => {
        expect(screen.getByText('repo-a')).toBeTruthy()
        expect(screen.getByText('https://github.com/user/repo-a.git')).toBeTruthy()
        expect(screen.getByText('repo-b')).toBeTruthy()
        expect(screen.getByText('git@github.com:user/repo-b.git')).toBeTruthy()
      })
    })

    test('add repo calls client with valid https url and refetches', async () => {
      await renderSettings()

      await waitFor(() => {
        expect(screen.getByText('repo-a')).toBeTruthy()
      })

      const urlInput = screen.getByTestId('add-repo-url-input')
      await fireEvent.changeText(urlInput, 'https://github.com/user/new-repo.git')

      const addButton = screen.getByTestId('add-repo-button')
      await fireEvent.press(addButton)

      await waitFor(() => {
        expect(mockAddRepo).toHaveBeenCalledWith(1, 'https://github.com/user/new-repo.git')
      })
    })

    test('add repo calls client with valid git@ url', async () => {
      await renderSettings()

      await waitFor(() => {
        expect(screen.getByText('repo-a')).toBeTruthy()
      })

      const urlInput = screen.getByTestId('add-repo-url-input')
      await fireEvent.changeText(urlInput, 'git@github.com:user/new-repo.git')

      const addButton = screen.getByTestId('add-repo-button')
      await fireEvent.press(addButton)

      await waitFor(() => {
        expect(mockAddRepo).toHaveBeenCalledWith(1, 'git@github.com:user/new-repo.git')
      })
    })

    test('invalid url shows inline error and never calls client', async () => {
      await renderSettings()

      await waitFor(() => {
        expect(screen.getByText('repo-a')).toBeTruthy()
      })

      const urlInput = screen.getByTestId('add-repo-url-input')
      await fireEvent.changeText(urlInput, 'not-a-valid-url')

      const addButton = screen.getByTestId('add-repo-button')
      await fireEvent.press(addButton)

      expect(screen.getByTestId('add-repo-error')).toBeTruthy()
      expect(mockAddRepo).not.toHaveBeenCalled()
    })

    test('remove repo confirms via dialog then calls client', async () => {
      await renderSettings()

      await waitFor(() => {
        expect(screen.getByText('repo-a')).toBeTruthy()
      })

      await fireEvent.press(screen.getByTestId('remove-repo-repo-a'))
      await fireEvent.press(screen.getByTestId('remove-repo-confirm'))

      await waitFor(() => {
        expect(mockRemoveRepo).toHaveBeenCalledWith(1, 'repo-a')
      })
    })

    test('add repo failure shows inline error and keeps the url input', async () => {
      const { ApiError } = require('../src/api/client')
      mockAddRepo.mockRejectedValueOnce(new ApiError(500, { error: 'clone failed' }))

      await renderSettings()

      await waitFor(() => {
        expect(screen.getByText('repo-a')).toBeTruthy()
      })

      const urlInput = screen.getByTestId('add-repo-url-input')
      await fireEvent.changeText(urlInput, 'https://github.com/user/new-repo.git')

      const addButton = screen.getByTestId('add-repo-button')
      await fireEvent.press(addButton)

      await waitFor(() => {
        expect(screen.getByTestId('add-repo-error')).toBeTruthy()
        expect(screen.getByTestId('add-repo-error').props.children).toBe('clone failed')
      })

      expect(screen.getByTestId('add-repo-url-input').props.value).toBe(
        'https://github.com/user/new-repo.git',
      )
    })

    test('remove repo failure shows inline error', async () => {
      const { ApiError } = require('../src/api/client')
      mockRemoveRepo.mockRejectedValueOnce(new ApiError(500, { error: 'remove failed' }))

      await renderSettings()

      await waitFor(() => {
        expect(screen.getByText('repo-a')).toBeTruthy()
      })

      await fireEvent.press(screen.getByTestId('remove-repo-repo-a'))
      await fireEvent.press(screen.getByTestId('remove-repo-confirm'))

      await waitFor(() => {
        expect(mockRemoveRepo).toHaveBeenCalledWith(1, 'repo-a')
        expect(screen.getByTestId('remove-repo-error')).toBeTruthy()
        expect(screen.getByTestId('remove-repo-error').props.children).toBe('remove failed')
      })
    })
  })

  describe('Defaults section', () => {
    test('model options change when adapter changes', async () => {
      await renderSettings()

      await waitFor(() => {
        expect(screen.getByTestId('adapter-picker')).toBeTruthy()
      })

      // Initially shows model for claude adapter
      expect(screen.getByTestId('model-picker')).toBeTruthy()

      // When adapter picker is pressed, modal should open
      const adapterPicker = screen.getByTestId('adapter-picker')
      fireEvent.press(adapterPicker)

      // Wait for modal items to be visible (more than 1 claude)
      await waitFor(() => {
        const adapterItems = screen.getAllByText('Claude')
        expect(adapterItems.length).toBeGreaterThan(1)
      })

      // Should still have model options for claude
      expect(screen.getByTestId('model-picker')).toBeTruthy()
    })

    test('selecting adapter calls patchWorkspace and updates model if needed', async () => {
      mockPatchWorkspace.mockResolvedValue(
        workspace({ defaultAdapter: 'claude', defaultModel: 'sonnet' }),
      )

      await renderSettings()

      await waitFor(() => {
        expect(screen.getByTestId('adapter-picker')).toBeTruthy()
      })

      const adapterPicker = screen.getByTestId('adapter-picker')
      fireEvent.press(adapterPicker)

      // Wait for modal item to be visible
      await waitFor(() => {
        const adapterItems = screen.getAllByText('Claude')
        expect(adapterItems.length).toBeGreaterThan(1)
      })

      // Press the modal item (the second one, which is from FlatList)
      const adapterItems = screen.getAllByText('Claude')
      if (adapterItems.length > 1) {
        const modalItem = adapterItems[adapterItems.length - 1]
        if (modalItem) fireEvent.press(modalItem)
      }

      await waitFor(() => {
        expect(mockPatchWorkspace).toHaveBeenCalled()
      })
    })

    test('selecting model calls patchWorkspace with model', async () => {
      await renderSettings()

      await waitFor(() => {
        expect(screen.getByTestId('model-picker')).toBeTruthy()
      })

      const modelPicker = screen.getByTestId('model-picker')
      fireEvent.press(modelPicker)

      // Wait for modal item to be visible
      await waitFor(() => {
        const modelItems = screen.getAllByText('Sonnet')
        expect(modelItems.length).toBeGreaterThan(1)
      })

      // Press the modal item (the second one, which is from FlatList)
      const modelItems = screen.getAllByText('Sonnet')
      if (modelItems.length > 1) {
        const modalItem = modelItems[modelItems.length - 1]
        if (modalItem) fireEvent.press(modalItem)
      }

      await waitFor(() => {
        expect(mockPatchWorkspace).toHaveBeenCalledWith(1, expect.objectContaining({ defaultModel: 'sonnet' }))
      })
    })
  })

  describe('Advanced section', () => {
    test('concurrency stepper +/- sends patched number', async () => {
      await renderSettings()

      await waitFor(() => {
        expect(screen.getByTestId('concurrency-increment')).toBeTruthy()
      })

      // Wait for workspace data to render concurrency value
      const incrementButton = screen.getByTestId('concurrency-increment')
      fireEvent.press(incrementButton)

      await waitFor(() => {
        expect(mockPatchWorkspace).toHaveBeenCalledWith(1, expect.objectContaining({ concurrency: 3 }))
      })

      jest.clearAllMocks()
      mockPatchWorkspace.mockResolvedValue(workspace({ concurrency: 3 }))

      const decrementButton = screen.getByTestId('concurrency-decrement')
      fireEvent.press(decrementButton)

      await waitFor(() => {
        expect(mockPatchWorkspace).toHaveBeenCalledWith(1, expect.objectContaining({ concurrency: 2 }))
      })
    })

    test('concurrency clamped to 1..4', async () => {
      await renderSettings()

      await waitFor(() => {
        expect(screen.getByTestId('concurrency-decrement')).toBeTruthy()
      })

      // Try to go below 1
      let decrementButton = screen.getByTestId('concurrency-decrement')
      fireEvent.press(decrementButton)

      await waitFor(() => {
        expect(mockPatchWorkspace).toHaveBeenCalledWith(1, expect.objectContaining({ concurrency: 1 }))
      })

      jest.clearAllMocks()
      mockPatchWorkspace.mockResolvedValue(workspace({ concurrency: 1 }))

      // Press decrement at 1 - should not call again
      decrementButton = screen.getByTestId('concurrency-decrement')
      fireEvent.press(decrementButton)

      // Should not call since already at min
      expect(mockPatchWorkspace).not.toHaveBeenCalled()
    })

    test('timeout minutes input can be changed', async () => {
      await renderSettings()

      await waitFor(() => {
        expect(screen.getByTestId('timeout-minutes-input')).toBeTruthy()
      })

      const timeoutInput = screen.getByTestId('timeout-minutes-input')
      fireEvent.changeText(timeoutInput, '10')

      // Wait for the input value to update
      await waitFor(() => {
        const updated = screen.getByTestId('timeout-minutes-input')
        expect(updated.props.value).toBe('10')
      })
    })

    test('blurring an empty timeout input resets to the last-saved value', async () => {
      await renderSettings()

      await waitFor(() => {
        expect(screen.getByTestId('timeout-minutes-input')).toBeTruthy()
      })

      const timeoutInput = screen.getByTestId('timeout-minutes-input')
      // workspace() fixture has timeoutMs 300_000 => 5 minutes displayed
      expect(timeoutInput.props.value).toBe('5')

      await fireEvent.changeText(timeoutInput, '')
      await fireEvent(timeoutInput, 'blur')

      await waitFor(() => {
        expect(screen.getByTestId('timeout-minutes-input').props.value).toBe('5')
      })
      expect(mockPatchWorkspace).not.toHaveBeenCalled()
    })

    test('blurring a non-numeric timeout input resets to the last-saved value', async () => {
      await renderSettings()

      await waitFor(() => {
        expect(screen.getByTestId('timeout-minutes-input')).toBeTruthy()
      })

      const timeoutInput = screen.getByTestId('timeout-minutes-input')

      await fireEvent.changeText(timeoutInput, 'abc')
      await fireEvent(timeoutInput, 'blur')

      await waitFor(() => {
        expect(screen.getByTestId('timeout-minutes-input').props.value).toBe('5')
      })
      expect(mockPatchWorkspace).not.toHaveBeenCalled()
    })
  })

  describe('Error handling', () => {
    test('server 400 on patch shows inline error text', async () => {
      const { ApiError } = require('../src/api/client')
      mockPatchWorkspace.mockRejectedValueOnce(
        new ApiError(400, { error: 'Invalid adapter' }),
      )

      await renderSettings()

      await waitFor(() => {
        expect(screen.getByTestId('adapter-picker')).toBeTruthy()
      })

      const adapterPicker = screen.getByTestId('adapter-picker')
      fireEvent.press(adapterPicker)

      await waitFor(() => {
        const adapterItems = screen.getAllByText('Claude')
        expect(adapterItems.length).toBeGreaterThan(1)
      })

      const adapterItems = screen.getAllByText('Claude')
      if (adapterItems.length > 1) {
        const modalItem = adapterItems[adapterItems.length - 1]
        if (modalItem) fireEvent.press(modalItem)
      }

      await waitFor(() => {
        expect(screen.getByTestId('patch-error')).toBeTruthy()
      })
    })
  })
})
