import { useQuery } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react-native'
import { AppQueryProvider } from '../app/_layout'
import { ApiError } from '../src/api/client'
import { ConnectionProvider } from '../src/ConnectionContext'

jest.mock('../src/settings', () => ({
  loadConnection: jest.fn(async () => ({ baseUrl: 'https://example.com', token: 'tok' })),
  saveConnection: jest.fn(async () => undefined),
  clearConnection: jest.fn(async () => undefined),
}))

import { clearConnection } from '../src/settings'

function FailingProbe() {
  useQuery({
    queryKey: ['probe'],
    queryFn: () => {
      throw new ApiError(401, { error: 'unauthorized' })
    },
    retry: false,
  })
  return null
}

describe('global 401 handling', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('a 401 ApiError from any query triggers disconnect', async () => {
    await render(
      <ConnectionProvider>
        <AppQueryProvider>
          <FailingProbe />
        </AppQueryProvider>
      </ConnectionProvider>,
    )

    await waitFor(() => {
      expect(clearConnection).toHaveBeenCalled()
    })
  })
})
