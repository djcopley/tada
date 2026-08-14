import type { ApiMemory } from '@tada/shared'
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

const mockMemory = jest.fn()
const mockPutMemory = jest.fn()
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
      memory: mockMemory,
      putMemory: mockPutMemory,
    })),
  }
})

function memory(overrides: Partial<ApiMemory> = {}): ApiMemory {
  return {
    agentsMd: '# Agents\n\nAgent docs here.',
    notes: [
      { name: 'api-notes.md', body: 'API notes' },
      { name: 'context.md', body: 'Context info' },
    ],
    ...overrides,
  }
}

async function renderMemoryList() {
  mockUseLocalSearchParams.mockReturnValue({ id: '1' })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const MemoryList = require('../app/workspaces/[id]/memory/index').default
  await render(
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider>
        <MemoryList />
      </ConnectionProvider>
    </QueryClientProvider>,
  )
}

async function renderMemoryEditor(file: string) {
  mockUseLocalSearchParams.mockReturnValue({ id: '1', file })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const MemoryEditor = require('../app/workspaces/[id]/memory/[file]').default
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ToastHost } = require('../src/toast')
  await render(
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider>
        <MemoryEditor />
        <ToastHost />
      </ConnectionProvider>
    </QueryClientProvider>,
  )
}

