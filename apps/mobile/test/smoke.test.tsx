import { render, waitFor } from '@testing-library/react-native'
import Index from '../app/index'
import { ConnectionProvider } from '../src/ConnectionContext'

const mockRedirect = jest.fn((_props: { href: string }) => null)
jest.mock('expo-router', () => ({
  Redirect: (props: { href: string }) => mockRedirect(props),
}))

jest.mock('../src/settings', () => ({
  loadConnection: jest.fn(),
  saveConnection: jest.fn(async () => undefined),
  clearConnection: jest.fn(async () => undefined),
}))

import { loadConnection } from '../src/settings'

describe('Index routing', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('redirects to /workspaces when a connection is stored', async () => {
    ;(loadConnection as jest.Mock).mockResolvedValueOnce({ baseUrl: 'https://x.com', token: 't' })

    await render(
      <ConnectionProvider>
        <Index />
      </ConnectionProvider>,
    )

    await waitFor(() => {
      expect(mockRedirect).toHaveBeenCalledWith({ href: '/workspaces' })
    })
  })

  test('redirects to /connect when there is no stored connection', async () => {
    ;(loadConnection as jest.Mock).mockResolvedValueOnce(null)

    await render(
      <ConnectionProvider>
        <Index />
      </ConnectionProvider>,
    )

    await waitFor(() => {
      expect(mockRedirect).toHaveBeenCalledWith({ href: '/connect' })
    })
  })
})
