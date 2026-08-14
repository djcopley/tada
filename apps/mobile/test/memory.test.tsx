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
})