describe('Memory screens', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('List screen', () => {
    test('renders AGENTS.md pinned first, then notes sorted by name', async () => {
      mockMemory.mockResolvedValueOnce(
        memory({
          agentsMd: '# Agents\n\nAgent docs here.',
          notes: [
            { name: 'zebra.md', body: 'Z notes' },
            { name: 'alpha.md', body: 'A notes' },
            { name: 'beta.md', body: 'B notes' },
          ],
        }),
      )

      await renderMemoryList()

      await waitFor(() => {
        expect(screen.getByText('AGENTS.md')).toBeTruthy()
      })

      expect(screen.getByText('alpha.md')).toBeTruthy()
      expect(screen.getByText('beta.md')).toBeTruthy()
      expect(screen.getByText('zebra.md')).toBeTruthy()
    })

    test('tapping a file navigates to editor with file param', async () => {
      mockMemory.mockResolvedValueOnce(memory())

      await renderMemoryList()

      await waitFor(() => {
        expect(screen.getByText('AGENTS.md')).toBeTruthy()
      })

      await fireEvent.press(screen.getByTestId('memory-file-AGENTS.md'))
      expect(mockPush).toHaveBeenCalledWith('/workspaces/1/memory/AGENTS.md')
    })

    test('tapping a file with spaces encodes the filename in the route', async () => {
      mockMemory.mockResolvedValueOnce(
        memory({
          notes: [{ name: 'my note.md', body: 'content' }],
        }),
      )

      await renderMemoryList()

      await waitFor(() => {
        expect(screen.getByText('my note.md')).toBeTruthy()
      })

      await fireEvent.press(screen.getByTestId('memory-file-my note.md'))
      expect(mockPush).toHaveBeenCalledWith('/workspaces/1/memory/my%20note.md')
    })

    test('new note flow opens name prompt', async () => {
      mockMemory.mockResolvedValueOnce(memory())

      await renderMemoryList()

      await waitFor(() => {
        expect(screen.getByText('AGENTS.md')).toBeTruthy()
      })

      await fireEvent.press(screen.getByTestId('memory-add-button'))
      expect(screen.getByTestId('memory-name-input')).toBeTruthy()
    })
  })

  describe('New note validation', () => {
    test('invalid name with .. shows inline error and never calls client', async () => {
      mockMemory.mockResolvedValueOnce(memory())

      await renderMemoryList()

      await waitFor(() => {
        expect(screen.getByText('AGENTS.md')).toBeTruthy()
      })

      await fireEvent.press(screen.getByTestId('memory-add-button'))
      const input = screen.getByTestId('memory-name-input')

      await fireEvent.changeText(input, '../secret.md')
      await fireEvent.press(screen.getByTestId('memory-name-submit'))

      expect(screen.getByTestId('memory-name-error')).toBeTruthy()
      expect(mockPutMemory).not.toHaveBeenCalled()
    })

    test('name with / is rejected', async () => {
      mockMemory.mockResolvedValueOnce(memory())

      await renderMemoryList()

      await waitFor(() => {
        expect(screen.getByText('AGENTS.md')).toBeTruthy()
      })

      await fireEvent.press(screen.getByTestId('memory-add-button'))
      const input = screen.getByTestId('memory-name-input')

      await fireEvent.changeText(input, 'invalid/name.md')
      await fireEvent.press(screen.getByTestId('memory-name-submit'))

      expect(screen.getByTestId('memory-name-error')).toBeTruthy()
      expect(mockPutMemory).not.toHaveBeenCalled()
    })

    test('valid name .md is appended if missing', async () => {
      mockMemory.mockResolvedValueOnce(memory())
      mockPutMemory.mockResolvedValueOnce(undefined)

      await renderMemoryList()

      await waitFor(() => {
        expect(screen.getByText('AGENTS.md')).toBeTruthy()
      })

      await fireEvent.press(screen.getByTestId('memory-add-button'))
      const input = screen.getByTestId('memory-name-input')

      await fireEvent.changeText(input, 'notes')
      await fireEvent.press(screen.getByTestId('memory-name-submit'))

      await waitFor(() => {
        expect(mockPutMemory).toHaveBeenCalledWith(1, 'notes.md', '')
      })
    })
  })

  describe('Editor screen', () => {
    test('renders seeded body for AGENTS.md', async () => {
      mockMemory.mockResolvedValueOnce(
        memory({ agentsMd: 'Custom agent content' }),
      )

      await renderMemoryEditor('AGENTS.md')

      await waitFor(() => {
        expect(screen.getByDisplayValue('Custom agent content')).toBeTruthy()
      })
      expect(screen.getByText('AGENTS.md')).toBeTruthy()
    })

    test('renders seeded body for a note', async () => {
      mockMemory.mockResolvedValueOnce(
        memory({ notes: [{ name: 'test.md', body: 'Test note content' }] }),
      )

      await renderMemoryEditor('test.md')

      await waitFor(() => {
        expect(screen.getByDisplayValue('Test note content')).toBeTruthy()
      })
      expect(screen.getByText('test.md')).toBeTruthy()
    })

    test('save button is disabled until content changes', async () => {
      mockMemory.mockResolvedValueOnce(
        memory({ notes: [{ name: 'test.md', body: 'Original content' }] }),
      )

      await renderMemoryEditor('test.md')

      await waitFor(() => {
        expect(screen.getByDisplayValue('Original content')).toBeTruthy()
      })

      // Button should be disabled initially (verify by checking accessibility state)
      const saveButton = screen.getByTestId('memory-save-button')
      const accessibilityState = saveButton.props.accessibilityState
      expect(accessibilityState?.disabled).toBe(true)
    })

    test('editing enables save button', async () => {
      mockMemory.mockResolvedValueOnce(
        memory({ notes: [{ name: 'test.md', body: 'Original' }] }),
      )

      await renderMemoryEditor('test.md')

      await waitFor(() => {
        expect(screen.getByDisplayValue('Original')).toBeTruthy()
      })

      const input = screen.getByTestId('memory-editor-input')
      await fireEvent.changeText(input, 'Modified content')

      const saveButton = screen.getByTestId('memory-save-button')
      const accessibilityState = saveButton.props.accessibilityState
      expect(accessibilityState?.disabled).toBe(false)
    })

    test('save calls putMemory with edited body and shows toast', async () => {
      mockMemory.mockResolvedValueOnce(
        memory({ notes: [{ name: 'test.md', body: 'Original' }] }),
      )
      mockPutMemory.mockResolvedValueOnce(undefined)

      await renderMemoryEditor('test.md')

      await waitFor(() => {
        expect(screen.getByDisplayValue('Original')).toBeTruthy()
      })

      const input = screen.getByTestId('memory-editor-input')
      await fireEvent.changeText(input, 'Updated content')

      const saveButton = screen.getByTestId('memory-save-button')
      await fireEvent.press(saveButton)

      await waitFor(() => {
        expect(mockPutMemory).toHaveBeenCalledWith(1, 'test.md', 'Updated content')
      })

      // Wait for toast to appear
      await waitFor(() => {
        expect(screen.getByTestId('toast-message')).toBeTruthy()
      })
      expect(screen.getByTestId('toast-message')).toHaveTextContent('Saved')
    })
  })
})
