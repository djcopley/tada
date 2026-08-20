import type { ApiAdapterInfo, ApiRule, ApiSettings, ApiSource } from '@tada/shared'
import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native'
import { Dimensions } from 'react-native'
import { ConnectionProvider, useConnection } from '../src/ConnectionContext'
import { ToastHost } from '../src/toast'
import { makeTestQueryClient } from './helpers/queryClient'

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
  useLocalSearchParams: () => ({}),
}))

jest.mock('../src/settings', () => ({
  loadConnection: jest.fn(async () => ({ baseUrl: 'https://tada.home-server.dev', token: 'tada_supersecret3f9a' })),
  saveConnection: jest.fn(async () => undefined),
  clearConnection: jest.fn(async () => undefined),
  loadThemeScheme: jest.fn(async () => 'night'),
  saveThemeScheme: jest.fn(async () => undefined),
}))

// The socket hook opens a WebSocket on mount; a no-op keeps the test hermetic.
jest.mock('../src/api/useAppSocket', () => ({ useAppSocket: () => undefined }))

const mockSettings = jest.fn()
const mockPatchSettings = jest.fn()
const mockSources = jest.fn()
const mockAddSource = jest.fn()
const mockRemoveSource = jest.fn()
const mockAdapters = jest.fn()
const mockRules = jest.fn()
const mockPatchRule = jest.fn()
const mockCreateRule = jest.fn()
const mockDeleteRule = jest.fn()
const mockStatus = jest.fn()

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
      settings: mockSettings,
      patchSettings: mockPatchSettings,
      sources: mockSources,
      addSource: mockAddSource,
      removeSource: mockRemoveSource,
      adapters: mockAdapters,
      rules: mockRules,
      patchRule: mockPatchRule,
      createRule: mockCreateRule,
      deleteRule: mockDeleteRule,
      status: mockStatus,
    })),
  }
})

// eslint-disable-next-line @typescript-eslint/no-require-imports
const SettingsScreen = require('../app/(tabs)/settings').default

function settings(overrides: Partial<ApiSettings> = {}): ApiSettings {
  return {
    adapter: 'claude',
    model: 'sonnet',
    effort: 'medium',
    concurrency: 2,
    timeoutMs: 30 * 60_000,
    pingChannel: 'push',
    repingMs: 60 * 60_000,
    ...overrides,
  }
}

function adapter(overrides: Partial<ApiAdapterInfo> = {}): ApiAdapterInfo {
  return {
    id: 'claude',
    label: 'Claude',
    available: true,
    models: ['sonnet', 'opus', 'haiku'],
    efforts: ['low', 'medium', 'high'],
    supportsInjection: true,
    supportsGates: true,
    ...overrides,
  }
}

function rule(overrides: Partial<ApiRule> = {}): ApiRule {
  return {
    id: 1,
    title: 'Open a pull request',
    description: 'github · gh pr create · the review moment',
    tool: 'Bash',
    patterns: ['*gh pr create*'],
    decision: 'ask',
    publishes: true,
    position: 2,
    source: 'default',
    sourceRunId: null,
    updatedAt: '2026-08-17T08:04:00.000Z',
    holdingCount: 0,
    ...overrides,
  }
}

const sources: ApiSource[] = [
  { type: 'repo', name: 'parlor-api', url: 'https://github.com/acme/parlor-api.git', defaultBranch: 'main' },
  { type: 'folder', name: 'parlor-specs', path: '/srv/docs/parlor-specs' },
]

/** Mirrors GuardedStack: the real app never renders a connected-only screen once `connection`
 * drops (it redirects to /connect first). */
function Guarded() {
  const { connection } = useConnection()
  if (!connection) return null
  return <SettingsScreen />
}

async function renderSettings() {
  const queryClient = makeTestQueryClient()
  await render(
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider>
        <Guarded />
        <ToastHost />
      </ConnectionProvider>
    </QueryClientProvider>,
  )
  await screen.findByTestId('settings-rules')
}

