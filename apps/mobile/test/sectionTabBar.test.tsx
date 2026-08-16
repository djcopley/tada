import type { ApiBoard, ApiWorkspaceListItem } from '@tada/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react-native'
import { Dimensions } from 'react-native'
import { ClientProvider } from '../src/api/ClientContext'
import { resetActiveWorkspaceForTests } from '../src/api/queries'
import { SectionTabBar } from '../src/components/frame/SectionTabBar'

const mockNavigate = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ navigate: mockNavigate }),
}))

jest.mock('../src/settings', () => ({
  loadActiveWorkspaceId: jest.fn(async () => 5),
  saveActiveWorkspaceId: jest.fn(async () => undefined),
}))

const mockListWorkspaces = jest.fn()
const mockBoard = jest.fn()

function makeClient() {
  return {
    listWorkspaces: mockListWorkspaces,
    board: mockBoard,
  } as unknown as import('../src/api/client').TadaClient
}

function workspace(overrides: Partial<ApiWorkspaceListItem>): ApiWorkspaceListItem {
  return {
    id: 1,
    name: 'parlor',
    defaultAdapter: 'claude',
    defaultModel: 'sonnet',
    defaultEffort: 'medium',
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

function board(wsId: number, inReview: number, held: number): ApiBoard {
  const ticket = (id: number, queueState: 'idle' | 'held' = 'idle') =>
    ({ id, workspaceId: wsId, title: `t${id}`, queueState, position: id }) as unknown as ApiBoard['columns'][number]['tickets'][number]
  return {
    workspaceId: wsId,
    columns: [
      { id: 1, kind: 'backlog', name: 'Backlog', position: 0, tickets: [ticket(1)] },
      {
        id: 2,
        kind: 'ready',
        name: 'Queued',
        position: 1,
        tickets: Array.from({ length: held }, (_, i) => ticket(100 + i, 'held')),
      },
      {
        id: 3,
        kind: 'in_review',
        name: 'In review',
        position: 2,
        tickets: Array.from({ length: inReview }, (_, i) => ticket(200 + i)),
      },
    ],
  } as unknown as ApiBoard
}

function setWindowWidth(width: number) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height: 800, scale: 1, fontScale: 1 })
}

type TabBarProps = Parameters<typeof SectionTabBar>[0]
function tabState(name: string, params?: Record<string, string>): TabBarProps['state'] {
  const routes = [
    { key: 'index-k', name: 'index' },
    { key: 'board-k', name: '[id]/board', params },
    { key: 'memory-k', name: '[id]/memory', params },
    { key: 'settings-k', name: '[id]/settings', params },
  ]
  return {
    key: 'tabs',
    index: routes.findIndex((r) => r.name === name),
    routeNames: routes.map((r) => r.name),
    routes,
    type: 'tab',
    stale: false,
    history: [],
    preloadedRouteKeys: [],
  } as unknown as TabBarProps['state']
}

async function renderTabBar(state: TabBarProps['state']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return await render(
    <QueryClientProvider client={queryClient}>
      <ClientProvider client={makeClient()}>
        <SectionTabBar state={state} descriptors={{}} navigation={{} as never} insets={{ top: 0, right: 0, bottom: 0, left: 0 }} />
      </ClientProvider>
    </QueryClientProvider>,
  )
}

describe('SectionTabBar (the tabs frame)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetActiveWorkspaceForTests()
    mockListWorkspaces.mockResolvedValue([workspace({ id: 5, name: 'ops', sourceCount: 1 }), workspace({ id: 7, name: 'parlor' })])
    mockBoard.mockImplementation(async (id: number) => (id === 5 ? board(5, 1, 1) : board(7, 1, 0)))
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('wide: draws the Rail for the focused tab, scoped to the route workspace, with the needs-you total', async () => {
    setWindowWidth(1400)
    await renderTabBar(tabState('[id]/board', { id: '7' }))

    await waitFor(() => {
      expect(screen.getByTestId('board-rail')).toBeTruthy()
    })
    expect(screen.queryByTestId('board-bottom-strip')).toBeNull()
    // Workspace line comes from the workspace list, not the screen.
    await waitFor(() => {
      expect(screen.getByText('parlor · 2 repos')).toBeTruthy()
    })
    // 1 in review + 1 held in ops, 1 in review in parlor.
    await waitFor(() => {
      expect(screen.getByText('3')).toBeTruthy()
    })
  })

  test('wide: Control scopes the Rail to the active (device) workspace', async () => {
    setWindowWidth(1400)
    await renderTabBar(tabState('index'))

    await waitFor(() => {
      expect(screen.getByTestId('control-rail')).toBeTruthy()
    })
    await waitFor(() => {
      expect(screen.getByText('ops · 1 repo')).toBeTruthy()
    })
  })

  test('narrow: draws the BottomStrip', async () => {
    setWindowWidth(390)
    await renderTabBar(tabState('[id]/memory', { id: '7' }))
    await waitFor(() => {
      expect(screen.getByTestId('memory-bottom-strip')).toBeTruthy()
    })
    expect(screen.queryByTestId('memory-rail')).toBeNull()
  })

  test('narrow: Settings has no strip (it is a pushed-feeling page with its own back header)', async () => {
    setWindowWidth(390)
    await renderTabBar(tabState('[id]/settings', { id: '7' }))
    await waitFor(() => {
      expect(mockListWorkspaces).toHaveBeenCalled()
    })
    expect(screen.queryByTestId('settings-bottom-strip')).toBeNull()
    expect(screen.queryByTestId('settings-rail')).toBeNull()
  })
})
