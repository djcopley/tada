import type { ApiMemoryNote, ApiSource } from '@tada/shared'
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { Dimensions } from 'react-native'
import { ConnectionProvider } from '../src/ConnectionContext'
import { keepHint, keptNoteMeta, noteAge } from '../src/components/memory/MemoryListScreen'
import { toggleTag } from '../src/components/memory/NoteEditorScreen'
import { makeTestQueryClient } from './helpers/queryClient'

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockBack = jest.fn()
const mockUseLocalSearchParams = jest.fn()
const mockAddListener = jest.fn(() => jest.fn())

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack, canGoBack: () => false, navigate: jest.fn() }),
  useLocalSearchParams: () => mockUseLocalSearchParams(),
  useNavigation: () => ({ addListener: mockAddListener, dispatch: jest.fn() }),
}))

jest.mock('../src/settings', () => ({
  loadConnection: jest.fn(async () => ({ baseUrl: 'https://example.com', token: 'secret' })),
  saveConnection: jest.fn(async () => undefined),
  clearConnection: jest.fn(async () => undefined),
}))

// The list mounts the app socket; keep it inert here.
jest.mock('../src/api/useAppSocket', () => ({ useAppSocket: jest.fn() }))

const mockMemory = jest.fn()
const mockSources = jest.fn()
const mockCreateNote = jest.fn()
const mockPatchNote = jest.fn()
const mockDeleteNote = jest.fn()
const mockKeepNote = jest.fn()
const mockDismissNote = jest.fn()

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
      sources: mockSources,
      createNote: mockCreateNote,
      patchNote: mockPatchNote,
      deleteNote: mockDeleteNote,
      keepNote: mockKeepNote,
      dismissNote: mockDismissNote,
    })),
  }
})

let nextId = 1
function note(overrides: Partial<ApiMemoryNote> = {}): ApiMemoryNote {
  const id = nextId++
  return {
    id,
    title: `Note ${id}`,
    body: `body ${id}`,
    tags: [],
    author: 'human',
    runId: null,
    state: 'kept',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const REPOS: ApiSource[] = [
  { type: 'repo', name: 'parlor-web', url: 'x', defaultBranch: 'main' },
  { type: 'repo', name: 'parlor-api', url: 'y', defaultBranch: 'main' },
  { type: 'folder', name: 'specs', path: '/specs' },
]

let dimensionsSpy: jest.SpyInstance | undefined
function setWidth(width: number) {
  dimensionsSpy?.mockRestore()
  dimensionsSpy = jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height: 900, scale: 1, fontScale: 1 })
}

async function renderList() {
  const queryClient = makeTestQueryClient()
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const MemoryList = require('../app/(tabs)/memory').default
  await render(
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider>
        <MemoryList />
      </ConnectionProvider>
    </QueryClientProvider>,
  )
}

async function renderEditor(id: string) {
  // Let the previous test's trailing microtasks (mutation settles, navigation) drain before a new
  // tree mounts — otherwise their act() scopes overlap with this render's.
  await new Promise((r) => setTimeout(r, 0))
  mockUseLocalSearchParams.mockReturnValue({ id })
  const queryClient = makeTestQueryClient()
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const NoteScreen = require('../app/notes/[id]').default
  await render(
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider>
        <NoteScreen />
      </ConnectionProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  // Only the Dimensions spy is restored — jest.restoreAllMocks() would also wipe the jest.fn()
  // implementations set up in the module mocks above (Jest 29 semantics).
  dimensionsSpy?.mockRestore()
  dimensionsSpy = undefined
})

beforeEach(() => {
  jest.clearAllMocks()
  nextId = 1
  setWidth(500)
  mockSources.mockResolvedValue(REPOS)
  mockCreateNote.mockImplementation(async (n) => note(n))
  mockPatchNote.mockImplementation(async (_id, patch) => note(patch))
  mockDeleteNote.mockResolvedValue(undefined)
  mockKeepNote.mockResolvedValue(undefined)
  mockDismissNote.mockResolvedValue(undefined)
})

describe('note editor', () => {
  test('creates a new note with title, body and toggled repo tags, then leaves', async () => {
    mockMemory.mockResolvedValue([])
    await renderEditor('new')

    const save = await screen.findByTestId('note-save-button')
    expect(save.props.accessibilityState?.disabled ?? save.props.disabled).toBeTruthy()

    await fireEvent.changeText(screen.getByTestId('note-title-input'), 'Testing')
    await fireEvent.changeText(screen.getByTestId('note-body-input'), 'pnpm test first')
    await screen.findByTestId('note-tag-parlor-web')
    await fireEvent.press(screen.getByTestId('note-tag-parlor-web'))
    await waitFor(() => expect(screen.getByTestId('note-tag-parlor-web').props.accessibilityState).toMatchObject({ checked: true }))
    // folders are not tags
    expect(screen.queryByTestId('note-tag-specs')).toBeNull()

    await fireEvent.press(screen.getByTestId('note-save-button'))
    await waitFor(() =>
      expect(mockCreateNote).toHaveBeenCalledWith({ title: 'Testing', body: 'pnpm test first', tags: ['parlor-web'] }),
    )
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/memory'))
    expect(screen.queryByTestId('note-delete-button')).toBeNull()
  })

  test('edits an existing note (patch) and can delete it', async () => {
    mockMemory.mockResolvedValue([note({ id: 7, title: 'Conventions', body: 'old', tags: ['parlor-api'] })])
    await renderEditor('7')

    const body = await screen.findByTestId('note-body-input')
    expect(body.props.value).toBe('old')
    expect(screen.getByTestId('note-tag-parlor-api').props.accessibilityState).toMatchObject({ checked: true })

    await fireEvent.changeText(body, 'new body')
    await fireEvent.press(screen.getByTestId('note-tag-parlor-api'))
    await waitFor(() => expect(screen.getByTestId('note-tag-parlor-api').props.accessibilityState).toMatchObject({ checked: false }))
    await fireEvent.press(screen.getByTestId('note-save-button'))
    await waitFor(() =>
      expect(mockPatchNote).toHaveBeenCalledWith(7, { title: 'Conventions', body: 'new body', tags: [] }),
    )
  })

  test('delete asks first, then deletes and returns to the list', async () => {
    mockMemory.mockResolvedValue([note({ id: 7, title: 'Conventions' })])
    await renderEditor('7')
    await screen.findByTestId('note-delete-button')
    await fireEvent.press(screen.getByTestId('note-delete-button'))
    await screen.findByTestId('note-delete-confirm')
    await fireEvent.press(screen.getByTestId('note-delete-confirm'))
    await waitFor(() => expect(mockDeleteNote).toHaveBeenCalledWith(7))
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/memory'))
  })

  test('an unknown id shows not-found', async () => {
    mockMemory.mockResolvedValue([note({ id: 7 })])
    await renderEditor('99')

    expect(await screen.findByText("This note doesn't exist.")).toBeTruthy()
  })
})
