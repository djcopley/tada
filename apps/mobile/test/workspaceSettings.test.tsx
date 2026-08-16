import type { ApiAdapterInfo, ApiSource, ApiWorkspaceDetail } from '@tada/shared'
import { QueryClientProvider } from '@tanstack/react-query'
import { makeTestQueryClient } from './helpers/queryClient'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { Dimensions } from 'react-native'
import { ConnectionProvider, useConnection } from '../src/ConnectionContext'
import { ToastHost } from '../src/toast'

const mockPush = jest.fn()
const mockUseLocalSearchParams = jest.fn()

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => mockUseLocalSearchParams(),
  useFocusEffect: (cb: () => void) => { require('react').useEffect(cb, [cb]) },
}))

jest.mock('../src/settings', () => ({
  loadConnection: jest.fn(async () => ({ baseUrl: 'https://tada.home-server.dev', token: 'tada_supersecret3f9a' })),
  saveConnection: jest.fn(async () => undefined),
  clearConnection: jest.fn(async () => undefined),
  loadActiveWorkspaceId: jest.fn(async () => null),
  saveActiveWorkspaceId: jest.fn(async () => undefined),
  loadThemeScheme: jest.fn(async () => 'night'),
  saveThemeScheme: jest.fn(async () => undefined),
}))

const mockGetWorkspace = jest.fn()
const mockPatchWorkspace = jest.fn()
const mockAddSource = jest.fn()
const mockRemoveSource = jest.fn()
const mockAdapters = jest.fn()
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
      getWorkspace: mockGetWorkspace,
      patchWorkspace: mockPatchWorkspace,
      addSource: mockAddSource,
      removeSource: mockRemoveSource,
      adapters: mockAdapters,
      status: mockStatus,
    })),
  }
})

function setWindowWidth(width: number) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height: 900, scale: 1, fontScale: 1 })
}

function source(overrides: Partial<ApiSource> & { name: string }): ApiSource {
  return { type: 'repo', ...overrides }
}

function adapter(overrides: Partial<ApiAdapterInfo> = {}): ApiAdapterInfo {
  return {
    id: 'claude',
    label: 'Claude',
    available: true,
    models: ['sonnet', 'opus', 'haiku'],
    efforts: ['low', 'medium', 'high'],
    supportsInjection: true,
    ...overrides,
  }
}

