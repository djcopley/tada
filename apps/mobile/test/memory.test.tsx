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

describe('memory helpers', () => {
  const now = new Date('2026-08-17T12:00:00Z').getTime()

  test('keptNoteMeta: untagged rides on every run, tagged shows who and when', () => {
    expect(keptNoteMeta({ tags: [], author: 'human', updatedAt: '2026-08-01T00:00:00Z' }, now)).toBe('global · every run')
    expect(keptNoteMeta({ tags: ['parlor-web'], author: 'human', updatedAt: '2026-08-03T12:00:00Z' }, now)).toBe('edited by you · 2w')
    expect(keptNoteMeta({ tags: ['parlor-web'], author: 'agent', updatedAt: '2026-08-12T12:00:00Z' }, now)).toBe('by agent · 5d')
  })

  test('noteAge: HH:MM today, bare age otherwise', () => {
    const today = new Date(now - 60 * 60 * 1000).toISOString()
    expect(noteAge(today, now)).toMatch(/^\d\d:\d\d$/)
    expect(noteAge('2026-08-10T12:00:00Z', now)).toBe('1w')
  })

  test('keepHint names the tags a kept proposal gets, or nothing when untagged', () => {
    expect(keepHint([])).toBeNull()
    expect(keepHint(['parlor-api'])).toBe('keeping tags it parlor-api')
  })

  test('toggleTag adds and removes', () => {
    expect(toggleTag([], 'a')).toEqual(['a'])
    expect(toggleTag(['a', 'b'], 'a')).toEqual(['b'])
  })
})

describe('memory list', () => {
  test('renders kept notes as cards with tags, and proposals with keep/dismiss', async () => {
    mockMemory.mockResolvedValue([
      note({ title: 'Safety', body: 'never force-push a shared branch.' }),
      note({ title: 'Testing', body: 'pnpm test before every pr.', tags: ['parlor-web'] }),
      note({ title: 'reports queries', body: 'paginate past 50k rows', author: 'agent', state: 'pending', tags: ['parlor-api'], runId: 4 }),
    ])
    await renderList()

    expect(await screen.findByText('Safety')).toBeTruthy()
    expect(screen.getByText('3 notes')).toBeTruthy()
    expect(screen.getByText('global · every run')).toBeTruthy()
    expect(screen.getByText('parlor-web')).toBeTruthy()
    // proposal
    expect(screen.getByText('proposed: reports queries')).toBeTruthy()
    expect(screen.getByText('keeping tags it parlor-api')).toBeTruthy()

    await fireEvent.press(screen.getByTestId('memory-note-1'))
    expect(mockPush).toHaveBeenCalledWith('/notes/1')

    await fireEvent.press(screen.getByTestId('memory-pending-3-keep'))
    await waitFor(() => expect(mockKeepNote).toHaveBeenCalledWith(3))

    await fireEvent.press(screen.getByTestId('memory-pending-3-dismiss'))
    await screen.findByTestId('memory-dismiss-confirm')
    await fireEvent.press(screen.getByTestId('memory-dismiss-confirm'))
    await waitFor(() => expect(mockDismissNote).toHaveBeenCalledWith(3))
  })

  test('New note goes to /notes/new; an empty list shows the empty state', async () => {
    mockMemory.mockResolvedValue([])
    await renderList()
    expect(await screen.findByTestId('memory-empty')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('memory-add-button'))
    expect(mockPush).toHaveBeenCalledWith('/notes/new')
  })

  test('wide layout renders the same list', async () => {
    setWidth(1280)
    mockMemory.mockResolvedValue([note({ title: 'Conventions' })])
    await renderList()
    expect(await screen.findByTestId('memory-wide')).toBeTruthy()
    expect(await screen.findByText('Conventions')).toBeTruthy()
  })
})

