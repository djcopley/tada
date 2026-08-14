import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import Connect from '../app/connect'
import { ConnectionProvider } from '../src/ConnectionContext'

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
    TadaClient: jest.fn().mockImplementation(() => ({ health: mockHealth })),
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

  test('successful health probe saves the connection and navigates to /workspaces', async () => {
    mockHealth.mockResolvedValueOnce({ ok: true })
    await renderConnect()

    await fillForm()
    await fireEvent.press(screen.getByTestId('connect-button'))

    await waitFor(() => {
      expect(saveConnection).toHaveBeenCalledWith({
        baseUrl: 'https://example.com',
        token: 'secret-token',
      })
    })
    expect(mockReplace).toHaveBeenCalledWith('/workspaces')
    expect(screen.queryByTestId('connect-error')).toBeNull()
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

  test('disables the connect button while probing', async () => {
    let resolveHealth: (v: { ok: boolean }) => void = () => {}
    mockHealth.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveHealth = resolve
        }),
    )
    await renderConnect()

    await fillForm()
    // Don't await: the promise only resolves once health() resolves below.
    void fireEvent.press(screen.getByTestId('connect-button'))

    await waitFor(() => {
      expect(screen.getByTestId('connect-button').props.accessibilityState.disabled).toBe(true)
    })

    resolveHealth({ ok: true })
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/workspaces'))
  })
})