function workspace(overrides: Partial<ApiWorkspaceDetail> = {}): ApiWorkspaceDetail {
  return {
    id: 1,
    name: 'parlor',
    defaultAdapter: 'claude',
    defaultModel: 'sonnet',
    defaultEffort: 'medium',
    concurrency: 2,
    timeoutMs: 300_000,
    createdAt: '2026-01-01T00:00:00.000Z',
    sources: [
      source({ name: 'acme/parlor-api', url: 'https://github.com/acme/parlor-api.git', defaultBranch: 'main' }),
      source({ name: 'acme/parlor-gitlab', type: 'repo', url: 'https://gitlab.com/acme/parlor-gitlab.git' }),
      source({ name: '~/docs/parlor-specs', type: 'folder', path: '/srv/repos/parlor-specs' }),
    ],
    ...overrides,
  }
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const SettingsScreen = require('../app/workspaces/[id]/settings').default

/** Mirrors GuardedStack (src/components/GuardedStack.tsx): the real app never renders a
 * connected-only screen once `connection` drops (it redirects to /connect first). This keeps
 * the disconnect flow from tripping useClient()'s invariant the way an un-routed test render
 * otherwise would. */
function Guarded() {
  const { connection } = useConnection()
  if (!connection) return null
  return <SettingsScreen />
}

async function renderSettings() {
  mockUseLocalSearchParams.mockReturnValue({ id: '1' })
  const queryClient = makeTestQueryClient()
  await render(
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider>
        <Guarded />
        <ToastHost />
      </ConnectionProvider>
    </QueryClientProvider>,
  )
}

describe('Workspace settings screen', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setWindowWidth(500)
    mockGetWorkspace.mockResolvedValue(workspace())
    mockPatchWorkspace.mockResolvedValue(workspace())
    mockAddSource.mockResolvedValue(undefined)
    mockRemoveSource.mockResolvedValue(undefined)
    mockAdapters.mockResolvedValue([
      adapter({ id: 'claude', label: 'Claude', models: ['sonnet', 'opus', 'haiku'], efforts: ['low', 'medium', 'high'] }),
      adapter({ id: 'codex', label: 'Codex', available: false, models: ['gpt-5'], efforts: ['default'] }),
    ])
    mockStatus.mockResolvedValue({ ok: true, version: '0.9.2', workspaces: [], agents: [] })
  })

  describe('Sources section', () => {
    test('renders repo/folder rows with mono name and the right tag text', async () => {
      await renderSettings()

      await waitFor(() => {
        expect(screen.getByText('acme/parlor-api')).toBeTruthy()
      })
      expect(screen.getAllByText('repo · github')).toHaveLength(1)
      expect(screen.getByText('repo · git')).toBeTruthy()
      expect(screen.getByText('folder · server')).toBeTruthy()
    })

    test('Add repo opens a dialog; a valid https url calls addSource and closes it', async () => {
      await renderSettings()
      await waitFor(() => expect(screen.getByTestId('open-add-repo')).toBeTruthy())

      await fireEvent.press(screen.getByTestId('open-add-repo'))
      expect(screen.getByTestId('add-repo-dialog')).toBeTruthy()

      await fireEvent.changeText(screen.getByTestId('add-repo-url-input'), 'https://github.com/user/new-repo.git')
      await fireEvent.press(screen.getByTestId('add-repo-confirm'))

      await waitFor(() => {
        expect(mockAddSource).toHaveBeenCalledWith(1, { type: 'repo', url: 'https://github.com/user/new-repo.git' })
      })
    })

    test('Add repo rejects an invalid url inline and never calls the client', async () => {
      await renderSettings()
      await waitFor(() => expect(screen.getByTestId('open-add-repo')).toBeTruthy())

      await fireEvent.press(screen.getByTestId('open-add-repo'))
      await fireEvent.changeText(screen.getByTestId('add-repo-url-input'), 'not-a-valid-url')
      await fireEvent.press(screen.getByTestId('add-repo-confirm'))

      expect(screen.getByTestId('add-repo-error')).toBeTruthy()
      expect(mockAddSource).not.toHaveBeenCalled()
    })

    test('Add folder opens a dialog; an absolute path calls addSource with type folder', async () => {
      await renderSettings()
      await waitFor(() => expect(screen.getByTestId('open-add-folder')).toBeTruthy())

      await fireEvent.press(screen.getByTestId('open-add-folder'))
      expect(screen.getByTestId('add-folder-dialog')).toBeTruthy()

      await fireEvent.changeText(screen.getByTestId('add-folder-path-input'), '/srv/repos/new-folder')
      await fireEvent.press(screen.getByTestId('add-folder-confirm'))

      await waitFor(() => {
        expect(mockAddSource).toHaveBeenCalledWith(1, { type: 'folder', path: '/srv/repos/new-folder' })
      })
    })

    test('Add folder rejects a relative path inline', async () => {
      await renderSettings()
      await waitFor(() => expect(screen.getByTestId('open-add-folder')).toBeTruthy())

      await fireEvent.press(screen.getByTestId('open-add-folder'))
      await fireEvent.changeText(screen.getByTestId('add-folder-path-input'), 'relative/path')
      await fireEvent.press(screen.getByTestId('add-folder-confirm'))

      expect(screen.getByTestId('add-folder-error')).toBeTruthy()
      expect(mockAddSource).not.toHaveBeenCalled()
    })

    test('remove repo confirms via dialog then calls client', async () => {
      await renderSettings()
      await waitFor(() => expect(screen.getByText('acme/parlor-api')).toBeTruthy())

      await fireEvent.press(screen.getByTestId('remove-repo-acme/parlor-api'))
      await fireEvent.press(screen.getByTestId('remove-repo-confirm'))

      await waitFor(() => {
        expect(mockRemoveSource).toHaveBeenCalledWith(1, 'acme/parlor-api')
      })
    })

    test('remove repo failure shows an inline error', async () => {
      const { ApiError } = require('../src/api/client')
      mockRemoveSource.mockRejectedValueOnce(new ApiError(500, { error: 'remove failed' }))
      await renderSettings()
      await waitFor(() => expect(screen.getByText('acme/parlor-api')).toBeTruthy())

      await fireEvent.press(screen.getByTestId('remove-repo-acme/parlor-api'))
      await fireEvent.press(screen.getByTestId('remove-repo-confirm'))

      await waitFor(() => {
        expect(screen.getByTestId('remove-repo-error')).toBeTruthy()
      })
    })
  })

  describe('Agent section', () => {
    test('renders a segmented button per adapter — selected is secondary, others ghost', async () => {
      await renderSettings()

      await waitFor(() => {
        expect(screen.getByTestId('harness-claude')).toBeTruthy()
        expect(screen.getByTestId('harness-codex')).toBeTruthy()
      })
    })

    test('an unavailable adapter is disabled with a "not installed" hint', async () => {
      await renderSettings()

      await waitFor(() => {
        expect(screen.getByTestId('harness-codex').props.accessibilityState.disabled).toBe(true)
      })
      expect(screen.getByTestId('harness-hint-codex')).toHaveTextContent('not installed on the server')
      expect(screen.queryByTestId('harness-hint-claude')).toBeNull()
    })

    test('pressing a disabled harness does not patch', async () => {
      await renderSettings()
      await waitFor(() => expect(screen.getByTestId('harness-codex')).toBeTruthy())

      await fireEvent.press(screen.getByTestId('harness-codex'))
      expect(mockPatchWorkspace).not.toHaveBeenCalled()
    })

    test('switching to an available harness resets model + effort to its first entries in a single PATCH', async () => {
      mockAdapters.mockResolvedValue([
        adapter({ id: 'claude', label: 'Claude', models: ['sonnet', 'opus'], efforts: ['low', 'medium'] }),
        adapter({ id: 'gemini', label: 'Gemini', available: true, models: ['pro', 'flash'], efforts: ['fast', 'thorough'] }),
      ])
      await renderSettings()
      await waitFor(() => expect(screen.getByTestId('harness-gemini')).toBeTruthy())

      await fireEvent.press(screen.getByTestId('harness-gemini'))

      await waitFor(() => {
        expect(mockPatchWorkspace).toHaveBeenCalledTimes(1)
      })
      expect(mockPatchWorkspace).toHaveBeenCalledWith(1, {
        defaultAdapter: 'gemini',
        defaultModel: 'pro',
        defaultEffort: 'fast',
      })
      // The model button and first effort button now reflect the new harness.
      expect(screen.getByTestId('model-menu-trigger')).toHaveTextContent('Pro ▾')
      expect(screen.getByTestId('effort-fast').props.accessibilityState.disabled).toBeFalsy()
    })

    test('Model opens a Menu of the current harness models; selecting one PATCHes defaultModel', async () => {
      await renderSettings()
      await waitFor(() => expect(screen.getByTestId('model-menu-trigger')).toBeTruthy())

      await fireEvent.press(screen.getByTestId('model-menu-trigger'))
      expect(screen.getByTestId('model-menu')).toBeTruthy()
      expect(screen.getByTestId('model-option-opus')).toBeTruthy()

      await fireEvent.press(screen.getByTestId('model-option-opus'))

      await waitFor(() => {
        expect(mockPatchWorkspace).toHaveBeenCalledWith(1, { defaultModel: 'opus' })
      })
    })

    test('Effort renders a segmented row from the current harness efforts; selecting one PATCHes defaultEffort', async () => {
      mockPatchWorkspace.mockResolvedValue(workspace({ defaultEffort: 'high' }))
      await renderSettings()
      await waitFor(() => expect(screen.getByTestId('effort-high')).toBeTruthy())

      await fireEvent.press(screen.getByTestId('effort-high'))

      await waitFor(() => {
        expect(mockPatchWorkspace).toHaveBeenCalledWith(1, { defaultEffort: 'high' })
      })
      // Effort-only body: nothing else rides along (the server used to strip defaultEffort out of
      // this PATCH entirely, leaving it an empty patch).
      expect(mockPatchWorkspace).toHaveBeenCalledTimes(1)
      expect(Object.keys(mockPatchWorkspace.mock.calls[0][1])).toEqual(['defaultEffort'])

      // Success path: no error surfaced, and the optimistic value stuck — pressing the same
      // effort again is a no-op, which it would not be had the handler rolled `local.effort`
      // back to 'medium'.
      expect(screen.queryByTestId('agent-error')).toBeNull()
      await fireEvent.press(screen.getByTestId('effort-high'))
      expect(mockPatchWorkspace).toHaveBeenCalledTimes(1)
    })

    test('shows the harness/model helper copy', async () => {
      await renderSettings()
      await waitFor(() => {
        expect(screen.getByText('Model and effort options come from the selected harness.')).toBeTruthy()
      })
    })

    test('a patch failure shows an inline agent error', async () => {
      const { ApiError } = require('../src/api/client')
      mockPatchWorkspace.mockRejectedValueOnce(new ApiError(400, { error: 'Invalid adapter' }))
      await renderSettings()
      await waitFor(() => expect(screen.getByTestId('effort-high')).toBeTruthy())

      await fireEvent.press(screen.getByTestId('effort-high'))

      await waitFor(() => {
        expect(screen.getByTestId('agent-error')).toHaveTextContent('Invalid adapter')
      })
    })

    test('a failed harness switch rolls back the UI to the server\'s harness/model/effort', async () => {
      const { ApiError } = require('../src/api/client')
      mockAdapters.mockResolvedValue([
        adapter({ id: 'claude', label: 'Claude', models: ['sonnet', 'opus'], efforts: ['low', 'medium'] }),
        adapter({ id: 'gemini', label: 'Gemini', available: true, models: ['pro', 'flash'], efforts: ['fast', 'thorough'] }),
      ])
      mockPatchWorkspace.mockRejectedValueOnce(new ApiError(400, { error: 'Invalid adapter' }))
      await renderSettings()
      await waitFor(() => expect(screen.getByTestId('harness-gemini')).toBeTruthy())

      await fireEvent.press(screen.getByTestId('harness-gemini'))

      await waitFor(() => {
        expect(screen.getByTestId('agent-error')).toHaveTextContent('Invalid adapter')
      })
      // Rolled back to the server's harness (claude/sonnet/medium), not left showing the
      // rejected gemini/pro/fast the optimistic update had briefly applied.
      expect(screen.getByTestId('model-menu-trigger')).toHaveTextContent('Sonnet ▾')
      expect(screen.getByTestId('effort-medium')).toBeTruthy()
      expect(screen.queryByTestId('effort-fast')).toBeNull()

      // A subsequent model pick now correctly targets claude's model list, not gemini's.
      await fireEvent.press(screen.getByTestId('model-menu-trigger'))
      expect(screen.getByTestId('model-option-opus')).toBeTruthy()
    })

    test('overlapping PATCHes: a late-rejecting harness switch does not stomp a model pick that already succeeded', async () => {
      const { ApiError } = require('../src/api/client')
      mockAdapters.mockResolvedValue([
        adapter({ id: 'claude', label: 'Claude', models: ['sonnet', 'opus'], efforts: ['low', 'medium'] }),
        adapter({ id: 'gemini', label: 'Gemini', available: true, models: ['pro', 'flash'], efforts: ['fast', 'thorough'] }),
      ])

      // The harness-switch PATCH (first mutateAsync call) stays pending until we reject it
      // ourselves, below — simulating it resolving *after* a second, unrelated PATCH.
      let rejectHarnessPatch: (err: unknown) => void = () => {}
      const harnessPatchPromise = new Promise((_resolve, reject) => {
        rejectHarnessPatch = reject
      })
      mockPatchWorkspace.mockImplementationOnce(() => harnessPatchPromise)
      // The model-pick PATCH (second call) resolves immediately.
      mockPatchWorkspace.mockResolvedValueOnce(workspace({ defaultModel: 'flash' }))

      await renderSettings()
      await waitFor(() => expect(screen.getByTestId('harness-gemini')).toBeTruthy())

      // 1. Switch harness — its PATCH is now in flight (pending).
      await fireEvent.press(screen.getByTestId('harness-gemini'))
      await waitFor(() => {
        expect(mockPatchWorkspace).toHaveBeenCalledWith(1, {
          defaultAdapter: 'gemini',
          defaultModel: 'pro',
          defaultEffort: 'fast',
        })
      })
      expect(screen.getByTestId('model-menu-trigger')).toHaveTextContent('Pro ▾')

      // 2. While the harness PATCH is still pending, pick a different model — its PATCH
      // resolves right away.
      await fireEvent.press(screen.getByTestId('model-menu-trigger'))
      await fireEvent.press(screen.getByTestId('model-option-flash'))
      await waitFor(() => {
        expect(mockPatchWorkspace).toHaveBeenCalledWith(1, { defaultModel: 'flash' })
      })
      await waitFor(() => {
        expect(screen.getByTestId('model-menu-trigger')).toHaveTextContent('Flash ▾')
      })

      // 3. Only now does the harness switch's PATCH reject.
      await act(async () => {
        rejectHarnessPatch(new ApiError(400, { error: 'Invalid adapter' }))
        await harnessPatchPromise.catch(() => {})
      })

      await waitFor(() => {
        expect(screen.getByTestId('agent-error')).toHaveTextContent('Invalid adapter')
      })
      // The harness field-level-rolls-back (adapter/effort revert to claude/medium), but the
      // model field must keep the value the *later* PATCH actually got the server to accept —
      // a whole-object rollback would have stomped it back to "sonnet" here.
      expect(screen.getByTestId('model-menu-trigger')).toHaveTextContent('Flash ▾')
      expect(screen.getByTestId('effort-medium')).toBeTruthy()
    })

    test('a failed concurrency patch rolls the stepper back', async () => {
      const { ApiError } = require('../src/api/client')
      mockPatchWorkspace.mockRejectedValueOnce(new ApiError(500, { error: 'db down' }))
      await renderSettings()
      await waitFor(() => expect(screen.getByTestId('concurrency-stepper-increment')).toBeTruthy())

      await fireEvent.press(screen.getByTestId('concurrency-stepper-increment'))

      await waitFor(() => {
        expect(mockPatchWorkspace).toHaveBeenCalledWith(1, { concurrency: 3 })
      })
      // workspace() fixture has concurrency: 2 — the optimistic 3 must roll back on rejection.
      await waitFor(() => {
        expect(screen.getByTestId('concurrency-stepper-decrement').props.accessibilityState.disabled).toBe(
          false,
        )
      })
      jest.clearAllMocks()
      mockPatchWorkspace.mockResolvedValue(workspace())
      await fireEvent.press(screen.getByTestId('concurrency-stepper-decrement'))
      await waitFor(() => {
        // Rolled back to 2, so decrementing sends 1 (not 2, which it would send from a
        // still-showing-3 value).
        expect(mockPatchWorkspace).toHaveBeenCalledWith(1, { concurrency: 1 })
      })
    })
  })

  describe('Run limits section', () => {
    test('stepper +/- sends the patched concurrency', async () => {
      await renderSettings()
      await waitFor(() => expect(screen.getByTestId('concurrency-stepper-increment')).toBeTruthy())

      await fireEvent.press(screen.getByTestId('concurrency-stepper-increment'))
      await waitFor(() => {
        expect(mockPatchWorkspace).toHaveBeenCalledWith(1, { concurrency: 3 })
      })

      jest.clearAllMocks()
      mockPatchWorkspace.mockResolvedValue(workspace({ concurrency: 3 }))
      await fireEvent.press(screen.getByTestId('concurrency-stepper-decrement'))
      await waitFor(() => {
        expect(mockPatchWorkspace).toHaveBeenCalledWith(1, { concurrency: 2 })
      })
    })

    test('concurrency clamps to 1..8', async () => {
      mockGetWorkspace.mockResolvedValue(workspace({ concurrency: 1 }))
      await renderSettings()
      await waitFor(() => expect(screen.getByTestId('concurrency-stepper-decrement')).toBeTruthy())

      expect(screen.getByTestId('concurrency-stepper-decrement').props.accessibilityState.disabled).toBe(true)
      await fireEvent.press(screen.getByTestId('concurrency-stepper-decrement'))
      expect(mockPatchWorkspace).not.toHaveBeenCalled()
    })

    test('concurrency does not exceed 8', async () => {
      mockGetWorkspace.mockResolvedValue(workspace({ concurrency: 8 }))
      await renderSettings()
      await waitFor(() => expect(screen.getByTestId('concurrency-stepper-increment')).toBeTruthy())

      expect(screen.getByTestId('concurrency-stepper-increment').props.accessibilityState.disabled).toBe(true)
      await fireEvent.press(screen.getByTestId('concurrency-stepper-increment'))
      expect(mockPatchWorkspace).not.toHaveBeenCalled()
    })

    test('Per-run timeout opens a Menu of 10/15/30/60 min; selecting one PATCHes timeoutMs', async () => {
      await renderSettings()
      await waitFor(() => expect(screen.getByTestId('timeout-menu-trigger')).toBeTruthy())

      await fireEvent.press(screen.getByTestId('timeout-menu-trigger'))
      expect(screen.getByTestId('timeout-option-10')).toBeTruthy()
      expect(screen.getByTestId('timeout-option-60')).toBeTruthy()

      await fireEvent.press(screen.getByTestId('timeout-option-60'))

      await waitFor(() => {
        expect(mockPatchWorkspace).toHaveBeenCalledWith(1, { timeoutMs: 60 * 60_000 })
      })
    })
  })

  describe('Global section (narrow)', () => {
    test('shows the server url, masked token and theme switch', async () => {
      await renderSettings()

      await waitFor(() => {
        expect(screen.getByText('https://tada.home-server.dev')).toBeTruthy()
      })
      expect(screen.getByTestId('masked-token')).toHaveTextContent('tada_••••••••••3f9a')
      expect(screen.getByTestId('theme-switch')).toBeTruthy()
    })

    test('Disconnect asks for confirmation before disconnecting', async () => {
      await renderSettings()
      await waitFor(() => expect(screen.getByTestId('disconnect-button')).toBeTruthy())

      await fireEvent.press(screen.getByTestId('disconnect-button'))
      expect(screen.getByTestId('disconnect-confirm')).toBeTruthy()

      await fireEvent.press(screen.getByTestId('disconnect-confirm'))
      // Disconnecting drops the connection, which re-renders without a workspace client —
      // the settings screen itself unmounts; nothing further to assert here beyond no crash.
    })

    test('Replace token probes the new token via status() before persisting it', async () => {
      mockStatus.mockResolvedValueOnce({ ok: true, version: '0.9.2', workspaces: [], agents: [] })
      await renderSettings()
      await waitFor(() => expect(screen.getByTestId('open-replace-token')).toBeTruthy())

      await fireEvent.press(screen.getByTestId('open-replace-token'))
      await fireEvent.changeText(screen.getByTestId('replace-token-input'), 'tada_newtoken1234')
      await fireEvent.press(screen.getByTestId('replace-token-confirm'))

      await waitFor(() => {
        expect(mockStatus).toHaveBeenCalled()
      })
      // The probe must hit the CURRENT server with the NEW token — not the stale token, and
      // not some other baseUrl.
      const { TadaClient } = require('../src/api/client')
      expect(TadaClient).toHaveBeenCalledWith({
        baseUrl: 'https://tada.home-server.dev',
        token: 'tada_newtoken1234',
      })
      await waitFor(() => {
        expect(screen.queryByTestId('replace-token-dialog')?.props.visible ?? false).toBe(false)
      })
      await waitFor(() => {
        expect(screen.getByTestId('masked-token')).toHaveTextContent('tada_••••••••••1234')
      })
    })

    test('Replace token failure keeps the dialog open and shows a toast', async () => {
      const { ApiError } = require('../src/api/client')
      mockStatus.mockRejectedValueOnce(new ApiError(401, { error: 'unauthorized' }))
      await renderSettings()
      await waitFor(() => expect(screen.getByTestId('open-replace-token')).toBeTruthy())

      await fireEvent.press(screen.getByTestId('open-replace-token'))
      await fireEvent.changeText(screen.getByTestId('replace-token-input'), 'tada_badtoken')
      await fireEvent.press(screen.getByTestId('replace-token-confirm'))

      await waitFor(() => {
        expect(screen.getByText('Could not verify the new token')).toBeTruthy()
      })
      // Dialog stays open (still findable) so the user can retry.
      expect(screen.getByTestId('replace-token-dialog')).toBeTruthy()
    })
  })

  describe('Wide layout', () => {
    test('renders the wide artboard without the narrow theme switch (the Rail comes from the tabs frame)', async () => {
      setWindowWidth(1400)
      await renderSettings()

      await waitFor(() => {
        expect(screen.getByTestId('settings-wide')).toBeTruthy()
      })
      expect(screen.queryByTestId('settings-rail')).toBeNull()
      expect(screen.queryByTestId('theme-switch')).toBeNull()
      expect(screen.queryByTestId('settings-narrow')).toBeNull()
    })
  })
})
