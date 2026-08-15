import { StyleSheet } from 'react-native'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import Connect from '../app/connect'
import { ConnectionProvider } from '../src/ConnectionContext'
import { day } from '../src/design/tokens'

const mockReplace = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
}))

jest.mock('../src/settings', () => ({
  loadConnection: jest.fn(async () => null),
  saveConnection: jest.fn(async () => undefined),
  clearConnection: jest.fn(async () => undefined),
}))

const mockHealth = jest.fn()
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
    TadaClient: jest.fn().mockImplementation(() => ({ health: mockHealth, status: mockStatus })),
  }
})

import { ApiError } from '../src/api/client'
import { saveConnection } from '../src/settings'

async function renderConnect() {
  await render(
    <ConnectionProvider>
      <Connect />
    </ConnectionProvider>,
  )
}

async function fillForm() {
  await fireEvent.changeText(screen.getByTestId('base-url-input'), 'https://example.com')
  await fireEvent.changeText(screen.getByTestId('token-input'), 'secret-token')
}

describe('Connect screen', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('renders forced to the light "paper day" palette regardless of the stored scheme', async () => {
    await renderConnect()
    const style = StyleSheet.flatten(screen.getByTestId('connect-screen').props.style)
    expect(style.backgroundColor).toBe(day.ground)
  })

  test('shared Input/Button primitives inside Connect also resolve day colors, not the app scheme', async () => {
    // Regression: Input/Button read colors via useTheme() internally — forcing the palette only
    // in Connect's own inline styles wouldn't touch them. Connect must wrap its subtree in a
    // local ThemeContext override so every descendant, not just Connect's own text, renders day.
    await renderConnect()
    const inputStyle = StyleSheet.flatten(screen.getByTestId('base-url-input').props.style)
    expect(inputStyle.backgroundColor).toBe(day.controlBg)
  })

  test('successful probe shows the full checklist, saves the connection and navigates to /workspaces', async () => {
    mockHealth.mockResolvedValueOnce({ ok: true, version: '0.9.2' })
    mockStatus.mockResolvedValueOnce({
      ok: true,
      version: '0.9.2',
      workspaces: ['parlor', 'ops'],
      agents: [{ id: 'claude', available: true }],
    })
    await renderConnect()

    await fillForm()
    await fireEvent.press(screen.getByTestId('connect-button'))

    await waitFor(() => {
      expect(screen.getByText('✓ server reachable · v0.9.2')).toBeTruthy()
    })
    expect(screen.getByText('✓ 2 workspaces found — parlor, ops')).toBeTruthy()
    expect(screen.getByText('✓ agent keys present on the server')).toBeTruthy()

    await waitFor(() => {
      expect(saveConnection).toHaveBeenCalledWith({
        baseUrl: 'https://example.com',
        token: 'secret-token',
      })
    })
    expect(mockReplace).toHaveBeenCalledWith('/workspaces')
    expect(screen.queryByTestId('connect-error')).toBeNull()
  })

  test('no agent keys on the server shows the muted line but still connects', async () => {
    mockHealth.mockResolvedValueOnce({ ok: true, version: '0.9.2' })
    mockStatus.mockResolvedValueOnce({
      ok: true,
      version: '0.9.2',
      workspaces: [],
      agents: [{ id: 'claude', available: false }],
    })
    await renderConnect()

    await fillForm()
    await fireEvent.press(screen.getByTestId('connect-button'))

    await waitFor(() => {
      expect(screen.getByText('— no agent keys on the server yet')).toBeTruthy()
    })
    expect(screen.getByText('✓ connected — no workspaces yet')).toBeTruthy()
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/workspaces'))
  })

  test('unreachable server shows an inline error and saves nothing', async () => {
    mockHealth.mockRejectedValueOnce(new Error('network down'))
    await renderConnect()

    await fillForm()
    await fireEvent.press(screen.getByTestId('connect-button'))

    await waitFor(() => {
      expect(screen.getByTestId('connect-error')).toHaveTextContent('Could not reach server')
    })
    expect(saveConnection).not.toHaveBeenCalled()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  test('401 from the health probe shows an invalid token error and saves nothing', async () => {
    mockHealth.mockRejectedValueOnce(new ApiError(401, { error: 'unauthorized' }))
    await renderConnect()

    await fillForm()
    await fireEvent.press(screen.getByTestId('connect-button'))

    await waitFor(() => {
      expect(screen.getByTestId('connect-error')).toHaveTextContent('Invalid token')
    })
    expect(saveConnection).not.toHaveBeenCalled()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  test('a typo\'d token: health succeeds (server is reachable) but status 401s — shows Invalid token and saves nothing', async () => {
    // /health is auth-exempt server-side, so a bad token still passes it.
    // The 401 only surfaces on an authenticated route.
    mockHealth.mockResolvedValueOnce({ ok: true, version: '0.9.2' })
    mockStatus.mockRejectedValueOnce(new ApiError(401, { error: 'unauthorized' }))
    await renderConnect()

    await fillForm()
    await fireEvent.press(screen.getByTestId('connect-button'))

    await waitFor(() => {
      expect(screen.getByTestId('connect-error')).toHaveTextContent('Invalid token')
    })
    expect(mockStatus).toHaveBeenCalled()
    expect(saveConnection).not.toHaveBeenCalled()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  test('status failing for a non-auth reason shows "Could not reach server"', async () => {
    mockHealth.mockResolvedValueOnce({ ok: true, version: '0.9.2' })
    mockStatus.mockRejectedValueOnce(new Error('network down'))
    await renderConnect()

    await fillForm()
    await fireEvent.press(screen.getByTestId('connect-button'))

    await waitFor(() => {
      expect(screen.getByTestId('connect-error')).toHaveTextContent('Could not reach server')
    })
    expect(saveConnection).not.toHaveBeenCalled()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  test('disables the connect button while probing', async () => {
    let resolveHealth: (v: { ok: boolean; version: string }) => void = () => {}
    mockHealth.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveHealth = resolve
        }),
    )
    mockStatus.mockResolvedValueOnce({ ok: true, version: '0.9.2', workspaces: [], agents: [] })
    await renderConnect()

    await fillForm()
    // Don't await: the promise only resolves once health() resolves below.
    void fireEvent.press(screen.getByTestId('connect-button'))

    await waitFor(() => {
      expect(screen.getByTestId('connect-button').props.accessibilityState.disabled).toBe(true)
    })

    resolveHealth({ ok: true, version: '0.9.2' })
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/workspaces'))
  })
})
