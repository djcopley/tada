import type {
  ApiMemory,
  ApiMemoryNote,
  ApiWorkspaceDetail,
  ApiWorkspaceListItem,
} from '@tada/shared'
import { QueryClientProvider } from '@tanstack/react-query'
import { makeTestQueryClient } from './helpers/queryClient'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { Dimensions } from 'react-native'
import { ConnectionProvider } from '../src/ConnectionContext'
import { WorkspaceSwitcher } from '../src/components/WorkspaceSwitcher'

const NARROW_WIDTH = 500
const WIDE_WIDTH = 1280

function setWidth(width: number) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height: 900, scale: 1, fontScale: 1 })
}

const mockPush = jest.fn()
const mockNavigate = jest.fn()
const mockReplace = jest.fn()
const mockUseLocalSearchParams = jest.fn()

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, navigate: mockNavigate, replace: mockReplace }),
  useLocalSearchParams: () => mockUseLocalSearchParams(),
  useFocusEffect: (cb: () => void) => { require('react').useEffect(cb, [cb]) },
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn() }),
}))

jest.mock('../src/settings', () => ({
  loadConnection: jest.fn(async () => ({ baseUrl: 'https://example.com', token: 'secret' })),
  saveConnection: jest.fn(async () => undefined),
  clearConnection: jest.fn(async () => undefined),
  loadActiveWorkspaceId: jest.fn(async () => null),
  saveActiveWorkspaceId: jest.fn(async () => undefined),
}))

const mockMemory = jest.fn()
const mockPutMemory = jest.fn()
const mockDeleteMemory = jest.fn()
const mockDeleteGlobalMemory = jest.fn()
const mockGlobalMemory = jest.fn()
const mockPutGlobalMemory = jest.fn()
const mockKeepNote = jest.fn()
const mockDiscardNote = jest.fn()
const mockListWorkspaces = jest.fn()
const mockGetWorkspace = jest.fn()

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
      globalMemory: mockGlobalMemory,
      putGlobalMemory: mockPutGlobalMemory,
      deleteMemory: mockDeleteMemory,
      deleteGlobalMemory: mockDeleteGlobalMemory,
      keepNote: mockKeepNote,
      discardNote: mockDiscardNote,
      listWorkspaces: mockListWorkspaces,
      getWorkspace: mockGetWorkspace,
    })),
  }
})

let nextNoteId = 1