describe('Settings screen', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 500, height: 900, scale: 1, fontScale: 1 })
    // A stateful fake: the hook refetches settings once the last patch settles, so a GET that
    // forgot the PATCH would look like the server reverting the change.
    let current = settings()
    mockSettings.mockImplementation(async () => current)
    mockPatchSettings.mockImplementation(async (patch: Partial<ApiSettings>) => {
      current = { ...current, ...patch }
      return current
    })
    mockSources.mockResolvedValue(sources)
    mockAddSource.mockResolvedValue(sources)
    mockRemoveSource.mockResolvedValue([])
    mockAdapters.mockResolvedValue([
      adapter(),
      adapter({ id: 'codex', label: 'Codex', available: false, models: ['gpt-5.2-codex'], efforts: ['low', 'medium', 'high'] }),
    ])
    mockRules.mockResolvedValue([
      rule({ id: 1, title: 'Push a branch', decision: 'allow', patterns: ['*git push*'], position: 1 }),
      rule({ id: 2, holdingCount: 1 }),
      rule({
        id: 3,
        title: 'Run a database migration',
        description: 'pnpm db:migrate',
        decision: 'allow',
        publishes: false,
        source: 'gate',
        sourceRunId: 4127,
        position: 4,
      }),
      rule({ id: 4, title: 'Force-push or touch main', decision: 'never', position: 0 }),
    ])
    mockPatchRule.mockImplementation(async (id: number, patch: Partial<ApiRule>) => rule({ id, ...patch }))
    mockCreateRule.mockImplementation(async (body: Partial<ApiRule>) => rule({ id: 9, ...body }))
    mockDeleteRule.mockResolvedValue(undefined)
    mockStatus.mockResolvedValue({ ok: true, version: '0.9.2', sources: [], ticketCount: 0, noteCount: 0, agents: [] })
  })

  test('renders the server, sources, and the rule table with decisions and provenance', async () => {
    await renderSettings()
    expect(screen.getByTestId('server-host')).toHaveTextContent(/tada.home-server.dev/)
    expect(screen.getByTestId('masked-token')).toHaveTextContent(/tada_••••••••••3f9a/)
    expect(await screen.findByTestId('source-parlor-api')).toHaveTextContent(/repo · github/)
    expect(screen.getByTestId('source-parlor-specs')).toHaveTextContent(/folder · server/)

    // decisions render as the segmented pill with the right selection
    expect(screen.getByTestId('rule-2-decision-ask')).toHaveProp('accessibilityState', expect.objectContaining({ selected: true }))
    expect(screen.getByTestId('rule-4-decision-never')).toHaveProp('accessibilityState', expect.objectContaining({ selected: true }))
    // a rule holding a run says so; a rule set from a gate shows its provenance
    expect(screen.getByTestId('rule-2-holding')).toHaveTextContent(/holding 1 run/)
    expect(screen.getByTestId('rule-3-provenance')).toHaveTextContent(/set from a gate · aug 1/)
    expect(screen.getByTestId('rule-3')).toHaveTextContent(/you chose always allow on run #4127/)
  })

  test('toggling a rule decision patches that rule', async () => {
    await renderSettings()
    await fireEvent.press(screen.getByTestId('rule-2-decision-allow'))
    await waitFor(() => expect(mockPatchRule).toHaveBeenCalledWith(2, { decision: 'allow' }))
    // pressing the already-selected segment is a no-op
    await fireEvent.press(screen.getByTestId('rule-1-decision-allow'))
    expect(mockPatchRule).toHaveBeenCalledTimes(1)
  })

  test('adding a rule sends title, tool, parsed patterns, decision and publishes', async () => {
    await renderSettings()
    await fireEvent.press(screen.getByTestId('open-add-rule'))
    await fireEvent.changeText(await screen.findByTestId('rule-title-input'), 'Run a database migration')
    await fireEvent.changeText(screen.getByTestId('rule-patterns-input'), '*db:migrate*\n*prisma migrate*')
    await fireEvent.press(screen.getByTestId('rule-decision-new-ask'))
    await fireEvent.press(screen.getByTestId('rule-publishes'))
    await fireEvent.press(screen.getByTestId('add-rule-confirm'))
    await waitFor(() =>
      expect(mockCreateRule).toHaveBeenCalledWith({
        title: 'Run a database migration',
        tool: 'Bash',
        patterns: ['*db:migrate*', '*prisma migrate*'],
        decision: 'ask',
        publishes: true,
      }),
    )
  })

  test('harness switch carries the model/effort fallback the server applies', async () => {
    mockAdapters.mockResolvedValue([
      adapter(),
      adapter({ id: 'gemini', label: 'Gemini', models: ['gemini-3-pro'], efforts: ['default'] }),
    ])
    await renderSettings()
    await screen.findByTestId('harness-gemini')
    await fireEvent.press(screen.getByTestId('harness-gemini'))
    await waitFor(() =>
      expect(mockPatchSettings).toHaveBeenCalledWith({ adapter: 'gemini', model: 'gemini-3-pro', effort: 'default' }),
    )
  })

  test('an unavailable harness is disabled with a hint; effort buttons patch effort', async () => {
    await renderSettings()
    await screen.findByTestId('harness-hint-codex')
    await fireEvent.press(screen.getByTestId('harness-codex'))
    expect(mockPatchSettings).not.toHaveBeenCalled()
    await fireEvent.press(screen.getByTestId('effort-high'))
    await waitFor(() => expect(mockPatchSettings).toHaveBeenCalledWith({ effort: 'high' }))
  })

  test('the concurrency stepper patches settings and reflects the response', async () => {
    await renderSettings()
    expect(within(screen.getByTestId('concurrency-stepper')).getByText('2')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('concurrency-stepper-increment'))
    await waitFor(() => expect(mockPatchSettings).toHaveBeenCalledWith({ concurrency: 3 }))
    await waitFor(() => expect(within(screen.getByTestId('concurrency-stepper')).getByText('3')).toBeTruthy())
  })

  test('pings: the channel pill and the re-ping menu patch settings', async () => {
    await renderSettings()
    await fireEvent.press(screen.getByTestId('ping-channel-off'))
    await waitFor(() => expect(mockPatchSettings).toHaveBeenCalledWith({ pingChannel: 'off' }))
    await fireEvent.press(screen.getByTestId('reping-menu-trigger'))
    await fireEvent.press(await screen.findByTestId('reping-option-0'))
    await waitFor(() => expect(mockPatchSettings).toHaveBeenCalledWith({ repingMs: 0 }))
  })

  test('adding a repo validates the URL, then clones', async () => {
    await renderSettings()
    await fireEvent.press(screen.getByTestId('open-add-repo'))
    await fireEvent.changeText(await screen.findByTestId('add-repo-url-input'), 'nope')
    await fireEvent.press(screen.getByTestId('add-repo-confirm'))
    expect(await screen.findByTestId('add-repo-error')).toBeTruthy()
    expect(mockAddSource).not.toHaveBeenCalled()
    await fireEvent.changeText(screen.getByTestId('add-repo-url-input'), 'https://github.com/acme/parlor-web.git')
    await fireEvent.press(screen.getByTestId('add-repo-confirm'))
    await waitFor(() => expect(mockAddSource).toHaveBeenCalledWith({ type: 'repo', url: 'https://github.com/acme/parlor-web.git' }))
  })
})
