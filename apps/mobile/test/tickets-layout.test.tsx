import { render, waitFor } from '@testing-library/react-native'
import TicketsLayout from '../app/tickets/_layout'
import { ConnectionProvider } from '../src/ConnectionContext'

const mockRedirect = jest.fn((_props: { href: string }) => null)
jest.mock('expo-router', () => ({
  Redirect: (props: { href: string }) => mockRedirect(props),
  Stack: () => null,
}))

jest.mock('../src/settings', () => ({
  loadConnection: jest.fn(async () => null),
  saveConnection: jest.fn(async () => undefined),
  clearConnection: jest.fn(async () => undefined),
}))

describe('Tickets layout guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('redirects to /connect when there is no connection', async () => {
    await render(
      <ConnectionProvider>
        <TicketsLayout />
      </ConnectionProvider>,
    )

    await waitFor(() => {
      expect(mockRedirect).toHaveBeenCalledWith({ href: '/connect' })
    })
  })
})