function note(overrides: Partial<ApiMemoryNote> & { file: string }): ApiMemoryNote {
  return {
    id: nextNoteId++,
    scope: 'workspace',
    workspaceId: 1,
    title: overrides.file.replace(/\.md$/, ''),
    author: 'human',
    runId: null,
    state: 'kept',
    body: '',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function memory(overrides: Partial<ApiMemory> = {}): ApiMemory {
  return {
    agentsMd: '# Agents\n\nAgent docs here.',
    notes: [
      note({ file: 'api-notes.md', body: 'API notes' }),
      note({ file: 'context.md', body: 'Context info' }),
    ],
    ...overrides,
  }
}

function workspaceListItem(overrides: Partial<ApiWorkspaceListItem> = {}): ApiWorkspaceListItem {
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

function workspaceDetail(overrides: Partial<ApiWorkspaceDetail> = {}): ApiWorkspaceDetail {
  return {
    id: 1,
    name: 'parlor',
    defaultAdapter: 'claude',
    defaultModel: 'sonnet',
    defaultEffort: 'default',
    concurrency: 1,
    timeoutMs: 60_000,
    createdAt: '2026-01-01T00:00:00.000Z',
    sources: [],
    ...overrides,
  }
}

async function renderMemoryList({ withSwitcher = false }: { withSwitcher?: boolean } = {}) {
  mockUseLocalSearchParams.mockReturnValue({ id: '1' })
  const queryClient = makeTestQueryClient()
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const MemoryList = require('../app/workspaces/[id]/memory/index').default
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ToastHost } = require('../src/toast')
  await render(
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider>
        <MemoryList />
        {withSwitcher ? <WorkspaceSwitcher /> : null}
        <ToastHost />
      </ConnectionProvider>
    </QueryClientProvider>,
  )
}

async function renderGlobalMemoryList({ withSwitcher = false }: { withSwitcher?: boolean } = {}) {
  mockUseLocalSearchParams.mockReturnValue({})
  const queryClient = makeTestQueryClient()
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const GlobalMemoryList = require('../app/memory/index').default
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ToastHost } = require('../src/toast')
  return await render(
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider>
        <GlobalMemoryList />
        {withSwitcher ? <WorkspaceSwitcher /> : null}
        <ToastHost />
      </ConnectionProvider>
    </QueryClientProvider>,
  )
}

async function renderMemoryEditor(file: string) {
  mockUseLocalSearchParams.mockReturnValue({ id: '1', file })
  const queryClient = makeTestQueryClient()
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

async function renderGlobalMemoryEditor(file: string) {
  mockUseLocalSearchParams.mockReturnValue({ file })
  const queryClient = makeTestQueryClient()
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const GlobalMemoryEditor = require('../app/memory/[file]').default
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ToastHost } = require('../src/toast')
  await render(
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider>
        <GlobalMemoryEditor />
        <ToastHost />
      </ConnectionProvider>
    </QueryClientProvider>,
  )
}

describe('Memory screens', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    nextNoteId = 1
    setWidth(NARROW_WIDTH)
    mockListWorkspaces.mockResolvedValue([workspaceListItem()])
    mockGetWorkspace.mockResolvedValue(workspaceDetail())
    mockGlobalMemory.mockResolvedValue(memory({ notes: [note({ file: 'shared.md', body: 'shared body' })] }))
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('Workspace scope list', () => {
    test('renders AGENTS.md pinned first, kept notes, and the Global card', async () => {
      mockMemory.mockResolvedValue(
        memory({
          notes: [
            note({ file: 'zebra.md', body: 'Z notes' }),
            note({ file: 'alpha.md', body: 'A notes' }),
          ],
        }),
      )

      await renderMemoryList()

      await waitFor(() => {
        expect(screen.getByText('Agents')).toBeTruthy()
      })
      expect(screen.getByText('zebra')).toBeTruthy()
      expect(screen.getByText('alpha')).toBeTruthy()

      // Global card is shown while in workspace scope.
      expect(screen.getByTestId('memory-global-card')).toBeTruthy()
      expect(screen.getByText('Global')).toBeTruthy()
      expect(screen.getByText('every workspace · 1')).toBeTruthy()
      expect(screen.getByText('shared body')).toBeTruthy()

      // AGENTS.md's fixture body ('# Agents\n\nAgent docs here.') shows body text under the
      // pinned card's header, with the `# Agents` heading line stripped — not duplicated with
      // the title above it.
      expect(screen.getByTestId('memory-note-AGENTS.md')).toHaveTextContent('Agent docs here.', { exact: false })
      expect(screen.getByTestId('memory-note-AGENTS.md')).not.toHaveTextContent('# Agents', { exact: false })
    })

    test('note card bodies strip a leading markdown heading line', async () => {
      mockMemory.mockResolvedValue(
        memory({
          notes: [note({ file: 'conventions.md', body: '# Conventions\n\nconventional commits (fix:, feat:).' })],
        }),
      )

      await renderMemoryList()

      await waitFor(() => expect(screen.getByTestId('memory-note-conventions.md')).toBeTruthy())
      expect(screen.getByTestId('memory-note-conventions.md')).toHaveTextContent(
        'conventional commits (fix:, feat:).',
        { exact: false },
      )
      expect(screen.getByTestId('memory-note-conventions.md')).not.toHaveTextContent('# Conventions', {
        exact: false,
      })
    })

    test('empty AGENTS.md shows a faint "empty" placeholder instead of a blank body', async () => {
      mockMemory.mockResolvedValue(memory({ agentsMd: '' }))

      await renderMemoryList()

      await waitFor(() => expect(screen.getByTestId('memory-note-AGENTS.md')).toBeTruthy())
      expect(screen.getByTestId('memory-note-AGENTS.md')).toHaveTextContent('empty', { exact: false })
    })

    test('header shows the note count', async () => {
      mockMemory.mockResolvedValue(
        memory({
          notes: [
            note({ file: 'a.md', body: 'a' }),
            note({ file: 'b.md', body: 'b' }),
          ],
        }),
      )

      await renderMemoryList()

      await waitFor(() => {
        expect(screen.getByText('2 notes')).toBeTruthy()
      })
    })

    test('tapping a kept note navigates to the workspace-scoped editor', async () => {
      mockMemory.mockResolvedValue(memory({ notes: [note({ file: 'test.md', body: 'body' })] }))

      await renderMemoryList()

      await waitFor(() => {
        expect(screen.getByTestId('memory-note-test.md')).toBeTruthy()
      })
      await fireEvent.press(screen.getByTestId('memory-note-test.md'))
      expect(mockPush).toHaveBeenCalledWith('/workspaces/1/memory/test.md')
    })

    test('tapping AGENTS.md navigates to its editor', async () => {
      mockMemory.mockResolvedValue(memory({ notes: [] }))

      await renderMemoryList()

      await waitFor(() => {
        expect(screen.getByTestId('memory-note-AGENTS.md')).toBeTruthy()
      })
      await fireEvent.press(screen.getByTestId('memory-note-AGENTS.md'))
      expect(mockPush).toHaveBeenCalledWith('/workspaces/1/memory/AGENTS.md')
    })

    test('tapping the Global card switches to global scope', async () => {
      mockMemory.mockResolvedValue(memory({ notes: [] }))

      await renderMemoryList()

      await waitFor(() => {
        expect(screen.getByTestId('memory-global-card')).toBeTruthy()
      })
      await fireEvent.press(screen.getByTestId('memory-global-card'))
      expect(mockPush).toHaveBeenCalledWith('/memory')
    })

    test('pending agent note renders as an AgentPanel with Keep/Discard', async () => {
      mockMemory.mockResolvedValue(
        memory({
          notes: [
            note({
              id: 9,
              file: 'reports.md',
              title: 'reports queries',
              author: 'agent',
              state: 'pending',
              body: 'reports queries time out over 50k rows',
            }),
          ],
        }),
      )

      await renderMemoryList()

      await waitFor(() => {
        expect(screen.getByText('learned: reports queries')).toBeTruthy()
      })
      expect(screen.getByText('reports queries time out over 50k rows')).toBeTruthy()
      expect(screen.getByTestId('memory-pending-9-keep')).toBeTruthy()
      expect(screen.getByTestId('memory-pending-9-discard')).toBeTruthy()
    })

    test('pressing Keep keeps the pending note', async () => {
      mockKeepNote.mockResolvedValueOnce(undefined)
      mockMemory.mockResolvedValue(
        memory({
          notes: [note({ id: 9, file: 'reports.md', author: 'agent', state: 'pending', body: 'x' })],
        }),
      )

      await renderMemoryList()

      await waitFor(() => {
        expect(screen.getByTestId('memory-pending-9-keep')).toBeTruthy()
      })
      await fireEvent.press(screen.getByTestId('memory-pending-9-keep'))

      await waitFor(() => {
        expect(mockKeepNote).toHaveBeenCalledWith(9)
      })
    })

    test('pressing Discard confirms before discarding', async () => {
      mockDiscardNote.mockResolvedValueOnce(undefined)
      mockMemory.mockResolvedValue(
        memory({
          notes: [
            note({ id: 9, file: 'reports.md', title: 'reports queries', author: 'agent', state: 'pending', body: 'x' }),
          ],
        }),
      )

      await renderMemoryList()

      await waitFor(() => {
        expect(screen.getByTestId('memory-pending-9-discard')).toBeTruthy()
      })
      await fireEvent.press(screen.getByTestId('memory-pending-9-discard'))

      expect(screen.getByTestId('memory-discard-dialog')).toBeTruthy()
      expect(mockDiscardNote).not.toHaveBeenCalled()

      await fireEvent.press(screen.getByTestId('memory-discard-confirm'))

      await waitFor(() => {
        expect(mockDiscardNote).toHaveBeenCalledWith(9)
      })
    })

    test('canceling the discard dialog does not discard', async () => {
      mockMemory.mockResolvedValue(
        memory({
          notes: [note({ id: 9, file: 'reports.md', author: 'agent', state: 'pending', body: 'x' })],
        }),
      )

      await renderMemoryList()

      await waitFor(() => {
        expect(screen.getByTestId('memory-pending-9-discard')).toBeTruthy()
      })
      await fireEvent.press(screen.getByTestId('memory-pending-9-discard'))
      await fireEvent.press(screen.getByText('Cancel'))

      await waitFor(() => {
        expect(screen.queryByTestId('memory-discard-dialog')).toBeNull()
      })
      expect(mockDiscardNote).not.toHaveBeenCalled()
    })

    test('new note flow opens name prompt', async () => {
      mockMemory.mockResolvedValue(memory())

      await renderMemoryList()

      await waitFor(() => {
        expect(screen.getByTestId('memory-add-button')).toBeTruthy()
      })
      await fireEvent.press(screen.getByTestId('memory-add-button'))
      expect(screen.getByTestId('memory-name-input')).toBeTruthy()
    })

    test('invalid name with .. shows inline error and never calls the client', async () => {
      mockMemory.mockResolvedValue(memory())

      await renderMemoryList()

      await waitFor(() => {
        expect(screen.getByTestId('memory-add-button')).toBeTruthy()
      })
      await fireEvent.press(screen.getByTestId('memory-add-button'))
      const input = screen.getByTestId('memory-name-input')

      await fireEvent.changeText(input, '../secret.md')
      await fireEvent.press(screen.getByTestId('memory-name-submit'))

      expect(screen.getByTestId('memory-name-error')).toBeTruthy()
      expect(mockPutMemory).not.toHaveBeenCalled()
    })

    test('name with / is rejected', async () => {
      mockMemory.mockResolvedValue(memory())

      await renderMemoryList()

      await waitFor(() => {
        expect(screen.getByTestId('memory-add-button')).toBeTruthy()
      })
      await fireEvent.press(screen.getByTestId('memory-add-button'))
      const input = screen.getByTestId('memory-name-input')

      await fireEvent.changeText(input, 'invalid/name.md')
      await fireEvent.press(screen.getByTestId('memory-name-submit'))

      expect(screen.getByTestId('memory-name-error')).toBeTruthy()
      expect(mockPutMemory).not.toHaveBeenCalled()
    })

    test('valid name has .md appended and navigates to the new note', async () => {
      mockMemory.mockResolvedValue(memory())
      mockPutMemory.mockResolvedValueOnce(undefined)

      await renderMemoryList()

      await waitFor(() => {
        expect(screen.getByTestId('memory-add-button')).toBeTruthy()
      })
      await fireEvent.press(screen.getByTestId('memory-add-button'))
      const input = screen.getByTestId('memory-name-input')

      await fireEvent.changeText(input, 'notes')
      await fireEvent.press(screen.getByTestId('memory-name-submit'))

      await waitFor(() => {
        expect(mockPutMemory).toHaveBeenCalledWith(1, 'notes.md', '')
      })
      expect(mockPush).toHaveBeenCalledWith('/workspaces/1/memory/notes.md')
    })

    test('a name that already exists (any case, or AGENTS.md) is refused instead of blanking the note', async () => {
      mockMemory.mockResolvedValue(memory({ notes: [note({ file: 'gotchas.md', body: 'keep me' })] }))

      await renderMemoryList()
      await waitFor(() => {
        expect(screen.getByTestId('memory-add-button')).toBeTruthy()
      })
      await fireEvent.press(screen.getByTestId('memory-add-button'))
      const input = screen.getByTestId('memory-name-input')

      await fireEvent.changeText(input, 'Gotchas')
      await fireEvent.press(screen.getByTestId('memory-name-submit'))
      expect(screen.getByText(/already exists/)).toBeTruthy()

      await fireEvent.changeText(input, 'AGENTS.md')
      await fireEvent.press(screen.getByTestId('memory-name-submit'))
      expect(screen.getByText(/already exists/)).toBeTruthy()

      expect(mockPutMemory).not.toHaveBeenCalled()
      expect(mockPush).not.toHaveBeenCalled()
    })

    test('scope switching: the switcher Global row navigates to /memory', async () => {
      mockMemory.mockResolvedValue(memory({ notes: [] }))

      await renderMemoryList({ withSwitcher: true })

      await waitFor(() => {
        expect(screen.getByTestId('memory-workspace-switcher')).toBeTruthy()
      })
      await fireEvent.press(screen.getByTestId('memory-workspace-switcher'))

      await waitFor(() => {
        expect(screen.getByTestId('switcher-scope-global')).toBeTruthy()
      })
      await fireEvent.press(screen.getByTestId('switcher-scope-global'))

      expect(mockPush).toHaveBeenCalledWith('/memory')
    })

    test('workspace scope draws no frame of its own — the tabs frame supplies Rail/BottomStrip', async () => {
      setWidth(WIDE_WIDTH)
      mockMemory.mockResolvedValue(memory({ notes: [] }))

      await renderMemoryList()

      await waitFor(() => {
        expect(screen.getByTestId('memory-wide')).toBeTruthy()
      })
      expect(screen.queryByTestId('memory-rail')).toBeNull()
      expect(screen.queryByTestId('memory-bottom-strip')).toBeNull()
    })

    test('narrow workspace scope likewise has no BottomStrip of its own', async () => {
      mockMemory.mockResolvedValue(memory({ notes: [] }))

      await renderMemoryList()

      await waitFor(() => {
        expect(screen.getByTestId('memory-narrow')).toBeTruthy()
      })
      expect(screen.queryByTestId('memory-bottom-strip')).toBeNull()
      expect(screen.queryByTestId('memory-rail')).toBeNull()
    })

    test('narrow header gear navigates to the workspace\'s settings', async () => {
      mockMemory.mockResolvedValue(memory({ notes: [] }))

      await renderMemoryList()

      await waitFor(() => {
        expect(screen.getByTestId('memory-settings-button')).toBeTruthy()
      })
      await fireEvent.press(screen.getByTestId('memory-settings-button'))

      expect(mockNavigate).toHaveBeenCalledWith('/workspaces/1/settings')
    })
  })

  describe('Global scope list', () => {
    // Global memory is pushed over the tabs group, so unlike workspace memory it draws its own
    // frame: the Rail when wide, the BottomStrip when narrow.
    test('wide draws its own Rail', async () => {
      mockGlobalMemory.mockResolvedValue(memory({ notes: [] }))
      setWidth(WIDE_WIDTH)
      await renderGlobalMemoryList()
      await waitFor(() => {
        expect(screen.getByTestId('memory-rail')).toBeTruthy()
      })
      expect(screen.queryByTestId('memory-bottom-strip')).toBeNull()
    })

    test('narrow draws its own BottomStrip', async () => {
      mockGlobalMemory.mockResolvedValue(memory({ notes: [] }))
      await renderGlobalMemoryList()
      await waitFor(() => {
        expect(screen.getByTestId('memory-bottom-strip')).toBeTruthy()
      })
      expect(screen.queryByTestId('memory-rail')).toBeNull()
    })

    test('renders global notes directly, with no Global card', async () => {
      mockGlobalMemory.mockResolvedValue(
        memory({
          agentsMd: '# Charter title\n\nGlobal rules.',
          notes: [note({ file: 'rules.md', body: 'never force-push a shared branch' })],
        }),
      )

      await renderGlobalMemoryList()

      await waitFor(() => {
        expect(screen.getByText('Charter title')).toBeTruthy()
      })
      expect(screen.getByText('rules')).toBeTruthy()
      expect(screen.queryByTestId('memory-global-card')).toBeNull()
    })

    test('tapping a kept global note navigates to the global editor', async () => {
      mockGlobalMemory.mockResolvedValue(
        memory({ notes: [note({ file: 'rules.md', body: 'body' })] }),
      )

      await renderGlobalMemoryList()

      await waitFor(() => {
        expect(screen.getByTestId('memory-note-rules.md')).toBeTruthy()
      })
      await fireEvent.press(screen.getByTestId('memory-note-rules.md'))
      expect(mockPush).toHaveBeenCalledWith('/memory/rules.md')
    })

    test('new note flow creates via the global endpoint', async () => {
      mockGlobalMemory.mockResolvedValue(memory({ notes: [] }))
      mockPutGlobalMemory.mockResolvedValueOnce(undefined)

      await renderGlobalMemoryList()

      await waitFor(() => {
        expect(screen.getByTestId('memory-add-button')).toBeTruthy()
      })
      await fireEvent.press(screen.getByTestId('memory-add-button'))
      await fireEvent.changeText(screen.getByTestId('memory-name-input'), 'global-notes')
      await fireEvent.press(screen.getByTestId('memory-name-submit'))

      await waitFor(() => {
        expect(mockPutGlobalMemory).toHaveBeenCalledWith('global-notes.md', '')
      })
      expect(mockPush).toHaveBeenCalledWith('/memory/global-notes.md')
    })

    test('scope switching: selecting a workspace from the switcher leaves global scope', async () => {
      mockGlobalMemory.mockResolvedValue(memory({ notes: [] }))

      await renderGlobalMemoryList({ withSwitcher: true })

      await waitFor(() => {
        expect(screen.getByTestId('memory-workspace-switcher')).toBeTruthy()
      })
      await fireEvent.press(screen.getByTestId('memory-workspace-switcher'))

      await waitFor(() => {
        expect(screen.getByTestId('switcher-workspace-1')).toBeTruthy()
      })
      await fireEvent.press(screen.getByTestId('switcher-workspace-1'))

      // Opened from Memory, a workspace pick lands on that workspace's memory, not its board.
      expect(mockNavigate).toHaveBeenCalledWith('/workspaces/1/memory')
    })
  })

  describe('Editor screen — workspace scope', () => {
    test('renders seeded body for a note and saves', async () => {
      mockMemory.mockResolvedValueOnce(memory({ notes: [note({ file: 'test.md', body: 'Original' })] }))
      mockPutMemory.mockResolvedValueOnce(undefined)

      await renderMemoryEditor('test.md')

      await waitFor(() => {
        expect(screen.getByDisplayValue('Original')).toBeTruthy()
      })

      const saveButton = screen.getByTestId('memory-save-button')
      expect(saveButton.props.accessibilityState?.disabled).toBe(true)

      const input = screen.getByTestId('memory-editor-input')
      await fireEvent.changeText(input, 'Updated content')
      expect(saveButton.props.accessibilityState?.disabled).toBe(false)

      await fireEvent.press(saveButton)

      await waitFor(() => {
        expect(mockPutMemory).toHaveBeenCalledWith(1, 'test.md', 'Updated content')
      })
      await waitFor(() => {
        expect(screen.getByTestId('toast-message')).toHaveTextContent('Saved')
      })
    })
  })

  describe('Editor screen — delete', () => {
    test('a note can be deleted after confirming; the charter cannot', async () => {
      mockMemory.mockResolvedValue(memory({ notes: [note({ file: 'test.md', body: 'Original' })] }))
      mockDeleteMemory.mockResolvedValueOnce(undefined)

      await renderMemoryEditor('test.md')
      await waitFor(() => {
        expect(screen.getByDisplayValue('Original')).toBeTruthy()
      })

      await fireEvent.press(screen.getByTestId('memory-delete-button'))
      expect(screen.getByTestId('memory-delete-dialog')).toBeTruthy()
      await fireEvent.press(screen.getByTestId('memory-delete-confirm'))

      await waitFor(() => {
        expect(mockDeleteMemory).toHaveBeenCalledWith(1, 'test.md')
      })
      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/workspaces/1/memory')
      })
    })

    test('AGENTS.md has no delete control', async () => {
      mockMemory.mockResolvedValue(memory())
      await renderMemoryEditor('AGENTS.md')
      await waitFor(() => {
        expect(screen.getByTestId('memory-editor-input')).toBeTruthy()
      })
      expect(screen.queryByTestId('memory-delete-button')).toBeNull()
    })
  })

  describe('Editor screen — global scope', () => {
    test('renders seeded body for a global note and saves', async () => {
      mockGlobalMemory.mockResolvedValueOnce(
        memory({ notes: [note({ file: 'rules.md', body: 'Original global' })] }),
      )
      mockPutGlobalMemory.mockResolvedValueOnce(undefined)

      await renderGlobalMemoryEditor('rules.md')

      await waitFor(() => {
        expect(screen.getByDisplayValue('Original global')).toBeTruthy()
      })

      const saveButton = screen.getByTestId('memory-save-button')
      expect(saveButton.props.accessibilityState?.disabled).toBe(true)

      const input = screen.getByTestId('memory-editor-input')
      await fireEvent.changeText(input, 'Updated global content')
      expect(saveButton.props.accessibilityState?.disabled).toBe(false)

      await fireEvent.press(saveButton)

      await waitFor(() => {
        expect(mockPutGlobalMemory).toHaveBeenCalledWith('rules.md', 'Updated global content')
      })
      await waitFor(() => {
        expect(screen.getByTestId('toast-message')).toHaveTextContent('Saved')
      })
    })

    test('renders seeded AGENTS.md body for global scope', async () => {
      mockGlobalMemory.mockResolvedValueOnce(memory({ agentsMd: 'Global agent charter' }))

      await renderGlobalMemoryEditor('AGENTS.md')

      await waitFor(() => {
        expect(screen.getByDisplayValue('Global agent charter')).toBeTruthy()
      })
    })
  })
})
