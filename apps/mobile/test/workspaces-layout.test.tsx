import { render, waitFor } from '@testing-library/react-native'
import WorkspacesLayout from '../app/workspaces/_layout'
import { ConnectionProvider } from '../src/ConnectionContext'

const mockRedirect = jest.fn((_props: { href: string }) => null)
jest.mock('expo-router', () => ({
  Redirect: (props: { href: string }) => mockRedirect(props),
  Stack: Object.assign(() => null, { Screen: () => null }),
}))

jest.mock('../src/settings', () => ({
  loadConnection: jest.fn(async () => null),
  saveConnection: jest.fn(async () => undefined),
  clearConnection: jest.fn(async () => undefined),
}))

describe('Workspaces layout guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('redirects to /connect when there is no connection', async () => {
    await render(
      <ConnectionProvider>
        <WorkspacesLayout />
      </ConnectionProvider>,
    )

    await waitFor(() => {
      expect(mockRedirect).toHaveBeenCalledWith({ href: '/connect' })
    })
  })
})
